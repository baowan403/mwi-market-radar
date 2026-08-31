import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTOR_LOCK_NAME,
  type CollectorLockManager,
  withCollectorLock,
} from '../src/collector/lock';

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
    expect(request).toHaveBeenCalledWith(
      COLLECTOR_LOCK_NAME,
      { ifAvailable: true },
      expect.any(Function),
    );
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

  it('fails closed without invoking the task when Web Locks are unavailable', async () => {
    const task = vi.fn(async () => 'must not run');
    vi.stubGlobal('navigator', { locks: undefined });

    await expect(withCollectorLock({ navigator: {} }, task)).rejects.toThrow(
      'Collector Web Lock API is unavailable.',
    );
    expect(task).not.toHaveBeenCalled();
  });
});
