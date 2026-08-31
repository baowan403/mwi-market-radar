import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfficialMarketError,
  OFFICIAL_REQUEST_CANCELLED_MESSAGE,
  OFFICIAL_MARKETPLACE_URL,
  fetchOfficialSnapshot,
} from '../src/collector/official-client';

const NOW = 1_787_645_160_000;

async function flushAsyncWork(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('fetchOfficialSnapshot', () => {
  it('uses only the official endpoint with a cache-buster and safe GET options', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      okResponse({
        timestamp: 1_787_645_160,
        marketData: { '/items/test': { '0': { p: 100 } } },
      }),
    );

    await fetchOfficialSnapshot({ fetcher, now: () => NOW });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetcher.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(requestUrl);
    expect(`${parsedUrl.origin}${parsedUrl.pathname}`).toBe(OFFICIAL_MARKETPLACE_URL);
    expect([...parsedUrl.searchParams.keys()]).toEqual(['radar']);
    expect(parsedUrl.searchParams.get('radar')).toBe(String(NOW));
    expect(requestInit).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes the decoded JSON through parseOfficialSnapshot', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      okResponse({
        timestamp: 1_787_645_160,
        marketData: { '/items/cowbell': { '7': { p: 99.5, a: 100, b: 99, v: 42 } } },
      }),
    );

    await expect(fetchOfficialSnapshot(fetcher, () => NOW)).resolves.toEqual({
      timestamp: NOW,
      quotes: {
        '/items/cowbell::7': { p: 99.5, a: 100, b: 99, v: 42 },
      },
    });
  });

  it('rejects non-ok responses using only the status without reading the body', async () => {
    const json = vi.fn().mockRejectedValue(new Error('private response body'));
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503, json } as unknown as Response);

    const error = await fetchOfficialSnapshot({ fetcher, now: () => NOW }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Official marketplace request failed: 503');
    expect((error as Error).message).not.toContain('private response body');
    expect(json).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(OfficialMarketError);
    expect(error).toMatchObject({ code: 'network', status: 503 });
  });

  it('turns JSON decoding failures into a body-free error', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error('sensitive raw body')),
    } as unknown as Response);

    const error = await fetchOfficialSnapshot({ fetcher, now: () => NOW }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Official marketplace response JSON parse failed');
    expect((error as Error).message).not.toContain('sensitive raw body');
    expect(error).toMatchObject({ code: 'schema' });
  });

  it('preserves schema validation errors without exposing response data', async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse({ timestamp: 'bad', marketData: {} }));

    const error = await fetchOfficialSnapshot({ fetcher, now: () => NOW }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Invalid timestamp');
    expect((error as Error).message).not.toContain('marketData');
    expect(error).toMatchObject({ code: 'schema' });
  });

  describe('request timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('aborts an unresolved fetch at the configured timeout and rejects safely', async () => {
      const controller = new AbortController();
      const createAbortController = vi.fn(() => controller);
      const fetcher = vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('sensitive body and URL'), { name: 'AbortError' }));
          });
        });
      });
      const request = fetchOfficialSnapshot({
        fetcher,
        now: () => NOW,
        timeoutMs: 1_000,
        createAbortController,
      });
      const rejected = expect(request).rejects.toThrow('Official marketplace request timed out');

      await vi.advanceTimersByTimeAsync(999);
      expect(controller.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(controller.signal.aborted).toBe(true);
      const error = await request.catch((cause: unknown) => cause) as OfficialMarketError;
      expect(error).toMatchObject({ code: 'timeout' });
      expect(error.message).not.toContain('sensitive');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects on timeout even when the fetcher ignores the abort signal', async () => {
      const controller = new AbortController();
      const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
      const request = fetchOfficialSnapshot({
        fetcher,
        now: () => NOW,
        timeoutMs: 1_000,
        createAbortController: () => controller,
      });
      const rejected = expect(request).rejects.toThrow('Official marketplace request timed out');

      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
      expect(controller.signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the fifteen second default timeout and clears the timer after HTTP completion', async () => {
      const timer = {
        setTimeout: vi.fn((callback: () => void, delayMs: number) => setTimeout(callback, delayMs)),
        clearTimeout: vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      };
      const fetcher = vi.fn().mockResolvedValue(
        okResponse({
          timestamp: 1_787_645_160,
          marketData: { '/items/test': { '0': { p: 100 } } },
        }),
      );

      await fetchOfficialSnapshot({ fetcher, now: () => NOW, timer });

      expect(timer.setTimeout).toHaveBeenCalledWith(expect.any(Function), 15_000);
      expect(timer.clearTimeout).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('maps an AbortError from the external fetcher to the safe timeout error', async () => {
      const timer = {
        setTimeout: vi.fn((callback: () => void, delayMs: number) => setTimeout(callback, delayMs)),
        clearTimeout: vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      };
      const fetcher = vi.fn().mockRejectedValue(
        Object.assign(new Error('private body'), { name: 'AbortError' }),
      );

      await expect(fetchOfficialSnapshot({ fetcher, now: () => NOW, timer })).rejects.toThrow(
        'Official marketplace request timed out',
      );
      expect(timer.clearTimeout).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not fetch when the external signal is already aborted', async () => {
      const externalController = new AbortController();
      externalController.abort();
      const fetcher = vi.fn();
      const timer = {
        setTimeout: vi.fn(),
        clearTimeout: vi.fn(),
      };

      const cancelled = await fetchOfficialSnapshot({
        fetcher,
        signal: externalController.signal,
        timer,
      }).catch((cause: unknown) => cause) as OfficialMarketError;

      expect(fetcher).not.toHaveBeenCalled();
      expect(timer.setTimeout).not.toHaveBeenCalled();
      expect(cancelled).toMatchObject({ code: 'cancelled', message: OFFICIAL_REQUEST_CANCELLED_MESSAGE });
    });

    it('aborts the internal fetch and cleans timer/listener on external cancellation', async () => {
      const externalController = new AbortController();
      const internalController = new AbortController();
      const createAbortController = vi.fn(() => internalController);
      const removeEventListener = vi.spyOn(externalController.signal, 'removeEventListener');
      const timer = {
        setTimeout: vi.fn((callback: () => void, delayMs: number) => setTimeout(callback, delayMs)),
        clearTimeout: vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      };
      const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(() => {
        expect(init?.signal).toBe(internalController.signal);
      }));
      const request = fetchOfficialSnapshot({
        fetcher,
        signal: externalController.signal,
        now: () => NOW,
        timeoutMs: 15_000,
        timer,
        createAbortController,
      });
      const rejected = expect(request).rejects.toThrow(OFFICIAL_REQUEST_CANCELLED_MESSAGE);
      await flushAsyncWork();

      externalController.abort();
      await rejected;

      expect(internalController.signal.aborted).toBe(true);
      expect(timer.clearTimeout).toHaveBeenCalledTimes(1);
      expect(removeEventListener).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('removes the external abort listener after a successful request', async () => {
      const externalController = new AbortController();
      const removeEventListener = vi.spyOn(externalController.signal, 'removeEventListener');
      const fetcher = vi.fn().mockResolvedValue(
        okResponse({
          timestamp: 1_787_645_160,
          marketData: { '/items/test': { '0': { p: 100 } } },
        }),
      );

      await fetchOfficialSnapshot({
        fetcher,
        signal: externalController.signal,
        now: () => NOW,
      });

      expect(removeEventListener).toHaveBeenCalledTimes(1);
    });
  });
});
