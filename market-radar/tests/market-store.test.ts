import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RadarSettings, Snapshot, WatchItem } from '../src/core/types';
import {
  DEFAULT_SETTINGS,
  MarketStore,
  SETTINGS_KEY,
  STORAGE_PREFIX,
  StorageWriteError,
  WATCHLIST_KEY,
  createGMKeyValueStore,
  hourlyDayKey,
  type KeyValueStore,
} from '../src/collector/market-store';
import { decodeDayChunk, encodeDayChunk, STORAGE_CODEC_GZIP_PREFIX } from '../src/core/storage-codec';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const itemKey = '/items/test::0';

class MemoryKeyValueStore implements KeyValueStore {
  readonly values = new Map<string, unknown>();
  failSetFor: string | null = null;
  failSetOnAttempt: number | null = null;
  failDeleteFor: string | null = null;
  failGetFor: string | null = null;
  failKeysOnCall: number | null = null;
  afterSet: ((storageKey: string, value: unknown) => void) | null = null;
  private setAttempts = 0;
  private keysCalls = 0;

  async get<T>(storageKey: string, fallback: T): Promise<T> {
    if (storageKey === this.failGetFor) {
      throw new Error('get failed');
    }
    return (this.values.has(storageKey) ? this.values.get(storageKey) : fallback) as T;
  }

  async set<T>(storageKey: string, value: T): Promise<void> {
    this.setAttempts += 1;
    if (storageKey === this.failSetFor || this.failSetOnAttempt === this.setAttempts) {
      throw new Error('quota exceeded');
    }
    this.values.set(storageKey, value);
    this.afterSet?.(storageKey, value);
  }

  async delete(storageKey: string): Promise<void> {
    if (storageKey === this.failDeleteFor) {
      throw new Error('delete failed');
    }
    this.values.delete(storageKey);
  }

  async keys(): Promise<string[]> {
    this.keysCalls += 1;
    if (this.failKeysOnCall === this.keysCalls) {
      throw new Error('keys failed');
    }
    return [...this.values.keys()];
  }
}

class DelayedFirstWriteStore extends MemoryKeyValueStore {
  readonly firstWriteStarted: Promise<void>;
  private resolveFirstWriteStarted!: () => void;
  private releaseFirstWriteGate!: () => void;
  private readonly firstWriteReleased: Promise<void>;
  private blockFirstWrite = true;

  constructor() {
    super();
    this.firstWriteStarted = new Promise((resolve) => {
      this.resolveFirstWriteStarted = resolve;
    });
    this.firstWriteReleased = new Promise((resolve) => {
      this.releaseFirstWriteGate = resolve;
    });
  }

  releaseFirstWrite(): void {
    this.releaseFirstWriteGate();
  }

  override async set<T>(storageKey: string, value: T): Promise<void> {
    if (this.blockFirstWrite) {
      this.blockFirstWrite = false;
      this.resolveFirstWriteStarted();
      await this.firstWriteReleased;
    }
    await super.set(storageKey, value);
  }
}

class NullGetRaceStore extends MemoryKeyValueStore {
  raceKey: string | null = null;
  deleteOnRace = true;
  private raceArmed = false;
  private raceConsumed = false;

  armRace(): void {
    this.raceArmed = true;
    this.raceConsumed = false;
  }

  override async get<T>(storageKey: string, fallback: T): Promise<T> {
    if (this.raceArmed && !this.raceConsumed && storageKey === this.raceKey) {
      this.raceConsumed = true;
      if (this.deleteOnRace) {
        this.values.delete(storageKey);
      } else {
        this.values.set(storageKey, null);
      }
      return null as T;
    }
    return super.get(storageKey, fallback);
  }
}

function snapshot(timestamp: number, price = 100): Snapshot {
  return {
    timestamp,
    quotes: { [itemKey]: { a: price + 1, b: price - 1, p: price, v: 10 } },
  };
}

function createStore(adapter: MemoryKeyValueStore): MarketStore {
  return new MarketStore(adapter);
}

describe('MarketStore snapshot history', () => {
  it('deduplicates equal timestamps and keeps each chunk sorted ascending', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const later = snapshot(Date.parse('2026-08-31T23:08:00Z'), 120);
    const earlier = snapshot(Date.parse('2026-08-31T01:08:00Z'), 100);
    const conflicting = snapshot(earlier.timestamp, 999);

    await store.saveSnapshot(later);
    await store.saveSnapshot(earlier);
    const duplicateResult = await store.saveSnapshot(conflicting);

    expect(duplicateResult).toEqual({ inserted: false, cleanupErrors: [] });
    expect(await store.listSnapshots()).toEqual([earlier, later]);
    expect(typeof adapter.values.get(hourlyDayKey(later.timestamp))).toBe('string');
    expect(await adapter.keys()).toContain(`${STORAGE_PREFIX}hourly:2026-08-31`);
  });

  it('merges snapshots across UTC day boundaries', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const beforeMidnight = snapshot(Date.parse('2026-08-31T23:59:00Z'), 100);
    const afterMidnight = snapshot(Date.parse('2026-09-01T00:01:00Z'), 101);

    await store.saveSnapshot(beforeMidnight);
    await store.saveSnapshot(afterMidnight);

    await expect(store.listSnapshots()).resolves.toEqual([beforeMidnight, afterMidnight]);
    expect(await adapter.keys()).toEqual(
      expect.arrayContaining([
        `${STORAGE_PREFIX}hourly:2026-08-31`,
        `${STORAGE_PREFIX}hourly:2026-09-01`,
      ]),
    );
  });

  it('retains the exact eight-day window including its cutoff boundary', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const boundary = snapshot(latest.timestamp - 8 * DAY, 100);
    const justOld = snapshot(boundary.timestamp - 1, 99);
    const muchOlder = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);

    await store.saveSnapshot(muchOlder);
    await store.saveSnapshot(justOld);
    await store.saveSnapshot(boundary);
    await store.saveSnapshot(latest);

    await expect(store.listSnapshots()).resolves.toEqual([boundary, latest]);
    expect(await adapter.keys()).not.toContain(hourlyDayKey(muchOlder.timestamp));
    expect(await adapter.keys()).toContain(hourlyDayKey(boundary.timestamp));
  });

  it('rejects a snapshot older than the latest snapshot cutoff without writing it', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const old = snapshot(latest.timestamp - 8 * DAY - 1, 100);

    await store.saveSnapshot(latest);
    const result = await store.saveSnapshot(old);

    expect(result).toEqual({ inserted: false, cleanupErrors: [] });
    await expect(store.listSnapshots()).resolves.toEqual([latest]);
  });

  it('filters a same-day chunk from the value written by the current save', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const sameDayOld = snapshot(Date.parse('2026-08-23T12:07:59Z'), 50);
    const sameDayBoundary = snapshot(Date.parse('2026-08-23T12:08:00Z'), 100);
    const incoming = snapshot(Date.parse('2026-08-23T12:09:00Z'), 110);
    const dayKey = hourlyDayKey(incoming.timestamp);

    adapter.values.set(hourlyDayKey(latest.timestamp), await encodeDayChunk([latest]));
    adapter.values.set(dayKey, await encodeDayChunk([sameDayOld, sameDayBoundary]));

    const result = await store.saveSnapshot(incoming);

    expect(result.inserted).toBe(true);
    await expect(store.listSnapshots()).resolves.toEqual([sameDayBoundary, incoming, latest]);
  });

  it('throws StorageWriteError for a failed current-chunk write without exposing the payload', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const existing = snapshot(Date.parse('2026-08-31T12:08:00Z'), 100);
    const incoming = snapshot(Date.parse('2026-08-31T13:08:00Z'), 110);
    await store.saveSnapshot(existing);
    adapter.failSetFor = hourlyDayKey(incoming.timestamp);

    const error = await store.saveSnapshot(incoming).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageWriteError);
    expect((error as StorageWriteError).key).toBe(hourlyDayKey(incoming.timestamp));
    expect((error as Error).message).not.toContain(JSON.stringify(incoming));
    await expect(store.listSnapshots()).resolves.toEqual([existing]);
  });

  it('reports cleanup failures after keeping the successfully written current chunk', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    await store.saveSnapshot(old);
    adapter.failDeleteFor = hourlyDayKey(old.timestamp);

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain(`delete:${hourlyDayKey(old.timestamp)}`);
    await expect(store.listSnapshots()).resolves.toEqual([old, latest]);
  });

  it('reports a cleanup set failure without overwriting the new current chunk', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    await store.saveSnapshot(old);
    adapter.failSetOnAttempt = 4;

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain(`set:${hourlyDayKey(latest.timestamp)}`);
    await expect(store.listSnapshots()).resolves.toEqual([latest]);
  });

  it('reports a cleanup keys failure without escaping or losing the current chunk', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const currentKey = hourlyDayKey(latest.timestamp);

    await store.saveSnapshot(old);
    adapter.failKeysOnCall = 4;

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain('keys');
    adapter.failKeysOnCall = null;
    const encodedCurrent = await adapter.get<string | null>(currentKey, null);
    await expect(decodeDayChunk(encodedCurrent as string)).resolves.toEqual([latest]);
    await expect(createStore(adapter).listSnapshots()).resolves.toEqual([old, latest]);
  });

  it('reports a cleanup get failure and continues with the remaining keys', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const oldKey = hourlyDayKey(old.timestamp);
    const currentKey = hourlyDayKey(latest.timestamp);

    await store.saveSnapshot(old);
    adapter.afterSet = (storageKey) => {
      if (storageKey === currentKey) adapter.failGetFor = oldKey;
    };

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain(`get:${oldKey}`);
    adapter.afterSet = null;
    adapter.failGetFor = null;
    const encodedCurrent = await adapter.get<string | null>(currentKey, null);
    await expect(decodeDayChunk(encodedCurrent as string)).resolves.toEqual([latest]);
  });

  it('reports a cleanup decode failure while preserving the current chunk and listSnapshots behavior', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const oldKey = hourlyDayKey(old.timestamp);
    const currentKey = hourlyDayKey(latest.timestamp);

    await store.saveSnapshot(old);
    adapter.afterSet = (storageKey) => {
      if (storageKey === currentKey) {
        adapter.values.set(oldKey, `${STORAGE_CODEC_GZIP_PREFIX}not-valid!`);
      }
    };

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain(`decode:${oldKey}`);
    adapter.afterSet = null;
    const encodedCurrent = await adapter.get<string | null>(currentKey, null);
    await expect(decodeDayChunk(encodedCurrent as string)).resolves.toEqual([latest]);
    await expect(createStore(adapter).listSnapshots()).rejects.toThrow(/base64/i);
  });

  it('ignores malformed hourly namespace keys without attempting to decode them', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const valid = snapshot(Date.parse('2026-08-31T12:08:00Z'));
    await adapter.set(hourlyDayKey(valid.timestamp), await encodeDayChunk([valid]));

    const malformedKeys = [
      `${STORAGE_PREFIX}hourly:2026-08-31T00:00:00.000Z`,
      `${STORAGE_PREFIX}hourly:2026-8-31`,
      `${STORAGE_PREFIX}hourly:2026-08-31-extra`,
      `${STORAGE_PREFIX}hourlyX:2026-08-31`,
    ];
    for (const key of malformedKeys) {
      adapter.values.set(key, `${STORAGE_CODEC_GZIP_PREFIX}not-valid!`);
    }

    await expect(store.listSnapshots()).resolves.toEqual([valid]);
  });

  it('ignores an impossible calendar date in an hourly key', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const invalidDateKey = `${STORAGE_PREFIX}hourly:2026-02-30`;
    adapter.values.set(invalidDateKey, `${STORAGE_CODEC_GZIP_PREFIX}not-valid!`);

    await expect(store.listSnapshots()).resolves.toEqual([]);
  });

  it('retries cleanup on a duplicate after an earlier cleanup failure', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const oldKey = hourlyDayKey(old.timestamp);

    await store.saveSnapshot(old);
    adapter.failDeleteFor = oldKey;
    const firstResult = await store.saveSnapshot(latest);
    expect(firstResult.cleanupErrors).toContain(`delete:${oldKey}`);

    adapter.failDeleteFor = null;
    await expect(store.saveSnapshot(latest)).resolves.toEqual({
      inserted: false,
      cleanupErrors: [],
    });
    expect(await adapter.keys()).not.toContain(oldKey);
    await expect(store.listSnapshots()).resolves.toEqual([latest]);
  });

  it('uses the newest readable chunk when an older snapshot still triggers cleanup', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const stale = snapshot(Date.parse('2026-08-20T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const staleKey = hourlyDayKey(stale.timestamp);

    await store.saveSnapshot(stale);
    adapter.failDeleteFor = staleKey;
    await store.saveSnapshot(latest);
    adapter.failDeleteFor = null;

    const result = await store.saveSnapshot(snapshot(Date.parse('2026-08-21T12:08:00Z'), 75));

    expect(result).toEqual({ inserted: false, cleanupErrors: [] });
    expect(await adapter.keys()).not.toContain(staleKey);
    await expect(store.listSnapshots()).resolves.toEqual([latest]);
  });

  it('throws for a listed hourly key whose value is null', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const key = `${STORAGE_PREFIX}hourly:2026-08-31`;
    adapter.values.set(key, null);

    await expect(store.listSnapshots()).rejects.toThrow(/corrupt.*hourly|missing.*hourly/i);
  });

  it('reports a null listed hourly value during cleanup and keeps the current chunk', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-30T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const oldKey = hourlyDayKey(old.timestamp);
    const currentKey = hourlyDayKey(latest.timestamp);

    await store.saveSnapshot(old);
    adapter.afterSet = (storageKey) => {
      if (storageKey === currentKey) adapter.values.set(oldKey, null);
    };

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain(`get:${oldKey}`);
    adapter.afterSet = null;
    const encodedCurrent = await adapter.get<string | null>(currentKey, null);
    await expect(decodeDayChunk(encodedCurrent as string)).resolves.toEqual([latest]);
  });

  it('self-heals a list read when a listed chunk is deleted before get', async () => {
    const adapter = new NullGetRaceStore();
    const store = createStore(adapter);
    const deleted = snapshot(Date.parse('2026-08-30T12:08:00Z'), 50);
    const remaining = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const deletedKey = hourlyDayKey(deleted.timestamp);

    adapter.values.set(deletedKey, await encodeDayChunk([deleted]));
    adapter.values.set(hourlyDayKey(remaining.timestamp), await encodeDayChunk([remaining]));
    adapter.raceKey = deletedKey;
    adapter.armRace();

    await expect(store.listSnapshots()).resolves.toEqual([remaining]);
  });

  it('still throws for a null listed chunk when the key survives the recheck', async () => {
    const adapter = new NullGetRaceStore();
    const store = createStore(adapter);
    const key = `${STORAGE_PREFIX}hourly:2026-08-31`;

    adapter.values.set(key, null);
    adapter.raceKey = key;
    adapter.deleteOnRace = false;
    adapter.armRace();

    await expect(store.listSnapshots()).rejects.toThrow(/corrupt.*hourly|missing.*hourly/i);
  });

  it('does not report a cleanup error when a listed chunk is deleted before get', async () => {
    const adapter = new NullGetRaceStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-30T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const oldKey = hourlyDayKey(old.timestamp);
    const currentKey = hourlyDayKey(latest.timestamp);

    await store.saveSnapshot(old);
    adapter.raceKey = oldKey;
    adapter.afterSet = (storageKey) => {
      if (storageKey === currentKey) adapter.armRace();
    };

    const result = await store.saveSnapshot(latest);

    expect(result).toEqual({ inserted: true, cleanupErrors: [] });
    adapter.afterSet = null;
    expect(await adapter.keys()).not.toContain(oldKey);
    const encodedCurrent = await adapter.get<string | null>(currentKey, null);
    await expect(decodeDayChunk(encodedCurrent as string)).resolves.toEqual([latest]);
  });

  it('reports a cleanup get error when a null listed chunk survives the recheck', async () => {
    const adapter = new NullGetRaceStore();
    const store = createStore(adapter);
    const old = snapshot(Date.parse('2026-08-30T12:08:00Z'), 50);
    const latest = snapshot(Date.parse('2026-08-31T12:08:00Z'), 200);
    const oldKey = hourlyDayKey(old.timestamp);
    const currentKey = hourlyDayKey(latest.timestamp);

    await store.saveSnapshot(old);
    adapter.raceKey = oldKey;
    adapter.deleteOnRace = false;
    adapter.afterSet = (storageKey) => {
      if (storageKey === currentKey) adapter.armRace();
    };

    const result = await store.saveSnapshot(latest);

    expect(result.inserted).toBe(true);
    expect(result.cleanupErrors).toContain(`get:${oldKey}`);
    adapter.afterSet = null;
    const encodedCurrent = await adapter.get<string | null>(currentKey, null);
    await expect(decodeDayChunk(encodedCurrent as string)).resolves.toEqual([latest]);
  });

  it('serializes concurrent same-day saves so both snapshots are retained', async () => {
    const adapter = new DelayedFirstWriteStore();
    const store = createStore(adapter);
    const first = snapshot(Date.parse('2026-08-31T12:08:00Z'), 100);
    const second = snapshot(Date.parse('2026-08-31T13:08:00Z'), 110);

    const firstSave = store.saveSnapshot(first);
    await adapter.firstWriteStarted;
    const secondSave = store.saveSnapshot(second);
    adapter.releaseFirstWrite();

    await expect(Promise.all([firstSave, secondSave])).resolves.toHaveLength(2);
    await expect(store.listSnapshots()).resolves.toEqual([first, second]);
  });

  it('continues queued saves after a prior save rejects', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const first = snapshot(Date.parse('2026-08-31T12:08:00Z'), 100);
    const second = snapshot(Date.parse('2026-08-31T13:08:00Z'), 110);
    adapter.failSetOnAttempt = 1;

    const firstSave = store.saveSnapshot(first);
    const secondSave = store.saveSnapshot(second);

    await expect(firstSave).rejects.toBeInstanceOf(StorageWriteError);
    await expect(secondSave).resolves.toMatchObject({ inserted: true });
    await expect(store.listSnapshots()).resolves.toEqual([second]);
  });

  it('deduplicates timestamps globally while listing every hourly chunk', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const duplicate = snapshot(Date.parse('2026-08-31T12:08:00Z'), 100);
    const duplicateDayKey = hourlyDayKey(duplicate.timestamp);
    const secondDayKey = `${STORAGE_PREFIX}hourly:2026-09-01`;

    adapter.values.set(duplicateDayKey, await encodeDayChunk([duplicate]));
    adapter.values.set(secondDayKey, await encodeDayChunk([snapshot(duplicate.timestamp, 999)]));

    await expect(store.listSnapshots()).resolves.toEqual([duplicate]);
  });

  it('propagates a corrupt day chunk instead of silently skipping it', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    adapter.values.set(`${STORAGE_PREFIX}hourly:2026-08-31`, `${STORAGE_CODEC_GZIP_PREFIX}not-valid!`);

    await expect(store.listSnapshots()).rejects.toThrow(/base64/i);
  });
});

describe('MarketStore preferences', () => {
  it('returns a fresh copy of default settings when none are stored', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);

    const settings = await store.getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    settings.minimumVolume = 42;

    expect(DEFAULT_SETTINGS.minimumVolume).toBe(0);
    await expect(store.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('round trips watchlist and settings using independent deterministic values', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const watchlist: WatchItem[] = [
      { key: '/items/zeta::0', order: 2 },
      { key: '/items/alpha::7', order: 0 },
      { key: '/items/beta::1', order: 1 },
      { key: '/items/gamma::1', order: 1 },
    ];
    const settings: RadarSettings = {
      period: '7d',
      minimumVolume: 1.5,
      maximumSpreadPct: 12,
      anomalyMovePct: 7,
      anomalyVolumeMultiple: 3,
    };

    await store.setWatchlist(watchlist);
    await store.setSettings(settings);

    expect(adapter.values.get(WATCHLIST_KEY)).toEqual([
      { key: '/items/alpha::7', order: 0 },
      { key: '/items/beta::1', order: 1 },
      { key: '/items/gamma::1', order: 1 },
      { key: '/items/zeta::0', order: 2 },
    ]);
    await expect(store.getWatchlist()).resolves.toEqual([
      { key: '/items/alpha::7', order: 0 },
      { key: '/items/beta::1', order: 1 },
      { key: '/items/gamma::1', order: 1 },
      { key: '/items/zeta::0', order: 2 },
    ]);
    await expect(store.getSettings()).resolves.toEqual(settings);
    expect(adapter.values.get(SETTINGS_KEY)).toEqual(settings);
  });

  it('reads preferences after a MarketStore restart with the same adapter', async () => {
    const adapter = new MemoryKeyValueStore();
    const firstStore = createStore(adapter);
    const watchlist: WatchItem[] = [{ key: '/items/test::3', order: 0 }];
    const settings: RadarSettings = {
      period: '3d',
      minimumVolume: 10,
      maximumSpreadPct: null,
      anomalyMovePct: 5,
      anomalyVolumeMultiple: 2,
    };

    await firstStore.setWatchlist(watchlist);
    await firstStore.setSettings(settings);

    const restartedStore = createStore(adapter);
    await expect(restartedStore.getWatchlist()).resolves.toEqual(watchlist);
    await expect(restartedStore.getSettings()).resolves.toEqual(settings);
  });

  it('rejects duplicate or malformed watchlist entries before writing', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const invalidValues: WatchItem[] | unknown[] = [
      [
        { key: '/items/test::0', order: 0 },
        { key: '/items/test::0', order: 1 },
      ],
      [{ key: '/items/test::-1', order: 0 }],
      [{ key: '/items/test::1.5', order: 0 }],
      [{ key: '/items/test::0', order: -1 }],
      [{ key: '/items/test::0', order: 1.5 }],
      [{ key: '/items/test::0', order: Number.NaN }],
    ];

    for (const value of invalidValues) {
      await expect(store.setWatchlist(value as WatchItem[])).rejects.toThrow(/watchlist|key|order/i);
    }

    expect(adapter.values.has(WATCHLIST_KEY)).toBe(false);
  });

  it('rejects invalid settings values before writing', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const baseSettings = { ...DEFAULT_SETTINGS };
    const invalidValues: unknown[] = [
      { ...baseSettings, period: '2d' },
      { ...baseSettings, minimumVolume: -1 },
      { ...baseSettings, minimumVolume: Number.NaN },
      { ...baseSettings, minimumVolume: Infinity },
      { ...baseSettings, maximumSpreadPct: -1 },
      { ...baseSettings, maximumSpreadPct: Number.NaN },
      { ...baseSettings, maximumSpreadPct: Infinity },
      { ...baseSettings, anomalyMovePct: -1 },
      { ...baseSettings, anomalyVolumeMultiple: -1 },
    ];

    for (const value of invalidValues) {
      await expect(store.setSettings(value as RadarSettings)).rejects.toThrow(/settings|period|non-negative|finite/i);
    }

    expect(adapter.values.has(SETTINGS_KEY)).toBe(false);
  });

  it('reports corrupt stored preferences instead of returning defaults', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);

    adapter.values.set(WATCHLIST_KEY, [{ key: '/items/test::bad', order: 0 }]);
    await expect(store.getWatchlist()).rejects.toThrow(/corrupt.*watchlist|invalid.*watchlist/i);
    adapter.values.set(WATCHLIST_KEY, null);
    await expect(store.getWatchlist()).rejects.toThrow(/corrupt.*watchlist|invalid.*watchlist/i);

    adapter.values.set(SETTINGS_KEY, { ...DEFAULT_SETTINGS, period: '2d' });
    await expect(store.getSettings()).rejects.toThrow(/corrupt.*settings|invalid.*settings/i);
    adapter.values.set(SETTINGS_KEY, null);
    await expect(store.getSettings()).rejects.toThrow(/corrupt.*settings|invalid.*settings/i);
  });

  it('wraps preference write failures without exposing the value', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const watchlist: WatchItem[] = [{ key: '/items/private::7', order: 0 }];
    adapter.failSetFor = WATCHLIST_KEY;

    const error = await store.setWatchlist(watchlist).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageWriteError);
    expect((error as StorageWriteError).key).toBe(WATCHLIST_KEY);
    expect((error as Error).message).toBe(`Storage write failed for key: ${WATCHLIST_KEY}`);
    expect((error as Error).message).not.toContain(JSON.stringify(watchlist));
    expect(adapter.values.has(WATCHLIST_KEY)).toBe(false);
  });

  it('preserves preferences while snapshot retention cleans hourly chunks', async () => {
    const adapter = new MemoryKeyValueStore();
    const store = createStore(adapter);
    const watchlist: WatchItem[] = [{ key: '/items/test::0', order: 0 }];
    const settings = { ...DEFAULT_SETTINGS, period: '3d' as const };

    await store.setWatchlist(watchlist);
    await store.setSettings(settings);
    await store.saveSnapshot(snapshot(Date.parse('2026-08-20T12:08:00Z')));
    await store.saveSnapshot(snapshot(Date.parse('2026-08-31T12:08:00Z')));

    await expect(store.getWatchlist()).resolves.toEqual(watchlist);
    await expect(store.getSettings()).resolves.toEqual(settings);
    expect(await adapter.keys()).toEqual(
      expect.arrayContaining([WATCHLIST_KEY, SETTINGS_KEY]),
    );
  });
});

describe('GM key-value adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the four GM functions for async CRUD and never touches localStorage', async () => {
    const values = new Map<string, unknown>();
    const getValue = vi.fn((key: string, fallback: unknown) =>
      values.has(key) ? values.get(key) : fallback,
    );
    const setValue = vi.fn((key: string, value: unknown) => {
      values.set(key, value);
    });
    const deleteValue = vi.fn((key: string) => {
      values.delete(key);
    });
    const listValues = vi.fn(() => [...values.keys()]);
    const localStorageStub = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      key: vi.fn(),
      length: 0,
    };
    vi.stubGlobal('GM_getValue', getValue);
    vi.stubGlobal('GM_setValue', setValue);
    vi.stubGlobal('GM_deleteValue', deleteValue);
    vi.stubGlobal('GM_listValues', listValues);
    vi.stubGlobal('localStorage', localStorageStub);

    const adapter = createGMKeyValueStore();
    await adapter.set('mwi-radar:v1:test', { ok: true });
    await expect(adapter.get('mwi-radar:v1:test', null)).resolves.toEqual({ ok: true });
    await expect(adapter.keys()).resolves.toEqual(['mwi-radar:v1:test']);
    await adapter.delete('mwi-radar:v1:test');

    expect(getValue).toHaveBeenCalledWith('mwi-radar:v1:test', null);
    expect(setValue).toHaveBeenCalledWith('mwi-radar:v1:test', { ok: true });
    expect(deleteValue).toHaveBeenCalledWith('mwi-radar:v1:test');
    expect(listValues).toHaveBeenCalledTimes(1);
    expect(localStorageStub.getItem).not.toHaveBeenCalled();
    expect(localStorageStub.setItem).not.toHaveBeenCalled();
    expect(localStorageStub.removeItem).not.toHaveBeenCalled();
  });
});
