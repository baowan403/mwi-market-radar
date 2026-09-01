import { randomUUID } from 'node:crypto';
import * as nodeFileSystem from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Snapshot } from '../core/types';
import { decodeDayChunk, encodeDayChunk } from '../core/storage-codec';
import {
  createDailyHistoryPack,
  decodeDailyHistoryPack,
  encodeDailyHistoryPack,
  upsertDailySummary,
  type DailyHistoryPack,
} from './daily-history';
import { aggregateDailySummary } from './daily-summary';
import {
  CLOUD_RETENTION_MS,
  createManifest,
  parseManifest,
  type ManifestGeneratedAt,
} from './manifest';
import type { CloudManifest } from './types';

const MANIFEST_FILE = 'manifest.json';
const SNAPSHOT_DIRECTORY = 'snapshots';
const DAILY_HISTORY_FILE = 'daily-history.txt';

export type CloudHistoryErrorCode =
  | 'invalid_snapshot'
  | 'manifest'
  | 'older_snapshot'
  | 'snapshot_mismatch'
  | 'storage'
  | 'manifest_publish';

export class CloudHistoryError extends Error {
  readonly code: CloudHistoryErrorCode;

  constructor(code: CloudHistoryErrorCode, message: string) {
    super(message);
    this.name = 'CloudHistoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CloudFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: 'utf8'; flag?: string },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number }>;
}

const defaultFileSystem: CloudFileSystem = {
  mkdir: (path, options) => nodeFileSystem.mkdir(path, options),
  readFile: (path, encoding) => nodeFileSystem.readFile(path, encoding),
  writeFile: (path, data, options) => nodeFileSystem.writeFile(path, data, options),
  rename: (oldPath, newPath) => nodeFileSystem.rename(oldPath, newPath),
  unlink: (path) => nodeFileSystem.unlink(path),
  readdir: (path) => nodeFileSystem.readdir(path),
  stat: (path) => nodeFileSystem.stat(path),
};

export interface UpdateCloudHistoryOptions {
  dataDir: string;
  snapshot: Snapshot;
  generatedAt: ManifestGeneratedAt;
  fileSystem?: Partial<CloudFileSystem>;
  /** Short alias useful for callers that already name their adapter `fs`. */
  fs?: Partial<CloudFileSystem>;
}

export interface CloudHistoryUpdateResult {
  inserted: boolean;
  latestTimestamp: number | null;
  snapshotCount: number;
  manifest: CloudManifest;
  cleanupErrors: string[];
}

function updateResult(
  inserted: boolean,
  manifest: CloudManifest,
  cleanupErrors: string[],
): CloudHistoryUpdateResult {
  return {
    inserted,
    latestTimestamp: manifest.latestTimestamp,
    snapshotCount: manifest.snapshots.length,
    manifest,
    cleanupErrors,
  };
}

function isNodeError(value: unknown, code: string): boolean {
  return value !== null
    && typeof value === 'object'
    && (value as { code?: unknown }).code === code;
}

function storageError(): CloudHistoryError {
  return new CloudHistoryError('storage', 'Cloud history storage operation failed');
}

function manifestError(): CloudHistoryError {
  return new CloudHistoryError('manifest', 'Cloud history manifest is invalid');
}

function mismatchError(): CloudHistoryError {
  return new CloudHistoryError('snapshot_mismatch', 'Cloud snapshot file does not match the requested snapshot');
}

function isValidSnapshot(value: unknown): value is Snapshot {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { timestamp?: unknown }).timestamp === 'number'
    && Number.isSafeInteger((value as { timestamp: number }).timestamp)
    && (value as { timestamp: number }).timestamp >= 0
    && (value as { quotes?: unknown }).quotes !== null
    && typeof (value as { quotes?: unknown }).quotes === 'object'
    && !Array.isArray((value as { quotes?: unknown }).quotes);
}

function manifestPath(dataDir: string): string {
  return join(dataDir, MANIFEST_FILE);
}

function snapshotsDir(dataDir: string): string {
  return join(dataDir, SNAPSHOT_DIRECTORY);
}

function snapshotPath(dataDir: string, timestamp: number): string {
  return join(snapshotsDir(dataDir), `${timestamp}.txt`);
}

function relativeSnapshotPath(timestamp: number): `snapshots/${number}.txt` {
  return `snapshots/${timestamp}.txt`;
}

async function readCurrentManifest(
  dataDir: string,
  generatedAt: ManifestGeneratedAt,
  fileSystem: CloudFileSystem,
): Promise<CloudManifest> {
  let text: string;
  try {
    text = await fileSystem.readFile(manifestPath(dataDir), 'utf8');
  } catch (cause) {
    if (isNodeError(cause, 'ENOENT')) {
      try {
        return createManifest([], generatedAt);
      } catch {
        throw manifestError();
      }
    }
    throw storageError();
  }

  try {
    return parseManifest(JSON.parse(text) as unknown);
  } catch {
    throw manifestError();
  }
}

async function encodeSnapshot(snapshot: Snapshot): Promise<string> {
  if (!isValidSnapshot(snapshot)) throw new CloudHistoryError('invalid_snapshot', 'Cloud snapshot is invalid');
  try {
    const encoded = await encodeDayChunk([snapshot]);
    const decoded = await decodeDayChunk(encoded);
    if (decoded.length !== 1 || !isDeepStrictEqual(decoded[0], snapshot)) {
      throw new Error('snapshot round trip mismatch');
    }
    return encoded;
  } catch (cause) {
    if (cause instanceof CloudHistoryError) throw cause;
    throw new CloudHistoryError('invalid_snapshot', 'Cloud snapshot is invalid');
  }
}

interface ExistingSnapshotFile {
  text: string;
  bytes: number;
}

async function readAndVerifySnapshotFile(
  path: string,
  snapshot: Snapshot,
  fileSystem: CloudFileSystem,
): Promise<ExistingSnapshotFile> {
  let text: string;
  try {
    text = await fileSystem.readFile(path, 'utf8');
  } catch (cause) {
    if (isNodeError(cause, 'ENOENT')) throw cause;
    throw storageError();
  }
  try {
    const decoded = await decodeDayChunk(text);
    if (decoded.length !== 1 || !isDeepStrictEqual(decoded[0], snapshot)) throw mismatchError();
  } catch (cause) {
    if (cause instanceof CloudHistoryError) throw cause;
    throw mismatchError();
  }
  return { text, bytes: Buffer.byteLength(text, 'utf8') };
}

async function ensureImmutableSnapshotFile(
  dataDir: string,
  snapshot: Snapshot,
  encoded: string,
  fileSystem: CloudFileSystem,
): Promise<ExistingSnapshotFile> {
  const path = snapshotPath(dataDir, snapshot.timestamp);
  try {
    return await readAndVerifySnapshotFile(path, snapshot, fileSystem);
  } catch (cause) {
    if (!isNodeError(cause, 'ENOENT')) throw cause;
  }

  try {
    await fileSystem.writeFile(path, encoded, { encoding: 'utf8', flag: 'wx' });
    return { text: encoded, bytes: Buffer.byteLength(encoded, 'utf8') };
  } catch (cause) {
    if (isNodeError(cause, 'EEXIST')) {
      try {
        return await readAndVerifySnapshotFile(path, snapshot, fileSystem);
      } catch (raceError) {
        if (isNodeError(raceError, 'ENOENT')) throw storageError();
        throw raceError;
      }
    }
    throw storageError();
  }
}

async function publishManifest(
  dataDir: string,
  manifest: CloudManifest,
  fileSystem: CloudFileSystem,
): Promise<void> {
  const finalPath = manifestPath(dataDir);
  const tempPath = join(dataDir, `.${MANIFEST_FILE}.tmp-${process.pid}-${randomUUID()}`);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    await fileSystem.writeFile(tempPath, text, { encoding: 'utf8', flag: 'wx' });
    await fileSystem.rename(tempPath, finalPath);
  } catch {
    try {
      await fileSystem.unlink(tempPath);
    } catch {
      // A failed publish must remain a safe, typed error even when cleanup fails.
    }
    throw new CloudHistoryError('manifest_publish', 'Cloud history manifest could not be published');
  }
}

async function readDailyHistory(
  dataDir: string,
  generatedAt: string,
  fileSystem: CloudFileSystem,
): Promise<DailyHistoryPack> {
  try {
    return await decodeDailyHistoryPack(await fileSystem.readFile(join(dataDir, DAILY_HISTORY_FILE), 'utf8'));
  } catch (cause) {
    if (isNodeError(cause, 'ENOENT')) return createDailyHistoryPack([], generatedAt);
    throw storageError();
  }
}

async function publishDailyHistory(
  dataDir: string,
  pack: DailyHistoryPack,
  fileSystem: CloudFileSystem,
): Promise<void> {
  const finalPath = join(dataDir, DAILY_HISTORY_FILE);
  const tempPath = join(dataDir, `.${DAILY_HISTORY_FILE}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await fileSystem.writeFile(tempPath, await encodeDailyHistoryPack(pack), { encoding: 'utf8', flag: 'wx' });
    await fileSystem.rename(tempPath, finalPath);
  } catch {
    try {
      await fileSystem.unlink(tempPath);
    } catch {
      // Preserve the original safe storage failure.
    }
    throw storageError();
  }
}

async function rebuildCurrentDailyHistory(
  dataDir: string,
  snapshot: Snapshot,
  manifest: CloudManifest,
  fileSystem: CloudFileSystem,
): Promise<void> {
  const date = new Date(snapshot.timestamp).toISOString().slice(0, 10);
  const current = await readDailyHistory(dataDir, manifest.generatedAt, fileSystem);
  const existingDates = new Set(current.summaries.map((summary) => summary.date));
  const entries = manifest.snapshots.filter((entry) => {
    const entryDate = new Date(entry.timestamp).toISOString().slice(0, 10);
    return entryDate < date && !existingDates.has(entryDate);
  });
  if (entries.length === 0) return;
  const byDate = new Map<string, Snapshot[]>();
  for (const entry of entries) {
    let decoded: Snapshot[];
    try {
      decoded = await decodeDayChunk(await fileSystem.readFile(join(dataDir, entry.file), 'utf8'));
    } catch {
      throw storageError();
    }
    if (decoded.length !== 1 || decoded[0]?.timestamp !== entry.timestamp) throw mismatchError();
    const entryDate = new Date(entry.timestamp).toISOString().slice(0, 10);
    const values = byDate.get(entryDate) ?? [];
    values.push(decoded[0]);
    byDate.set(entryDate, values);
  }
  if (byDate.size === 0) return;
  let next = current;
  for (const values of byDate.values()) {
    next = upsertDailySummary(next, aggregateDailySummary(values), manifest.generatedAt);
  }
  await publishDailyHistory(dataDir, next, fileSystem);
}

async function pruneSnapshotFiles(
  dataDir: string,
  manifest: CloudManifest,
  fileSystem: CloudFileSystem,
): Promise<string[]> {
  const cleanupErrors: string[] = [];
  const latestTimestamp = manifest.latestTimestamp;
  if (latestTimestamp === null) return cleanupErrors;

  let names: string[];
  try {
    names = await fileSystem.readdir(snapshotsDir(dataDir));
  } catch (cause) {
    if (isNodeError(cause, 'ENOENT')) return cleanupErrors;
    return ['list'];
  }

  const cutoff = latestTimestamp - CLOUD_RETENTION_MS;
  const retainedFiles = new Set(manifest.snapshots.map((entry) => entry.file));
  for (const name of names) {
    const match = /^(\d+)\.txt$/.exec(name);
    if (match === null) continue;
    const timestampText = match[1];
    if (timestampText === undefined) continue;
    const timestamp = Number(timestampText);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= cutoff) continue;
    const relativeFile = relativeSnapshotPath(timestamp);
    if (retainedFiles.has(relativeFile)) continue;
    try {
      await fileSystem.unlink(join(snapshotsDir(dataDir), name));
    } catch (cause) {
      if (isNodeError(cause, 'ENOENT')) continue;
      cleanupErrors.push('delete');
    }
  }
  return cleanupErrors;
}

/** Persist one immutable snapshot and atomically publish the retained manifest. */
export async function updateCloudHistory(
  options: UpdateCloudHistoryOptions,
): Promise<CloudHistoryUpdateResult> {
  const fileSystem: CloudFileSystem = {
    ...defaultFileSystem,
    ...(options.fs ?? {}),
    ...(options.fileSystem ?? {}),
  };
  const encoded = await encodeSnapshot(options.snapshot);
  let previous: CloudManifest;
  try {
    await fileSystem.mkdir(options.dataDir, { recursive: true });
    await fileSystem.mkdir(snapshotsDir(options.dataDir), { recursive: true });
    previous = await readCurrentManifest(options.dataDir, options.generatedAt, fileSystem);
  } catch (cause) {
    if (cause instanceof CloudHistoryError) throw cause;
    throw storageError();
  }

  if (
    previous.latestTimestamp !== null
    && options.snapshot.timestamp < previous.latestTimestamp
  ) {
    return updateResult(false, previous, []);
  }

  const existingEntry = previous.snapshots.find((entry) => entry.timestamp === options.snapshot.timestamp);
  const existingFile = await ensureImmutableSnapshotFile(
    options.dataDir,
    options.snapshot,
    encoded,
    fileSystem,
  );
  if (existingEntry !== undefined) {
    if (existingEntry.bytes !== existingFile.bytes) throw mismatchError();
    await rebuildCurrentDailyHistory(options.dataDir, options.snapshot, previous, fileSystem);
    const cleanupErrors = await pruneSnapshotFiles(options.dataDir, previous, fileSystem);
    return updateResult(false, previous, cleanupErrors);
  }

  const next = createManifest(
    [...previous.snapshots, {
      timestamp: options.snapshot.timestamp,
      file: relativeSnapshotPath(options.snapshot.timestamp),
      bytes: existingFile.bytes,
    }],
    options.generatedAt,
  );
  await publishManifest(options.dataDir, next, fileSystem);
  await rebuildCurrentDailyHistory(options.dataDir, options.snapshot, next, fileSystem);
  const cleanupErrors = await pruneSnapshotFiles(options.dataDir, next, fileSystem);
  return updateResult(true, next, cleanupErrors);
}

export const CLOUD_HISTORY_MANIFEST_FILE = MANIFEST_FILE;
export const CLOUD_HISTORY_SNAPSHOT_DIRECTORY = SNAPSHOT_DIRECTORY;
export const CLOUD_DAILY_HISTORY_FILE = DAILY_HISTORY_FILE;
