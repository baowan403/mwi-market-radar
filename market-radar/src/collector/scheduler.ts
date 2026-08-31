export type CheckResult = 'updated' | 'unchanged' | 'skipped';

export interface SchedulerCheckContext {
  isRetry: boolean;
  /** Present for scheduler-driven checks; optional for existing manual callers. */
  signal?: AbortSignal;
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
  let generation = 0;
  let inFlightGeneration: number | null = null;
  let activeController: AbortController | null = null;
  let timer: unknown;
  let hasTimer = false;

  function clearScheduledTimer(): void {
    if (!hasTimer) return;
    const handle = timer;
    timer = undefined;
    hasTimer = false;
    timerApi.clearTimeout(handle);
  }

  function isActive(lifecycleGeneration: number): boolean {
    return started && lifecycleGeneration === generation;
  }

  function schedule(
    delayMs: number,
    isRetry: boolean,
    lifecycleGeneration: number,
    signal: AbortSignal,
  ): void {
    if (!isActive(lifecycleGeneration)) return;
    clearScheduledTimer();
    let scheduledHandle: unknown;
    const callback = (): void => {
      if (!isActive(lifecycleGeneration) || timer !== scheduledHandle) return;
      timer = undefined;
      hasTimer = false;
      void runCheck(isRetry, lifecycleGeneration, signal);
    };
    scheduledHandle = timerApi.setTimeout(callback, Math.max(0, delayMs));
    timer = scheduledHandle;
    hasTimer = true;
  }

  function scheduleRegular(lifecycleGeneration: number, signal: AbortSignal): void {
    if (!isActive(lifecycleGeneration)) return;
    const currentTime = clock();
    schedule(nextHourlyRun(currentTime) - currentTime, false, lifecycleGeneration, signal);
  }

  function scheduleRetry(lifecycleGeneration: number, signal: AbortSignal): void {
    schedule(RETRY_DELAY_MS, true, lifecycleGeneration, signal);
  }

  async function runCheck(
    isRetry: boolean,
    lifecycleGeneration: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (!isActive(lifecycleGeneration) || inFlightGeneration === lifecycleGeneration) return;
    inFlightGeneration = lifecycleGeneration;

    try {
      const result = await options.check({ isRetry, signal });
      if (!isActive(lifecycleGeneration)) return;

      if (isRetry || result !== 'unchanged') {
        scheduleRegular(lifecycleGeneration, signal);
      } else {
        scheduleRetry(lifecycleGeneration, signal);
      }
    } catch {
      if (!isActive(lifecycleGeneration)) return;
      if (isRetry) {
        scheduleRegular(lifecycleGeneration, signal);
      } else {
        scheduleRetry(lifecycleGeneration, signal);
      }
    } finally {
      if (inFlightGeneration === lifecycleGeneration) {
        inFlightGeneration = null;
      }
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      const lifecycleGeneration = ++generation;
      const controller = new AbortController();
      activeController = controller;
      void runCheck(false, lifecycleGeneration, controller.signal);
    },

    stop(): void {
      started = false;
      generation += 1;
      const controller = activeController;
      activeController = null;
      controller?.abort();
      clearScheduledTimer();
    },
  };
}
