import { describe, expect, it, vi } from 'vitest';
import { HISTORY_MAX_BODY_BYTES, LATEST_STATUS_MAX_BODY_BYTES, createStockmarketClient } from '../src/backfill/stockmarket-client';

const point = (itemName: string) => ({
  item_name: itemName, level: 1, timestamp: 1, price_a: 1, price_b: 2, price_p: 3, volume: 4,
});
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, body: null }) as unknown as Response;
const list = (...names: string[]) => ({ data: names.map((item_name) => ({ item_name })) });

function streamingResponse(chunks: Uint8Array[], status = 200): Response & { cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  let index = 0;
  const body = {
    getReader: () => ({
      read: async () => index < chunks.length ? { done: false, value: chunks[index++]! } : { done: true, value: undefined },
      cancel,
      releaseLock: () => undefined,
    }),
  } as unknown as ReadableStream<Uint8Array>;
  return { ok: status >= 200 && status < 300, status, body, json: async () => { throw new Error('stream should be used'); }, cancel } as unknown as Response & { cancel: ReturnType<typeof vi.fn> };
}

describe('stockmarket client', () => {
  it('uses the fixed origin, exact paths, headers, and timeout signals', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => String(input).endsWith('latest-status') ? response(list('iron_ore')) : response({ item: 'iron_ore', history: [point('iron_ore')] }));
    const client = createStockmarketClient({ fetcher });
    try {
      await client.loadAll();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        'https://www.stockmarket.xin/api/latest-status',
        'https://www.stockmarket.xin/api/item/iron_ore/history?limit=200',
      ]);
      for (const call of fetcher.mock.calls) {
        const init = call[1] as RequestInit;
        expect(init.headers).toEqual({ 'User-Agent': 'mwi-market-radar-authorized-backfill/1' });
        expect(init.method).toBe('GET');
        expect(init.redirect).toBe('error');
        expect(init.credentials).toBe('omit');
        expect(init.cache).toBe('no-store');
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }
      expect(timeout).toHaveBeenCalledTimes(2);
      expect(timeout.mock.calls.every(([milliseconds]) => milliseconds === 10_000)).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  it('rejects redirected responses without retrying or using a different origin', async () => {
    let calls = 0;
    const redirected = {
      ok: true, status: 200, body: null, json: async () => list('ore'), redirected: true, url: 'https://elsewhere.invalid/api/latest-status',
    } as unknown as Response;
    const fetcher = vi.fn(async () => { calls++; return redirected; });
    await expect(createStockmarketClient({ fetcher, sleep: async () => undefined }).loadAll()).rejects.toThrow('Stockmarket redirect rejected');
    expect(calls).toBe(1);
  });

  it('parses split UTF-8 stream bodies and falls back safely when bodies are unavailable', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...list('ore'), label: 'é' }));
    const split = bytes.indexOf(0xC3) + 1;
    const streamed = streamingResponse([bytes.slice(0, split), bytes.slice(split)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('latest-status')) return streamed;
      return response({ item: 'ore', history: [point('ore')] });
    });
    await expect(createStockmarketClient({ fetcher, sleep: async () => undefined }).loadAll()).resolves.toBeInstanceOf(Map);
    expect(streamed.cancel).not.toHaveBeenCalled();
  });

  it('cancels oversize streams before buffering or retrying them', async () => {
    const oversize = streamingResponse([new Uint8Array(LATEST_STATUS_MAX_BODY_BYTES + 1)]);
    const fetcher = vi.fn(async () => oversize);
    await expect(createStockmarketClient({ fetcher, sleep: async () => undefined }).loadAll()).rejects.toThrow('Stockmarket response body too large');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(oversize.cancel).toHaveBeenCalledTimes(1);
    expect(HISTORY_MAX_BODY_BYTES).toBe(8 * 1024 * 1024);
  });

  it('applies the smaller body cap and cancellation to each item history response', async () => {
    const oversize = streamingResponse([new Uint8Array(HISTORY_MAX_BODY_BYTES + 1)]);
    const fetcher = vi.fn(async (input: string | URL) => String(input).endsWith('latest-status')
      ? response(list('ore'))
      : oversize);
    await expect(createStockmarketClient({ fetcher, sleep: async () => undefined }).loadAll()).rejects.toThrow('Stockmarket response body too large');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(oversize.cancel).toHaveBeenCalledTimes(1);
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

  it('stops workers from starting more item requests after the first failure', async () => {
    const started: string[] = [];
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('latest-status')) return response(list('alpha', 'beta', 'gamma', 'delta'));
      started.push(url);
      if (url.includes('/alpha/')) return response({}, 404);
      if (url.includes('/beta/')) await new Promise((resolve) => setTimeout(resolve, 10));
      return response({ item: 'unexpected', history: [] });
    });
    await expect(createStockmarketClient({ fetcher, concurrency: 2, sleep: async () => undefined }).loadAll()).rejects.toThrow('404');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toHaveLength(2);
    expect(started[0]).toContain('/alpha/');
  });

  it('rejects when injected item pacing sleep fails', async () => {
    const pacingFailure = new Error('pacing failed');
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      if (String(input).endsWith('latest-status')) return response(list('ore'));
      return response({ item: 'ore', history: [point('ore')] });
    });
    const sleep = async (milliseconds: number): Promise<void> => {
      if (milliseconds === 100) throw pacingFailure;
    };
    await expect(createStockmarketClient({ fetcher, sleep }).loadAll()).rejects.toBe(pacingFailure);
  });

  it('rejects non-finite or non-positive concurrency and clamps larger values', async () => {
    for (const concurrency of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createStockmarketClient({ concurrency })).toThrow();
    }
    expect(() => createStockmarketClient({ concurrency: 99 })).not.toThrow();
    expect(() => createStockmarketClient({ concurrency: 2.9 })).not.toThrow();
  });
});
