export const COLLECTOR_LOCK_NAME = 'mwi-market-radar-collector';

export interface CollectorLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
}

export interface CollectorLockOptions {
  /** Injected Web Locks manager; takes precedence over the browser global. */
  lockManager?: CollectorLockManager;
  /** Alias useful when callers already have a `locks` object. */
  locks?: CollectorLockManager;
  /** Optional navigator-like object for deterministic native-lock tests. */
  navigator?: { locks?: CollectorLockManager };
}

export interface CollectorLockResult<T> {
  acquired: boolean;
  value?: T;
}

const UNAVAILABLE_ERROR = 'Collector Web Lock API is unavailable.';

function isLockManager(value: unknown): value is CollectorLockManager {
  return value !== null
    && typeof value === 'object'
    && 'request' in value
    && typeof value.request === 'function';
}

function getNativeLockManager(options: CollectorLockOptions): CollectorLockManager | undefined {
  if (isLockManager(options.lockManager)) return options.lockManager;
  if (isLockManager(options.locks)) return options.locks;
  if (isLockManager(options.navigator?.locks)) return options.navigator.locks;

  const browserNavigator = (globalThis as typeof globalThis & {
    navigator?: { locks?: unknown };
  }).navigator;
  return isLockManager(browserNavigator?.locks) ? browserNavigator.locks : undefined;
}

export async function withCollectorLock<T>(
  options: CollectorLockOptions = {},
  task: () => T | PromiseLike<T>,
): Promise<CollectorLockResult<T>> {
  const lockManager = getNativeLockManager(options);
  if (!lockManager) throw new Error(UNAVAILABLE_ERROR);

  return lockManager.request(COLLECTOR_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (lock === null) return { acquired: false };
    return { acquired: true, value: await task() };
  });
}
