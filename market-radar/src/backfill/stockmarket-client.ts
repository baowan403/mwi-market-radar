import { parseStockmarketHistory, parseStockmarketItemNames, type StockmarketHistoryPoint } from './stockmarket-schema';

const ORIGIN = 'https://www.stockmarket.xin';
const USER_AGENT = 'mwi-market-radar-authorized-backfill/1';
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_DELAYS = [500, 1000, 1500];
export const LATEST_STATUS_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const HISTORY_MAX_BODY_BYTES = 8 * 1024 * 1024;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Sleeper = (milliseconds: number) => Promise<void>;

export interface StockmarketClientOptions {
  fetcher?: Fetcher;
  sleep?: Sleeper;
  concurrency?: number;
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) return 4;
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid stockmarket concurrency');
  return Math.min(4, Math.max(1, Math.floor(value)));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  if (response.body === null) return response.json();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new Error('Stockmarket response body too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

async function requestJson(
  fetcher: Fetcher,
  sleep: Sleeper,
  url: string,
  maxBodyBytes: number,
  cancellation?: AbortSignal,
): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (cancellation?.aborted) throw cancellation.reason ?? new DOMException('Request cancelled', 'AbortError');
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'User-Agent': USER_AGENT },
        signal: cancellation ? AbortSignal.any([timeout, cancellation]) : timeout,
      });
      if (response.redirected) throw new Error('Stockmarket redirect rejected');
      if (!response.ok) {
        if (!RETRY_STATUSES.has(response.status) || attempt === 3) {
          throw new Error(`Stockmarket request failed with HTTP ${response.status}`);
        }
        await sleep(RETRY_DELAYS[attempt] ?? 1500);
        continue;
      }
      return await readResponseJson(response, maxBodyBytes);
    } catch (error) {
      if (cancellation?.aborted) throw error;
      if (!isAbortError(error) || attempt === 3) throw error;
      await sleep(RETRY_DELAYS[attempt] ?? 1500);
    }
  }
  throw new Error('Unreachable stockmarket retry state');
}

export function createStockmarketClient(options: StockmarketClientOptions = {}): {
  loadAll: () => Promise<Map<string, StockmarketHistoryPoint[]>>;
} {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('Fetch is unavailable');
  const sleep = options.sleep ?? defaultSleep;
  const concurrency = normalizeConcurrency(options.concurrency);

  return {
    async loadAll() {
      const status = await requestJson(fetcher, sleep, `${ORIGIN}/api/latest-status`, LATEST_STATUS_MAX_BODY_BYTES);
      const names = parseStockmarketItemNames(status);
      const result = new Map<string, StockmarketHistoryPoint[]>();
      const cancellation = new AbortController();
      let firstFailure: unknown;
      let hasFailure = false;
      let stopped = false;
      let nextIndex = 0;

      function recordFailure(error: unknown): void {
        if (hasFailure) return;
        hasFailure = true;
        firstFailure = error;
        stopped = true;
        cancellation.abort(error);
      }

      async function worker(): Promise<void> {
        while (true) {
          if (stopped) return;
          const index = nextIndex++;
          if (index >= names.length) return;
          const name = names[index]!;
          const url = `${ORIGIN}/api/item/${encodeURIComponent(name)}/history?limit=200`;
          try {
            const payload = await requestJson(fetcher, sleep, url, HISTORY_MAX_BODY_BYTES, cancellation.signal);
            result.set(name, parseStockmarketHistory(payload, name));
          } catch (error) {
            recordFailure(error);
            throw error;
          } finally {
            try {
              await sleep(100);
            } catch (error) {
              recordFailure(error);
              throw error;
            }
          }
        }
      }

      await Promise.allSettled(Array.from({ length: Math.min(concurrency, names.length) }, () => worker()));
      if (hasFailure) throw firstFailure;
      return new Map(names.map((name) => [name, result.get(name)!]));
    },
  };
}
