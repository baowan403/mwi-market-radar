import type {
  BridgeBootstrap,
  BridgeRequest,
  BridgeResponse,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../core/types';
import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
} from '../dashboard/client';
import { isAllowedDashboardUrl } from './origins';

export const MAX_BRIDGE_REQUEST_ID_LENGTH = 128;

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
  target: EventTarget;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_BRIDGE_REQUEST_ID_LENGTH;
}

function responseId(value: unknown): string {
  return isPlainObject(value) && isValidRequestId(value.id) ? value.id : 'invalid-request';
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

type ParsedRequest =
  | { kind: 'valid'; request: BridgeRequest }
  | { kind: 'invalid'; id: string }
  | { kind: 'unsupported'; id: string };

function parseRequest(value: unknown): ParsedRequest {
  const id = responseId(value);
  if (!isPlainObject(value) || !isValidRequestId(value.id) || typeof value.type !== 'string') {
    return { kind: 'invalid', id };
  }

  if (!BRIDGE_REQUEST_TYPES.has(value.type as BridgeRequest['type'])) {
    return { kind: 'unsupported', id };
  }

  if (value.type === 'bootstrap' || value.type === 'snapshots') {
    if (!hasOnlyKeys(value, ['id', 'type'])) return { kind: 'invalid', id };
    return { kind: 'valid', request: { id: value.id, type: value.type } };
  }

  if (!hasOwn(value, 'value') || !hasOnlyKeys(value, ['id', 'type', 'value'])) {
    return { kind: 'invalid', id };
  }

  if (value.type === 'set-watchlist') {
    return { kind: 'valid', request: { id: value.id, type: value.type, value: value.value as WatchItem[] } };
  }

  return { kind: 'valid', request: { id: value.id, type: 'set-settings', value: value.value as RadarSettings } };
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

async function handleRequest(
  request: BridgeRequest,
  store: DashboardBridgeStore,
): Promise<BridgeResponse> {
  try {
    switch (request.type) {
      case 'bootstrap': {
        const [snapshots, watchlist, settings, collectorStatus] = await Promise.all([
          readStorage(() => store.listSnapshots()),
          readStorage(() => store.getWatchlist()),
          readStorage(() => store.getSettings()),
          readStorage(() => store.getCollectorStatus()),
        ]);
        const latestTimestamp = snapshots.reduce<number | null>(
          (latest, snapshot) => latest === null || snapshot.timestamp > latest ? snapshot.timestamp : latest,
          null,
        );
        const value: BridgeBootstrap = {
          watchlist,
          settings,
          collectorStatus,
          latestTimestamp,
          snapshotCount: snapshots.length,
        };
        return successResponse(request.id, value);
      }
      case 'snapshots':
        return successResponse(request.id, await readStorage(() => store.listSnapshots()));
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

export function installDashboardBridge(options: DashboardBridgeOptions): DashboardBridgeCleanup {
  const noop = (): void => undefined;
  if (!isAllowedDashboardUrl(options.currentUrl, options.allowedBaseUrls)) return noop;

  let disposed = false;
  const onRequest = (event: Event): void => {
    if (disposed || !(event instanceof CustomEvent)) return;

    let parsed: ParsedRequest;
    try {
      parsed = parseRequest(event.detail);
    } catch {
      parsed = { kind: 'invalid', id: responseId(event.detail) };
    }

    const responsePromise = parsed.kind === 'valid'
      ? handleRequest(parsed.request, options.store)
      : Promise.resolve(parsed.kind === 'unsupported'
        ? errorResponse(parsed.id, 'unsupported_request')
        : errorResponse(parsed.id, 'invalid_request'));

    void responsePromise.then((response) => {
      if (disposed) return;
      try {
        options.target.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: response }));
      } catch {
        // The target may be disposed by the host while an async store read is pending.
      }
    });
  };

  options.target.addEventListener(BRIDGE_REQUEST_EVENT, onRequest);
  return (): void => {
    if (disposed) return;
    disposed = true;
    options.target.removeEventListener(BRIDGE_REQUEST_EVENT, onRequest);
  };
}
