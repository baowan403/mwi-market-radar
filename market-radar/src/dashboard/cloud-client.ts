import { decodeDayChunkLimited, StorageDecodeError } from '../core/storage-codec';
import { parseManifest, type CloudManifest, type CloudSnapshotEntry } from '../cloud/manifest';
import { dailyHistorySnapshots, decodeDailyHistoryPack } from '../cloud/daily-history';
import type { Snapshot } from '../core/types';

export const CLOUD_REQUEST_TIMEOUT_MS = 15_000;
export const CLOUD_MAX_CONCURRENCY = 6;
export const CLOUD_STALE_AFTER_MS = 2.5 * 60 * 60 * 1_000;
export const CLOUD_MAX_MANIFEST_BYTES = 1_000_000;
export const CLOUD_MAX_SNAPSHOT_COUNT = 256;
export const CLOUD_MAX_SNAPSHOT_BYTES = 2_000_000;
export const CLOUD_MAX_TOTAL_SNAPSHOT_BYTES = 64_000_000;
export const CLOUD_MAX_DECODED_SNAPSHOT_BYTES = 16_000_000;
export const CLOUD_MAX_QUOTE_KEYS = 10_000;
export const CLOUD_MAX_DAILY_HISTORY_BYTES = 64_000_000;

export type CloudMarketErrorCode =
  | 'cloud_unavailable'
  | 'cloud_stale'
  | 'cloud_data_invalid'
  | 'cancelled';

const CLOUD_ERROR_MESSAGES: Record<CloudMarketErrorCode, string> = {
  cloud_unavailable: 'Cloud market data is unavailable',
  cloud_stale: 'Cloud market data is stale',
  cloud_data_invalid: 'Cloud market data is invalid',
  cancelled: 'Cloud market request cancelled',
};

export class CloudMarketError extends Error {
  readonly code: CloudMarketErrorCode;

  constructor(code: CloudMarketErrorCode) {
    super(CLOUD_ERROR_MESSAGES[code]);
    this.name = 'CloudMarketError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CloudSourceInfo {
  latestTimestamp: number | null;
  generatedAt: string | null;
  stale: boolean;
  warningCode: 'cloud_stale' | null;
  warning?: string | null;
}

export interface CloudMarketData {
  snapshots: Snapshot[];
  latestTimestamp: number | null;
  generatedAt: string | null;
  stale: boolean;
  warningCode: 'cloud_stale' | null;
  warning?: string | null;
}

export interface CloudRequestOptions {
  signal?: AbortSignal;
  force?: boolean;
}

export interface CloudTimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type CloudFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CloudClientOptions {
  fetcher?: CloudFetcher;
  timeoutMs?: number;
  now?: () => number;
  timers?: CloudTimerApi;
  setTimeout?: CloudTimerApi['setTimeout'];
  clearTimeout?: CloudTimerApi['clearTimeout'];
}

export interface CloudClient {
  load(options?: CloudRequestOptions): Promise<CloudMarketData>;
  refresh(options?: CloudRequestOptions): Promise<CloudMarketData>;
  listSnapshots(options?: CloudRequestOptions): Promise<Snapshot[]>;
  bootstrap?(options?: CloudRequestOptions): Promise<CloudMarketData>;
  loadSnapshots?(options?: CloudRequestOptions): Promise<Snapshot[]>;
  getSourceInfo(): CloudSourceInfo;
}

interface SnapshotCache {
  signature: string;
  manifest: CloudManifest;
  snapshots: Snapshot[];
}

interface CloudOperation {
  controller: AbortController;
  promise: Promise<CloudMarketData>;
  subscribers: number;
  settled: boolean;
}

function unavailable(): CloudMarketError {
  return new CloudMarketError('cloud_unavailable');
}

function invalidData(): CloudMarketError {
  return new CloudMarketError('cloud_data_invalid');
}

function cancelled(): CloudMarketError {
  return new CloudMarketError('cancelled');
}

function isAbortError(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && (value as { name?: unknown }).name === 'AbortError';
}

function timeoutValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : CLOUD_REQUEST_TIMEOUT_MS;
}

function timerApi(options: CloudClientOptions): CloudTimerApi {
  const defaults: CloudTimerApi = {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  return options.timers ?? {
    setTimeout: options.setTimeout ?? defaults.setTimeout,
    clearTimeout: options.clearTimeout ?? defaults.clearTimeout,
  };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeBaseDataUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value.toString());
  } catch {
    throw invalidData();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalidData();
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function resolveManifestUrl(base: URL): URL {
  return new URL('manifest.json', base);
}

function resolveDailyHistoryUrl(base: URL): URL {
  return new URL('daily-history.txt', base);
}

function resolveSnapshotUrl(base: URL, entry: CloudSnapshotEntry): URL {
  if (entry.file !== `snapshots/${entry.timestamp}.txt`) throw invalidData();
  const url = new URL(entry.file, base);
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (url.origin !== base.origin || !url.pathname.startsWith(basePath)) throw invalidData();
  return url;
}

function parseManifestText(text: string): CloudManifest {
  try {
    return parseManifest(JSON.parse(text) as unknown);
  } catch {
    throw invalidData();
  }
}

function snapshotSignature(manifest: CloudManifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    latestTimestamp: manifest.latestTimestamp,
    snapshots: manifest.snapshots.map(({ timestamp, file, bytes }) => ({ timestamp, file, bytes })),
  });
}

function sortedUniqueSnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (!byTimestamp.has(snapshot.timestamp)) byTimestamp.set(snapshot.timestamp, snapshot);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function createCloudClient(
  baseDataUrl: string | URL,
  options: CloudClientOptions = {},
): CloudClient {
  const base = normalizeBaseDataUrl(baseDataUrl);
  const fetcher: CloudFetcher | undefined = options.fetcher ?? globalThis.fetch;
  const timeoutMs = timeoutValue(options.timeoutMs);
  const timers = timerApi(options);
  const clock = options.now ?? (() => Date.now());
  let cache: SnapshotCache | null = null;
  let activeOperation: CloudOperation | null = null;
  let sourceInfo: CloudSourceInfo = {
    latestTimestamp: null,
    generatedAt: null,
    stale: false,
    warningCode: null,
    warning: null,
  };

  async function requestText(
    url: URL,
    signal: AbortSignal | undefined,
    purpose: 'manifest' | 'snapshot' | 'daily',
    maxBytes: number,
  ): Promise<string> {
    if (signal?.aborted) throw cancelled();
    if (typeof fetcher !== 'function') throw unavailable();

    const controller = new AbortController();
    let timedOut = false;
    let timer: unknown;
    let rejectExternal: ((error: CloudMarketError) => void) | null = null;
    const onAbort = (): void => {
      controller.abort();
      rejectExternal?.(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          callback();
        };
        const rejectWith = (error: CloudMarketError): void => finish(() => reject(error));
        const resolveWith = (text: string): void => finish(() => resolve(text));
        rejectExternal = rejectWith;
        const handleResponse = async (response: Response): Promise<void> => {
          if (settled) return;
          if (signal?.aborted) {
            rejectWith(cancelled());
            return;
          }
          if (!response.ok) {
            if (purpose === 'daily' && response.status === 404) resolveWith('');
            else rejectWith(purpose === 'manifest' ? unavailable() : invalidData());
            return;
          }
          const contentLength = response.headers?.get?.('content-length') ?? null;
          if (contentLength !== null) {
            const declaredBytes = Number(contentLength);
            if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
              rejectWith(invalidData());
              return;
            }
          }
          try {
            const text = await response.text();
            if (signal?.aborted) rejectWith(cancelled());
            else if (utf8ByteLength(text) > maxBytes) rejectWith(invalidData());
            else resolveWith(text);
          } catch {
            rejectWith(unavailable());
          }
        };
        let request: Promise<Response>;
        try {
          request = fetcher(url, {
            method: 'GET',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          });
        } catch {
          rejectWith(unavailable());
          return;
        }
        request.then((response) => {
          void handleResponse(response).catch(() => rejectWith(unavailable()));
        }, (cause: unknown) => {
          if (signal?.aborted) rejectWith(cancelled());
          else if (timedOut || isAbortError(cause)) rejectWith(unavailable());
          else rejectWith(unavailable());
        });
        timer = timers.setTimeout(() => {
          timedOut = true;
          controller.abort();
          rejectWith(unavailable());
        }, timeoutMs);
        if (signal?.aborted) {
          controller.abort();
          rejectWith(cancelled());
        }
      });
    } catch (cause) {
      if (cause instanceof CloudMarketError) throw cause;
      if (signal?.aborted) throw cancelled();
      if (timedOut || isAbortError(cause)) throw unavailable();
      throw purpose === 'manifest' ? unavailable() : unavailable();
    } finally {
      if (timer !== undefined) timers.clearTimeout(timer);
      rejectExternal = null;
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function sourceFor(manifest: CloudManifest): CloudSourceInfo {
    const latestTimestamp = manifest.latestTimestamp;
    const elapsed = latestTimestamp === null ? null : clock() - latestTimestamp;
    const stale = elapsed !== null && Number.isFinite(elapsed) && elapsed > CLOUD_STALE_AFTER_MS;
    return {
      latestTimestamp,
      generatedAt: manifest.generatedAt,
      stale,
      warningCode: stale ? 'cloud_stale' : null,
      warning: stale ? CLOUD_ERROR_MESSAGES.cloud_stale : null,
    };
  }

  interface DownloadedSnapshot {
    snapshot: Snapshot;
    bytes: number;
  }

  async function downloadEntry(
    entry: CloudSnapshotEntry,
    signal: AbortSignal | undefined,
  ): Promise<DownloadedSnapshot> {
    const text = await requestText(
      resolveSnapshotUrl(base, entry),
      signal,
      'snapshot',
      CLOUD_MAX_SNAPSHOT_BYTES,
    );
    let decoded: Snapshot[];
    try {
      decoded = await decodeDayChunkLimited(text, CLOUD_MAX_DECODED_SNAPSHOT_BYTES, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof StorageDecodeError && error.reason === 'cancelled')) {
        throw cancelled();
      }
      throw invalidData();
    }
    if (
      decoded.length !== 1
      || decoded[0]?.timestamp !== entry.timestamp
      || Object.keys(decoded[0]?.quotes ?? {}).length > CLOUD_MAX_QUOTE_KEYS
    ) throw invalidData();
    return { snapshot: decoded[0], bytes: utf8ByteLength(text) };
  }

  async function downloadEntries(
    entries: readonly CloudSnapshotEntry[],
    signal: AbortSignal | undefined,
  ): Promise<Snapshot[]> {
    if (entries.length > CLOUD_MAX_SNAPSHOT_COUNT) throw invalidData();
    let declaredTotalBytes = 0;
    for (const entry of entries) {
      if (entry.bytes > CLOUD_MAX_SNAPSHOT_BYTES) throw invalidData();
      declaredTotalBytes += entry.bytes;
      if (!Number.isSafeInteger(declaredTotalBytes) || declaredTotalBytes > CLOUD_MAX_TOTAL_SNAPSHOT_BYTES) {
        throw invalidData();
      }
    }
    const actualTotal = { bytes: 0 };
    const results: Snapshot[] = new Array(entries.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= entries.length) return;
        const entry = entries[index];
        if (entry === undefined) throw invalidData();
        const downloaded = await downloadEntry(entry, signal);
        actualTotal.bytes += downloaded.bytes;
        if (actualTotal.bytes > CLOUD_MAX_TOTAL_SNAPSHOT_BYTES) throw invalidData();
        results[index] = downloaded.snapshot;
      }
    };
    const workers = Math.min(CLOUD_MAX_CONCURRENCY, entries.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return sortedUniqueSnapshots(results);
  }

  function cachedData(): CloudMarketData {
    if (cache === null) throw unavailable();
    sourceInfo = sourceFor(cache.manifest);
    return {
      snapshots: [...cache.snapshots],
      latestTimestamp: cache.manifest.latestTimestamp,
      generatedAt: cache.manifest.generatedAt,
      stale: sourceInfo.stale,
      warningCode: sourceInfo.warningCode,
      warning: sourceInfo.warning,
    };
  }

  function detachSubscriber(operation: CloudOperation): void {
    if (operation.subscribers === 0) return;
    operation.subscribers -= 1;
    if (operation.subscribers === 0) {
      operation.controller.abort();
      if (activeOperation === operation) activeOperation = null;
    }
  }

  function attachSubscriber(
    operation: CloudOperation,
    signal: AbortSignal | undefined,
  ): Promise<CloudMarketData> {
    if (signal?.aborted) return Promise.reject(cancelled());
    operation.subscribers += 1;
    let detached = false;
    const detach = (): void => {
      if (detached) return;
      detached = true;
      detachSubscriber(operation);
    };

    return new Promise<CloudMarketData>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        detach();
        reject(cancelled());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      operation.promise.then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        detach();
        resolve(value);
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        detach();
        reject(error);
      });
      if (signal?.aborted) onAbort();
    });
  }

  function loadShared(force: boolean): Promise<CloudMarketData> {
    if (activeOperation !== null) return activeOperation.promise;
    if (!force && cache !== null) return Promise.resolve(cachedData());
    const controller = new AbortController();
    const operation = {} as CloudOperation;
    operation.controller = controller;
    operation.subscribers = 0;
    operation.settled = false;
    const pending = (async (): Promise<CloudMarketData> => {
      const manifestText = await requestText(
        resolveManifestUrl(base),
        controller.signal,
        'manifest',
        CLOUD_MAX_MANIFEST_BYTES,
      );
      const manifest = parseManifestText(manifestText);
      if (manifest.snapshots.length > CLOUD_MAX_SNAPSHOT_COUNT) throw invalidData();
      const signature = snapshotSignature(manifest);
      let snapshots: Snapshot[];
      if (cache?.signature === signature) {
        snapshots = cache.snapshots;
      } else {
        const hourly = await downloadEntries(manifest.snapshots, controller.signal);
        const dailyText = await requestText(
          resolveDailyHistoryUrl(base), controller.signal, 'daily', CLOUD_MAX_DAILY_HISTORY_BYTES,
        );
        let daily: Snapshot[] = [];
        if (dailyText.trim().length > 0) {
          try {
            const pack = await decodeDailyHistoryPack(dailyText);
            daily = dailyHistorySnapshots(pack, hourly[0]?.timestamp ?? Number.MAX_SAFE_INTEGER);
          } catch {
            throw invalidData();
          }
        }
        snapshots = sortedUniqueSnapshots([...daily, ...hourly]);
      }
      if (controller.signal.aborted) throw cancelled();
      cache = { signature, manifest, snapshots };
      sourceInfo = sourceFor(manifest);
      return {
        snapshots: [...snapshots],
        latestTimestamp: manifest.latestTimestamp,
        generatedAt: manifest.generatedAt,
        stale: sourceInfo.stale,
        warningCode: sourceInfo.warningCode,
        warning: sourceInfo.warning,
      };
    })();
    operation.promise = pending.then((value) => {
      operation.settled = true;
      return value;
    }, (error: unknown) => {
      operation.settled = true;
      throw error;
    });
    activeOperation = operation;
    void operation.promise.then(() => {
      if (activeOperation === operation) activeOperation = null;
    }, () => {
      if (activeOperation === operation) activeOperation = null;
    });
    return operation.promise;
  }

  async function load(optionsForRequest: CloudRequestOptions = {}): Promise<CloudMarketData> {
    if (optionsForRequest.signal?.aborted) throw cancelled();
    const force = optionsForRequest.force === true;
    if (!force && activeOperation === null && cache !== null) return cachedData();
    const operationPromise = loadShared(force);
    const operation = activeOperation;
    if (operation === null) return operationPromise;
    return attachSubscriber(operation, optionsForRequest.signal);
  }

  return {
    load,
    refresh: (requestOptions = {}) => load({ ...requestOptions, force: true }),
    listSnapshots: async (requestOptions = {}) => (await load(requestOptions)).snapshots,
    bootstrap: load,
    loadSnapshots: async (requestOptions = {}) => (await load(requestOptions)).snapshots,
    getSourceInfo: () => ({ ...sourceInfo }),
  };
}

export const createCloudMarketClient = createCloudClient;
