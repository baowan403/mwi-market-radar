import type { CollectorStatus, Snapshot } from '../core/types';
import {
  DEFAULT_COLLECTOR_STATUS,
  STORAGE_PREFIX,
  createGMKeyValueStore,
  MarketStore,
  type KeyValueStore,
} from '../collector/market-store';
import {
  RETRY_DELAY_MS,
  createScheduler,
  nextHourlyRun,
  type CheckResult,
  type Scheduler,
  type SchedulerCheck,
  type SchedulerOptions,
  type SchedulerTimerApi,
} from '../collector/scheduler';
import {
  withCollectorLock,
  type CollectorLockOptions,
  type CollectorLockResult,
} from '../collector/lock';
import { fetchOfficialSnapshot } from '../collector/official-client';

const HOUR_MS = 3_600_000;
const LAST_CHECKED_SLOT_KEY = `${STORAGE_PREFIX}last-checked-slot`;

type CollectorErrorCode = 'network' | 'schema' | 'storage' | 'unknown';
export type LockRunner = <T>(task: () => Promise<T>) => Promise<CollectorLockResult<T>>;
export type FetchSnapshot = () => Snapshot | PromiseLike<Snapshot>;

export interface CollectorCheckContext {
  isRetry: boolean;
}

export interface CollectorCheckOptions {
  storage: KeyValueStore;
  marketStore: MarketStore;
  fetchSnapshot: FetchSnapshot;
  lockRunner?: LockRunner;
  /** Backwards-compatible alias for callers that named the injected wrapper `withLock`. */
  withLock?: LockRunner;
  now?: () => number;
}

export type CollectorCheckFactory = (options: CollectorCheckOptions) => SchedulerCheck;

export type CollectorLockFactory = <T>(
  options: CollectorLockOptions,
  task: () => T | PromiseLike<T>,
) => Promise<CollectorLockResult<T>>;

export interface GameCollectorDependencies {
  /** Prebuilt dependencies are useful for deterministic checks and tests. */
  storage?: KeyValueStore;
  marketStore?: MarketStore;
  fetchSnapshot?: FetchSnapshot;
  lockRunner?: LockRunner;
  withLock?: LockRunner;
  scheduler?: Scheduler;
  now?: () => number;
  timers?: SchedulerTimerApi;

  /** Production factories and their narrow injection points. */
  createGMKeyValueStore?: () => KeyValueStore;
  createStorage?: () => KeyValueStore;
  createMarketStore?: (storage: KeyValueStore) => MarketStore;
  fetchOfficialSnapshot?: FetchSnapshot;
  withCollectorLock?: CollectorLockFactory;
  lockOptions?: Omit<CollectorLockOptions, 'storage'>;
  createCollectorCheck?: CollectorCheckFactory;
  createScheduler?: (options: SchedulerOptions) => Scheduler;
}

export interface GameCollectorHandle {
  stop(): void;
}

interface LockedCheckResult {
  result: CheckResult;
  snapshot?: Snapshot;
}

/** Return the UTC hourly slot containing a timestamp. */
function slotIdForTimestamp(timestamp: number): number {
  return Math.floor(timestamp / HOUR_MS);
}

function isCollectorErrorCode(value: unknown): value is CollectorErrorCode {
  return value === 'network' || value === 'schema' || value === 'storage' || value === 'unknown';
}

function errorProperty(error: unknown, key: string): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  return (error as Record<string, string | undefined>)[key];
}

/** Classify an error without ever persisting its message or arbitrary properties. */
function classifyError(error: unknown): CollectorErrorCode {
  for (const key of ['code', 'kind', 'category', 'type']) {
    const value = errorProperty(error, key);
    if (isCollectorErrorCode(value)) return value;
  }

  const name = errorProperty(error, 'name');
  if (name === 'StorageWriteError' || name === 'QuotaExceededError') return 'storage';
  if (name === 'SyntaxError') return 'schema';
  if (name === 'TypeError') return 'network';

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/storage|quota|persist|write|disk/.test(message)) return 'storage';
  if (/schema|payload|json|parse|invalid snapshot|invalid market/.test(message)) return 'schema';
  if (/network|fetch|request|timeout|offline|abort|http|status|load/.test(message)) return 'network';
  return 'unknown';
}

function copyStatus(status: CollectorStatus): CollectorStatus {
  return {
    state: status.state,
    lastAttemptAt: status.lastAttemptAt,
    lastSuccessAt: status.lastSuccessAt,
    officialTimestamp: status.officialTimestamp,
    nextRunAt: status.nextRunAt,
    lastErrorCode: status.lastErrorCode,
  };
}

function isInsertedResult(value: unknown): value is { inserted: boolean } {
  return value !== null
    && typeof value === 'object'
    && typeof (value as { inserted?: unknown }).inserted === 'boolean';
}

/**
 * Build one injected, lock-aware collector check.
 *
 * Scheduling and userscript startup are intentionally outside this module. The
 * returned function performs exactly one normal or retry attempt.
 */
function createCollectorCheckInternal(options: CollectorCheckOptions): (context: CollectorCheckContext) => Promise<CheckResult> {
  const clock = options.now ?? (() => Date.now());
  const lockRunner = options.lockRunner ?? options.withLock;
  if (!lockRunner) {
    throw new Error('Collector lock runner is required.');
  }

  return async ({ isRetry }: CollectorCheckContext): Promise<CheckResult> => {
    const attemptAt = clock();
    let failureCode: CollectorErrorCode = 'unknown';

    const lockedResult = await lockRunner(async (): Promise<LockedCheckResult> => {
      // A normal check must compare the slot after acquiring the lock. This
      // keeps both de-duplication and the subsequent writes owner-authoritative.
      let lastCheckedSlot: number | null = null;
      if (!isRetry) {
        try {
          lastCheckedSlot = await options.storage.get<number | null>(LAST_CHECKED_SLOT_KEY, null);
        } catch (error) {
          failureCode = 'storage';
          throw error;
        }

        if (lastCheckedSlot === slotIdForTimestamp(attemptAt)) {
          return { result: 'skipped' };
        }
      }

      let previousStatus: CollectorStatus;
      try {
        previousStatus = typeof options.marketStore.getCollectorStatus === 'function'
          ? await options.marketStore.getCollectorStatus()
          : copyStatus(DEFAULT_COLLECTOR_STATUS);
      } catch (error) {
        failureCode = classifyError(error);
        throw error;
      }

      const startedStatus: CollectorStatus = {
        ...copyStatus(previousStatus),
        state: isRetry ? 'retrying' : 'checking',
        lastAttemptAt: attemptAt,
        lastErrorCode: null,
      };

      try {
        // Status writes stay in the lock so a busy loser cannot overwrite the
        // status written by the tab that owns the collector lease.
        await options.marketStore.setCollectorStatus(startedStatus);

        let snapshot: Snapshot;
        try {
          snapshot = await options.fetchSnapshot();
        } catch (error) {
          failureCode = classifyError(error);
          throw error;
        }

        let saved: unknown;
        try {
          // Snapshot persistence must remain inside the cross-tab lock.
          saved = await options.marketStore.saveSnapshot(snapshot);
        } catch (error) {
          failureCode = 'storage';
          throw error;
        }
        if (!isInsertedResult(saved)) {
          failureCode = 'unknown';
          throw new Error('Collector snapshot save returned an invalid result.');
        }

        try {
          // Mark the current slot only after the snapshot save has fulfilled.
          await options.storage.set(LAST_CHECKED_SLOT_KEY, slotIdForTimestamp(attemptAt));
        } catch (error) {
          failureCode = 'storage';
          throw error;
        }

        const result: CheckResult = saved.inserted ? 'updated' : 'unchanged';
        const finalStatus: CollectorStatus = {
          ...startedStatus,
          state: result === 'updated' || isRetry ? 'ok' : 'retrying',
          nextRunAt: result === 'updated' || isRetry
            ? nextHourlyRun(attemptAt)
            : attemptAt + RETRY_DELAY_MS,
          lastErrorCode: null,
        };
        if (result === 'updated') {
          finalStatus.lastSuccessAt = attemptAt;
          finalStatus.officialTimestamp = snapshot.timestamp;
        }

        await options.marketStore.setCollectorStatus(finalStatus);
        return { result, snapshot };
      } catch (error) {
        if (failureCode === 'unknown') failureCode = classifyError(error);
        const failureStatus: CollectorStatus = {
          ...startedStatus,
          state: isRetry ? 'error' : 'retrying',
          nextRunAt: isRetry
            ? nextHourlyRun(attemptAt)
            : attemptAt + RETRY_DELAY_MS,
          lastErrorCode: failureCode,
        };
        await options.marketStore.setCollectorStatus(failureStatus);
        throw error;
      }
    });

    if (!lockedResult.acquired) {
      // Busy callers intentionally leave the persisted status untouched.
      return 'skipped';
    }

    return lockedResult.value?.result ?? 'skipped';
  };
}

export const slotId = slotIdForTimestamp;
export const createCollectorCheck = createCollectorCheckInternal;

/**
 * Assemble and start the MWI-side collector with production defaults.
 *
 * Every boundary is injectable so startup can be exercised without GM APIs,
 * network access, or real timers. A caller may provide either complete
 * dependencies or factories; omitted pieces use the browser implementations.
 */
export function startGameCollector(
  dependencies: GameCollectorDependencies = {},
): GameCollectorHandle {
  const storageFactory = dependencies.createGMKeyValueStore
    ?? dependencies.createStorage
    ?? createGMKeyValueStore;
  const storage = dependencies.storage ?? storageFactory();

  const marketStore = dependencies.marketStore
    ?? (dependencies.createMarketStore ?? ((adapter: KeyValueStore) => new MarketStore(adapter)))(storage);
  const fetchSnapshot = dependencies.fetchSnapshot
    ?? dependencies.fetchOfficialSnapshot
    ?? (() => fetchOfficialSnapshot());

  const lockRunner: LockRunner = dependencies.lockRunner ?? dependencies.withLock ?? (<T>(task: () => Promise<T>) => {
    const lockFactory = dependencies.withCollectorLock ?? withCollectorLock;
    const lockOptions: CollectorLockOptions = {
      ...dependencies.lockOptions,
      storage,
    };
    if (dependencies.now !== undefined && dependencies.lockOptions?.now === undefined) {
      lockOptions.now = dependencies.now;
    }
    return lockFactory(lockOptions, task);
  });

  const checkFactory = dependencies.createCollectorCheck ?? createCollectorCheck;
  const checkOptions: CollectorCheckOptions = {
    storage,
    marketStore,
    fetchSnapshot,
    lockRunner,
  };
  if (dependencies.now !== undefined) checkOptions.now = dependencies.now;
  const check = checkFactory(checkOptions);

  const schedulerOptions: SchedulerOptions = { check };
  if (dependencies.now !== undefined) schedulerOptions.now = dependencies.now;
  if (dependencies.timers !== undefined) schedulerOptions.timers = dependencies.timers;
  const scheduler = dependencies.scheduler
    ?? (dependencies.createScheduler ?? createScheduler)(schedulerOptions);

  scheduler.start();
  return {
    stop: () => scheduler.stop(),
  };
}
