import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/core/types';
import {
  MarketStore,
  STORAGE_PREFIX,
  StorageWriteError,
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
