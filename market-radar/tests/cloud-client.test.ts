import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudManifest, CloudSnapshotEntry } from '../src/cloud/types';
import { createManifest } from '../src/cloud/manifest';
import { encodeDayChunk } from '../src/core/storage-codec';
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
  it('fetches the manifest and snapshot text with safe GET options under the base URL', async () => {
    const data = await manifestAndFiles([snapshot(LATEST - HOUR), snapshot(LATEST)]);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/manifest.json')) return response(data.manifest);
      const file = url.slice('https://example.test/cloud/'.length);
      return response(data.files.get(file) ?? '', 200);
    });
    const client = createCloudClient(new URL('https://example.test/cloud/'), { fetcher });

    await expect(client.listSnapshots()).resolves.toEqual([snapshot(LATEST - HOUR), snapshot(LATEST)]);
    expect(calls).toHaveLength(3);
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
      return response(data.files.get(url.slice('https://example.test/cloud/'.length)) ?? '');
    });
    const client = createCloudClient('https://example.test/cloud/', { fetcher });

    await client.listSnapshots();
    await client.listSnapshots();
    await client.refresh({ force: true });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/manifest.json'))).toHaveLength(2);
  });

  it('reuses snapshots when only generatedAt changes while returning the new manifest metadata', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    let generatedAt = GENERATED_AT;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return response({ ...data.manifest, generatedAt });
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

  it('shares concurrent force refreshes so one fetch commits one result', async () => {
    const data = await manifestAndFiles([snapshot(LATEST)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('/manifest.json')) await gate;
      const url = String(input);
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
    const fetcher = vi.fn(async () => response(oversized));
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const error = await client.listSnapshots().catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'cloud_data_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a manifest declaring more than 256 snapshots before downloads', async () => {
    const entries: CloudSnapshotEntry[] = Array.from({ length: 257 }, (_, index) => ({
      timestamp: LATEST - (257 - index) * 60_000,
      file: `snapshots/${LATEST - (257 - index) * 60_000}.txt` as `snapshots/${number}.txt`,
      bytes: 1,
    }));
    const manifest = createManifest(entries, GENERATED_AT);
    const fetcher = vi.fn(async () => response(manifest));
    const client = createCloudClient('https://example.test/cloud/', { fetcher });
    const error = await client.listSnapshots().catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'cloud_data_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized snapshot text and declared total bytes before unbounded downloads', async () => {
    const current = snapshot(LATEST);
    const data = await manifestAndFiles([current]);
    const oversizedFetcher = vi.fn(async (input: string | URL) => (
      String(input).endsWith('/manifest.json')
        ? response(data.manifest)
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
    const totalFetcher = vi.fn(async () => response(manyManifest));
    const totalClient = createCloudClient('https://example.test/cloud/', { fetcher: totalFetcher });
    await expect(totalClient.listSnapshots()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
    expect(totalFetcher).toHaveBeenCalledTimes(1);
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
