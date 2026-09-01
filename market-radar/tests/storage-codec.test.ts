import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../src/core/types';
import {
  decodeDayChunk,
  decodeDayChunkLimited,
  encodeDayChunk,
  STORAGE_CODEC_GZIP_PREFIX,
  StorageDecodeError,
} from '../src/core/storage-codec';

const key = '/items/test::0';

function snapshot(timestamp: number, price: number | null = 100): Snapshot {
  return {
    timestamp,
    quotes: {
      [key]: { a: price, b: price === null ? null : price - 1, p: price, v: null },
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

async function gzipPayload(value: unknown): Promise<string> {
  return gzipJson(JSON.stringify(value));
}

async function gzipJson(json: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(json)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `${STORAGE_CODEC_GZIP_PREFIX}${bytesToBase64(bytes)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage codec', () => {
  it('round trips a day chunk while preserving nulls, quotes, and timestamps', async () => {
    const input: Snapshot[] = [
      snapshot(1_788_000_000_000, null),
      {
        timestamp: 1_788_003_600_000,
        quotes: {
          '/items/rare::7': { a: 12.5, b: 10, p: null, v: 0 },
        },
      },
    ];

    const encoded = await encodeDayChunk(input);

    expect(encoded.startsWith(STORAGE_CODEC_GZIP_PREFIX)).toBe(true);
    await expect(decodeDayChunk(encoded)).resolves.toEqual(input);
  });

  it('encodes the same content deterministically', async () => {
    const input = [snapshot(1_788_000_000_000), snapshot(1_788_003_600_000, 101)];

    await expect(encodeDayChunk(input)).resolves.toBe(await encodeDayChunk(input));
  });

  it('handles a large payload without overflowing the call stack', async () => {
    const quotes: Snapshot['quotes'] = {};
    for (let index = 0; index < 20_000; index += 1) {
      quotes[`/items/item-${index}::0`] = { a: index, b: index, p: index, v: index * 2 };
    }

    const input: Snapshot[] = [{ timestamp: 1_788_000_000_000, quotes }];
    const encoded = await encodeDayChunk(input);

    await expect(decodeDayChunk(encoded)).resolves.toEqual(input);
  });

  it('rejects a missing or unknown codec prefix without exposing the encoded value', async () => {
    const raw = 'mwi-radar:v1:unknown:base64:secret-payload';

    const error = await decodeDayChunk(raw).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageDecodeError);
    expect((error as Error).message).toMatch(/prefix/i);
    expect((error as Error).message).not.toContain(raw);
    expect((error as StorageDecodeError).reason).toBe('prefix');
  });

  it('rejects malformed base64 without exposing the payload', async () => {
    const raw = `${STORAGE_CODEC_GZIP_PREFIX}not-base64!`;

    const error = await decodeDayChunk(raw).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageDecodeError);
    expect((error as Error).message).toMatch(/base64/i);
    expect((error as Error).message).not.toContain(raw);
    expect((error as StorageDecodeError).reason).toBe('base64');
  });

  it('rejects a gzip payload that cannot be decompressed', async () => {
    const raw = `${STORAGE_CODEC_GZIP_PREFIX}${bytesToBase64(new TextEncoder().encode('not gzip'))}`;

    const error = await decodeDayChunk(raw).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageDecodeError);
    expect((error as Error).message).toMatch(/gzip/i);
    expect((error as StorageDecodeError).reason).toBe('gzip');
  });

  it('rejects invalid JSON after decoding the payload', async () => {
    const raw = await gzipJson('{not-json');

    const error = await decodeDayChunk(raw).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageDecodeError);
    expect((error as Error).message).toMatch(/json/i);
    expect((error as StorageDecodeError).reason).toBe('json');
  });

  it('rejects a decoded value that does not match the snapshot schema', async () => {
    const raw = await gzipPayload([{ timestamp: 1, quotes: { [key]: { a: 'bad' } } }]);

    const error = await decodeDayChunk(raw).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageDecodeError);
    expect((error as Error).message).toMatch(/schema/i);
    expect((error as StorageDecodeError).reason).toBe('schema');
  });

  it('rejects malformed JSON values such as a non-array root', async () => {
    const raw = await gzipPayload({ timestamp: 1, quotes: {} });

    await expect(decodeDayChunk(raw)).rejects.toMatchObject({ reason: 'schema' });
  });

  it('rejects snapshots with invalid timestamps or quote containers', async () => {
    const invalidValues: unknown[] = [
      [{ timestamp: 1.5, quotes: {} }],
      [{ timestamp: -1, quotes: {} }],
      [{ timestamp: Number.NaN, quotes: {} }],
      [{ timestamp: Infinity, quotes: {} }],
      [{ timestamp: 1, quotes: [] }],
      [{ timestamp: 1, quotes: null }],
    ];

    for (const value of invalidValues) {
      await expect(decodeDayChunk(await gzipPayload(value))).rejects.toMatchObject({ reason: 'schema' });
    }
  });

  it('rejects negative, non-finite, and non-null quote values', async () => {
    const invalidQuoteJson: string[] = [
      '{"a":-1,"b":null,"p":null,"v":null}',
      '{"a":1e999,"b":null,"p":null,"v":null}',
      '{"a":null,"b":"100","p":null,"v":null}',
      '{"a":null,"b":null,"p":null,"v":1e999}',
    ];

    for (const quote of invalidQuoteJson) {
      const value = `[{"timestamp":1,"quotes":{"${key}":${quote}}}]`;
      await expect(decodeDayChunk(await gzipJson(value))).rejects.toMatchObject({ reason: 'schema' });
    }
  });

  it('reports a clear unsupported error when compression is unavailable', async () => {
    if (typeof CompressionStream !== 'function') return;

    vi.stubGlobal('CompressionStream', undefined);

    await expect(encodeDayChunk([])).rejects.toThrow(/unsupported/i);
  });

  it('rejects highly compressed output once the decoded byte limit is exceeded', async () => {
    const input = [{ timestamp: 1_788_000_000_000, quotes: {
      [key]: { a: 1, b: 1, p: 1, v: 1 },
    }, padding: 'x'.repeat(100_000) }];
    const encoded = await gzipJson(JSON.stringify(input));

    await expect(decodeDayChunkLimited(encoded, 1_024)).rejects.toMatchObject({ reason: 'size' });
  });

  it('rejects a pre-aborted limited decode with a safe cancellation reason', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(decodeDayChunkLimited(await gzipPayload([snapshot(1)]), 1_024, controller.signal))
      .rejects.toMatchObject({ reason: 'cancelled' });
  });
});
