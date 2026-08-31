import { MarketSchemaError, parseOfficialSnapshot } from '../core/market-schema';
import type { Snapshot } from '../core/types';

export const OFFICIAL_MARKETPLACE_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';
export const DEFAULT_OFFICIAL_REQUEST_TIMEOUT_MS = 15_000;
export const OFFICIAL_REQUEST_TIMEOUT_MESSAGE = 'Official marketplace request timed out';
export const OFFICIAL_REQUEST_CANCELLED_MESSAGE = 'Official marketplace request cancelled';

export type OfficialMarketErrorCode = 'network' | 'timeout' | 'cancelled' | 'schema';

export class OfficialMarketError extends Error {
  readonly code: OfficialMarketErrorCode;
  readonly status?: number;

  constructor(code: OfficialMarketErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'OfficialMarketError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface OfficialSnapshotTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type OfficialFetcher =
  (input: string, init?: RequestInit) => Response | Promise<Response>;

export interface OfficialSnapshotClientOptions {
  fetcher?: OfficialFetcher;
  now?: () => number;
  timeoutMs?: number;
  timer?: OfficialSnapshotTimer;
  createAbortController?: () => AbortController;
  signal?: AbortSignal;
}

function isFetcher(value: OfficialFetcher | OfficialSnapshotClientOptions): value is OfficialFetcher {
  return typeof value === 'function';
}

function defaultTimer(): OfficialSnapshotTimer {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'AbortError';
}

function timeoutError(): Error {
  return new OfficialMarketError('timeout', OFFICIAL_REQUEST_TIMEOUT_MESSAGE);
}

function cancellationError(): Error {
  return new OfficialMarketError('cancelled', OFFICIAL_REQUEST_CANCELLED_MESSAGE);
}

function networkError(status?: number): OfficialMarketError {
  const message = status === undefined
    ? 'Official marketplace request failed'
    : `Official marketplace request failed: ${status}`;
  return new OfficialMarketError('network', message, status);
}

function schemaError(message = 'Official marketplace response schema invalid'): OfficialMarketError {
  return new OfficialMarketError('schema', message);
}

/** Fetch and validate one public marketplace snapshot without sending credentials. */
export async function fetchOfficialSnapshot(
  optionsOrFetcher: OfficialSnapshotClientOptions | OfficialFetcher = {},
  now?: () => number,
): Promise<Snapshot> {
  const fetcher = isFetcher(optionsOrFetcher)
    ? optionsOrFetcher
    : optionsOrFetcher.fetcher ?? globalThis.fetch;
  const clock = now ?? (isFetcher(optionsOrFetcher) ? undefined : optionsOrFetcher.now) ?? (() => Date.now());
  const options = isFetcher(optionsOrFetcher) ? {} : optionsOrFetcher;
  const externalSignal = options.signal;
  if (externalSignal?.aborted) {
    throw cancellationError();
  }

  const timer = options.timer ?? defaultTimer();
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OFFICIAL_REQUEST_TIMEOUT_MS);
  const controller = (options.createAbortController ?? (() => new AbortController()))();
  const url = `${OFFICIAL_MARKETPLACE_URL}?radar=${clock()}`;
  const requestInit: RequestInit = {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: controller.signal,
  };

  let timerHandle: unknown;
  let timerActive = false;
  let cleanedUp = false;
  let cancelled = false;
  let externalAbortListener: (() => void) | undefined;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (timerActive) {
      timerActive = false;
      timer.clearTimeout(timerHandle);
    }
    if (externalSignal !== undefined && externalAbortListener !== undefined) {
      externalSignal.removeEventListener('abort', externalAbortListener);
      externalAbortListener = undefined;
    }
  };

  let rejectCancellation: ((reason?: unknown) => void) | undefined;
  const cancellationPromise = externalSignal === undefined
    ? undefined
    : new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
      externalAbortListener = (): void => {
        cancelled = true;
        controller.abort();
        cleanup();
        rejectCancellation?.(cancellationError());
      };
      externalSignal.addEventListener('abort', externalAbortListener);
    });

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerHandle = timer.setTimeout(() => {
      controller.abort();
      cleanup();
      reject(timeoutError());
    }, timeoutMs);
    timerActive = true;
  });

  const responsePromise = (async (): Promise<Snapshot> => {
    try {
      const response = await fetcher(url, requestInit);

      if (!response.ok) {
        throw networkError(response.status);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (cause) {
        if (isAbortError(cause)) throw cause;
        throw schemaError('Official marketplace response JSON parse failed');
      }

      return parseOfficialSnapshot(raw);
    } catch (cause) {
      if (cancelled || externalSignal?.aborted) throw cancellationError();
      if (isAbortError(cause)) throw timeoutError();
      if (cause instanceof OfficialMarketError) throw cause;
      if (cause instanceof MarketSchemaError) throw schemaError(cause.message);
      if (cause instanceof SyntaxError) throw schemaError('Official marketplace response JSON parse failed');
      throw networkError();
    }
  })();

  try {
    const promises: Array<Promise<Snapshot> | Promise<never>> = [responsePromise, timeoutPromise];
    if (cancellationPromise !== undefined) promises.push(cancellationPromise);
    return await Promise.race(promises);
  } finally {
    cleanup();
  }
}
