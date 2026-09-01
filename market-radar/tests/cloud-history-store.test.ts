import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Snapshot } from '../src/core/types';
import { decodeDayChunk, encodeDayChunk, STORAGE_CODEC_PREFIX } from '../src/core/storage-codec';
import {
  CloudHistoryError,
  updateCloudHistory,
  type CloudFileSystem,
} from '../src/cloud/history-store';
import {
  DEFAULT_CLOUD_DATA_DIR,
  DEFAULT_MIN_QUOTES,
  OFFICIAL_MARKETPLACE_URL,
  parseArgs,
  run,
} from '../scripts/update-cloud-history';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

async function readManifest(dataDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

async function snapshotFile(dataDir: string, timestamp: number): Promise<string> {
  return readFile(join(dataDir, 'snapshots', `${timestamp}.txt`), 'utf8');
}

async function fixtureFile(dataDir: string): Promise<string> {
  const path = join(dataDir, 'fixture.json');
  await writeFile(path, JSON.stringify({
    timestamp: LATEST,
    marketData: {
      '/items/test': {
        '0': { a: 101, b: 99, p: 100, v: 10 },
      },
    },
  }), 'utf8');
  return path;
}

beforeEach(async () => {
  vi.restoreAllMocks();
});

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mwi-cloud-history-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('updateCloudHistory', () => {
  it('writes a prefixed immutable snapshot file and atomically publishes its manifest', async () => {
    const current = snapshot(LATEST);

    const result = await updateCloudHistory({ dataDir, snapshot: current, generatedAt: GENERATED_AT });

    expect(result).toMatchObject({ inserted: true, cleanupErrors: [] });
    const text = await snapshotFile(dataDir, LATEST);
    expect(text.startsWith(STORAGE_CODEC_PREFIX)).toBe(true);
    await expect(decodeDayChunk(text)).resolves.toEqual([current]);
    const manifest = await readManifest(dataDir);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      latestTimestamp: LATEST,
      snapshots: [{ timestamp: LATEST, file: `snapshots/${LATEST}.txt`, bytes: Buffer.byteLength(text) }],
    });
    expect(await readdir(dataDir)).not.toContain('manifest.json.tmp');
  });

  it('is idempotent for the same timestamp and does not replace its immutable file', async () => {
    const current = snapshot(LATEST);
    await updateCloudHistory({ dataDir, snapshot: current, generatedAt: GENERATED_AT });
    const beforeFile = await snapshotFile(dataDir, LATEST);
    const beforeManifest = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    const result = await updateCloudHistory({
      dataDir,
      snapshot: current,
      generatedAt: '2026-09-01T12:10:00.000Z',
    });

    expect(result.inserted).toBe(false);
    await expect(snapshotFile(dataDir, LATEST)).resolves.toBe(beforeFile);
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(beforeManifest);
  });

  it('ignores an older timestamp without touching files, manifest, or cleanup', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const beforeManifest = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const beforeSnapshot = await snapshotFile(dataDir, LATEST);
    const beforeManifestHash = createHash('sha256').update(beforeManifest).digest('hex');
    const beforeFiles = await readdir(join(dataDir, 'snapshots'));
    const unlink = vi.fn(async () => undefined);

    const result = await updateCloudHistory({
      dataDir,
      snapshot: snapshot(LATEST - HOUR),
      generatedAt: GENERATED_AT,
      fileSystem: { unlink },
    });

    expect(result).toMatchObject({
      inserted: false,
      latestTimestamp: LATEST,
      snapshotCount: 1,
      cleanupErrors: [],
    });
    expect(result.manifest.latestTimestamp).toBe(LATEST);
    expect(createHash('sha256').update(await readFile(join(dataDir, 'manifest.json'), 'utf8')).digest('hex')).toBe(beforeManifestHash);
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(beforeManifest);
    await expect(snapshotFile(dataDir, LATEST)).resolves.toBe(beforeSnapshot);
    await expect(readdir(join(dataDir, 'snapshots'))).resolves.toEqual(beforeFiles);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('recovers an existing snapshot file when the manifest is missing it', async () => {
    const current = snapshot(LATEST);
    const text = await encodeDayChunk([current]);
    await mkdir(join(dataDir, 'snapshots'), { recursive: true });
    await writeFile(join(dataDir, 'snapshots', `${LATEST}.txt`), text, 'utf8');

    const result = await updateCloudHistory({ dataDir, snapshot: current, generatedAt: GENERATED_AT });

    expect(result.inserted).toBe(true);
    await expect(snapshotFile(dataDir, LATEST)).resolves.toBe(text);
    await expect(readManifest(dataDir)).resolves.toMatchObject({ latestTimestamp: LATEST });
  });

  it('rejects recovery when the immutable file decodes to a different snapshot', async () => {
    await mkdir(join(dataDir, 'snapshots'), { recursive: true });
    await writeFile(
      join(dataDir, 'snapshots', `${LATEST}.txt`),
      await encodeDayChunk([snapshot(LATEST, 999)]),
      'utf8',
    );

    const error = await updateCloudHistory({
      dataDir,
      snapshot: snapshot(LATEST),
      generatedAt: GENERATED_AT,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('snapshot_mismatch');
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the eight-day boundary and commits the manifest before deleting old files', async () => {
    const old = snapshot(LATEST - 9 * DAY);
    const boundary = snapshot(LATEST - 8 * DAY, 101);
    await updateCloudHistory({ dataDir, snapshot: old, generatedAt: GENERATED_AT });
    await updateCloudHistory({ dataDir, snapshot: boundary, generatedAt: GENERATED_AT });

    const result = await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST, 102), generatedAt: GENERATED_AT });

    expect(result.cleanupErrors).toEqual([]);
    await expect(readManifest(dataDir)).resolves.toMatchObject({
      latestTimestamp: LATEST,
      snapshots: [
        { timestamp: LATEST - 8 * DAY },
        { timestamp: LATEST },
      ],
    });
    await expect(readFile(join(dataDir, 'snapshots', `${old.timestamp}.txt`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a safe cleanup error while leaving the committed manifest valid', async () => {
    const old = snapshot(LATEST - 9 * DAY);
    await updateCloudHistory({ dataDir, snapshot: old, generatedAt: GENERATED_AT });
    const failingFileSystem: Partial<CloudFileSystem> = {
      unlink: vi.fn(async () => {
        throw new Error('private delete path should never be logged');
      }),
    };

    const result = await updateCloudHistory({
      dataDir,
      snapshot: snapshot(LATEST),
      generatedAt: GENERATED_AT,
      fileSystem: failingFileSystem,
    });

    expect(result.cleanupErrors).toEqual(['delete']);
    await expect(readManifest(dataDir)).resolves.toMatchObject({
      latestTimestamp: LATEST,
      snapshots: [{ timestamp: LATEST }],
    });
    await expect(snapshotFile(dataDir, old.timestamp)).resolves.toMatch(STORAGE_CODEC_PREFIX);
  });
});

describe('cloud history CLI', () => {
  it('parses the exact defaults and supported arguments', () => {
    expect(parseArgs([])).toEqual({
      dataDir: DEFAULT_CLOUD_DATA_DIR,
      sourceUrl: OFFICIAL_MARKETPLACE_URL,
      fixture: null,
      minQuotes: DEFAULT_MIN_QUOTES,
      validateOnly: false,
    });
    expect(parseArgs([
      '--data-dir', 'tmp/data',
      '--source-url', 'https://example.test/market.json',
      '--fixture', 'fixture.json',
      '--min-quotes', '1',
      '--validate-only',
    ])).toEqual({
      dataDir: 'tmp/data',
      sourceUrl: 'https://example.test/market.json',
      fixture: 'fixture.json',
      minQuotes: 1,
      validateOnly: true,
    });
  });

  it.each(['http://example.test/market.json', 'javascript:alert(1)', 'https://user:pass@example.test/market.json'])('rejects an unsafe source URL: %s', (sourceUrl) => {
    expect(() => parseArgs(['--source-url', sourceUrl])).toThrow(/https|source|URL/i);
  });

  it('updates from a fixture through parseOfficialSnapshot and validates every file', async () => {
    const fixture = await fixtureFile(dataDir);

    await expect(run(['--data-dir', dataDir, '--fixture', fixture, '--min-quotes', '1'])).resolves.toBe(0);
    await expect(run(['--data-dir', dataDir, '--validate-only'])).resolves.toBe(0);
    await expect(readManifest(dataDir)).resolves.toMatchObject({ latestTimestamp: LATEST });
  });

  it('uses safe fetch options and enforces the minimum quote count', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        timestamp: LATEST,
        marketData: { '/items/test': { '0': { a: 101, b: 99, p: 100, v: 10 } } },
      }),
    }));

    await expect(run([
      '--data-dir', dataDir,
      '--source-url', 'https://example.test/market.json',
      '--min-quotes', '1',
    ], { fetch: fetcher as unknown as typeof fetch })).resolves.toBe(0);
    expect(fetcher).toHaveBeenCalledWith('https://example.test/market.json', {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(run([
      '--data-dir', dataDir,
      '--fixture', await fixtureFile(dataDir),
      '--min-quotes', '2',
    ])).resolves.toBe(1);
    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('marketData');
  });

  it('returns a nonzero safe result for corrupt validate-only data', async () => {
    const fixture = await fixtureFile(dataDir);
    await run(['--data-dir', dataDir, '--fixture', fixture, '--min-quotes', '1']);
    await writeFile(join(dataDir, 'snapshots', `${LATEST}.txt`), 'corrupt private payload', 'utf8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(run(['--data-dir', dataDir, '--validate-only'])).resolves.toBe(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('corrupt private payload');
  });
});
