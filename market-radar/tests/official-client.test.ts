import { describe, expect, it, vi } from 'vitest';
import {
  OFFICIAL_MARKETPLACE_URL,
  fetchOfficialSnapshot,
} from '../src/collector/official-client';

const NOW = 1_787_645_160_000;

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
    expect(requestInit).toEqual({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
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
  });

  it('preserves schema validation errors without exposing response data', async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse({ timestamp: 'bad', marketData: {} }));

    const error = await fetchOfficialSnapshot({ fetcher, now: () => NOW }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Invalid timestamp');
    expect((error as Error).message).not.toContain('marketData');
  });
});
