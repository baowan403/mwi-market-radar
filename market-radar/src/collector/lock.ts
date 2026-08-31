import type { KeyValueStore } from './market-store';

export const COLLECTOR_LOCK_NAME = 'mwi-market-radar-collector';
export const COLLECTOR_LEASE_KEY = 'mwi-radar:v1:collector-lease';
export const DEFAULT_COLLECTOR_LEASE_MS = 120_000;
export const COLLECTOR_JITTER_MIN_MS = 100;
export const COLLECTOR_JITTER_MAX_MS = 400;

export interface CollectorLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
}

export interface CollectorLockOptions {
  /** Storage used when the browser does not provide Web Locks. */
  storage?: KeyValueStore;
  /** Injected Web Locks manager; takes precedence over the browser global. */
  lockManager?: CollectorLockManager;
  /** Alias useful when callers already have a `locks` object. */
  locks?: CollectorLockManager;
  /** Optional navigator-like object for deterministic native-lock tests. */
  navigator?: { locks?: CollectorLockManager };
  owner?: string;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  /** Returns the pre-verification delay in milliseconds. Defaults to 100–400 ms. */
  jitter?: () => number;
  leaseMs?: number;
}

export interface CollectorLockResult<T> {
  acquired: boolean;
  value?: T;
}

interface CollectorLease {
  owner: string;
  expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseLease(value: unknown): CollectorLease | null {
  if (!isRecord(value)) return null;
  if (typeof value.owner !== 'string' || value.owner.length === 0) return null;
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return null;
  return { owner: value.owner, expiresAt: value.expiresAt };
}

function defaultJitter(): number {
  return (
    COLLECTOR_JITTER_MIN_MS +
    Math.floor(Math.random() * (COLLECTOR_JITTER_MAX_MS - COLLECTOR_JITTER_MIN_MS + 1))
  );
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

function defaultOwner(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Collector lock owner generation is unavailable.');
  }
  return globalThis.crypto.randomUUID();
}

function getNativeLockManager(options: CollectorLockOptions): CollectorLockManager | undefined {
  if (options.lockManager) return options.lockManager;
  if (options.locks) return options.locks;
  if (options.navigator?.locks) return options.navigator.locks;

  const browserNavigator = (globalThis as typeof globalThis & {
    navigator?: { locks?: unknown };
  }).navigator;
  const lockManager = browserNavigator?.locks;
  if (typeof lockManager !== 'object' || lockManager === null) return undefined;
  if (!('request' in lockManager) || typeof lockManager.request !== 'function') return undefined;
  return lockManager as CollectorLockManager;
}

function storageError(operation: 'read' | 'write' | 'delete'): Error {
  return new Error(`Collector lock storage ${operation} failed.`);
}

async function readLease(storage: KeyValueStore): Promise<unknown> {
  try {
    return await storage.get<unknown | null>(COLLECTOR_LEASE_KEY, null);
  } catch {
    throw storageError('read');
  }
}

async function writeLease(storage: KeyValueStore, lease: CollectorLease): Promise<void> {
  try {
    await storage.set(COLLECTOR_LEASE_KEY, lease);
  } catch {
    throw storageError('write');
  }
}

async function deleteLease(storage: KeyValueStore): Promise<void> {
  try {
    await storage.delete(COLLECTOR_LEASE_KEY);
  } catch {
    throw storageError('delete');
  }
}

async function withNativeCollectorLock<T>(
  lockManager: CollectorLockManager,
  task: () => T | PromiseLike<T>,
): Promise<CollectorLockResult<T>> {
  return lockManager.request(COLLECTOR_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (lock === null) return { acquired: false };
    return { acquired: true, value: await task() };
  });
}

async function withLeaseCollectorLock<T>(
  options: CollectorLockOptions,
  task: () => T | PromiseLike<T>,
): Promise<CollectorLockResult<T>> {
  const storage = options.storage;
  if (!storage) {
    throw new Error('Collector lock storage is required when Web Locks are unavailable.');
  }

  const clock = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? defaultJitter;
  const leaseMs = options.leaseMs ?? DEFAULT_COLLECTOR_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('Collector lock lease duration must be a positive finite number.');
  }
  const owner = options.owner ?? defaultOwner();

  const existing = parseLease(await readLease(storage));
  if (existing !== null && existing.expiresAt > clock()) {
    return { acquired: false };
  }

  const lease: CollectorLease = { owner, expiresAt: clock() + leaseMs };
  await writeLease(storage, lease);

  let taskFailed = false;
  try {
    await sleep(jitter());
    const confirmed = parseLease(await readLease(storage));
    if (confirmed?.owner !== owner) return { acquired: false };
    return { acquired: true, value: await task() };
  } catch (error) {
    taskFailed = true;
    throw error;
  } finally {
    try {
      const current = parseLease(await readLease(storage));
      if (current?.owner === owner) await deleteLease(storage);
    } catch (error) {
      if (!taskFailed) throw error;
    }
  }
}

export async function withCollectorLock<T>(
  options: CollectorLockOptions,
  task: () => T | PromiseLike<T>,
): Promise<CollectorLockResult<T>> {
  const lockManager = getNativeLockManager(options);
  if (lockManager) return withNativeCollectorLock(lockManager, task);
  return withLeaseCollectorLock(options, task);
}
