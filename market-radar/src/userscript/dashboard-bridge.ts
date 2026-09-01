import type {
  BridgeBootstrap,
  BridgeRequest,
  BridgeResponse,
  BridgeSnapshotPage,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../core/types';
import {
  BRIDGE_REQUEST_PREFIX,
  BRIDGE_RESPONSE_PREFIX,
  type BridgeMessageTarget,
} from '../dashboard/client';
import { isAllowedDashboardUrl } from './origins';

export const MAX_BRIDGE_REQUEST_ID_LENGTH = 128;
export const SNAPSHOT_CACHE_TTL_MS = 5_000;

export const BRIDGE_ERROR_MESSAGES = {
  invalid_request: 'Invalid bridge request',
  unsupported_request: 'Unsupported bridge request',
  storage_error: 'Market data storage unavailable',
  internal_error: 'Bridge request failed',
} as const;

export interface DashboardBridgeStore {
  listSnapshots(): Promise<Snapshot[]>;
  getWatchlist(): Promise<WatchItem[]>;
  setWatchlist(value: WatchItem[]): Promise<void>;
  getSettings(): Promise<RadarSettings>;
  setSettings(value: RadarSettings): Promise<void>;
  getCollectorStatus(): Promise<CollectorStatus>;
}

export interface DashboardBridgeOptions {
  target: BridgeMessageTarget;
  currentUrl: string | URL;
  allowedBaseUrls: readonly string[];
  store: DashboardBridgeStore;
}

export type DashboardBridgeCleanup = () => void;

const STORAGE_FAILURE = Symbol('dashboard bridge storage failure');
const BRIDGE_REQUEST_TYPES = new Set<BridgeRequest['type']>([
  'bootstrap',
  'snapshots',
  'set-watchlist',
  'set-settings',
]);
const WATCHLIST_ITEM_KEY_PATTERN = /^.+::(?:0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_BRIDGE_REQUEST_ID_LENGTH;
}

function responseId(value: unknown): string | null {
  return isRecord(value) && isValidRequestId(value.id) ? value.id : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidWatchlist(value: unknown): value is WatchItem[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !WATCHLIST_ITEM_KEY_PATTERN.test(entry.key)) {
      return false;
    }
    const order = entry.order;
    if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0 || keys.has(entry.key)) {
      return false;
    }
    keys.add(entry.key);
  }
  return true;
}

function isValidSettings(value: unknown): value is RadarSettings {
  if (!isRecord(value)) return false;
  if (value.period !== '1d' && value.period !== '3d' && value.period !== '7d') return false;
  return isFiniteNonnegative(value.minimumVolume)
    && (value.maximumSpreadPct === null || isFiniteNonnegative(value.maximumSpreadPct))
    && isFiniteNonnegative(value.anomalyMovePct)
    && isFiniteNonnegative(value.anomalyVolumeMultiple);
}

type ParsedRequest =
  | { kind: 'valid'; request: BridgeRequest }
  | { kind: 'invalid'; id: string | null }
  | { kind: 'unsupported'; id: string };

function parseRequest(value: unknown): ParsedRequest {
  const id = responseId(value);
  if (!isRecord(value) || !isValidRequestId(value.id) || typeof value.type !== 'string') {
    return { kind: 'invalid', id };
  }

  if (!BRIDGE_REQUEST_TYPES.has(value.type as BridgeRequest['type'])) {
    return { kind: 'unsupported', id: value.id };
  }

  if (value.type === 'bootstrap') {
    if (!hasOnlyKeys(value, ['id', 'type'])) return { kind: 'invalid', id };
    return { kind: 'valid', request: { id: value.id, type: 'bootstrap' } };
  }

  if (value.type === 'snapshots') {
    if (!hasOnlyKeys(value, ['id', 'type', 'beforeTimestamp', 'limit'])) {
      return { kind: 'invalid', id };
    }
    const beforeTimestamp = value.beforeTimestamp;
    if (!(beforeTimestamp === null || (typeof beforeTimestamp === 'number' && Number.isFinite(beforeTimestamp)))) {
      return { kind: 'invalid', id };
    }
    const limit = value.limit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 24) {
      return { kind: 'invalid', id };
    }
    return {
      kind: 'valid',
      request: { id: value.id, type: 'snapshots', beforeTimestamp, limit },
    };
  }

  if (!hasOwn(value, 'value') || !hasOnlyKeys(value, ['id', 'type', 'value'])) {
    return { kind: 'invalid', id };
  }

  if (value.type === 'set-watchlist') {
    if (!isValidWatchlist(value.value)) return { kind: 'invalid', id };
    return { kind: 'valid', request: { id: value.id, type: value.type, value: value.value } };
  }

  if (!isValidSettings(value.value)) return { kind: 'invalid', id };
  return { kind: 'valid', request: { id: value.id, type: 'set-settings', value: value.value } };
}

function successResponse<T>(id: string, value: T): BridgeResponse<T> {
  return { id, ok: true, value };
}

function errorResponse(
  id: string,
  code: keyof typeof BRIDGE_ERROR_MESSAGES,
): BridgeResponse {
  return { id, ok: false, error: { code, message: BRIDGE_ERROR_MESSAGES[code] } };
}

async function readStorage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw STORAGE_FAILURE;
  }
}

function sortUniqueSnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (!byTimestamp.has(snapshot.timestamp)) byTimestamp.set(snapshot.timestamp, snapshot);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

interface SnapshotCache {
  get(): Promise<Snapshot[]>;
  clear(): void;
}

function createSnapshotCache(store: DashboardBridgeStore): SnapshotCache {
  let cached: { snapshots: Snapshot[]; expiresAt: number } | null = null;
  let inFlight: Promise<Snapshot[]> | null = null;
  let generation = 0;

  return {
    async get(): Promise<Snapshot[]> {
      const now = Date.now();
      if (cached !== null && cached.expiresAt > now) return cached.snapshots;
      if (inFlight !== null) return inFlight;

      const readGeneration = generation;
      const read = readStorage(() => store.listSnapshots()).then((snapshots) => {
        const normalized = sortUniqueSnapshots(snapshots);
        if (readGeneration === generation) {
          cached = { snapshots: normalized, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS };
        }
        return normalized;
      });
      inFlight = read;
      try {
        return await read;
      } finally {
        if (inFlight === read) inFlight = null;
      }
    },

    clear(): void {
      generation += 1;
      cached = null;
      inFlight = null;
    },
  };
}

function pageSnapshots(
  snapshots: readonly Snapshot[],
  beforeTimestamp: number | null,
  limit: number,
): BridgeSnapshotPage {
  const newestFirst = [...snapshots].reverse();
  const start = beforeTimestamp === null
    ? 0
    : newestFirst.findIndex((snapshot) => snapshot.timestamp < beforeTimestamp);
  const pageStart = start < 0 ? newestFirst.length : start;
  const items = newestFirst.slice(pageStart, pageStart + limit);
  const hasMore = pageStart + items.length < newestFirst.length;
  return {
    items,
    nextBeforeTimestamp: hasMore ? items.at(-1)?.timestamp ?? null : null,
    hasMore,
  };
}

async function handleRequest(
  request: BridgeRequest,
  store: DashboardBridgeStore,
  snapshotCache: SnapshotCache,
): Promise<BridgeResponse> {
  try {
    switch (request.type) {
      case 'bootstrap': {
        const [snapshots, watchlist, settings, collectorStatus] = await Promise.all([
          snapshotCache.get(),
          readStorage(() => store.getWatchlist()),
          readStorage(() => store.getSettings()),
          readStorage(() => store.getCollectorStatus()),
        ]);
        const value: BridgeBootstrap = {
          watchlist,
          settings,
          collectorStatus,
          latestTimestamp: snapshots.at(-1)?.timestamp ?? null,
          snapshotCount: snapshots.length,
        };
        return successResponse(request.id, value);
      }
      case 'snapshots':
        return successResponse(
          request.id,
          pageSnapshots(await snapshotCache.get(), request.beforeTimestamp, request.limit),
        );
      case 'set-watchlist':
        await readStorage(() => store.setWatchlist(request.value));
        return successResponse(request.id, { acknowledged: true });
      case 'set-settings':
        await readStorage(() => store.setSettings(request.value));
        return successResponse(request.id, { acknowledged: true });
    }
  } catch (cause) {
    if (cause === STORAGE_FAILURE) return errorResponse(request.id, 'storage_error');
    return errorResponse(request.id, 'internal_error');
  }
}

function parseWireRequest(data: unknown): ParsedRequest | null {
  if (typeof data !== 'string' || !data.startsWith(BRIDGE_REQUEST_PREFIX)) return null;
  try {
    return parseRequest(JSON.parse(data.slice(BRIDGE_REQUEST_PREFIX.length)));
  } catch {
    return null;
  }
}

function serializeResponse(response: BridgeResponse): string {
  return JSON.stringify(response);
}

function originOf(value: string | URL): string | null {
  try {
    return (typeof value === 'string' ? new URL(value) : value).origin;
  } catch {
    return null;
  }
}

export function installDashboardBridge(options: DashboardBridgeOptions): DashboardBridgeCleanup {
  const noop = (): void => undefined;
  if (!isAllowedDashboardUrl(options.currentUrl, options.allowedBaseUrls)) return noop;
  const targetOrigin = originOf(options.currentUrl);
  if (targetOrigin === null) return noop;

  let disposed = false;
  const snapshotCache = createSnapshotCache(options.store);
  const onRequest = (event: Event): void => {
    if (disposed || event.type !== 'message') return;
    const message = event as MessageEvent<unknown>;
    if (message.origin !== targetOrigin) return;
    const parsed = parseWireRequest(message.data);
    if (parsed === null) return;
    const id = parsed.kind === 'valid' ? parsed.request.id : parsed.id;
    if (id === null) return;

    const responsePromise = parsed.kind === 'valid'
      ? handleRequest(parsed.request, options.store, snapshotCache)
      : Promise.resolve(parsed.kind === 'unsupported'
        ? errorResponse(id, 'unsupported_request')
        : errorResponse(id, 'invalid_request'));

    void responsePromise.then((response) => {
      if (disposed) return;
      try {
        options.target.postMessage(
          `${BRIDGE_RESPONSE_PREFIX}${serializeResponse(response)}`,
          targetOrigin,
        );
      } catch {
        // The target may be disposed by the host while an async store read is pending.
      }
    });
  };

  options.target.addEventListener('message', onRequest);
  return (): void => {
    if (disposed) return;
    disposed = true;
    snapshotCache.clear();
    options.target.removeEventListener('message', onRequest);
  };
}
