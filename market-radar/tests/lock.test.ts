import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../src/collector/market-store';
import {
  COLLECTOR_CANDIDATE_PREFIX,
  COLLECTOR_LEASE_KEY,
  COLLECTOR_LOCK_NAME,
  type CollectorHeartbeatFactory,
  type CollectorLockManager,
  withCollectorLock,
} from '../src/collector/lock';

class MemoryKeyValueStore implements KeyValueStore {
  readonly values = new Map<string, unknown>();
  onSet: ((key: string, value: unknown) => void) | null = null;

  async get<T>(key: string, fallback: T): Promise<T> {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
    this.onSet?.(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

function candidateKey(owner: string): string {
  return `${COLLECTOR_CANDIDATE_PREFIX}${encodeURIComponent(owner)}`;
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

describe('collector lock with the lease election fallback', () => {
  function fallbackOptions(storage: MemoryKeyValueStore, owner: string) {
    return {
      storage,
      owner,
      now: () => 1_000,
      electionWindowMs: 0,
      jitter: () => 0,
      sleep: async () => undefined,
      leaseMs: 120_000,
      releaseGraceMs: 1_000,
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
    expect(await storage.keys()).not.toContain(candidateKey('mine'));
  });

  it('claims an expired lease through the election window and leaves a short release lease', async () => {
    const storage = new MemoryKeyValueStore();
    storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other', expiresAt: 999 });
    const sleep = vi.fn(async () => undefined);
    const task = vi.fn(async () => 'snapshot');

    await expect(
      withCollectorLock({ ...fallbackOptions(storage, 'mine'), sleep }, task),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(sleep).toHaveBeenCalledWith(0);
    expect(task).toHaveBeenCalledTimes(1);
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'mine', expiresAt: 2_000 });
    expect(await storage.keys()).not.toContain(candidateKey('mine'));
  });

  it('elects one deterministic winner when two contenders start together', async () => {
    const storage = new MemoryKeyValueStore();
    const task = vi.fn(async () => 'snapshot');

    const first = withCollectorLock(fallbackOptions(storage, 'zeta'), task);
    const second = withCollectorLock(fallbackOptions(storage, 'alpha'), task);
    const results = await Promise.all([first, second]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.find((result) => result.acquired)?.value).toBe('snapshot');
    expect(task).toHaveBeenCalledTimes(1);
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'alpha', expiresAt: 2_000 });
    expect(await storage.keys()).not.toContain(candidateKey('zeta'));
    expect(await storage.keys()).not.toContain(candidateKey('alpha'));
  });

  it('does not let a stale or late contender overwrite an active lease', async () => {
    const storage = new MemoryKeyValueStore();
    const leaseWritten = new Promise<void>((resolve) => {
      storage.onSet = (key) => {
        if (key === COLLECTOR_LEASE_KEY) resolve();
      };
    });
    let releaseTask!: () => void;
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const first = withCollectorLock(fallbackOptions(storage, 'winner'), async () => {
      await taskGate;
      return 'snapshot';
    });

    await leaseWritten;
    const activeLease = storage.values.get(COLLECTOR_LEASE_KEY);
    const late = await withCollectorLock(fallbackOptions(storage, 'late'), async () => 'should not run');

    expect(late).toEqual({ acquired: false });
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual(activeLease);
    releaseTask();
    await expect(first).resolves.toEqual({ acquired: true, value: 'snapshot' });
  });

  it('does not delete a newer lease at completion', async () => {
    const storage = new MemoryKeyValueStore();

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), async () => {
        storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'newer', expiresAt: 5_000 });
        return 'snapshot';
      }),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'newer', expiresAt: 5_000 });
    expect(await storage.keys()).not.toContain(candidateKey('mine'));
  });

  it('extends only the current owner during a heartbeat', async () => {
    const storage = new MemoryKeyValueStore();
    let currentNow = 1_000;
    let beat!: () => Promise<void>;
    let stopCalls = 0;
    const heartbeat: CollectorHeartbeatFactory = (callback, intervalMs) => {
      expect(intervalMs).toBe(40_000);
      beat = callback;
      return () => {
        stopCalls += 1;
      };
    };

    await expect(
      withCollectorLock(
        { ...fallbackOptions(storage, 'mine'), now: () => currentNow, heartbeat },
        async () => {
          currentNow = 20_000;
          await beat();
          expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'mine', expiresAt: 140_000 });
          storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other', expiresAt: 50_000 });
          currentNow = 30_000;
          await beat();
          expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'other', expiresAt: 50_000 });
          return 'snapshot';
        },
      ),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(stopCalls).toBe(1);
  });

  it('shortens the lease and cleans its candidate when the task throws', async () => {
    const storage = new MemoryKeyValueStore();
    const error = new Error('task failed');

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), () => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'mine', expiresAt: 2_000 });
    expect(await storage.keys()).not.toContain(candidateKey('mine'));
  });

  it('cleans its candidate when it loses the election', async () => {
    const storage = new MemoryKeyValueStore();
    storage.values.set(candidateKey('alpha'), { owner: 'alpha', expiresAt: 2_000 });

    await expect(
      withCollectorLock(fallbackOptions(storage, 'zeta'), async () => 'should not run'),
    ).resolves.toEqual({ acquired: false });
    expect(await storage.keys()).not.toContain(candidateKey('zeta'));
    expect(storage.values.get(candidateKey('alpha'))).toEqual({ owner: 'alpha', expiresAt: 2_000 });
  });

  it('reclaims malformed lease and candidate values', async () => {
    const storage = new MemoryKeyValueStore();
    storage.values.set(COLLECTOR_LEASE_KEY, { owner: 'other' });
    storage.values.set(candidateKey('malformed'), { expiresAt: 2_000 });

    await expect(
      withCollectorLock(fallbackOptions(storage, 'mine'), async () => 'snapshot'),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({ owner: 'mine', expiresAt: 2_000 });
    expect(await storage.keys()).not.toContain(candidateKey('mine'));
  });

  it('generates a timestamp-and-random owner when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    const storage = new MemoryKeyValueStore();
    const task = vi.fn(async () => 'snapshot');

    await expect(
      withCollectorLock({ ...fallbackOptions(storage, ''), owner: undefined }, task),
    ).resolves.toEqual({ acquired: true, value: 'snapshot' });
    expect(task).toHaveBeenCalledTimes(1);
    expect(storage.values.get(COLLECTOR_LEASE_KEY)).toEqual({
      owner: expect.any(String),
      expiresAt: 2_000,
    });
  });

  it('sanitizes candidate and lease storage errors', async () => {
    const secret = 'secret-owner-value';
    const storage: KeyValueStore = {
      async get() {
        throw new Error(secret);
      },
      async set() {
        throw new Error(secret);
      },
      async delete() {
        throw new Error(secret);
      },
      async keys() {
        throw new Error(secret);
      },
    };

    const error = await withCollectorLock({
      ...fallbackOptions(storage as MemoryKeyValueStore, 'mine'),
      owner: 'mine',
    }, async () => 'snapshot').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secret);
  });
});
