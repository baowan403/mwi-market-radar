import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Snapshot } from '../src/core/types';
import { decodeDayChunk, encodeDayChunk, STORAGE_CODEC_PREFIX } from '../src/core/storage-codec';
import { decodeDailyHistoryPack, encodeDailyHistoryPack } from '../src/cloud/daily-history';
import { aggregateDailySummary } from '../src/cloud/daily-summary';
import { createManifest } from '../src/cloud/manifest';
import {
  CLOUD_DAILY_HISTORY_FILE,
  CloudHistoryError,
  mergeCloudHistory,
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
const MAX_DATE_MS = 8_640_000_000_000_000;
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
  it('accepts the maximum Date timestamp and rejects a larger snapshot before writing', async () => {
    const maxDataDir = join(dataDir, 'update-max-date');
    const valid = snapshot(MAX_DATE_MS, 100);
    await expect(updateCloudHistory({ dataDir: maxDataDir, snapshot: valid, generatedAt: GENERATED_AT }))
      .resolves.toMatchObject({ inserted: true });
    const manifestBefore = await readFile(join(maxDataDir, 'manifest.json'), 'utf8');
    const snapshotBefore = await snapshotFile(maxDataDir, MAX_DATE_MS);

    const error = await updateCloudHistory({
      dataDir: maxDataDir,
      snapshot: snapshot(MAX_DATE_MS + 1, 101),
      generatedAt: GENERATED_AT,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('invalid_snapshot');
    await expect(readFile(join(maxDataDir, 'manifest.json'), 'utf8')).resolves.toBe(manifestBefore);
    await expect(snapshotFile(maxDataDir, MAX_DATE_MS)).resolves.toBe(snapshotBefore);
    await expect(snapshotFile(maxDataDir, MAX_DATE_MS + 1)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finalizes one compressed daily OHLCV summary only after the UTC day closes', async () => {
    await updateCloudHistory({
      dataDir,
      snapshot: snapshot(LATEST - HOUR, 90),
      generatedAt: '2026-09-01T11:09:00.000Z',
    });
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST, 100), generatedAt: GENERATED_AT });
    await expect(readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await updateCloudHistory({
      dataDir,
      snapshot: snapshot(LATEST + DAY, 110),
      generatedAt: '2026-09-02T12:09:00.000Z',
    });

    const encoded = await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8');
    const pack = await decodeDailyHistoryPack(encoded);
    expect(pack.summaries).toHaveLength(1);
    expect(pack.summaries[0]?.quotes[KEY]).toMatchObject({
      o: 90, h: 100, l: 90, c: 100, v: 20, samples: 2,
    });
  });

  it('backfills retained hourly days when migrating a history without a daily pack', async () => {
    await mkdir(join(dataDir, 'snapshots'), { recursive: true });
    const existing = [snapshot(LATEST - 2 * DAY, 80), snapshot(LATEST - DAY, 90)];
    const entries = [];
    for (const value of existing) {
      const text = await encodeDayChunk([value]);
      await writeFile(join(dataDir, 'snapshots', `${value.timestamp}.txt`), text, 'utf8');
      entries.push({
        timestamp: value.timestamp,
        file: `snapshots/${value.timestamp}.txt` as `snapshots/${number}.txt`,
        bytes: Buffer.byteLength(text),
      });
    }
    await writeFile(
      join(dataDir, 'manifest.json'),
      JSON.stringify(createManifest(entries, '2026-08-31T12:09:00.000Z')),
      'utf8',
    );

    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST, 100), generatedAt: GENERATED_AT });

    const pack = await decodeDailyHistoryPack(await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8'));
    expect(pack.summaries.map((value) => value.quotes[KEY]?.c)).toEqual([80, 90]);
  });

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

  it('retains the ten-day boundary and commits the manifest before deleting old files', async () => {
    const old = snapshot(LATEST - 11 * DAY);
    const boundary = snapshot(LATEST - 10 * DAY, 101);
    await updateCloudHistory({ dataDir, snapshot: old, generatedAt: GENERATED_AT });
    await updateCloudHistory({ dataDir, snapshot: boundary, generatedAt: GENERATED_AT });

    const result = await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST, 102), generatedAt: GENERATED_AT });

    expect(result.cleanupErrors).toEqual([]);
    await expect(readManifest(dataDir)).resolves.toMatchObject({
      latestTimestamp: LATEST,
      snapshots: [
        { timestamp: LATEST - 10 * DAY },
        { timestamp: LATEST },
      ],
    });
    await expect(readFile(join(dataDir, 'snapshots', `${old.timestamp}.txt`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a safe cleanup error while leaving the committed manifest valid', async () => {
    const old = snapshot(LATEST - 11 * DAY);
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

  it('prunes only exact old orphan files on a same-timestamp no-op and preserves the manifest hash', async () => {
    const current = snapshot(LATEST);
    await updateCloudHistory({ dataDir, snapshot: current, generatedAt: GENERATED_AT });
    const oldTimestamp = LATEST - 11 * DAY;
    const withinWindowTimestamp = LATEST - 7 * DAY;
    const futureTimestamp = LATEST + DAY;
    const orphanText = await encodeDayChunk([snapshot(oldTimestamp)]);
    await writeFile(join(dataDir, 'snapshots', `${oldTimestamp}.txt`), orphanText, 'utf8');
    await writeFile(join(dataDir, 'snapshots', `${withinWindowTimestamp}.txt`), orphanText, 'utf8');
    await writeFile(join(dataDir, 'snapshots', `${futureTimestamp}.txt`), orphanText, 'utf8');
    await writeFile(join(dataDir, 'snapshots', 'not-a-timestamp.txt'), orphanText, 'utf8');

    const beforeManifest = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const beforeManifestHash = createHash('sha256').update(beforeManifest).digest('hex');
    const oldPath = join(dataDir, 'snapshots', `${oldTimestamp}.txt`);
    const unlink = vi.fn(async (path: string) => {
      if (path === oldPath) throw new Error('private old path should never be logged');
    });

    const failed = await updateCloudHistory({
      dataDir,
      snapshot: current,
      generatedAt: GENERATED_AT,
      fileSystem: { unlink },
    });

    expect(failed.inserted).toBe(false);
    expect(failed.cleanupErrors).toEqual(['delete']);
    expect(createHash('sha256').update(await readFile(join(dataDir, 'manifest.json'), 'utf8')).digest('hex')).toBe(beforeManifestHash);
    await expect(snapshotFile(dataDir, oldTimestamp)).resolves.toBe(orphanText);
    await expect(snapshotFile(dataDir, withinWindowTimestamp)).resolves.toBe(orphanText);
    await expect(snapshotFile(dataDir, futureTimestamp)).resolves.toBe(orphanText);
    await expect(readFile(join(dataDir, 'snapshots', 'not-a-timestamp.txt'), 'utf8')).resolves.toBe(orphanText);

    const recovered = await updateCloudHistory({ dataDir, snapshot: current, generatedAt: GENERATED_AT });

    expect(recovered.inserted).toBe(false);
    expect(recovered.cleanupErrors).toEqual([]);
    expect(createHash('sha256').update(await readFile(join(dataDir, 'manifest.json'), 'utf8')).digest('hex')).toBe(beforeManifestHash);
    await expect(readFile(oldPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(unlink).toHaveBeenCalledTimes(1);
  });
});

describe('mergeCloudHistory', () => {
  it('accepts the maximum Date timestamp and rejects a larger snapshot before writing', async () => {
    const maxDataDir = join(dataDir, 'merge-max-date');
    const valid = snapshot(MAX_DATE_MS, 100);
    await expect(mergeCloudHistory({ dataDir: maxDataDir, snapshots: [valid], generatedAt: GENERATED_AT }))
      .resolves.toMatchObject({ inserted: 1 });
    const manifestBefore = await readFile(join(maxDataDir, 'manifest.json'), 'utf8');
    const snapshotBefore = await snapshotFile(maxDataDir, MAX_DATE_MS);

    const error = await mergeCloudHistory({
      dataDir: maxDataDir,
      snapshots: [snapshot(MAX_DATE_MS + 1, 101)],
      generatedAt: GENERATED_AT,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('invalid_snapshot');
    await expect(readFile(join(maxDataDir, 'manifest.json'), 'utf8')).resolves.toBe(manifestBefore);
    await expect(snapshotFile(maxDataDir, MAX_DATE_MS)).resolves.toBe(snapshotBefore);
    await expect(snapshotFile(maxDataDir, MAX_DATE_MS + 1)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('merges retained older snapshots with an existing latest snapshot in ascending order', async () => {
    const official = snapshot(LATEST, 100);
    await updateCloudHistory({ dataDir, snapshot: official, generatedAt: GENERATED_AT });
    const incoming = [snapshot(LATEST - 2 * HOUR, 80), official, snapshot(LATEST - HOUR, 90)];
    const before = incoming.map((value) => structuredClone(value));

    const result = await mergeCloudHistory({
      dataDir,
      snapshots: incoming,
      generatedAt: '2026-09-01T12:11:00.000Z',
    });

    expect(result.inserted).toBe(2);
    expect(result.manifest.snapshots.map((entry) => entry.timestamp)).toEqual([
      LATEST - 2 * HOUR,
      LATEST - HOUR,
      LATEST,
    ]);
    expect(incoming).toEqual(before);
  });

  it('is a byte-identical no-op when all incoming snapshots already exist', async () => {
    const backfill = [snapshot(LATEST - DAY, 80), snapshot(LATEST - DAY + HOUR, 90)];
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    await mergeCloudHistory({ dataDir, snapshots: backfill, generatedAt: '2026-09-01T12:11:00.000Z' });
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const dailyBefore = await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8');

    const result = await mergeCloudHistory({
      dataDir,
      snapshots: backfill,
      generatedAt: '2026-09-01T12:12:00.000Z',
    });

    expect(result).toMatchObject({ inserted: 0, cleanupErrors: [] });
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(manifestBefore);
    await expect(readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8')).resolves.toBe(dailyBefore);
  });

  it('reconciles an incomplete daily pack once and leaves the repaired bytes untouched on retry', async () => {
    const backfill = [snapshot(LATEST - DAY, 80), snapshot(LATEST - DAY + HOUR, 90)];
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    await mergeCloudHistory({ dataDir, snapshots: backfill, generatedAt: '2026-09-01T12:11:00.000Z' });
    await writeFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), await encodeDailyHistoryPack({
      schemaVersion: 1,
      generatedAt: '2026-09-01T12:11:00.000Z',
      summaries: [],
    }), 'utf8');
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    const reconciled = await mergeCloudHistory({
      dataDir,
      snapshots: backfill,
      generatedAt: '2026-09-01T12:12:00.000Z',
    });
    const repaired = await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8');
    const retried = await mergeCloudHistory({
      dataDir,
      snapshots: backfill,
      generatedAt: '2026-09-01T12:13:00.000Z',
    });

    expect(reconciled.inserted).toBe(0);
    expect(retried.inserted).toBe(0);
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(manifestBefore);
    expect((await decodeDailyHistoryPack(repaired)).summaries[0]?.quotes[KEY]?.c).toBe(90);
    await expect(readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8')).resolves.toBe(repaired);
  });

  it('preserves an unchanged daily pack when a same-day official update advances the manifest timestamp', async () => {
    const backfill = [snapshot(LATEST - DAY, 80), snapshot(LATEST - DAY + HOUR, 90)];
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    await mergeCloudHistory({ dataDir, snapshots: backfill, generatedAt: '2026-09-01T12:11:00.000Z' });
    await updateCloudHistory({
      dataDir,
      snapshot: snapshot(LATEST + HOUR, 110),
      generatedAt: '2026-09-01T13:09:00.000Z',
    });
    const dailyBefore = await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8');

    await mergeCloudHistory({
      dataDir,
      snapshots: backfill,
      generatedAt: '2026-09-01T13:10:00.000Z',
    });

    await expect(readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8')).resolves.toBe(dailyBefore);
  });

  it('rejects an incoming snapshot that conflicts with an immutable manifest timestamp', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    const error = await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST, 999)],
      generatedAt: '2026-09-01T12:11:00.000Z',
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('snapshot_mismatch');
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(manifestBefore);
  });

  it('rejects duplicate timestamps in the incoming batch before writing them', async () => {
    const repeated = snapshot(LATEST - HOUR, 90);

    const error = await mergeCloudHistory({
      dataDir,
      snapshots: [repeated, structuredClone(repeated)],
      generatedAt: GENERATED_AT,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('invalid_snapshot');
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(snapshotFile(dataDir, repeated.timestamp)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats an empty batch as a no-op and preserves the current manifest', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const before = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    const result = await mergeCloudHistory({
      dataDir,
      snapshots: [],
      generatedAt: '2026-09-01T12:11:00.000Z',
    });

    expect(result.inserted).toBe(0);
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(before);
  });

  it('does not publish snapshots outside the final ten-day retention window', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const expired = snapshot(LATEST - 11 * DAY, 80);
    const before = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    const result = await mergeCloudHistory({ dataDir, snapshots: [expired], generatedAt: GENERATED_AT });

    expect(result.inserted).toBe(0);
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(before);
    await expect(snapshotFile(dataDir, expired.timestamp)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rebuilds every completed UTC day from the merged retained snapshots without sealing the latest day', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST, 100), generatedAt: GENERATED_AT });

    await mergeCloudHistory({
      dataDir,
      snapshots: [
        snapshot(LATEST - 2 * DAY, 60), snapshot(LATEST - 2 * DAY + HOUR, 70),
        snapshot(LATEST - DAY, 80), snapshot(LATEST - DAY + HOUR, 90),
      ],
      generatedAt: '2026-09-01T12:11:00.000Z',
    });

    const pack = await decodeDailyHistoryPack(await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8'));
    expect(pack.summaries.map((summary) => summary.date)).toEqual(['2026-08-30', '2026-08-31']);
    expect(pack.summaries.map((summary) => summary.quotes[KEY]?.c)).toEqual([70, 90]);
    expect(pack.summaries.some((summary) => summary.date === '2026-09-01')).toBe(false);
  });

  it('replaces an existing completed-date summary from the merged hourly contents', async () => {
    const initial = snapshot(LATEST - DAY, 80);
    const latest = snapshot(LATEST, 100);
    const initialText = await encodeDayChunk([initial]);
    const latestText = await encodeDayChunk([latest]);
    await mkdir(join(dataDir, 'snapshots'), { recursive: true });
    await writeFile(join(dataDir, 'snapshots', `${initial.timestamp}.txt`), initialText, 'utf8');
    await writeFile(join(dataDir, 'snapshots', `${latest.timestamp}.txt`), latestText, 'utf8');
    await writeFile(join(dataDir, 'manifest.json'), JSON.stringify(createManifest([
      { timestamp: initial.timestamp, file: `snapshots/${initial.timestamp}.txt`, bytes: Buffer.byteLength(initialText) },
      { timestamp: latest.timestamp, file: `snapshots/${latest.timestamp}.txt`, bytes: Buffer.byteLength(latestText) },
    ], GENERATED_AT)), 'utf8');
    await writeFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), await encodeDailyHistoryPack({
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      summaries: [aggregateDailySummary([initial]), aggregateDailySummary([latest])],
    }), 'utf8');

    await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - DAY + HOUR, 90)],
      generatedAt: '2026-09-01T12:11:00.000Z',
    });

    const pack = await decodeDailyHistoryPack(await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8'));
    expect(pack.summaries).toHaveLength(1);
    expect(pack.summaries[0]?.quotes[KEY]).toMatchObject({ o: 80, c: 90, samples: 2 });
    expect(pack.summaries.some((summary) => summary.date === '2026-09-01')).toBe(false);
  });

  it('does not publish the manifest when a later snapshot fails immutable readback', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const incoming = snapshot(LATEST - HOUR, 90);
    const before = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const rename = vi.fn(async () => undefined);
    let incomingReads = 0;

    const error = await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - 2 * HOUR, 80), incoming],
      generatedAt: '2026-09-01T12:11:00.000Z',
      fileSystem: {
        readFile: async (path) => {
          if (path !== join(dataDir, 'snapshots', `${incoming.timestamp}.txt`)) return readFile(path, 'utf8');
          incomingReads += 1;
          if (incomingReads === 1) return readFile(path, 'utf8');
          return 'corrupt newly-written snapshot';
        },
        rename,
      },
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('storage');
    expect(rename).not.toHaveBeenCalled();
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(before);
  });

  it('does not publish the manifest when a retained snapshot is corrupt during daily preparation', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    await writeFile(join(dataDir, 'snapshots', `${LATEST}.txt`), 'corrupt retained snapshot', 'utf8');
    const before = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const rename = vi.fn(async () => undefined);

    const error = await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - HOUR, 90)],
      generatedAt: '2026-09-01T12:11:00.000Z',
      fileSystem: { rename },
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('storage');
    expect(rename).not.toHaveBeenCalled();
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(before);
  });

  it('does not publish the manifest when the existing daily pack is corrupt', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    await writeFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'corrupt retained daily pack', 'utf8');
    const before = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const rename = vi.fn(async () => undefined);

    const error = await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - HOUR, 90)],
      generatedAt: '2026-09-01T12:11:00.000Z',
      fileSystem: { rename },
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('storage');
    expect(rename).not.toHaveBeenCalled();
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(before);
  });

  it('repairs daily history and prunes expired orphans after a post-manifest daily write failure', async () => {
    const expired = snapshot(LATEST - 11 * DAY, 70);
    const retained = snapshot(LATEST - 9 * DAY, 80);
    await updateCloudHistory({ dataDir, snapshot: expired, generatedAt: '2026-08-21T12:09:00.000Z' });
    await updateCloudHistory({ dataDir, snapshot: retained, generatedAt: '2026-08-23T12:09:00.000Z' });
    await rm(join(dataDir, CLOUD_DAILY_HISTORY_FILE));
    const current = snapshot(LATEST, 100);

    const failed = await mergeCloudHistory({
      dataDir,
      snapshots: [current],
      generatedAt: GENERATED_AT,
      fileSystem: {
        writeFile: async (path, data, options) => {
          if (path.includes(`.${CLOUD_DAILY_HISTORY_FILE}.tmp-`)) throw new Error('private daily failure');
          await writeFile(path, data, options);
        },
      },
    }).catch((cause: unknown) => cause);

    expect(failed).toBeInstanceOf(CloudHistoryError);
    await expect(snapshotFile(dataDir, expired.timestamp)).resolves.toMatch(STORAGE_CODEC_PREFIX);

    const recovered = await mergeCloudHistory({ dataDir, snapshots: [current], generatedAt: '2026-09-01T12:11:00.000Z' });

    expect(recovered).toMatchObject({ inserted: 0, cleanupErrors: [] });
    expect((await decodeDailyHistoryPack(await readFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'utf8'))).summaries)
      .toHaveLength(1);
    await expect(snapshotFile(dataDir, expired.timestamp)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves the previous manifest untouched when publishing a merged batch fails', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const before = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    const error = await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - HOUR, 90)],
      generatedAt: '2026-09-01T12:11:00.000Z',
      fileSystem: { rename: vi.fn(async () => { throw new Error('private publish failure'); }) },
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudHistoryError);
    expect((error as CloudHistoryError).code).toBe('manifest_publish');
    await expect(readFile(join(dataDir, 'manifest.json'), 'utf8')).resolves.toBe(before);
  });

  it('uses fileSystem overrides ahead of the fs alias and reports cleanup safely', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const oldTimestamp = LATEST - 11 * DAY;
    await writeFile(join(dataDir, 'snapshots', `${oldTimestamp}.txt`), await encodeDayChunk([snapshot(oldTimestamp)]), 'utf8');
    const aliasReaddir = vi.fn(async () => { throw new Error('alias should be overridden'); });
    const overrideReaddir = vi.fn(async () => [`${oldTimestamp}.txt`]);
    const failingUnlink = vi.fn(async () => { throw new Error('private cleanup failure'); });

    const result = await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - HOUR, 90)],
      generatedAt: '2026-09-01T12:11:00.000Z',
      fs: { readdir: aliasReaddir },
      fileSystem: { readdir: overrideReaddir, unlink: failingUnlink },
    });

    expect(result.cleanupErrors).toEqual(['delete']);
    expect(aliasReaddir).not.toHaveBeenCalled();
    expect(overrideReaddir).toHaveBeenCalledTimes(1);
    expect(failingUnlink).toHaveBeenCalledTimes(1);
    await expect(readManifest(dataDir)).resolves.toMatchObject({ latestTimestamp: LATEST });
  });

  it('uses the fs alias when fileSystem is absent', async () => {
    await updateCloudHistory({ dataDir, snapshot: snapshot(LATEST), generatedAt: GENERATED_AT });
    const aliasReaddir = vi.fn(async () => readdir(join(dataDir, 'snapshots')));

    await mergeCloudHistory({
      dataDir,
      snapshots: [snapshot(LATEST - HOUR, 90)],
      generatedAt: '2026-09-01T12:11:00.000Z',
      fs: { readdir: aliasReaddir },
    });

    expect(aliasReaddir).toHaveBeenCalledTimes(1);
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

  it('validates the compressed daily history pack without leaking corrupt content', async () => {
    const fixture = await fixtureFile(dataDir);
    await run(['--data-dir', dataDir, '--fixture', fixture, '--min-quotes', '1']);
    await writeFile(join(dataDir, CLOUD_DAILY_HISTORY_FILE), 'private corrupt daily payload', 'utf8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(run(['--data-dir', dataDir, '--validate-only'])).resolves.toBe(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private corrupt daily payload');
  });
});
