import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScheduler,
  nextHourlyRun,
  type CheckResult,
  type SchedulerCheck,
} from '../src/collector/scheduler';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TEN_MINUTES = 10 * MINUTE;

function atTaipeiTime(value: string): number {
  return Date.parse(`${value}+08:00`);
}

async function flushAsyncWork(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('nextHourlyRun', () => {
  it('schedules 10:07:30 at 10:08:00 in the local timezone', () => {
    expect(nextHourlyRun(atTaipeiTime('2026-08-31T10:07:30'))).toBe(
      atTaipeiTime('2026-08-31T10:08:00'),
    );
  });

  it('treats exactly 10:08:00 as the following hour', () => {
    expect(nextHourlyRun(atTaipeiTime('2026-08-31T10:08:00'))).toBe(
      atTaipeiTime('2026-08-31T11:08:00'),
    );
  });

  it('schedules 10:09:00 at the following hour', () => {
    expect(nextHourlyRun(atTaipeiTime('2026-08-31T10:09:00'))).toBe(
      atTaipeiTime('2026-08-31T11:08:00'),
    );
  });
});

describe('createScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one immediate startup check', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    const check = vi.fn<({ isRetry }: { isRetry: boolean }) => Promise<CheckResult>>().mockResolvedValue('updated');
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();

    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ isRetry: false }));
  });

  it('schedules an updated result at the next regular slot', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    const check = vi.fn<({ isRetry }: { isRetry: boolean }) => Promise<CheckResult>>().mockResolvedValue('updated');
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1]?.[0]).toMatchObject({ isRetry: false });
  });

  it('retries an unchanged non-retry result exactly once', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    const check = vi
      .fn<({ isRetry }: { isRetry: boolean }) => Promise<CheckResult>>()
      .mockResolvedValueOnce('unchanged')
      .mockResolvedValueOnce('updated');
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);

    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1]?.[0]).toMatchObject({ isRetry: true });
    await vi.advanceTimersByTimeAsync(50 * MINUTE + 30_000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(check.mock.calls[2]?.[0]).toMatchObject({ isRetry: false });
  });

  it('retries one thrown error and returns to the regular schedule after retry error', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    const check = vi
      .fn<({ isRetry }: { isRetry: boolean }) => Promise<CheckResult>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network again'));
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);

    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1]?.[0]).toMatchObject({ isRetry: true });
    await vi.advanceTimersByTimeAsync(50 * MINUTE + 30_000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(check.mock.calls[2]?.[0]).toMatchObject({ isRetry: false });
  });

  it('does not retry a skipped result', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    const check = vi.fn<({ isRetry }: { isRetry: boolean }) => Promise<CheckResult>>().mockResolvedValue('skipped');
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1]?.[0]).toMatchObject({ isRetry: false });
    await vi.advanceTimersByTimeAsync(9 * MINUTE + 59_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('stops the pending timer and makes repeated starts idempotent', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    const check = vi.fn<({ isRetry }: { isRetry: boolean }) => Promise<CheckResult>>().mockResolvedValue('updated');
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    scheduler.start();
    await flushAsyncWork();
    expect(check).toHaveBeenCalledTimes(1);

    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not start another check while the current check is still pending', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    let resolveCheck!: (result: CheckResult) => void;
    const check = vi.fn(
      () => new Promise<CheckResult>((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(check).toHaveBeenCalledTimes(1);

    resolveCheck('updated');
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('starts a new immediate check after stop and restart during a slow check', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    let resolveFirst!: (result: CheckResult) => void;
    let resolveSecond!: (result: CheckResult) => void;
    const check = vi.fn<SchedulerCheck>(() => {
      if (check.mock.calls.length === 1) {
        return new Promise<CheckResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return new Promise<CheckResult>((resolve) => {
        resolveSecond = resolve;
      });
    });
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    scheduler.stop();
    scheduler.start();
    await flushAsyncWork();

    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1]?.[0]).toMatchObject({ isRetry: false });

    resolveFirst('updated');
    await flushAsyncWork();
    expect(vi.getTimerCount()).toBe(0);
    resolveSecond('updated');
    await flushAsyncWork();
    scheduler.stop();
  });

  it('does not let an old generation overwrite the new generation timer', async () => {
    vi.setSystemTime(atTaipeiTime('2026-08-31T10:07:30'));
    let resolveFirst!: (result: CheckResult) => void;
    const activeTimers = new Set<number>();
    let nextTimerId = 0;
    const timers = {
      setTimeout: vi.fn((callback: () => void, _delayMs: number) => {
        void callback;
        const timerId = ++nextTimerId;
        activeTimers.add(timerId);
        return timerId;
      }),
      clearTimeout: vi.fn((handle: unknown) => {
        activeTimers.delete(handle as number);
      }),
    };
    const check = vi.fn()
      .mockImplementationOnce(() => new Promise<CheckResult>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce('updated');
    const scheduler = createScheduler({ now: () => Date.now(), check, timers });

    scheduler.start();
    await flushAsyncWork();
    scheduler.stop();
    scheduler.start();
    await flushAsyncWork();

    expect(timers.setTimeout).toHaveBeenCalledTimes(1);
    expect(activeTimers.size).toBe(1);

    resolveFirst('updated');
    await flushAsyncWork();

    expect(timers.setTimeout).toHaveBeenCalledTimes(1);
    expect(timers.clearTimeout).not.toHaveBeenCalled();
    expect(activeTimers.size).toBe(1);
    scheduler.stop();
  });

  it('does not schedule after a stopped generation resolves without restart', async () => {
    let resolveCheck!: (result: CheckResult) => void;
    const timers = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    };
    const check = vi.fn(() => new Promise<CheckResult>((resolve) => {
      resolveCheck = resolve;
    }));
    const scheduler = createScheduler({ now: () => Date.now(), check, timers });

    scheduler.start();
    await flushAsyncWork();
    scheduler.stop();
    resolveCheck('updated');
    await flushAsyncWork();

    expect(timers.setTimeout).not.toHaveBeenCalled();
    expect(timers.clearTimeout).not.toHaveBeenCalled();
  });

  it('passes a generation signal and aborts it when stopped', async () => {
    let resolveCheck!: (result: CheckResult) => void;
    let checkSignal!: AbortSignal;
    const check = vi.fn<SchedulerCheck>(({ signal }) => {
      if (signal === undefined) throw new Error('scheduler signal is required');
      checkSignal = signal;
      return new Promise<CheckResult>((resolve) => {
        resolveCheck = resolve;
      });
    });
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    expect(checkSignal).toBeInstanceOf(AbortSignal);
    expect(checkSignal.aborted).toBe(false);

    scheduler.stop();
    expect(checkSignal.aborted).toBe(true);
    resolveCheck('updated');
    await flushAsyncWork();
  });

  it('creates a fresh non-aborted signal after a stop and restart', async () => {
    const signals: AbortSignal[] = [];
    const resolvers: Array<(result: CheckResult) => void> = [];
    const check = vi.fn<SchedulerCheck>(({ signal }) => {
      if (signal === undefined) throw new Error('scheduler signal is required');
      signals.push(signal);
      return new Promise<CheckResult>((resolve) => {
        resolvers.push(resolve);
      });
    });
    const scheduler = createScheduler({ now: () => Date.now(), check });

    scheduler.start();
    await flushAsyncWork();
    scheduler.stop();
    scheduler.start();
    await flushAsyncWork();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1]?.aborted).toBe(false);

    resolvers[0]?.('updated');
    resolvers[1]?.('updated');
    await flushAsyncWork();
    scheduler.stop();
  });
});
