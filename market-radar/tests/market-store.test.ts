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
import { encodeDayChunk, STORAGE_CODEC_GZIP_PREFIX } from '../src/core/storage-codec';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const itemKey = '/items/test::0';

class MemoryKeyValueStore implements KeyValueStore {
  readonly values = new Map<string, unknown>();
  failSetFor: string | null = null;
  failSetOnAttempt: number | null = null;
  failDeleteFor: string | null = null;
  private setAttempts = 0;

  async get<T>(storageKey: string, fallback: T): Promise<T> {
    return (this.values.has(storageKey) ? this.values.get(storageKey) : fallback) as T;
  }

  async set<T>(storageKey: string, value: T): Promise<void> {
    this.setAttempts += 1;
    if (storageKey === this.failSetFor || this.failSetOnAttempt === this.setAttempts) {
      throw new Error('quota exceeded');
    }
    this.values.set(storageKey, value);
  }

  async delete(storageKey: string): Promise<void> {
    if (storageKey === this.failDeleteFor) {
      throw new Error('delete failed');
    }
    this.values.delete(storageKey);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
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
