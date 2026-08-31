import type {
  BridgeBootstrap,
  BridgeRequest,
  BridgeResponse,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../core/types';

export const BRIDGE_REQUEST_EVENT = 'mwi-radar:request';
export const BRIDGE_RESPONSE_EVENT = 'mwi-radar:response';

// Short aliases keep the event names convenient for callers without changing
// the wire protocol.
export const REQUEST_EVENT = BRIDGE_REQUEST_EVENT;
export const RESPONSE_EVENT = BRIDGE_RESPONSE_EVENT;

export interface DashboardClientOptions {
  timeoutMs?: number;
  idFactory?: () => string;
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
  | { type: 'snapshots' }
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
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.ok !== 'boolean') {
    return false;
  }

  if (value.ok) return hasOwn(value, 'value');
  if (!isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return 2_000;
  return Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 2_000;
}

export function createDashboardClient(
  target: EventTarget,
  options: DashboardClientOptions = {},
): DashboardClient {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const idFactory = options.idFactory ?? defaultIdFactory;
  const usedIds = new Set<string>();
  let fallbackSequence = 0;

  function nextId(): string {
    let candidate = idFactory();
    if (typeof candidate !== 'string' || candidate.length === 0) {
      candidate = defaultIdFactory();
    }

    const original = candidate;
    let suffix = 1;
    while (usedIds.has(candidate)) {
      candidate = `${original}-${suffix}`;
      suffix += 1;
    }
    if (usedIds.has(candidate)) {
      candidate = `${original}-${Date.now()}-${fallbackSequence}`;
      fallbackSequence += 1;
    }
    usedIds.add(candidate);
    return candidate;
  }

  function request<T>(payload: BridgeRequestPayload): Promise<T> {
    const requestId = nextId();
    const detail = { id: requestId, ...payload } as BridgeRequest;

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
      let settled = false;

      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        target.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
        if (timer !== undefined) globalThis.clearTimeout(timer);
      };

      const onResponse = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return;
        const response = event.detail;
        if (!isBridgeResponse(response) || response.id !== requestId) return;

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
        target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail }));
      } catch {
        cleanup();
        reject(new BridgeError('dispatch', 'Bridge request could not be dispatched'));
      }
    });
  }

  return {
    bootstrap: () => request<BridgeBootstrap>({ type: 'bootstrap' }),
    listSnapshots: () => request<Snapshot[]>({ type: 'snapshots' }),
    setWatchlist: async (value) => {
      await request<unknown>({ type: 'set-watchlist', value });
    },
    setSettings: async (value) => {
      await request<unknown>({ type: 'set-settings', value });
    },
  };
}
