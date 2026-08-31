import type { KeyValueStore } from './market-store';

export const COLLECTOR_LOCK_NAME = 'mwi-market-radar-collector';
export const COLLECTOR_LEASE_KEY = 'mwi-radar:v1:collector-lease';
export const COLLECTOR_CANDIDATE_PREFIX = 'mwi-radar:v1:collector-candidate:';
export const DEFAULT_COLLECTOR_LEASE_MS = 120_000;
export const COLLECTOR_JITTER_MIN_MS = 100;
export const COLLECTOR_JITTER_MAX_MS = 400;
export const DEFAULT_ELECTION_WINDOW_MS = 500;
export const DEFAULT_RELEASE_GRACE_MS = 1_000;

export interface CollectorLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
}

export interface CollectorHeartbeatHandle {
  stop(): void;
}

export type CollectorHeartbeatFactory = (
  beat: () => Promise<void>,
  intervalMs: number,
) => CollectorHeartbeatHandle | (() => void) | void;

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
  sleep?: (delayMs: number) => void | PromiseLike<void>;
  /** Returns the pre-verification delay in milliseconds. Defaults to 100–400 ms. */
  jitter?: () => number;
  leaseMs?: number;
  electionWindowMs?: number;
  heartbeat?: CollectorHeartbeatFactory;
  heartbeatIntervalMs?: number;
  releaseGraceMs?: number;
}

export interface CollectorLockResult<T> {
  acquired: boolean;
  value?: T;
}

export interface CollectorLease {
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
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

function storageError(operation: 'read' | 'write' | 'delete' | 'list'): Error {
  return new Error(`Collector lock storage ${operation} failed.`);
}

async function readStorageValue(storage: KeyValueStore, key: string): Promise<unknown> {
  try {
    return await storage.get<unknown | null>(key, null);
  } catch {
    throw storageError('read');
  }
}

async function listStorageKeys(storage: KeyValueStore): Promise<string[]> {
  try {
    return await storage.keys();
  } catch {
    throw storageError('list');
  }
}

async function writeStorageValue(storage: KeyValueStore, key: string, value: CollectorLease): Promise<void> {
  try {
    await storage.set(key, value);
  } catch {
    throw storageError('write');
  }
}

async function deleteStorageValue(storage: KeyValueStore, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch {
    throw storageError('delete');
  }
}

export function collectorCandidateKey(owner: string): string {
  return `${COLLECTOR_CANDIDATE_PREFIX}${encodeURIComponent(owner)}`;
}

function ownerFromCandidateKey(key: string): string | null {
  if (!key.startsWith(COLLECTOR_CANDIDATE_PREFIX)) return null;
  const encodedOwner = key.slice(COLLECTOR_CANDIDATE_PREFIX.length);
  if (encodedOwner.length === 0) return null;

  try {
    const owner = decodeURIComponent(encodedOwner);
    return owner.length > 0 ? owner : null;
  } catch {
    return null;
  }
}

async function activeLease(
  storage: KeyValueStore,
  clock: () => number,
): Promise<CollectorLease | null> {
  const lease = parseLease(await readStorageValue(storage, COLLECTOR_LEASE_KEY));
  return lease !== null && lease.expiresAt > clock() ? lease : null;
}

async function activeCandidates(
  storage: KeyValueStore,
  clock: () => number,
): Promise<CollectorLease[]> {
  const now = clock();
  const candidates: CollectorLease[] = [];
  for (const key of await listStorageKeys(storage)) {
    const keyOwner = ownerFromCandidateKey(key);
    if (keyOwner === null) continue;

    const candidate = parseLease(await readStorageValue(storage, key));
    if (candidate !== null && candidate.owner === keyOwner && candidate.expiresAt > now) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function electedOwner(candidates: CollectorLease[]): string | null {
  let winner: string | null = null;
  for (const candidate of candidates) {
    if (winner === null || candidate.owner < winner) winner = candidate.owner;
  }
  return winner;
}

function defaultHeartbeat(
  beat: () => Promise<void>,
  intervalMs: number,
): CollectorHeartbeatHandle {
  const timer = globalThis.setInterval(() => {
    void beat().catch(() => undefined);
  }, intervalMs);
  return {
    stop: () => globalThis.clearInterval(timer),
  };
}

function stopHeartbeat(handle: CollectorHeartbeatHandle | (() => void) | void): void {
  if (typeof handle === 'function') {
    handle();
  } else {
    handle?.stop();
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
  const electionWindowMs = options.electionWindowMs ?? DEFAULT_ELECTION_WINDOW_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? leaseMs / 3;
  const releaseGraceMs = options.releaseGraceMs ?? DEFAULT_RELEASE_GRACE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('Collector lock lease duration must be a positive finite number.');
  }
  if (!Number.isFinite(electionWindowMs) || electionWindowMs < 0) {
    throw new Error('Collector lock election window must be a finite non-negative number.');
  }
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    throw new Error('Collector lock heartbeat interval must be a positive finite number.');
  }
  if (!Number.isFinite(releaseGraceMs) || releaseGraceMs < 0) {
    throw new Error('Collector lock release grace must be a finite non-negative number.');
  }

  const owner = options.owner ?? defaultOwner();
  if (await activeLease(storage, clock) !== null) {
    return { acquired: false };
  }

  const candidateStorageKey = collectorCandidateKey(owner);
  let candidateWriteAttempted = false;
  let leaseWriteAttempted = false;
  let operationFailed = false;
  try {
    candidateWriteAttempted = true;
    await writeStorageValue(storage, candidateStorageKey, {
      owner,
      expiresAt: clock() + leaseMs,
    });

    const delayMs = electionWindowMs + jitter();
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error('Collector lock election delay must be a finite non-negative number.');
    }
    await sleep(delayMs);

    const winner = electedOwner(await activeCandidates(storage, clock));
    if (winner !== owner) return { acquired: false };

    const leaseBeforeWrite = await activeLease(storage, clock);
    if (leaseBeforeWrite !== null && leaseBeforeWrite.owner !== owner) {
      return { acquired: false };
    }

    leaseWriteAttempted = true;
    await writeStorageValue(storage, COLLECTOR_LEASE_KEY, {
      owner,
      expiresAt: clock() + leaseMs,
    });

    const confirmed = parseLease(await readStorageValue(storage, COLLECTOR_LEASE_KEY));
    if (confirmed?.owner !== owner) return { acquired: false };

    let heartbeatActive = true;
    const beat = async (): Promise<void> => {
      if (!heartbeatActive) return;
      const current = parseLease(await readStorageValue(storage, COLLECTOR_LEASE_KEY));
      if (!heartbeatActive || current?.owner !== owner) return;
      await writeStorageValue(storage, COLLECTOR_LEASE_KEY, {
        owner,
        expiresAt: clock() + leaseMs,
      });
    };
    const heartbeatFactory = options.heartbeat ?? defaultHeartbeat;
    const heartbeatHandle = heartbeatFactory(beat, heartbeatIntervalMs);
    let taskFailed = false;
    try {
      return { acquired: true, value: await task() };
    } catch (error) {
      taskFailed = true;
      throw error;
    } finally {
      heartbeatActive = false;
      try {
        stopHeartbeat(heartbeatHandle);
      } catch (error) {
        if (!taskFailed) throw error;
      }
    }
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    let cleanupError: unknown;

    if (leaseWriteAttempted) {
      try {
        const current = parseLease(await readStorageValue(storage, COLLECTOR_LEASE_KEY));
        if (current?.owner === owner) {
          await writeStorageValue(storage, COLLECTOR_LEASE_KEY, {
            owner,
            expiresAt: clock() + releaseGraceMs,
          });
        }
      } catch (error) {
        cleanupError = error;
      }
    }

    if (candidateWriteAttempted) {
      try {
        await deleteStorageValue(storage, candidateStorageKey);
      } catch (error) {
        cleanupError ??= error;
      }
    }

    if (cleanupError !== undefined && !operationFailed) {
      throw cleanupError;
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
