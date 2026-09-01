import { randomUUID } from 'node:crypto';
import * as nodeFileSystem from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import type { Snapshot } from '../src/core/types';
import { decodeDayChunk } from '../src/core/storage-codec';
import { buildBackfillSnapshots, validateOfficialOverlap } from '../src/backfill/stockmarket-backfill';
import { createStockmarketClient } from '../src/backfill/stockmarket-client';
import type { StockmarketHistoryPoint } from '../src/backfill/stockmarket-schema';
import {
  CLOUD_DAILY_HISTORY_FILE,
  CLOUD_HISTORY_MANIFEST_FILE,
  mergeCloudHistory,
  type CloudFileSystem,
} from '../src/cloud/history-store';
import { CLOUD_RETENTION_MS, parseManifest } from '../src/cloud/manifest';
import { decodeDailyHistoryPack } from '../src/cloud/daily-history';
import {
  createHistoryProvenance,
  HISTORY_PROVENANCE_FILE,
  parseHistoryProvenance,
  type HistoryProvenance,
} from '../src/cloud/provenance';
import type { CloudManifest } from '../src/cloud/types';

const MINIMUM_SNAPSHOTS = 150;
const MAXIMUM_SNAPSHOTS = 168;
const MINIMUM_LATEST_OVERLAP_COMPARISONS = 1_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export class StockmarketBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockmarketBackfillError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface StockmarketBackfillArgs {
  dataDir: string;
  force: boolean;
}

export interface StockmarketBackfillOptions {
  dataDir: string;
  generatedAt: string;
  client?: { loadAll(): Promise<Map<string, StockmarketHistoryPoint[]>> };
  createClient?: () => { loadAll(): Promise<Map<string, StockmarketHistoryPoint[]>> };
  fileSystem?: Partial<CloudFileSystem>;
  /** Short alias useful for callers that already name their adapter `fs`. */
  fs?: Partial<CloudFileSystem>;
  now?: () => number;
  force?: boolean;
}

export type StockmarketBackfillResult =
  | { skipped: true }
  | {
    skipped: false;
    itemCount: number;
    inserted: number;
    snapshotCount: number;
    overlapComparisons: number;
    fromTimestamp: number;
    toTimestamp: number;
  };

const defaultFileSystem: CloudFileSystem = {
  mkdir: (path, options) => nodeFileSystem.mkdir(path, options),
  readFile: (path, encoding) => nodeFileSystem.readFile(path, encoding),
  writeFile: (path, data, options) => nodeFileSystem.writeFile(path, data, options),
  rename: (oldPath, newPath) => nodeFileSystem.rename(oldPath, newPath),
  unlink: (path) => nodeFileSystem.unlink(path),
  readdir: (path) => nodeFileSystem.readdir(path),
  stat: (path) => nodeFileSystem.stat(path),
};

function fileSystemFor(options: Pick<StockmarketBackfillOptions, 'fileSystem' | 'fs'>): CloudFileSystem {
  return { ...defaultFileSystem, ...(options.fs ?? {}), ...(options.fileSystem ?? {}) };
}

function isNodeError(value: unknown, code: string): boolean {
  return value !== null && typeof value === 'object' && (value as { code?: unknown }).code === code;
}

function safeError(message: string): StockmarketBackfillError {
  return new StockmarketBackfillError(message);
}

/** Parse the deliberately small, non-configurable backfill CLI surface. */
export function parseBackfillArgs(argv: readonly string[]): StockmarketBackfillArgs {
  let dataDir: string | null = null;
  let force = false;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--data-dir') {
      if (seen.has(value)) throw safeError('Invalid stockmarket backfill arguments');
      seen.add(value);
      const path = argv[index + 1];
      if (path === undefined || path.length === 0 || path.startsWith('--')) {
        throw safeError('Invalid stockmarket backfill arguments');
      }
      dataDir = path;
      index += 1;
      continue;
    }
    if (value === '--force') {
      if (seen.has(value)) throw safeError('Invalid stockmarket backfill arguments');
      seen.add(value);
      force = true;
      continue;
    }
    throw safeError('Invalid stockmarket backfill arguments');
  }
  if (dataDir === null) throw safeError('Invalid stockmarket backfill arguments');
  return { dataDir, force };
}

interface ExistingHistory {
  manifest: CloudManifest;
  officialSnapshots: Snapshot[];
  provenance: HistoryProvenance | null;
}

async function readRequired(fileSystem: CloudFileSystem, path: string): Promise<string> {
  try {
    return await fileSystem.readFile(path, 'utf8');
  } catch {
    throw safeError('Stockmarket backfill validation failed');
  }
}

async function validateExistingHistory(dataDir: string, fileSystem: CloudFileSystem): Promise<ExistingHistory> {
  let manifest: CloudManifest;
  try {
    manifest = parseManifest(JSON.parse(await readRequired(fileSystem, join(dataDir, CLOUD_HISTORY_MANIFEST_FILE))) as unknown);
  } catch (error) {
    if (error instanceof StockmarketBackfillError) throw error;
    throw safeError('Stockmarket backfill validation failed');
  }
  if (manifest.latestTimestamp === null || manifest.snapshots.length === 0) {
    throw safeError('Stockmarket backfill validation failed');
  }

  const officialSnapshots: Snapshot[] = [];
  for (const entry of manifest.snapshots) {
    const text = await readRequired(fileSystem, join(dataDir, entry.file));
    let decoded: Snapshot[];
    try {
      decoded = await decodeDayChunk(text);
    } catch {
      throw safeError('Stockmarket backfill validation failed');
    }
    if (Buffer.byteLength(text, 'utf8') !== entry.bytes || decoded.length !== 1 || decoded[0]?.timestamp !== entry.timestamp) {
      throw safeError('Stockmarket backfill validation failed');
    }
    officialSnapshots.push(decoded[0]);
  }
  if (officialSnapshots.at(-1)?.timestamp !== manifest.latestTimestamp) {
    throw safeError('Stockmarket backfill validation failed');
  }
  try {
    validateOfficialOverlap([], officialSnapshots);
  } catch {
    throw safeError('Stockmarket backfill validation failed');
  }

  try {
    await fileSystem.readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8')
      .then(decodeDailyHistoryPack);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw safeError('Stockmarket backfill validation failed');
  }

  let provenance: HistoryProvenance | null = null;
  try {
    const text = await fileSystem.readFile(join(dataDir, HISTORY_PROVENANCE_FILE), 'utf8');
    provenance = parseHistoryProvenance(JSON.parse(text) as unknown);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw safeError('Stockmarket backfill validation failed');
  }
  if (provenance !== null && !provenanceMatchesRetainedHistory(provenance, manifest)) {
    throw safeError('Stockmarket backfill validation failed');
  }
  return { manifest, officialSnapshots, provenance };
}

function provenanceMatchesRetainedHistory(provenance: HistoryProvenance, manifest: CloudManifest): boolean {
  const latest = manifest.latestTimestamp;
  if (latest === null || provenance.snapshotCount < MINIMUM_SNAPSHOTS || provenance.snapshotCount > MAXIMUM_SNAPSHOTS) {
    return false;
  }
  if (
    provenance.fromTimestamp > provenance.toTimestamp
    || provenance.toTimestamp > latest
    || provenance.toTimestamp - provenance.fromTimestamp > SEVEN_DAYS_MS
  ) return false;
  const cutoff = latest - CLOUD_RETENTION_MS;
  if (provenance.toTimestamp < cutoff) return true;
  const timestamps = new Set(manifest.snapshots.map((entry) => entry.timestamp));
  if (!timestamps.has(provenance.toTimestamp)) return false;
  if (provenance.fromTimestamp >= cutoff && !timestamps.has(provenance.fromTimestamp)) return false;
  const maximumPrunedHourlyBuckets = Math.max(0, Math.ceil((cutoff - provenance.fromTimestamp) / HOUR_MS));
  const minimumSurvivingSnapshots = Math.max(0, provenance.snapshotCount - maximumPrunedHourlyBuckets);
  const survivingStart = Math.max(provenance.fromTimestamp, cutoff);
  return manifest.snapshots.filter((entry) => (
    entry.timestamp >= survivingStart && entry.timestamp <= provenance.toTimestamp
  )).length >= minimumSurvivingSnapshots;
}

async function publishProvenance(
  dataDir: string,
  provenance: ReturnType<typeof createHistoryProvenance>,
  fileSystem: CloudFileSystem,
): Promise<void> {
  const finalPath = join(dataDir, HISTORY_PROVENANCE_FILE);
  const tempPath = join(dataDir, `.${HISTORY_PROVENANCE_FILE}.tmp-${process.pid}-${randomUUID()}`);
  const text = `${JSON.stringify(provenance, null, 2)}\n`;
  try {
    await fileSystem.writeFile(tempPath, text, { encoding: 'utf8', flag: 'wx' });
    await fileSystem.rename(tempPath, finalPath);
  } catch {
    try {
      await fileSystem.unlink(tempPath);
    } catch {
      // The published manifest remains usable even if best-effort temp cleanup fails.
    }
    throw safeError('Stockmarket backfill provenance could not be published');
  }
}

function isoNow(now: () => number): string {
  try {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DATE_MS) throw new Error('invalid');
    return new Date(value).toISOString();
  } catch {
    throw safeError('Stockmarket backfill validation failed');
  }
}

function latestOverlapComparisons(
  candidates: readonly Snapshot[],
  officialSnapshots: readonly Snapshot[],
  latestTimestamp: number,
): number {
  const imported = candidates.find((snapshot) => snapshot.timestamp === latestTimestamp);
  const official = officialSnapshots.find((snapshot) => snapshot.timestamp === latestTimestamp);
  if (imported === undefined || official === undefined) return 0;
  let comparisons = 0;
  for (const [key, quote] of Object.entries(imported.quotes)) {
    const expected = official.quotes[key as keyof typeof official.quotes];
    if (expected === undefined) continue;
    if (quote.a !== null && expected.a !== null) comparisons += 1;
    if (quote.b !== null && expected.b !== null) comparisons += 1;
  }
  return comparisons;
}

function validateGeneratedAt(value: string): void {
  try {
    createHistoryProvenance({
      fetchedAt: value,
      fromTimestamp: 0,
      toTimestamp: 0,
      snapshotCount: MINIMUM_SNAPSHOTS,
      overlapComparisons: 0,
    });
  } catch {
    throw safeError('Stockmarket backfill validation failed');
  }
}

/**
 * Run the owner-authorized fixed-window history import. It intentionally has
 * no configurable endpoint or time range: the local official latest snapshot
 * defines the only allowed upper bound.
 */
export async function runStockmarketBackfill(options: StockmarketBackfillOptions): Promise<StockmarketBackfillResult> {
  if (!options || typeof options.dataDir !== 'string' || options.dataDir.length === 0 || typeof options.generatedAt !== 'string') {
    throw safeError('Stockmarket backfill validation failed');
  }
  validateGeneratedAt(options.generatedAt);
  const fetchedAt = isoNow(options.now ?? (() => Date.now()));
  validateGeneratedAt(fetchedAt);
  const fileSystem = fileSystemFor(options);
  const existing = await validateExistingHistory(options.dataDir, fileSystem);
  if (existing.provenance !== null && options.force !== true) return { skipped: true };
  const latestOfficialTimestamp = existing.manifest.latestTimestamp;
  if (latestOfficialTimestamp === null) throw safeError('Stockmarket backfill validation failed');

  const client = options.client ?? (options.createClient ?? createStockmarketClient)();
  let rows: Map<string, StockmarketHistoryPoint[]>;
  try {
    rows = await client.loadAll();
  } catch {
    throw safeError('Stockmarket backfill fetch failed');
  }

  let imported: Snapshot[];
  let overlapComparisons: number;
  try {
    const candidates = buildBackfillSnapshots(rows, latestOfficialTimestamp, {
      minimumHours: MINIMUM_SNAPSHOTS,
      minimumQuotes: 1_000,
    });
    if (candidates.length < MINIMUM_SNAPSHOTS || candidates.length > MAXIMUM_SNAPSHOTS) {
      throw new Error('invalid fixed history window');
    }
    if (latestOverlapComparisons(candidates, existing.officialSnapshots, latestOfficialTimestamp) < MINIMUM_LATEST_OVERLAP_COMPARISONS) {
      throw new Error('insufficient latest official overlap');
    }
    const overlap = validateOfficialOverlap(candidates, existing.officialSnapshots);
    imported = overlap.snapshots;
    overlapComparisons = overlap.comparisons;
  } catch {
    throw safeError('Stockmarket backfill validation failed');
  }
  const fromTimestamp = imported[0]?.timestamp;
  const toTimestamp = imported.at(-1)?.timestamp;
  if (fromTimestamp === undefined || toTimestamp === undefined) throw safeError('Stockmarket backfill validation failed');
  let provenance: HistoryProvenance;
  try {
    provenance = createHistoryProvenance({ fetchedAt, fromTimestamp, toTimestamp, snapshotCount: imported.length, overlapComparisons });
  } catch {
    throw safeError('Stockmarket backfill validation failed');
  }

  let merged: Awaited<ReturnType<typeof mergeCloudHistory>>;
  try {
    merged = await mergeCloudHistory({
      dataDir: options.dataDir,
      snapshots: imported,
      generatedAt: options.generatedAt,
      fileSystem,
    });
  } catch {
    throw safeError('Stockmarket backfill storage failed');
  }
  await publishProvenance(options.dataDir, provenance, fileSystem);
  return {
    skipped: false,
    itemCount: rows.size,
    inserted: merged.inserted,
    snapshotCount: imported.length,
    overlapComparisons,
    fromTimestamp,
    toTimestamp,
  };
}

/** Run the CLI and return a process-style exit code without exposing remote payload data. */
export async function run(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: Pick<StockmarketBackfillOptions, 'client' | 'createClient' | 'fileSystem' | 'fs' | 'now'> = {},
): Promise<number> {
  try {
    const args = parseBackfillArgs(argv);
    const now = dependencies.now ?? (() => Date.now());
    const current = isoNow(now);
    const result = await runStockmarketBackfill({
      ...dependencies,
      dataDir: resolve(args.dataDir),
      generatedAt: current,
      now: () => Date.parse(current),
      force: args.force,
    });
    if (result.skipped) {
      console.log('Stockmarket backfill skipped');
    } else {
      console.log(`Stockmarket backfill complete: items=${result.itemCount} inserted=${result.inserted} snapshots=${result.snapshotCount} overlaps=${result.overlapComparisons} range=${result.fromTimestamp}-${result.toTimestamp}`);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof StockmarketBackfillError ? error.message : 'Stockmarket backfill storage failed');
    return 1;
  }
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.exitCode = 1;
  });
}
