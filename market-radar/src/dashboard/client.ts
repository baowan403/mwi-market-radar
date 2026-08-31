import type {
  BridgeBootstrap,
  BridgeRequest,
  BridgeResponse,
  BridgeSnapshotPage,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../core/types';

export const BRIDGE_REQUEST_EVENT = 'mwi-radar:request';
export const BRIDGE_RESPONSE_EVENT = 'mwi-radar:response';

// Keep the wire names available under concise aliases for callers that prefer
// to import event constants without the bridge prefix.
export const REQUEST_EVENT = BRIDGE_REQUEST_EVENT;
export const RESPONSE_EVENT = BRIDGE_RESPONSE_EVENT;

export const DEFAULT_SNAPSHOT_PAGE_SIZE = 12;
export const MAX_SNAPSHOT_PAGES = 256;

export interface DashboardClientOptions {
  timeoutMs?: number;
  idFactory?: () => string;
  snapshotPageSize?: number;
  maxSnapshotPages?: number;
}

export interface DashboardClient {
  bootstrap(): Promise<BridgeBootstrap>;
  listSnapshots(): Promise<Snapshot[]>;
  setWatchlist(value: WatchItem[]): Promise<void>;
  setSettings(value: RadarSettings): Promise<void>;
}

export class BridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type BridgeRequestPayload =
  | { type: 'bootstrap' }
  | { type: 'snapshots'; beforeTimestamp: number | null; limit: number }
  | { type: 'set-watchlist'; value: WatchItem[] }
  | { type: 'set-settings'; value: RadarSettings };

function defaultIdFactory(): string {
  const cryptoApi = (globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  }).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.ok !== 'boolean') {
    return false;
  }

  if (value.ok) return hasOwn(value, 'value');
  if (!isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

function parseWireResponse(detail: unknown): BridgeResponse | null {
  if (typeof detail !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(detail);
    return isBridgeResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSnapshot(value: unknown): value is Snapshot {
  return isRecord(value)
    && typeof value.timestamp === 'number'
    && Number.isFinite(value.timestamp)
    && isRecord(value.quotes);
}

function isSnapshotPage(value: unknown): value is BridgeSnapshotPage {
  return isRecord(value)
    && Array.isArray(value.items)
    && value.items.every(isSnapshot)
    && (value.nextBeforeTimestamp === null
      || (typeof value.nextBeforeTimestamp === 'number' && Number.isFinite(value.nextBeforeTimestamp)))
    && typeof value.hasMore === 'boolean';
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return 2_000;
  return Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 2_000;
}

function normalizedPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_SNAPSHOT_PAGE_SIZE;
  return Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 24
    ? pageSize
    : DEFAULT_SNAPSHOT_PAGE_SIZE;
}

function normalizedMaxPages(maxPages: number | undefined): number {
  if (maxPages === undefined) return MAX_SNAPSHOT_PAGES;
  return Number.isSafeInteger(maxPages) && maxPages >= 1 ? maxPages : MAX_SNAPSHOT_PAGES;
}

function invalidRequestError(): BridgeError {
  return new BridgeError('invalid_request', 'Invalid bridge request');
}

export function createDashboardClient(
  target: EventTarget,
  options: DashboardClientOptions = {},
): DashboardClient {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const pageSize = normalizedPageSize(options.snapshotPageSize);
  const maxPages = normalizedMaxPages(options.maxSnapshotPages);
  const idFactory = options.idFactory ?? defaultIdFactory;
  const activeIds = new Set<string>();
  let fallbackSequence = 0;

  function nextId(): string {
    let candidate = idFactory();
    if (typeof candidate !== 'string' || candidate.length === 0) {
      candidate = defaultIdFactory();
    }

    const original = candidate;
    let suffix = 1;
    while (activeIds.has(candidate)) {
      candidate = `${original}-${suffix}`;
      suffix += 1;
    }
    if (candidate === original && activeIds.has(candidate)) {
      candidate = `${original}-${Date.now()}-${fallbackSequence}`;
      fallbackSequence += 1;
    }
    activeIds.add(candidate);
    return candidate;
  }

  function request<T>(
    payload: BridgeRequestPayload,
    valueGuard?: (value: unknown) => value is T,
  ): Promise<T> {
    const requestId = nextId();
    const detail = { id: requestId, ...payload } as BridgeRequest;
    let wireDetail: string;
    try {
      wireDetail = JSON.stringify(detail);
    } catch {
      activeIds.delete(requestId);
      return Promise.reject(invalidRequestError());
    }

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
      let settled = false;

      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        activeIds.delete(requestId);
        target.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
        if (timer !== undefined) globalThis.clearTimeout(timer);
      };

      const onResponse = (event: Event): void => {
        if (event.type !== BRIDGE_RESPONSE_EVENT) return;
        const response = parseWireResponse((event as CustomEvent<unknown>).detail);
        if (response === null || response.id !== requestId) return;
        if (response.ok && valueGuard !== undefined && !valueGuard(response.value)) return;

        cleanup();
        if (response.ok) {
          resolve(response.value as T);
        } else {
          reject(new BridgeError(response.error.code, response.error.message));
        }
      };

      target.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      timer = globalThis.setTimeout(() => {
        cleanup();
        reject(new BridgeError('timeout', 'Bridge request timed out'));
      }, timeoutMs);

      try {
        target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: wireDetail }));
      } catch {
        cleanup();
        reject(new BridgeError('dispatch', 'Bridge request could not be dispatched'));
      }
    });
  }

  async function listSnapshots(): Promise<Snapshot[]> {
    const byTimestamp = new Map<number, Snapshot>();
    let beforeTimestamp: number | null = null;

    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const page: BridgeSnapshotPage = await request<BridgeSnapshotPage>(
        { type: 'snapshots', beforeTimestamp, limit: pageSize },
        isSnapshotPage,
      );

      for (const snapshot of page.items) {
        if (!byTimestamp.has(snapshot.timestamp)) byTimestamp.set(snapshot.timestamp, snapshot);
      }

      if (!page.hasMore) {
        if (page.nextBeforeTimestamp !== null) {
          throw new BridgeError('pagination', 'Snapshot page returned an invalid cursor');
        }
        return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
      }

      const next: number | null = page.nextBeforeTimestamp;
      if (
        next === null
        || !Number.isFinite(next)
        || (beforeTimestamp !== null && next >= beforeTimestamp)
      ) {
        throw new BridgeError('pagination', 'Snapshot pagination cursor did not decrease');
      }
      beforeTimestamp = next;
    }

    throw new BridgeError('pagination', 'Snapshot pagination exceeded safety limit');
  }

  async function setWatchlist(value: WatchItem[]): Promise<void> {
    if (!Array.isArray(value)) throw invalidRequestError();
    await request<unknown>({ type: 'set-watchlist', value });
  }

  async function setSettings(value: RadarSettings): Promise<void> {
    if (!isRecord(value)) throw invalidRequestError();
    await request<unknown>({ type: 'set-settings', value });
  }

  return {
    bootstrap: () => request<BridgeBootstrap>({ type: 'bootstrap' }),
    listSnapshots,
    setWatchlist,
    setSettings,
  };
}
