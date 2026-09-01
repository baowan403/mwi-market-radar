import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudManifest, CloudSnapshotEntry } from '../src/cloud/types';
import { createManifest } from '../src/cloud/manifest';
import { createHistoryProvenance, HISTORY_PROVENANCE_FILE } from '../src/cloud/provenance';
import { encodeDayChunk } from '../src/core/storage-codec';
import { aggregateDailySummary } from '../src/cloud/daily-summary';
import { createDailyHistoryPack, encodeDailyHistoryPack } from '../src/cloud/daily-history';
import type { Snapshot } from '../src/core/types';
import {
  CloudMarketError,
  createCloudClient,
  type CloudClientOptions,
} from '../src/dashboard/cloud-client';

const HOUR = 3_600_000;
const LATEST = Date.parse('2026-09-01T12:08:00.000Z');
const GENERATED_AT = '2026-09-01T12:09:00.000Z';
const KEY = '/items/test::0';

function snapshot(timestamp: number, price = 100): Snapshot {
  return {
    timestamp,
    quotes: {
      [KEY]: { a: price + 1, b: price - 1, p: price, v: 10 },
    },
  };
}

async function manifestAndFiles(
  snapshots: Snapshot[],
): Promise<{ manifest: CloudManifest; files: Map<string, string> }> {
  const entries: CloudSnapshotEntry[] = [];
  const files = new Map<string, string>();
  for (const current of snapshots) {
    const text = await encodeDayChunk([current]);
    const file = `snapshots/${current.timestamp}.txt` as `snapshots/${number}.txt`;
    entries.push({ timestamp: current.timestamp, file, bytes: Buffer.byteLength(text) });
    files.set(file, text);
  }
  return { manifest: createManifest(entries, GENERATED_AT), files };
}

function response(value: unknown, status = 200): Response {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cloud client', () => {
  it('loads strict same-origin historical provenance alongside the manifest', async () => {
    const current = snapshot(LATEST);
    const data = await manifestAndFiles([current]);
    const calls: string[] = [];
    const provenance = createHistoryProvenance({
      fetchedAt: GENERATED_AT,
      fromTimestamp: LATEST,
      toTimestamp: LATEST,
      snapshotCount: 1,
      overlapComparisons: 0,
    });
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response(provenance);
      if (url.endsWith('/daily-history.txt')) return response('', 404);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).resolves.toMatchObject({ historySourceLabel: '牛牛股市' });
    expect(client.getSourceInfo()).toMatchObject({ historySourceLabel: '牛牛股市' });
    expect(calls.filter((url) => url.endsWith(`/${HISTORY_PROVENANCE_FILE}`))).toEqual([
      'https://example.test/cloud/history-provenance.json',
    ]);
  });

  it('treats a missing history provenance file as absent without changing cloud labels', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      if (url.endsWith('/daily-history.txt')) return response('', 404);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).resolves.toMatchObject({ historySourceLabel: null });
    expect(client.getSourceInfo()).toMatchObject({ historySourceLabel: null });
  });

  it.each([
    ['http failure', () => response('server unavailable', 500), 'cloud_data_invalid'],
    ['network failure', () => Promise.reject(new Error('network unavailable')), 'cloud_unavailable'],
  ])('maps a %s while reading optional provenance to the existing safe error policy', async (
    _kind,
    provenanceResponse,
    code,
  ) => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return provenanceResponse();
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).rejects.toMatchObject({ code });
  });

  it.each([
    ['malformed', '{bad json'],
    ['empty', ''],
    ['oversized', 'x'.repeat(64 * 1024 + 1)],
  ])('fails closed for %s history provenance without requesting snapshots', async (_kind, provenanceText) => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response(provenanceText);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/snapshots/'))).toBe(false);
  });

  it('cancels an oversized streaming provenance response before buffering the full body', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const encoder = new TextEncoder();
    let chunksServed = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksServed += 1;
        if (chunksServed <= 10) controller.enqueue(encoder.encode('x'.repeat(32 * 1024)));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamingResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
      async text(): Promise<string> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let value = '';
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) return value + decoder.decode();
            value += decoder.decode(chunk.value, { stream: true });
          }
        } finally {
          reader.releaseLock();
        }
      },
    } as unknown as Response;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return streamingResponse;
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
    expect(cancelled).toBe(true);
    expect(chunksServed).toBeLessThan(11);
  });

  it('treats a body-null provenance response as invalid data', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return new Response(null);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
  });

  it('keeps valid cached rows when a later history provenance read is invalid', async () => {
    const current = snapshot(LATEST);
    const data = await manifestAndFiles([current]);
    let valid = true;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response(valid
        ? createHistoryProvenance({
          fetchedAt: GENERATED_AT,
          fromTimestamp: LATEST,
          toTimestamp: LATEST,
          snapshotCount: 1,
          overlapComparisons: 0,
        })
        : 'not provenance');
      if (url.endsWith('/daily-history.txt')) return response('', 404);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.load()).resolves.toMatchObject({ snapshots: [current], historySourceLabel: '牛牛股市' });
    valid = false;
    await expect(client.refresh()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
    await expect(client.load()).resolves.toMatchObject({ snapshots: [current], historySourceLabel: '牛牛股市' });
  });

  it('merges older daily closes with the ten-day hourly window without overlapping dates', async () => {
    const hourly = [snapshot(LATEST - HOUR), snapshot(LATEST)];
    const data = await manifestAndFiles(hourly);
    const oldDaily = aggregateDailySummary([snapshot(LATEST - 11 * 24 * HOUR, 70)]);
    const overlappingDaily = aggregateDailySummary([snapshot(LATEST - HOUR, 90)]);
    const daily = await encodeDailyHistoryPack(createDailyHistoryPack(
      [oldDaily, overlappingDaily], GENERATED_AT,
    ));
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      if (url.endsWith('/daily-history.txt')) return response(daily);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    const values = await client.listSnapshots();
    expect(values.map((value) => value.timestamp)).toEqual([
      oldDaily.timestamp,
      LATEST - HOUR,
      LATEST,
    ]);
    expect(values[0]?.quotes[KEY]?.p).toBe(70);
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith('/daily-history.txt'))).toBe(true);
  });

  it('fetches the manifest and snapshot text with safe GET options under the base URL', async () => {
    const data = await manifestAndFiles([snapshot(LATEST - HOUR), snapshot(LATEST)]);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      const file = url.slice('https://example.test/cloud/'.length);
      return response(data.files.get(file) ?? '', 200);
    });
    const client = createCloudClient(new URL('https://example.test/cloud/'), { fetcher });

    await expect(client.listSnapshots()).resolves.toEqual([snapshot(LATEST - HOUR), snapshot(LATEST)]);
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(call.init?.headers).toBeUndefined();
    }
    expect(calls.map((call) => call.url)).toContain('https://example.test/cloud/manifest.json');
    expect(calls.map((call) => call.url)).toContain(`https://example.test/cloud/snapshots/${LATEST}.txt`);
  });

  it('rejects timeout with a safe unavailable error and aborts the request', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    vi.useFakeTimers();
    const options: CloudClientOptions = {
      fetcher,
      timeoutMs: 15,
    };
    const client = createCloudClient('https://example.test/cloud/', options);
    const pending = client.listSnapshots().catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(15);
    const error = await pending;

    expect(error).toBeInstanceOf(CloudMarketError);
    expect((error as CloudMarketError).code).toBe('cloud_unavailable');
    expect((error as Error).message).not.toContain('example.test');
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('maps an external abort to cancelled and does not leak the manifest/file URL', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const client = createCloudClient('https://private.example/cloud/', { fetcher });
    const pending = client.listSnapshots({ signal: controller.signal }).catch((cause: unknown) => cause);
    controller.abort();
    const error = await pending;

    expect(error).toBeInstanceOf(CloudMarketError);
    expect((error as CloudMarketError).code).toBe('cancelled');
    expect((error as Error).message).not.toContain('private.example');
  });

  it('limits snapshot downloads to six concurrent requests', async () => {
    const snapshots = Array.from({ length: 12 }, (_, index) => snapshot(LATEST - (11 - index) * HOUR, index + 1));
    const data = await manifestAndFiles(snapshots);
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      const url = String(input);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) {
        active -= 1;
        return response('', 404);
      }
      const value = url.endsWith('/manifest.json')
        ? JSON.stringify(data.manifest)
        : data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '';
      active -= 1;
      return response(value);
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.listSnapshots()).resolves.toHaveLength(snapshots.length);
    expect(maximum).toBeLessThanOrEqual(6);
  });

  it.each([
    'missing',
    'corrupt',
    'wrong-timestamp',
    'wrong-path',
  ])('rejects %s snapshot data with cloud_data_invalid', async (kind) => {
    const current = snapshot(LATEST);
    const data = await manifestAndFiles([current]);
    const entry = data.manifest.snapshots[0]!;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      if (url.endsWith('/manifest.json')) {
        if (kind === 'wrong-path') {
          return response({ ...data.manifest, snapshots: [{ ...entry, file: 'snapshots/../secret.txt' }] });
        }
        return response(data.manifest);
      }
      if (kind === 'missing') return response('', 404);
      if (kind === 'corrupt') return response('mwi-radar:gzip-json:v1:not-valid');
      if (kind === 'wrong-timestamp') return response(await encodeDayChunk([snapshot(LATEST - HOUR)]));
      return response(data.files.get(entry.file) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const error = await client.listSnapshots().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudMarketError);
    expect((error as CloudMarketError).code).toBe('cloud_data_invalid');
    expect((error as Error).message).not.toContain('secret');
  });

  it('uses manifest latest/signature caching and force refresh without redownloading unchanged files', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await client.listSnapshots();
    await client.listSnapshots();
    await client.refresh({ force: true });

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/manifest.json'))).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith(`/${HISTORY_PROVENANCE_FILE}`))).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/snapshots/'))).toHaveLength(1);
  });

  it('reuses snapshots when only generatedAt changes while returning the new manifest metadata', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    let generatedAt = GENERATED_AT;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response({ ...data.manifest, generatedAt });
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await client.listSnapshots();
    generatedAt = '2026-09-01T12:10:00.000Z';
    const refreshed = await client.refresh();

    expect(refreshed.generatedAt).toBe(generatedAt);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/manifest.json'))).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/snapshots/'))).toHaveLength(1);
  });

  it('redownloads snapshots when an entry identity changes', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    let manifest = data.manifest;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await client.listSnapshots();
    const entry = manifest.snapshots[0]!;
    manifest = {
      ...manifest,
      snapshots: [{ ...entry, bytes: entry.bytes + 1 }],
    };
    await client.refresh();

    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/snapshots/'))).toHaveLength(2);
  });

  it('downloads only a newly appended hourly snapshot when the manifest advances', async () => {
    const first = snapshot(LATEST - HOUR, 90);
    const second = snapshot(LATEST, 100);
    const firstData = await manifestAndFiles([first]);
    const secondData = await manifestAndFiles([first, second]);
    let manifest = firstData.manifest;
    const files = new Map([...firstData.files, ...secondData.files]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      if (url.endsWith('/daily-history.txt')) return response('');
      return response(files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.listSnapshots()).resolves.toEqual([first]);
    manifest = secondData.manifest;
    await expect(client.refresh()).resolves.toMatchObject({ snapshots: [first, second] });

    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/snapshots/'))).toHaveLength(2);
  });

  it('reuses the immutable completed-day pack throughout the same UTC date', async () => {
    const first = snapshot(LATEST - HOUR, 90);
    const second = snapshot(LATEST, 100);
    const firstData = await manifestAndFiles([first]);
    const secondData = await manifestAndFiles([first, second]);
    const oldDaily = aggregateDailySummary([snapshot(LATEST - 11 * 24 * HOUR, 70)]);
    const daily = await encodeDailyHistoryPack(createDailyHistoryPack([oldDaily], GENERATED_AT));
    let manifest = firstData.manifest;
    const files = new Map([...firstData.files, ...secondData.files]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response(manifest);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      if (url.endsWith('/daily-history.txt')) return response(daily);
      return response(files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await client.listSnapshots();
    manifest = secondData.manifest;
    await client.refresh();

    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/daily-history.txt'))).toHaveLength(1);
  });

  it('shares concurrent force refreshes so one fetch commits one result', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('/manifest.json')) await gate;
      const url = String(input);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      return url.endsWith('/manifest.json')
        ? response(data.manifest)
        : response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    const first = client.refresh();
    const second = client.refresh({ force: true });
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/manifest.json'))).toHaveLength(1);
  });

  it('isolates one caller abort from a shared refresh used by another caller', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('/manifest.json')) await gate;
      const url = String(input);
      if (url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)) return response('', 404);
      return url.endsWith('/manifest.json')
        ? response(data.manifest)
        : response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const aborted = client.refresh({ signal: controller.signal }).catch((cause: unknown) => cause);
    const survivor = client.refresh();
    controller.abort();
    release();

    const [abortedResult, survivorResult] = await Promise.all([aborted, survivor]);
    expect(abortedResult).toMatchObject({ code: 'cancelled' });
    expect(survivorResult.snapshots).toEqual([snapshot(LATEST)]);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/manifest.json'))).toHaveLength(1);
  });

  it('aborts the internal fetch when the last cloud subscriber leaves', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const controller = new AbortController();
    const pending = client.refresh({ signal: controller.signal }).catch((cause: unknown) => cause);

    controller.abort();
    const error = await pending;

    expect(error).toMatchObject({ code: 'cancelled' });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('rejects a manifest over one megabyte before downloading snapshots', async () => {
    const data = await manifestAndFiles([]);
    const oversized = `${JSON.stringify(data.manifest)}${' '.repeat(1_000_001)}`;
    const fetcher = vi.fn(async (input: string | URL) => (
      String(input).endsWith(`/${HISTORY_PROVENANCE_FILE}`) ? response('', 404) : response(oversized)
    ));
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const error = await client.listSnapshots().catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'cloud_data_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a manifest declaring more than 256 snapshots before downloads', async () => {
    const entries: CloudSnapshotEntry[] = Array.from({ length: 257 }, (_, index) => ({
      timestamp: LATEST - (257 - index) * 60_000,
      file: `snapshots/${LATEST - (257 - index) * 60_000}.txt` as `snapshots/${number}.txt`,
      bytes: 1,
    }));
    const manifest = createManifest(entries, GENERATED_AT);
    const fetcher = vi.fn(async (input: string | URL) => (
      String(input).endsWith(`/${HISTORY_PROVENANCE_FILE}`) ? response('', 404) : response(manifest)
    ));
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const error = await client.listSnapshots().catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'cloud_data_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized snapshot text and declared total bytes before unbounded downloads', async () => {
    const current = snapshot(LATEST);
    const data = await manifestAndFiles([current]);
    const oversizedFetcher = vi.fn(async (input: string | URL) => (
      String(input).endsWith('/manifest.json')
        ? response(data.manifest)
        : String(input).endsWith(`/${HISTORY_PROVENANCE_FILE}`)
          ? response('', 404)
        : response('x'.repeat(2_000_001))
    ));
    const oversizedClient = createCloudClient('https://example.test/cloud/', { fetcher: oversizedFetcher });
    await expect(oversizedClient.listSnapshots()).rejects.toMatchObject({ code: 'cloud_data_invalid' });

    const manyEntries: CloudSnapshotEntry[] = Array.from({ length: 33 }, (_, index) => ({
      timestamp: LATEST - (33 - index) * 60_000,
      file: `snapshots/${LATEST - (33 - index) * 60_000}.txt` as `snapshots/${number}.txt`,
      bytes: 2_000_000,
    }));
    const manyManifest = createManifest(manyEntries, GENERATED_AT);
    const totalFetcher = vi.fn(async (input: string | URL) => (
      String(input).endsWith(`/${HISTORY_PROVENANCE_FILE}`) ? response('', 404) : response(manyManifest)
    ));
    const totalClient = createCloudClient('https://example.test/cloud/', { fetcher: totalFetcher });
    await expect(totalClient.listSnapshots()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
    expect(totalFetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a decoded snapshot with more than ten thousand quote keys', async () => {
    const quotes: Snapshot['quotes'] = {};
    for (let index = 0; index <= 10_000; index += 1) {
      quotes[`/items/key-${index}::0`] = { a: 1, b: 1, p: 1, v: 1 };
    }
    const current: Snapshot = { timestamp: LATEST, quotes };
    const data = await manifestAndFiles([current]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      return url.endsWith('/manifest.json')
        ? response(data.manifest)
        : url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)
          ? response('', 404)
        : response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await expect(client.listSnapshots()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
  });

  it('returns valid snapshots with a stale warning instead of discarding them', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      return url.endsWith('/manifest.json')
        ? response(data.manifest)
        : url.endsWith(`/${HISTORY_PROVENANCE_FILE}`)
          ? response('', 404)
        : response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', {
      fetcher,
      now: () => LATEST + 3 * HOUR,
    });

    await expect(client.listSnapshots()).resolves.toEqual([snapshot(LATEST)]);
    expect(client.getSourceInfo()).toMatchObject({ stale: true, warningCode: 'cloud_stale' });
  });
});
