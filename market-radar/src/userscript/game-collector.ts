import type { CollectorStatus, Snapshot } from '../core/types';
import {
  DEFAULT_COLLECTOR_STATUS,
  STORAGE_PREFIX,
  type KeyValueStore,
  type MarketStore,
} from '../collector/market-store';
import { RETRY_DELAY_MS, nextHourlyRun, type CheckResult } from '../collector/scheduler';
import type { CollectorLockResult } from '../collector/lock';

const HOUR_MS = 3_600_000;
const LAST_CHECKED_SLOT_KEY = `${STORAGE_PREFIX}last-checked-slot`;

type CollectorErrorCode = 'network' | 'schema' | 'storage' | 'unknown';
type LockRunner = <T>(task: () => Promise<T>) => Promise<CollectorLockResult<T>>;
type FetchSnapshot = () => Snapshot | PromiseLike<Snapshot>;

interface CollectorCheckContext {
  isRetry: boolean;
}

interface CollectorCheckOptions {
  storage: KeyValueStore;
  marketStore: MarketStore;
  fetchSnapshot: FetchSnapshot;
  lockRunner?: LockRunner;
  /** Backwards-compatible alias for callers that named the injected wrapper `withLock`. */
  withLock?: LockRunner;
  now?: () => number;
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
    let previousStatus: CollectorStatus;

    try {
      previousStatus = typeof options.marketStore.getCollectorStatus === 'function'
        ? await options.marketStore.getCollectorStatus()
        : copyStatus(DEFAULT_COLLECTOR_STATUS);
    } catch (error) {
      throw error;
    }

    const startedStatus: CollectorStatus = {
      ...copyStatus(previousStatus),
      state: isRetry ? 'retrying' : 'checking',
      lastAttemptAt: attemptAt,
      lastErrorCode: null,
    };
    await options.marketStore.setCollectorStatus(startedStatus);

    let failureCode: CollectorErrorCode = 'unknown';
    let lockedResult: CollectorLockResult<LockedCheckResult>;

    try {
      lockedResult = await lockRunner(async (): Promise<LockedCheckResult> => {
        if (!isRetry) {
          let lastCheckedSlot: number | null;
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

        return {
          result: saved.inserted ? 'updated' : 'unchanged',
          snapshot,
        };
      });
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

    if (!lockedResult.acquired) {
      const skippedStatus: CollectorStatus = {
        ...startedStatus,
        nextRunAt: nextHourlyRun(attemptAt),
      };
      await options.marketStore.setCollectorStatus(skippedStatus);
      return 'skipped';
    }

    const value = lockedResult.value;
    if (!value || value.result === 'skipped') {
      const skippedStatus: CollectorStatus = {
        ...startedStatus,
        nextRunAt: nextHourlyRun(attemptAt),
      };
      await options.marketStore.setCollectorStatus(skippedStatus);
      return 'skipped';
    }

    const finalStatus: CollectorStatus = {
      ...startedStatus,
      state: value.result === 'updated' || isRetry ? 'ok' : 'retrying',
      nextRunAt: value.result === 'updated' || isRetry
        ? nextHourlyRun(attemptAt)
        : attemptAt + RETRY_DELAY_MS,
      lastErrorCode: null,
    };
    if (value.result === 'updated') {
      finalStatus.lastSuccessAt = attemptAt;
      finalStatus.officialTimestamp = value.snapshot?.timestamp ?? null;
    }

    await options.marketStore.setCollectorStatus(finalStatus);
    return value.result;
  };
}

export const slotId = slotIdForTimestamp;
export const createCollectorCheck = createCollectorCheckInternal;
