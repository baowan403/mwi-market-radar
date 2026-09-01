import { parseStockmarketHistory, parseStockmarketItemNames, type StockmarketHistoryPoint } from './stockmarket-schema';

const ORIGIN = 'https://www.stockmarket.xin';
const USER_AGENT = 'mwi-market-radar-authorized-backfill/1';
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_DELAYS = [500, 1000, 1500];

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
  return error instanceof Error && error.name === 'AbortError';
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(fetcher: Fetcher, sleep: Sleeper, url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (!RETRY_STATUSES.has(response.status) || attempt === 3) {
          throw new Error(`Stockmarket request failed with HTTP ${response.status}`);
        }
        await sleep(RETRY_DELAYS[attempt] ?? 1500);
        continue;
      }
      return await response.json();
    } catch (error) {
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
      const status = await requestJson(fetcher, sleep, `${ORIGIN}/api/latest-status`);
      const names = parseStockmarketItemNames(status);
      const result = new Map<string, StockmarketHistoryPoint[]>();
      let nextIndex = 0;

      async function worker(): Promise<void> {
        while (true) {
          const index = nextIndex++;
          if (index >= names.length) return;
          const name = names[index]!;
          const url = `${ORIGIN}/api/item/${encodeURIComponent(name)}/history?limit=200`;
          try {
            const payload = await requestJson(fetcher, sleep, url);
            result.set(name, parseStockmarketHistory(payload, name));
          } finally {
            await sleep(100);
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, () => worker()));
      return new Map(names.map((name) => [name, result.get(name)!]));
    },
  };
}
