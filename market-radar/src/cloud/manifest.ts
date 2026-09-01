import {
  CLOUD_MANIFEST_SCHEMA,
  CLOUD_RETENTION_MS,
  type CloudManifest,
  type CloudSnapshotEntry,
} from './types';

export { CLOUD_MANIFEST_SCHEMA, CLOUD_RETENTION_MS } from './types';
export type { CloudManifest, CloudSnapshotEntry } from './types';

const MANIFEST_KEYS = ['schemaVersion', 'generatedAt', 'latestTimestamp', 'snapshots'] as const;
const ENTRY_KEYS = ['timestamp', 'file', 'bytes'] as const;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface CreateManifestOptions {
  generatedAt?: string | Date;
  now?: () => number;
}

export type ManifestGeneratedAt = string | Date | number | (() => number) | CreateManifestOptions;

export class CloudManifestError extends Error {
  readonly code = 'invalid_manifest' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CloudManifestError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isSafeMilliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafeBytes(value: unknown): value is number {
  return isSafeMilliseconds(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function invalid(message: string): never {
  throw new CloudManifestError(message);
}

function validateEntry(value: unknown): CloudSnapshotEntry {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) {
    return invalid('Invalid cloud snapshot entry fields');
  }
  if (!isSafeMilliseconds(value.timestamp)) {
    return invalid('Invalid cloud snapshot timestamp');
  }
  if (value.file !== `snapshots/${value.timestamp}.txt`) {
    return invalid('Invalid cloud snapshot file path');
  }
  if (!isSafeBytes(value.bytes)) {
    return invalid('Invalid cloud snapshot bytes');
  }
  return {
    timestamp: value.timestamp,
    file: value.file as `snapshots/${number}.txt`,
    bytes: value.bytes,
  };
}

function validateManifest(value: unknown, enforceRetention = true): CloudManifest {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
    return invalid('Invalid cloud manifest fields');
  }
  if (value.schemaVersion !== CLOUD_MANIFEST_SCHEMA) {
    return invalid('Invalid cloud manifest schema');
  }
  if (!isIsoInstant(value.generatedAt)) {
    return invalid('Invalid cloud manifest generatedAt');
  }
  if (!(value.latestTimestamp === null || isSafeMilliseconds(value.latestTimestamp))) {
    return invalid('Invalid cloud manifest latest timestamp');
  }
  if (!Array.isArray(value.snapshots)) {
    return invalid('Invalid cloud manifest snapshots');
  }

  const snapshots: CloudSnapshotEntry[] = [];
  let previousTimestamp: number | null = null;
  for (const rawEntry of value.snapshots) {
    const snapshot = validateEntry(rawEntry);
    if (previousTimestamp !== null && snapshot.timestamp <= previousTimestamp) {
      return invalid('Cloud snapshots must be strictly ascending and unique');
    }
    snapshots.push(snapshot);
    previousTimestamp = snapshot.timestamp;
  }

  const finalTimestamp = snapshots.at(-1)?.timestamp ?? null;
  if (value.latestTimestamp !== finalTimestamp) {
    return invalid('Cloud manifest latest must equal the final snapshot timestamp');
  }
  if (enforceRetention && finalTimestamp !== null) {
    const cutoff = finalTimestamp - CLOUD_RETENTION_MS;
    if (snapshots.some((snapshot) => snapshot.timestamp < cutoff)) {
      return invalid('Cloud snapshot is outside the retention window');
    }
  }

  return {
    schemaVersion: CLOUD_MANIFEST_SCHEMA,
    generatedAt: value.generatedAt,
    latestTimestamp: value.latestTimestamp,
    snapshots,
  };
}

function generatedAtValue(value: ManifestGeneratedAt | undefined): string {
  if (value === undefined) return new Date().toISOString();

  if (typeof value === 'string') return value;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return invalid('Invalid cloud manifest generatedAt');
    return value.toISOString();
  }
  if (typeof value === 'number') {
    if (!isSafeMilliseconds(value)) return invalid('Invalid cloud manifest generatedAt');
    return new Date(value).toISOString();
  }
  if (typeof value === 'function') {
    const timestamp = value();
    if (!isSafeMilliseconds(timestamp)) return invalid('Invalid cloud manifest generatedAt');
    return new Date(timestamp).toISOString();
  }
  if (value.generatedAt !== undefined) return generatedAtValue(value.generatedAt);
  if (value.now !== undefined) return generatedAtValue(value.now);
  return new Date().toISOString();
}

/** Parse and strictly validate a cloud snapshot manifest. */
export function parseManifest(value: unknown): CloudManifest {
  return validateManifest(value);
}

/** Alias with an explicit cloud prefix for callers that prefer it. */
export const parseCloudManifest = parseManifest;

/**
 * Build a deterministic manifest from entries in any order. Entries older than
 * the latest timestamp's eight-day retention boundary are omitted.
 */
export function createManifest(
  entries: readonly CloudSnapshotEntry[],
  generatedAt?: ManifestGeneratedAt,
): CloudManifest {
  if (!Array.isArray(entries)) return invalid('Invalid cloud snapshot entries');

  const validated: CloudSnapshotEntry[] = [];
  const timestamps = new Set<number>();
  const files = new Set<string>();
  for (const value of entries) {
    const snapshot = validateEntry(value);
    if (timestamps.has(snapshot.timestamp)) {
      return invalid('Duplicate cloud snapshot timestamp');
    }
    if (files.has(snapshot.file)) {
      return invalid('Duplicate cloud snapshot file');
    }
    timestamps.add(snapshot.timestamp);
    files.add(snapshot.file);
    validated.push(snapshot);
  }

  validated.sort((left, right) => left.timestamp - right.timestamp);
  const latest = validated.at(-1)?.timestamp ?? null;
  const cutoff = latest === null ? null : latest - CLOUD_RETENTION_MS;
  const retained = cutoff === null
    ? validated
    : validated.filter((snapshot) => snapshot.timestamp >= cutoff);

  return parseManifest({
    schemaVersion: CLOUD_MANIFEST_SCHEMA,
    generatedAt: generatedAtValue(generatedAt),
    latestTimestamp: latest,
    snapshots: retained,
  });
}

/** Keep only the latest eight days while preserving the manifest metadata. */
export function retainEightDays(manifest: CloudManifest): CloudManifest {
  const validated = validateManifest(manifest, false);
  const latestTimestamp = validated.latestTimestamp;
  if (latestTimestamp === null) return validated;

  const cutoff = latestTimestamp - CLOUD_RETENTION_MS;
  const snapshots = validated.snapshots.filter((snapshot) => snapshot.timestamp >= cutoff);
  return validateManifest({
    schemaVersion: validated.schemaVersion,
    generatedAt: validated.generatedAt,
    latestTimestamp: snapshots.at(-1)?.timestamp ?? null,
    snapshots,
  });
}

/** Return sorted entries inside the eight-day window for a known latest time. */
export function retainSnapshots(
  entries: readonly CloudSnapshotEntry[],
  latestTimestamp: number,
): CloudSnapshotEntry[] {
  if (!isSafeMilliseconds(latestTimestamp)) return invalid('Invalid cloud snapshot latest timestamp');
  return entries
    .map(validateEntry)
    .filter((snapshot) => snapshot.timestamp >= latestTimestamp - CLOUD_RETENTION_MS)
    .sort((left, right) => left.timestamp - right.timestamp);
}
