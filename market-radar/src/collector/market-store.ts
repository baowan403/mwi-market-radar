import type { Snapshot } from '../core/types';
import { decodeDayChunk, encodeDayChunk } from '../core/storage-codec';

const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_MS = 8 * DAY_MS;

export const STORAGE_PREFIX = 'mwi-radar:v1:';
const HOURLY_PREFIX = `${STORAGE_PREFIX}hourly:`;

export interface KeyValueStore {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface SnapshotSaveResult {
  inserted: boolean;
  cleanupErrors: string[];
}

export class StorageWriteError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Storage write failed for key: ${key}`);
    this.name = 'StorageWriteError';
    this.key = key;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function hourlyDayKey(timestamp: number): string {
  return `${HOURLY_PREFIX}${new Date(timestamp).toISOString().slice(0, 10)}`;
}

function isHourlyKey(key: string): boolean {
  return key.startsWith(HOURLY_PREFIX);
}

function sortUniqueSnapshots(snapshots: Iterable<Snapshot>): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (!byTimestamp.has(snapshot.timestamp)) {
      byTimestamp.set(snapshot.timestamp, snapshot);
    }
  }

  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export class MarketStore {
  constructor(private readonly storage: KeyValueStore) {}

  async saveSnapshot(snapshot: Snapshot): Promise<SnapshotSaveResult> {
    const chunks = await this.readHourlyChunks();
    const existingSnapshots = [...chunks.values()].flat();
    const existingByTimestamp = new Set(existingSnapshots.map((entry) => entry.timestamp));
    const latestTimestamp = Math.max(snapshot.timestamp, ...existingByTimestamp);
    const cutoff = latestTimestamp - RETENTION_MS;

    if (snapshot.timestamp < cutoff || existingByTimestamp.has(snapshot.timestamp)) {
      return { inserted: false, cleanupErrors: [] };
    }

    const currentKey = hourlyDayKey(snapshot.timestamp);
    const currentChunk = sortUniqueSnapshots([...(chunks.get(currentKey) ?? []), snapshot]);
    const encodedCurrentChunk = await encodeDayChunk(currentChunk);

    try {
      await this.storage.set(currentKey, encodedCurrentChunk);
    } catch {
      throw new StorageWriteError(currentKey);
    }

    return {
      inserted: true,
      cleanupErrors: await this.cleanup(cutoff, currentKey),
    };
  }

  async listSnapshots(): Promise<Snapshot[]> {
    const chunks = await this.readHourlyChunks();
    return sortUniqueSnapshots([...chunks.values()].flat());
  }

  private async readHourlyChunks(): Promise<Map<string, Snapshot[]>> {
    const keys = (await this.storage.keys()).filter(isHourlyKey).sort();
    const chunks = new Map<string, Snapshot[]>();

    for (const key of keys) {
      const encoded = await this.storage.get<string | null>(key, null);
      if (encoded === null || encoded === undefined) continue;
      chunks.set(key, await decodeDayChunk(encoded));
    }

    return chunks;
  }

  private async cleanup(cutoff: number, currentKey: string): Promise<string[]> {
    const keys = new Set((await this.storage.keys()).filter(isHourlyKey));
    keys.add(currentKey);
    const cleanupErrors: string[] = [];

    for (const key of [...keys].sort()) {
      const encoded = await this.storage.get<string | null>(key, null);
      if (encoded === null || encoded === undefined) continue;

      const chunk = await decodeDayChunk(encoded);
      const retained = sortUniqueSnapshots(chunk.filter((entry) => entry.timestamp >= cutoff));

      if (retained.length === 0) {
        try {
          await this.storage.delete(key);
        } catch {
          cleanupErrors.push(`delete:${key}`);
        }
        continue;
      }

      try {
        await this.storage.set(key, await encodeDayChunk(retained));
      } catch {
        cleanupErrors.push(`set:${key}`);
      }
    }

    return cleanupErrors;
  }
}
