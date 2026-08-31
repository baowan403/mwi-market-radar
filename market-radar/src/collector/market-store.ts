import type { MarketKey, RadarSettings, Snapshot, WatchItem } from '../core/types';
import { decodeDayChunk, encodeDayChunk } from '../core/storage-codec';

const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_MS = 8 * DAY_MS;

export const STORAGE_PREFIX = 'mwi-radar:v1:';
const HOURLY_PREFIX = `${STORAGE_PREFIX}hourly:`;
export const WATCHLIST_KEY = `${STORAGE_PREFIX}watchlist`;
export const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
const MISSING_PREFERENCE = Symbol('missing preference');

export const DEFAULT_SETTINGS: RadarSettings = {
  period: '1d',
  minimumVolume: 0,
  maximumSpreadPct: null,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};

export interface KeyValueStore {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Adapt Tampermonkey's legacy synchronous GM storage grants to the async store interface. */
export function createGMKeyValueStore(): KeyValueStore {
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const value = await Promise.resolve(GM_getValue(key, fallback));
      return value === undefined ? fallback : value;
    },

    async set<T>(key: string, value: T): Promise<void> {
      await Promise.resolve(GM_setValue(key, value));
    },

    async delete(key: string): Promise<void> {
      await Promise.resolve(GM_deleteValue(key));
    },

    async keys(): Promise<string[]> {
      return [...(await Promise.resolve(GM_listValues()))];
    },
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const WATCHLIST_ITEM_KEY_PATTERN = /^.+::(?:0|[1-9]\d*)$/;

function normalizeWatchlist(value: unknown): WatchItem[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid watchlist: expected an array');
  }

  const keys = new Set<string>();
  const normalized = value.map((entry, index): WatchItem => {
    if (!isRecord(entry) || typeof entry.key !== 'string') {
      throw new Error(`Invalid watchlist entry at index ${index}: key is required`);
    }
    if (!WATCHLIST_ITEM_KEY_PATTERN.test(entry.key)) {
      throw new Error(`Invalid watchlist key at index ${index}`);
    }
    if (keys.has(entry.key)) {
      throw new Error(`Invalid watchlist: duplicate key at index ${index}`);
    }
    const order = entry.order;
    if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0) {
      throw new Error(`Invalid watchlist order at index ${index}`);
    }

    keys.add(entry.key);
    return { key: entry.key as MarketKey, order };
  });

  return normalized.sort((left, right) => {
    const byOrder = left.order - right.order;
    return byOrder !== 0 ? byOrder : left.key.localeCompare(right.key);
  });
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeSettings(value: unknown): RadarSettings {
  if (!isRecord(value)) {
    throw new Error('Invalid settings: expected an object');
  }
  if (value.period !== '1d' && value.period !== '3d' && value.period !== '7d') {
    throw new Error('Invalid settings period');
  }
  if (!isFiniteNonnegative(value.minimumVolume)) {
    throw new Error('Invalid settings minimumVolume: expected a finite non-negative number');
  }
  if (value.maximumSpreadPct !== null && !isFiniteNonnegative(value.maximumSpreadPct)) {
    throw new Error('Invalid settings maximumSpreadPct: expected null or a finite non-negative number');
  }
  if (!isFiniteNonnegative(value.anomalyMovePct)) {
    throw new Error('Invalid settings anomalyMovePct: expected a finite non-negative number');
  }
  if (!isFiniteNonnegative(value.anomalyVolumeMultiple)) {
    throw new Error('Invalid settings anomalyVolumeMultiple: expected a finite non-negative number');
  }

  return {
    period: value.period,
    minimumVolume: value.minimumVolume,
    maximumSpreadPct: value.maximumSpreadPct,
    anomalyMovePct: value.anomalyMovePct,
    anomalyVolumeMultiple: value.anomalyVolumeMultiple,
  };
}

function corruptPreferenceError(kind: 'watchlist' | 'settings', cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : 'invalid stored value';
  return new Error(`Corrupt stored ${kind} at key ${kind === 'watchlist' ? WATCHLIST_KEY : SETTINGS_KEY}: ${reason}`);
}

export class MarketStore {
  constructor(private readonly storage: KeyValueStore) {}

  async getWatchlist(): Promise<WatchItem[]> {
    const stored = await this.storage.get<unknown | typeof MISSING_PREFERENCE>(WATCHLIST_KEY, MISSING_PREFERENCE);
    if (stored === MISSING_PREFERENCE) return [];

    try {
      return normalizeWatchlist(stored);
    } catch (cause) {
      throw corruptPreferenceError('watchlist', cause);
    }
  }

  async setWatchlist(value: WatchItem[]): Promise<void> {
    const normalized = normalizeWatchlist(value);

    try {
      await this.storage.set(WATCHLIST_KEY, normalized);
    } catch {
      throw new StorageWriteError(WATCHLIST_KEY);
    }
  }

  async getSettings(): Promise<RadarSettings> {
    const stored = await this.storage.get<unknown | typeof MISSING_PREFERENCE>(SETTINGS_KEY, MISSING_PREFERENCE);
    if (stored === MISSING_PREFERENCE) return { ...DEFAULT_SETTINGS };

    try {
      return normalizeSettings(stored);
    } catch (cause) {
      throw corruptPreferenceError('settings', cause);
    }
  }

  async setSettings(value: RadarSettings): Promise<void> {
    const normalized = normalizeSettings(value);

    try {
      await this.storage.set(SETTINGS_KEY, normalized);
    } catch {
      throw new StorageWriteError(SETTINGS_KEY);
    }
  }

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
