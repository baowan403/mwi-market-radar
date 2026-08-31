import { describe, expect, it, vi } from 'vitest';
import type { CollectorStatus, Snapshot } from '../src/core/types';
import type { KeyValueStore, MarketStore, SnapshotSaveResult } from '../src/collector/market-store';
import { STORAGE_PREFIX } from '../src/collector/market-store';
import {
  createCollectorCheck,
  startGameCollector,
  slotId,
  type CollectorCheckOptions,
  type GameCollectorDependencies,
  type LockRunner,
} from '../src/userscript/game-collector';
import type { CollectorLockResult } from '../src/collector/lock';
import type { Scheduler, SchedulerCheck } from '../src/collector/scheduler';

const HOUR = 3_600_000;
const TEN_MINUTES = 10 * 60_000;
const NOW = Date.parse('2026-08-31T10:07:30+08:00');
const SNAPSHOT_TIMESTAMP = Date.parse('2026-08-31T10:06:00Z');
const ITEM_KEY = '/items/test::0';
const LAST_CHECKED_SLOT_KEY = `${STORAGE_PREFIX}last-checked-slot`;

function snapshot(timestamp = SNAPSHOT_TIMESTAMP): Snapshot {
  return {
    timestamp,
    quotes: {
      [ITEM_KEY]: { a: 101, b: 99, p: 100, v: 10 },
    },
  };
}

interface HarnessOptions {
  inserted?: boolean;
  fetchSnapshot?: () => Promise<Snapshot>;
  lockResult?: 'acquired' | 'busy';
  initialStatus?: Partial<CollectorStatus>;
}

function createHarness(options: HarnessOptions = {}) {
  const values = new Map<string, unknown>();
  const storage: KeyValueStore = {
    get: vi.fn(async <T>(key: string, fallback: T) => (
      values.has(key) ? values.get(key) as T : fallback
    )),
    set: vi.fn(async <T>(key: string, value: T) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    keys: vi.fn(async () => [...values.keys()]),
  };

  let status: CollectorStatus = {
    state: 'idle',
    lastAttemptAt: null,
    lastSuccessAt: null,
    officialTimestamp: null,
    nextRunAt: null,
    lastErrorCode: null,
    ...options.initialStatus,
  };
  const statusWrites: CollectorStatus[] = [];
  const setCollectorStatus = vi.fn(async (nextStatus: CollectorStatus) => {
    status = { ...nextStatus };
    statusWrites.push({ ...nextStatus });
  });
  const getCollectorStatus = vi.fn(async () => ({ ...status }));
  const saveSnapshot = vi.fn<MarketStore['saveSnapshot']>(async () => ({
    inserted: options.inserted ?? true,
    cleanupErrors: [],
  } satisfies SnapshotSaveResult));
  const marketStore = {
    saveSnapshot,
    getCollectorStatus,
    setCollectorStatus,
  } as unknown as MarketStore;
  const fetchSnapshot = options.fetchSnapshot ?? vi.fn(async () => snapshot());
  const lockRunner = vi.fn(async <T>(task: () => Promise<T>): Promise<CollectorLockResult<T>> => {
    if (options.lockResult === 'busy') return { acquired: false };
    return { acquired: true, value: await task() };
  }) as unknown as {
    <T>(task: () => Promise<T>): Promise<CollectorLockResult<T>>;
    mockImplementationOnce(
      implementation: <T>(task: () => Promise<T>) => Promise<CollectorLockResult<T>>,
    ): unknown;
    mock: { calls: unknown[] };
  };
  const check = createCollectorCheck({
    storage,
    marketStore,
    fetchSnapshot,
    lockRunner,
    now: vi.fn(() => NOW),
  });

  return {
    values,
    storage,
    marketStore,
    saveSnapshot,
    fetchSnapshot,
    lockRunner,
    check,
    statusWrites,
  };
}

describe('slotId', () => {
  it('maps a timestamp to its UTC hourly slot', () => {
    expect(slotId(0)).toBe(0);
    expect(slotId(HOUR - 1)).toBe(0);
    expect(slotId(HOUR)).toBe(1);
  });
});

describe('createCollectorCheck', () => {
  it('saves an inserted snapshot inside the lock and marks a normal check updated', async () => {
    const harness = createHarness();
    let inLock = false;
    harness.lockRunner.mockImplementationOnce(async (task) => {
      inLock = true;
      try {
        return { acquired: true, value: await task() };
      } finally {
        inLock = false;
      }
    });
    harness.saveSnapshot.mockImplementationOnce(async () => {
      expect(inLock).toBe(true);
      return { inserted: true, cleanupErrors: [] };
    });

    await expect(harness.check({ isRetry: false })).resolves.toBe('updated');

    expect(harness.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.saveSnapshot).toHaveBeenCalledWith(snapshot());
    expect(harness.values.get(LAST_CHECKED_SLOT_KEY)).toBe(slotId(NOW));
    expect(harness.statusWrites[0]).toMatchObject({ state: 'checking', lastAttemptAt: NOW });
    expect(harness.statusWrites.at(-1)).toMatchObject({
      state: 'ok',
      lastAttemptAt: NOW,
      lastSuccessAt: NOW,
      officialTimestamp: SNAPSHOT_TIMESTAMP,
      lastErrorCode: null,
    });
    expect(harness.statusWrites.at(-1)?.nextRunAt).toBeGreaterThan(NOW);
  });

  it('marks an unchanged normal check as retrying for ten minutes', async () => {
    const harness = createHarness({ inserted: false });

    await expect(harness.check({ isRetry: false })).resolves.toBe('unchanged');

    expect(harness.values.get(LAST_CHECKED_SLOT_KEY)).toBe(slotId(NOW));
    expect(harness.statusWrites.at(-1)).toMatchObject({
      state: 'retrying',
      lastAttemptAt: NOW,
      nextRunAt: NOW + TEN_MINUTES,
      lastErrorCode: null,
    });
  });

  it('marks an unchanged retry as healthy and schedules the next regular run', async () => {
    const harness = createHarness({
      inserted: false,
      initialStatus: { lastSuccessAt: NOW - HOUR, officialTimestamp: SNAPSHOT_TIMESTAMP },
    });

    await expect(harness.check({ isRetry: true })).resolves.toBe('unchanged');

    expect(harness.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.statusWrites.at(-1)).toMatchObject({
      state: 'ok',
      lastSuccessAt: NOW - HOUR,
      officialTimestamp: SNAPSHOT_TIMESTAMP,
      lastErrorCode: null,
    });
    expect(harness.statusWrites.at(-1)?.nextRunAt).toBeGreaterThan(NOW);
  });

  it('rethrows a normal fetch failure, retries, and stores only a safe network code', async () => {
    const harness = createHarness({
      fetchSnapshot: vi.fn(async () => {
        throw new TypeError('private response body should never be stored');
      }),
    });

    await expect(harness.check({ isRetry: false })).rejects.toThrow();

    expect(harness.values.has(LAST_CHECKED_SLOT_KEY)).toBe(false);
    expect(harness.statusWrites.at(-1)).toMatchObject({
      state: 'retrying',
      nextRunAt: NOW + TEN_MINUTES,
      lastErrorCode: 'network',
    });
    expect(JSON.stringify(harness.statusWrites)).not.toContain('private response body');
  });

  it('rethrows a retry failure, stores only a schema code, and returns to the regular schedule', async () => {
    const harness = createHarness({
      fetchSnapshot: vi.fn(async () => {
        const error = new Error('schema payload should never be stored') as Error & { code?: string };
        error.code = 'schema';
        throw error;
      }),
    });

    await expect(harness.check({ isRetry: true })).rejects.toThrow();

    expect(harness.values.has(LAST_CHECKED_SLOT_KEY)).toBe(false);
    expect(harness.statusWrites.at(-1)).toMatchObject({
      state: 'error',
      lastErrorCode: 'schema',
    });
    expect(harness.statusWrites.at(-1)?.nextRunAt).toBeGreaterThan(NOW);
    expect(JSON.stringify(harness.statusWrites)).not.toContain('schema payload');
  });

  it('does not mark the slot when snapshot storage fails', async () => {
    const harness = createHarness();
    harness.saveSnapshot.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(harness.check({ isRetry: false })).rejects.toThrow();

    expect(harness.values.has(LAST_CHECKED_SLOT_KEY)).toBe(false);
    expect(harness.statusWrites.at(-1)?.lastErrorCode).toBe('storage');
  });

  it('skips a normal check for a slot already fetched under the lock', async () => {
    const harness = createHarness();
    harness.values.set(LAST_CHECKED_SLOT_KEY, slotId(NOW));

    await expect(harness.check({ isRetry: false })).resolves.toBe('skipped');

    expect(harness.lockRunner).toHaveBeenCalledTimes(1);
    expect(harness.fetchSnapshot).not.toHaveBeenCalled();
    expect(harness.saveSnapshot).not.toHaveBeenCalled();
    expect(harness.statusWrites.at(-1)?.nextRunAt).toBeGreaterThan(NOW);
  });

  it('bypasses slot de-duplication for a retry', async () => {
    const harness = createHarness({ inserted: false });
    harness.values.set(LAST_CHECKED_SLOT_KEY, slotId(NOW));

    await expect(harness.check({ isRetry: true })).resolves.toBe('unchanged');

    expect(harness.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.saveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('skips without fetching when the collector lock is busy', async () => {
    const harness = createHarness({ lockResult: 'busy' });

    await expect(harness.check({ isRetry: false })).resolves.toBe('skipped');

    expect(harness.fetchSnapshot).not.toHaveBeenCalled();
    expect(harness.saveSnapshot).not.toHaveBeenCalled();
    expect(harness.statusWrites.at(-1)?.nextRunAt).toBeGreaterThan(NOW);
  });
});

describe('startGameCollector', () => {
  it('wires injected dependencies, starts the scheduler immediately, and delegates stop', async () => {
    const storage = {} as KeyValueStore;
    const marketStore = {} as MarketStore;
    const fetchOfficialSnapshot = vi.fn(async () => snapshot());
    const lockRunner: LockRunner = async <T>(task: () => Promise<T>): Promise<CollectorLockResult<T>> => ({
      acquired: true,
      value: await task(),
    });
    const check = vi.fn<SchedulerCheck>(async () => 'updated' as const);
    let schedulerCheck: SchedulerCheck | undefined;
    const scheduler: Scheduler = {
      start: vi.fn(() => {
        void schedulerCheck?.({ isRetry: false });
      }),
      stop: vi.fn(),
    };
    const createCollectorCheck = vi.fn((options: CollectorCheckOptions) => {
      expect(options.storage).toBe(storage);
      expect(options.marketStore).toBe(marketStore);
      expect(options.fetchSnapshot).toBe(fetchOfficialSnapshot);
      expect(options.lockRunner).toBe(lockRunner);
      return check;
    });
    const createScheduler = vi.fn((options: { check: SchedulerCheck }): Scheduler => {
      schedulerCheck = options.check;
      return scheduler;
    });
    const dependencies: GameCollectorDependencies = {
      createGMKeyValueStore: () => storage,
      createMarketStore: () => marketStore,
      fetchOfficialSnapshot,
      lockRunner,
      createCollectorCheck,
      createScheduler,
    };

    const controller = startGameCollector(dependencies);
    await Promise.resolve();

    expect(createCollectorCheck).toHaveBeenCalledTimes(1);
    expect(createScheduler).toHaveBeenCalledTimes(1);
    expect(scheduler.start).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({ isRetry: false });

    controller.stop();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });
});
