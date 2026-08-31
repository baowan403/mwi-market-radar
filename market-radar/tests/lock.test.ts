import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../src/collector/market-store';
import {
  COLLECTOR_LEASE_KEY,
  COLLECTOR_LOCK_NAME,
  withCollectorLock,
} from '../src/collector/lock';
import type { CollectorLockManager } from '../src/collector/lock';

class MemoryKeyValueStore implements KeyValueStore {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string, fallback: T): Promise<T> {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collector lock with Web Locks', () => {
  it('runs the task once and releases an acquired native lock', async () => {
    const task = vi.fn(async () => 'snapshot');
    const request = vi.fn(async <T>(
      _name: string,
      _options: { ifAvailable: true },
      callback: (lock: unknown | null) => Promise<T>,
    ): Promise<T> => callback({})) as unknown as CollectorLockManager['request'];

    await expect(
      withCollectorLock({ lockManager: { request } }, task),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(request).toHaveBeenCalledWith(COLLECTOR_LOCK_NAME, { ifAvailable: true }, expect.any(Function));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('returns busy without running the task when no native lock is available', async () => {
    const task = vi.fn(async () => 'should not run');
    const request = vi.fn(async <T>(
      _name: string,
      _options: { ifAvailable: true },
      callback: (lock: unknown | null) => Promise<T>,
    ): Promise<T> => callback(null)) as unknown as CollectorLockManager['request'];

    await expect(
      withCollectorLock({ lockManager: { request } }, task),
    ).resolves.toEqual({ acquired: false });
    expect(task).not.toHaveBeenCalled();
  });

  it('propagates a task error through an acquired native lock', async () => {
    const error = new Error('task failed');
    const request = vi.fn(async <T>(
      _name: string,
      _options: { ifAvailable: true },
      callback: (lock: unknown | null) => Promise<T>,
    ): Promise<T> => callback({})) as unknown as CollectorLockManager['request'];

    await expect(
      withCollectorLock({ lockManager: { request } }, () => Promise.reject(error)),
    ).rejects.toBe(error);
  });
});

describe('collector lock with the lease fallback', () => {
  function fallbackOptions(storage: MemoryKeyValueStore, owner: string) {
    return {
      storage,
      owner,
      now: () => 1_000,
      jitter: () => 100,
      sleep: async () => undefined,
    };
  }

  it('does not claim an active lease owned by another collector', async () => {
    const storage = new MemoryKeyValueStore();
    storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other', expiresAt: 2_000 });
    const task = vi.fn(async () => 'should not run');

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), task),
    ).resolves.toEqual({ acquired: false });
    expect(task).not.toHaveBeenCalled();
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'other', expiresAt: 2_000 });
  });

  it('claims an expired lease, waits, runs once, and releases it', async () => {
    const storage = new MemoryKeyValueStore();
    storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other', expiresAt: 999 });
    const sleep = vi.fn(async () => undefined);
    const task = vi.fn(async () => 'snapshot');

    await expect(
      withCollectorLock({ ...fallbackOptions(storage, 'mine'), sleep }, task),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(sleep).toHaveBeenCalledWith(100);
    expect(task).toHaveBeenCalledTimes(1);
    expect(storage.values.has(COLLECTOR_LEASE_KEY)).toBe(false);
  });

  it('lets only one of two simultaneous fallback collectors execute', async () => {
    const storage = new MemoryKeyValueStore();
    let sleepCalls = 0;
    let releaseSleep!: () => void;
    const sleepGate = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const sleep = vi.fn(async () => {
      sleepCalls += 1;
      if (sleepCalls === 2) releaseSleep();
      await sleepGate;
    });
    const task = vi.fn(async () => 'snapshot');

    const first = withCollectorLock({ ...fallbackOptions(storage, 'first'), sleep }, task);
    const second = withCollectorLock({ ...fallbackOptions(storage, 'second'), sleep }, task);
    const results = await Promise.all([first, second]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(task).toHaveBeenCalledTimes(1);
    expect(storage.values.has(COLLECTOR_LEASE_KEY)).toBe(false);
  });

  it('releases the fallback lease when the task throws', async () => {
    const storage = new MemoryKeyValueStore();
    const error = new Error('task failed');

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), () => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(storage.values.has(COLLECTOR_LEASE_KEY)).toBe(false);
  });

  it('does not delete a lease that another collector owns at release time', async () => {
    const storage = new MemoryKeyValueStore();

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), async () => {
        storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other', expiresAt: 5_000 });
        return 'snapshot';
      }),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'other', expiresAt: 5_000 });
  });

  it('reclaims malformed lease values', async () => {
    const storage = new MemoryKeyValueStore();
    storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other' });

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), async () => 'snapshot'),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(storage.values.has(COLLECTOR_LEASE_KEY)).toBe(false);
  });

  it('does not expose a stored lease value when storage fails', async () => {
    const storage: KeyValueStore = {
      async get() {
        throw new Error('secret-owner-value');
      },
      async set() {
        throw new Error('unused');
      },
      async delete() {},
      async keys() {
        return [];
      },
    };

    const error = await withCollectorLock(fallbackOptions(storage as MemoryKeyValueStore, 'secret-owner-value'), async () => 'snapshot')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret-owner-value');
  });
});
