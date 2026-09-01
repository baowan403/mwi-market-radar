import { describe, expect, it, vi } from 'vitest';
import { createStockmarketClient } from '../src/backfill/stockmarket-client';

const point = (itemName: string) => ({
  item_name: itemName, level: 1, timestamp: 1, price_a: 1, price_b: 2, price_p: 3, volume: 4,
});
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const list = (...names: string[]) => ({ data: names.map((item_name) => ({ item_name })) });

describe('stockmarket client', () => {
  it('uses the fixed origin, exact paths, headers, and timeout signals', async () => {
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => String(input).endsWith('latest-status') ? response(list('iron_ore')) : response({ item: 'iron_ore', history: [point('iron_ore')] }));
    const client = createStockmarketClient({ fetcher });
    await client.loadAll();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://www.stockmarket.xin/api/latest-status',
      'https://www.stockmarket.xin/api/item/iron_ore/history?limit=200',
    ]);
    for (const call of fetcher.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers).toEqual({ 'User-Agent': 'mwi-market-radar-authorized-backfill/1' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('returns a sorted Map and limits item concurrency to four', async () => {
    let active = 0;
    let maximum = 0;
    const names = ['zinc', 'alpha', 'copper', 'tin', 'lead', 'gold', 'silver'];
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list(...names));
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      const itemPart = url.split('/item/')[1]!;
      const item = decodeURIComponent(itemPart.split('/history')[0]!);
      return response({ item, history: [point(item)] });
    });
    const client = createStockmarketClient({ fetcher, concurrency: 4, sleep: async () => undefined });
    const result = await client.loadAll();
    expect(maximum).toBeLessThanOrEqual(4);
    expect([...result.keys()]).toEqual([...names].sort());
  });

  it('retries 503 with exact increasing delays', async () => {
    let attempts = 0; const backoffs: number[] = []; const pacing: number[] = [];
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list('ore'));
      attempts++; return attempts < 4 ? response({}, 503) : response({ item: 'ore', history: [point('ore')] });
    });
    await createStockmarketClient({ fetcher, sleep: async (ms) => { (ms === 100 ? pacing : backoffs).push(ms); } }).loadAll();
    expect(attempts).toBe(4); expect(backoffs).toEqual([500, 1000, 1500]); expect(pacing).toEqual([100]);
  });

  it('retries TimeoutError from AbortSignal.timeout', async () => {
    let attempts = 0; const delays: number[] = [];
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      if (String(input).endsWith('latest-status')) return response(list('ore'));
      attempts++;
      if (attempts === 1) throw new DOMException('The operation timed out', 'TimeoutError');
      return response({ item: 'ore', history: [] });
    });
    await createStockmarketClient({ fetcher, sleep: async (ms) => { delays.push(ms); } }).loadAll();
    expect(attempts).toBe(2);
    expect(delays).toEqual([500, 100]);
  });

  it('retries AbortError, but only attempts a 404 once', async () => {
    let abortAttempts = 0;
    const abortFetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list('ore'));
      abortAttempts++; if (abortAttempts < 2) throw Object.assign(new Error('timed out'), { name: 'AbortError' });
      return response({ item: 'ore', history: [] });
    });
    await createStockmarketClient({ fetcher: abortFetcher, sleep: async () => undefined }).loadAll();
    expect(abortAttempts).toBe(2);
    let notFoundAttempts = 0;
    const notFound = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list('ore'));
      notFoundAttempts++; return response({}, 404);
    });
    await expect(createStockmarketClient({ fetcher: notFound, sleep: async () => undefined }).loadAll()).rejects.toThrow('404');
    expect(notFoundAttempts).toBe(1);
  });

  it('rejects after four permanent 503 attempts and does not retry schema failures', async () => {
    let attempts = 0;
    const failing = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list('ore'));
      attempts++; return response({}, 503);
    });
    await expect(createStockmarketClient({ fetcher: failing, sleep: async () => undefined }).loadAll()).rejects.toThrow('503');
    expect(attempts).toBe(4);
    let schemaAttempts = 0;
    const malformed = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list('ore'));
      schemaAttempts++; return response({ item: 'ore', history: [{ nope: true }] });
    });
    await expect(createStockmarketClient({ fetcher: malformed, sleep: async () => undefined }).loadAll()).rejects.toThrow();
    expect(schemaAttempts).toBe(1);
  });

  it('rejects non-finite or non-positive concurrency and clamps larger values', async () => {
    for (const concurrency of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createStockmarketClient({ concurrency })).toThrow();
    }
    expect(() => createStockmarketClient({ concurrency: 99 })).not.toThrow();
    expect(() => createStockmarketClient({ concurrency: 2.9 })).not.toThrow();
  });
});
