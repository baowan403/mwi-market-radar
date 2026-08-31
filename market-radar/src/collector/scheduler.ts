export type CheckResult = 'updated' | 'unchanged' | 'skipped';

export interface SchedulerCheckContext {
  isRetry: boolean;
}

export type SchedulerCheck =
  (context: SchedulerCheckContext) => CheckResult | Promise<CheckResult>;

export interface SchedulerTimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SchedulerOptions {
  check: SchedulerCheck;
  now?: () => number;
  timers?: SchedulerTimerApi;
  setTimeout?: SchedulerTimerApi['setTimeout'];
  clearTimeout?: SchedulerTimerApi['clearTimeout'];
}

export interface Scheduler {
  start(): void;
  stop(): void;
}

export const RETRY_DELAY_MS = 10 * 60_000;

/** Return the next local-time hourly boundary at minute 08:00. */
export function nextHourlyRun(now: number): number {
  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setMinutes(8);
  if (date.getTime() <= now) {
    date.setHours(date.getHours() + 1);
  }
  return date.getTime();
}

function defaultTimerApi(): SchedulerTimerApi {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const clock = options.now ?? (() => Date.now());
  const defaults = defaultTimerApi();
  const timerApi: SchedulerTimerApi = options.timers ?? {
    setTimeout: options.setTimeout ?? defaults.setTimeout,
    clearTimeout: options.clearTimeout ?? defaults.clearTimeout,
  };

  let started = false;
  let inFlight = false;
  let timer: unknown;
  let hasTimer = false;

  function clearScheduledTimer(): void {
    if (!hasTimer) return;
    timerApi.clearTimeout(timer);
    timer = undefined;
    hasTimer = false;
  }

  function schedule(delayMs: number, isRetry: boolean): void {
    if (!started) return;
    clearScheduledTimer();
    timer = timerApi.setTimeout(() => {
      timer = undefined;
      hasTimer = false;
      void runCheck(isRetry);
    }, Math.max(0, delayMs));
    hasTimer = true;
  }

  function scheduleRegular(): void {
    const currentTime = clock();
    schedule(nextHourlyRun(currentTime) - currentTime, false);
  }

  function scheduleRetry(): void {
    schedule(RETRY_DELAY_MS, true);
  }

  async function runCheck(isRetry: boolean): Promise<void> {
    if (!started || inFlight) return;
    inFlight = true;

    try {
      const result = await options.check({ isRetry });
      if (!started) return;

      if (isRetry || result !== 'unchanged') {
        scheduleRegular();
      } else {
        scheduleRetry();
      }
    } catch {
      if (!started) return;
      if (isRetry) {
        scheduleRegular();
      } else {
        scheduleRetry();
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      void runCheck(false);
    },

    stop(): void {
      started = false;
      clearScheduledTimer();
    },
  };
}
