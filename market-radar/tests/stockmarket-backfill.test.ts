import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Quote, Snapshot } from '../src/core/types';
import type { StockmarketHistoryPoint } from '../src/backfill/stockmarket-schema';
import { buildBackfillSnapshots, validateOfficialOverlap } from '../src/backfill/stockmarket-backfill';
import { mergeCloudHistory, updateCloudHistory, type CloudFileSystem } from '../src/cloud/history-store';
import { parseManifest } from '../src/cloud/manifest';
import { createHistoryProvenance, HISTORY_PROVENANCE_FILE } from '../src/cloud/provenance';
import { decodeDayChunk, encodeDayChunk } from '../src/core/storage-codec';
import { parseBackfillArgs, run as runBackfillCli, runStockmarketBackfill } from '../scripts/backfill-stockmarket-history';

const HOUR = 3_600_000;
const latest = 1_000_000_000_000;
function row(itemName: string, level: number, timestamp: number, values: Partial<StockmarketHistoryPoint> = {}): StockmarketHistoryPoint {
  return { itemName, level, timestamp, a: 10, b: 9, p: 9.5, v: 2, ...values };
}
function makeRows(hours: number, quotes = 2, start = latest - (hours - 1) * HOUR): ReadonlyMap<string, readonly StockmarketHistoryPoint[]> {
  return new Map(Array.from({ length: quotes }, (_, q) => {
    const itemName = `item_${String(q).padStart(4, '0')}`;
    return [itemName, Array.from({ length: hours }, (_, h) => row(itemName, 0, start + h * HOUR))] as const;
  }));
}
function snapshot(timestamp: number, quote: Quote = { a: 10, b: 9, p: 8, v: 7 }): Snapshot {
  return { timestamp, quotes: { '/items/wood::0': quote } };
}

describe('stockmarket backfill aggregation', () => {
  it('aggregates unsorted item levels into sorted market keys at exact timestamps', () => {
    const result = buildBackfillSnapshots(new Map([
      ['zeta', [row('zeta', 2, latest), row('zeta', 1, latest)]],
      ['alpha', [row('alpha', 0, latest)]],
    ]), latest, { minimumHours: 1, minimumQuotes: 3 });
    expect(result).toEqual([{ timestamp: latest, quotes: {
      '/items/alpha::0': { a: 10, b: 9, p: 9.5, v: 2 },
      '/items/zeta::1': { a: 10, b: 9, p: 9.5, v: 2 },
      '/items/zeta::2': { a: 10, b: 9, p: 9.5, v: 2 },
    } }]);
    expect(Object.keys(result[0]!.quotes)).toEqual(['/items/alpha::0', '/items/zeta::1', '/items/zeta::2']);
  });

  it('keeps the inclusive seven-day boundary and preserves millisecond timestamps', () => {
    const cutoff = latest - 7 * 24 * HOUR;
    const result = buildBackfillSnapshots(new Map([['a', [row('a', 0, cutoff), row('a', 1, cutoff - 1), row('a', 2, latest - 1234)]]]), latest, { minimumHours: 2, minimumQuotes: 1 });
    expect(result.map((s) => s.timestamp)).toEqual([cutoff, latest - 1234]);
  });

  it('rejects future rows and invalid latest timestamps', () => {
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest + 1)]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/future/i);
    expect(() => buildBackfillSnapshots(new Map(), Number.NaN, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/timestamp/i);
    expect(() => buildBackfillSnapshots(new Map(), Number.MAX_SAFE_INTEGER + 1, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/timestamp/i);
    const maxDate = 8_640_000_000_000_000;
    expect(buildBackfillSnapshots(new Map([['a', [row('a', 0, maxDate)]]]), maxDate, { minimumHours: 1, minimumQuotes: 1 })).toHaveLength(1);
    expect(() => buildBackfillSnapshots(new Map(), maxDate + 1, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/timestamp/i);
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, maxDate + 1)]]]), maxDate, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/timestamp/i);
  });

  it('rejects sparse snapshots and invalid gates', () => {
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest)]]]), latest, { minimumHours: 2, minimumQuotes: 1 })).toThrow(/hours/i);
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest)]]]), latest, { minimumHours: 1, minimumQuotes: 2 })).toThrow(/quotes/i);
    expect(() => buildBackfillSnapshots(new Map(), latest, { minimumHours: 0, minimumQuotes: 1 })).toThrow(/gate/i);
    expect(() => buildBackfillSnapshots(new Map(), latest, { minimumHours: 1.5, minimumQuotes: 1 })).toThrow(/gate/i);
    expect(() => buildBackfillSnapshots(new Map(), latest, { minimumHours: 1, minimumQuotes: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/gate/i);
  });

  it('rejects conflicting duplicate rows but accepts exact duplicates', () => {
    const duplicate = row('a', 0, latest);
    expect(buildBackfillSnapshots(new Map([['a', [duplicate, { ...duplicate }]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toHaveLength(1);
    expect(() => buildBackfillSnapshots(new Map([['a', [duplicate, { ...duplicate, a: 11 }]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/duplicate|conflict/i);
    expect(() => buildBackfillSnapshots(new Map([['wrong', [row('a', 0, latest)]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/item/i);
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest, { a: Number.NaN })]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/quote/i);
  });

  it('is deterministic regardless of map and row order', () => {
    const first = makeRows(2, 3);
    const entries = [...first].reverse().map(([key, values]) => [key, [...values].reverse()] as const);
    expect(buildBackfillSnapshots(first, latest, { minimumHours: 2, minimumQuotes: 3 })).toEqual(buildBackfillSnapshots(new Map(entries), latest, { minimumHours: 2, minimumQuotes: 3 }));
  });

  it('rejects clustered timestamps and requires hourly span, while capping to 168 snapshots', () => {
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest), row('a', 1, latest + 1_000)]]]), latest + 1_000, { minimumHours: 2, minimumQuotes: 1 })).toThrow(/hour/i);
    const clustered = Array.from({ length: 150 }, (_, index) => row('a', 0, latest - 149_000 + index * 1_000));
    expect(() => buildBackfillSnapshots(new Map([['a', clustered]]), latest, { minimumHours: 150, minimumQuotes: 1 })).toThrow(/span|hour/i);
    const hourly = Array.from({ length: 169 }, (_, index) => row('a', 0, latest - index * HOUR));
    const result = buildBackfillSnapshots(new Map([['a', hourly]]), latest, { minimumHours: 1, minimumQuotes: 1 });
    expect(result).toHaveLength(168);
    expect(result[0]!.timestamp).toBe(latest - 167 * HOUR);
  });
});

describe('official overlap validation', () => {
  it('lets exact overlap succeed, counts fields, and makes official snapshot authoritative', () => {
    const imported = snapshot(latest, { a: 10, b: 9, p: 1, v: 2 });
    const official = snapshot(latest, { a: 10, b: 9, p: 99, v: 88 });
    const result = validateOfficialOverlap([imported, snapshot(latest - HOUR)], [official]);
    expect(result.comparisons).toBe(2);
    expect(result.snapshots).toEqual([snapshot(latest - HOUR), official]);
    expect(result.snapshots[1]).not.toBe(official);
  });

  it('accepts null/missing tolerance and rejects ask or bid mismatches', () => {
    expect(() => validateOfficialOverlap([snapshot(latest, { a: null, b: 9, p: null, v: null })], [snapshot(latest, { a: 10, b: 9, p: 2, v: 3 })])).not.toThrow();
    expect(() => validateOfficialOverlap([snapshot(latest, { a: 11, b: null, p: null, v: null })], [snapshot(latest, { a: 10, b: 9, p: 2, v: 3 })])).toThrow(/ask/i);
    expect(() => validateOfficialOverlap([snapshot(latest, { a: null, b: 8, p: null, v: null })], [snapshot(latest, { a: 10, b: 9, p: 2, v: 3 })])).toThrow(/bid/i);
  });

  it('rejects duplicate official timestamps and does not mutate input', () => {
    const imported = [snapshot(latest - HOUR), snapshot(latest)];
    const official = [snapshot(latest), snapshot(latest)];
    expect(() => validateOfficialOverlap(imported, official)).toThrow(/duplicate.*timestamp/i);
    const officialInput = [snapshot(latest)];
    const importedBefore = JSON.stringify(imported);
    const officialBefore = JSON.stringify(officialInput);
    validateOfficialOverlap(imported, officialInput);
    expect(JSON.stringify(imported)).toBe(importedBefore);
    expect(JSON.stringify(officialInput)).toBe(officialBefore);
    expect(() => validateOfficialOverlap([{ timestamp: 8_640_000_000_000_001, quotes: {} }], [])).toThrow(/timestamp/i);
    const poisonedQuotes = Object.create(null) as Record<string, Quote>;
    poisonedQuotes.__proto__ = { a: 1, b: 1, p: null, v: null };
    expect(() => validateOfficialOverlap([{ timestamp: latest, quotes: poisonedQuotes as Snapshot['quotes'] }], [])).toThrow(/key|quotes/i);
    expect(() => validateOfficialOverlap([{ timestamp: latest, quotes: { '/items/a::0': { a: Infinity, b: 1, p: null, v: null } } }], [])).toThrow(/quote/i);
    expect(() => validateOfficialOverlap([snapshot(latest), snapshot(latest)], [])).toThrow(/duplicate.*timestamp/i);
  });
});

const backfillDirs: string[] = [];
const BACKFILL_LATEST = Date.parse('2026-09-01T12:00:00.000Z');
const BACKFILL_GENERATED = '2026-09-01T12:10:00.000Z';
const BACKFILL_NOW = Date.parse(BACKFILL_GENERATED);
const MAX_DATE_MS = 8_640_000_000_000_000;

afterEach(async () => {
  await Promise.all(backfillDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function backfillDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mwi-stockmarket-backfill-'));
  backfillDirs.push(path);
  return path;
}

function stockmarketRows(hours = 150, keys = 1_000): Map<string, StockmarketHistoryPoint[]> {
  const start = BACKFILL_LATEST - (hours - 1) * HOUR;
  return new Map(Array.from({ length: keys }, (_, key) => {
    const itemName = `item_${String(key).padStart(4, '0')}`;
    return [itemName, Array.from({ length: hours }, (_, hour) => row(itemName, 0, start + hour * HOUR))];
  }));
}

function officialBackfillLatest(keys = 1_000): Snapshot {
  return {
    timestamp: BACKFILL_LATEST,
    quotes: Object.fromEntries(Array.from({ length: keys }, (_, key) => [
      `/items/item_${String(key).padStart(4, '0')}::0`,
      { a: 10, b: 9, p: 80, v: 70 },
    ])),
  };
}

async function seedBackfillLatest(dataDir: string): Promise<void> {
  await updateCloudHistory({
    dataDir,
    snapshot: officialBackfillLatest(),
    generatedAt: BACKFILL_GENERATED,
  });
}

async function dataBytes(dataDir: string): Promise<{
  manifest: string;
  daily: string | null;
  provenance: string | null;
  rootEntries: string[];
  snapshotFiles: Record<string, string>;
}> {
  const provenance = await readFile(join(dataDir, HISTORY_PROVENANCE_FILE), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const snapshotNames = await readdir(join(dataDir, 'snapshots'));
  return {
    manifest: await readFile(join(dataDir, 'manifest.json'), 'utf8'),
    daily: await readFile(join(dataDir, 'daily-history.txt'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
    provenance,
    rootEntries: (await readdir(dataDir)).sort(),
    snapshotFiles: Object.fromEntries(await Promise.all(snapshotNames.sort().map(async (name) => [
      name,
      await readFile(join(dataDir, 'snapshots', name), 'utf8'),
    ]))),
  };
}

describe('stockmarket backfill command', () => {
  it('imports a fixed seven-day window, makes the existing latest official snapshot authoritative, and publishes provenance', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    const client = { loadAll: vi.fn(async () => stockmarketRows()) };

    const result = await runStockmarketBackfill({
      dataDir,
      generatedAt: BACKFILL_GENERATED,
      client,
      now: () => BACKFILL_NOW,
    });

    expect(result).toMatchObject({ skipped: false, itemCount: 1_000, snapshotCount: 150, inserted: 149, overlapComparisons: 2_000 });
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error('unexpected skip');
    expect(result.fromTimestamp).toBe(BACKFILL_LATEST - 149 * HOUR);
    expect(result.toTimestamp).toBe(BACKFILL_LATEST);
    expect(client.loadAll).toHaveBeenCalledTimes(1);
    const manifest = parseManifest(JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')));
    expect(manifest.latestTimestamp).toBe(BACKFILL_LATEST);
    expect(manifest.snapshots).toHaveLength(150);
    const latestEntry = manifest.snapshots.at(-1);
    expect(latestEntry).toBeDefined();
    expect((await decodeDayChunk(await readFile(join(dataDir, latestEntry!.file), 'utf8')))[0]?.quotes['/items/item_0000::0'])
      .toEqual({ a: 10, b: 9, p: 80, v: 70 });
    expect(JSON.parse(await readFile(join(dataDir, HISTORY_PROVENANCE_FILE), 'utf8'))).toMatchObject({
      fetchedAt: BACKFILL_GENERATED,
      fromTimestamp: BACKFILL_LATEST - 149 * HOUR,
      toTimestamp: BACKFILL_LATEST,
      snapshotCount: 150,
      overlapComparisons: 2_000,
    });
  }, 30_000);

  it('skips a valid completed backfill before calling the client and leaves published bytes untouched', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    const before = await dataBytes(dataDir);
    const client = { loadAll: vi.fn(async () => { throw new Error('must not fetch'); }) };
    const createClient = vi.fn(() => client);

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, createClient, now: () => BACKFILL_NOW }))
      .resolves.toEqual({ skipped: true });
    expect(createClient).not.toHaveBeenCalled();
    expect(client.loadAll).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  }, 30_000);

  it('reconciles a missing provenance file with an idempotent merge and writes provenance with zero inserted snapshots', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    await rm(join(dataDir, HISTORY_PROVENANCE_FILE));

    const result = await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });

    expect(result).toMatchObject({ skipped: false, inserted: 0, snapshotCount: 150 });
    await expect(readFile(join(dataDir, HISTORY_PROVENANCE_FILE), 'utf8')).resolves.toContain('stockmarket-xin');
  }, 30_000);

  it.each([
    ['list', (dataDir: string): Partial<CloudFileSystem> => ({
      readdir: async () => { throw new Error('private listing failure'); },
    })],
    ['delete', (dataDir: string): Partial<CloudFileSystem> => ({
      readdir: async () => [`${BACKFILL_LATEST - 11 * 24 * HOUR}.txt`],
      unlink: async () => { throw new Error('private delete failure'); },
    })],
  ])('does not publish provenance when %s cleanup fails, then retries cleanup before completion', async (_kind, makeFileSystem) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    const expired = BACKFILL_LATEST - 11 * 24 * HOUR;
    await writeFile(join(dataDir, 'snapshots', `${expired}.txt`), await encodeDayChunk([snapshot(expired)]), 'utf8');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runStockmarketBackfill({
      dataDir,
      generatedAt: BACKFILL_GENERATED,
      client: { loadAll: async () => stockmarketRows() },
      now: () => BACKFILL_NOW,
      fileSystem: makeFileSystem(dataDir),
    })).rejects.toThrow('Stockmarket backfill cleanup failed');
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/private|\.txt|payload/i);
    error.mockRestore();
    await expect(readFile(join(dataDir, HISTORY_PROVENANCE_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(parseManifest(JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8'))).snapshots).toHaveLength(150);

    const recovered = await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });

    expect(recovered).toMatchObject({ skipped: false, inserted: 0, snapshotCount: 150 });
    await expect(readFile(join(dataDir, HISTORY_PROVENANCE_FILE), 'utf8')).resolves.toContain('stockmarket-xin');
    await expect(readFile(join(dataDir, 'snapshots', `${expired}.txt`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it.each([
    ['corrupt key', async (dataDir: string) => {
      const corrupted = { timestamp: BACKFILL_LATEST, quotes: { '/not-an-item': { a: 10, b: 9, p: 80, v: 70 } } };
      const text = await encodeDayChunk([corrupted]);
      const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as { snapshots: Array<{ timestamp: number; bytes: number }> };
      manifest.snapshots[0]!.bytes = Buffer.byteLength(text, 'utf8');
      await writeFile(join(dataDir, 'snapshots', `${BACKFILL_LATEST}.txt`), text, 'utf8');
      await writeFile(join(dataDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    }],
    ['out-of-range timestamp', async (dataDir: string) => {
      const timestamp = 8_640_000_000_000_001;
      const text = await encodeDayChunk([{ timestamp, quotes: officialBackfillLatest().quotes }]);
      await writeFile(join(dataDir, 'snapshots', `${timestamp}.txt`), text, 'utf8');
      await writeFile(join(dataDir, 'manifest.json'), JSON.stringify({
        schemaVersion: 1,
        generatedAt: BACKFILL_GENERATED,
        latestTimestamp: timestamp,
        snapshots: [{ timestamp, file: `snapshots/${timestamp}.txt`, bytes: Buffer.byteLength(text, 'utf8') }],
      }), 'utf8');
    }],
  ])('rejects a locally %s official snapshot before constructing or calling the client', async (_kind, corrupt) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await corrupt(dataDir);
    const before = await dataBytes(dataDir);
    const client = { loadAll: vi.fn(async () => stockmarketRows()) };
    const createClient = vi.fn(() => client);

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, createClient, now: () => BACKFILL_NOW }))
      .rejects.toThrow(/validation/i);
    expect(createClient).not.toHaveBeenCalled();
    expect(client.loadAll).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  });

  it('rejects a schema-valid provenance marker that ends after the manifest latest before client creation', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await writeFile(join(dataDir, HISTORY_PROVENANCE_FILE), `${JSON.stringify(createHistoryProvenance({
      fetchedAt: BACKFILL_GENERATED,
      fromTimestamp: BACKFILL_LATEST - 149 * HOUR,
      toTimestamp: BACKFILL_LATEST + HOUR,
      snapshotCount: 150,
      overlapComparisons: 0,
    }))}\n`, 'utf8');
    const before = await dataBytes(dataDir);
    const createClient = vi.fn(() => ({ loadAll: vi.fn(async () => stockmarketRows()) }));

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, createClient, now: () => BACKFILL_NOW }))
      .rejects.toThrow(/validation/i);
    expect(createClient).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  });

  it('keeps a valid completion marker after rolling retention prunes its original range', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    await updateCloudHistory({
      dataDir,
      snapshot: { ...officialBackfillLatest(), timestamp: BACKFILL_LATEST + 11 * 24 * HOUR },
      generatedAt: '2026-09-12T12:10:00.000Z',
    });
    const before = await dataBytes(dataDir);
    const client = { loadAll: vi.fn(async () => { throw new Error('must not fetch'); }) };
    const createClient = vi.fn(() => client);

    await expect(runStockmarketBackfill({ dataDir, generatedAt: '2026-09-12T12:11:00.000Z', createClient, now: () => Date.parse('2026-09-12T12:11:00.000Z') }))
      .resolves.toEqual({ skipped: true });
    expect(createClient).not.toHaveBeenCalled();
    expect(client.loadAll).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  }, 30_000);

  it('accepts a partial-aged marker when phase-shifted UTC hour buckets leave its adjusted count intact', async () => {
    const dataDir = await backfillDataDir();
    const fromTimestamp = Date.parse('2026-08-20T00:59:00.000Z');
    const cutoff = Date.parse('2026-08-20T01:30:00.000Z');
    const toTimestamp = fromTimestamp + 167 * HOUR;
    const latestTimestamp = cutoff + 10 * 24 * HOUR;
    const quote = { '/items/item_0000::0': { a: 10, b: 9, p: 8, v: 7 } };
    const retained = Array.from({ length: 147 }, (_, index) => ({ timestamp: cutoff + index * HOUR, quotes: quote }));
    await mergeCloudHistory({
      dataDir,
      snapshots: [...retained, { timestamp: toTimestamp, quotes: quote }, { timestamp: latestTimestamp, quotes: quote }],
      generatedAt: BACKFILL_GENERATED,
    });
    await writeFile(join(dataDir, HISTORY_PROVENANCE_FILE), `${JSON.stringify(createHistoryProvenance({
      fetchedAt: BACKFILL_GENERATED,
      fromTimestamp,
      toTimestamp,
      snapshotCount: 150,
      overlapComparisons: 1_000,
    }))}\n`, 'utf8');
    const before = await dataBytes(dataDir);
    const createClient = vi.fn(() => ({ loadAll: vi.fn(async () => stockmarketRows()) }));

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, createClient, now: () => BACKFILL_NOW }))
      .resolves.toEqual({ skipped: true });
    expect(createClient).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  });

  it.each([0, 999])('rejects a stored completion marker with only %i overlap comparisons before client creation', async (overlapComparisons) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    await writeFile(join(dataDir, HISTORY_PROVENANCE_FILE), `${JSON.stringify(createHistoryProvenance({
      fetchedAt: BACKFILL_GENERATED,
      fromTimestamp: BACKFILL_LATEST - 149 * HOUR,
      toTimestamp: BACKFILL_LATEST,
      snapshotCount: 150,
      overlapComparisons,
    }))}\n`, 'utf8');
    const before = await dataBytes(dataDir);
    const createClient = vi.fn(() => ({ loadAll: vi.fn(async () => stockmarketRows()) }));

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, createClient, now: () => BACKFILL_NOW }))
      .rejects.toThrow(/validation/i);
    expect(createClient).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  }, 30_000);

  it.each([
    ['missing retained to endpoint', async (dataDir: string) => {
      const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as { snapshots: Array<{ timestamp: number }> };
      manifest.snapshots = manifest.snapshots.filter((entry) => entry.timestamp !== BACKFILL_LATEST);
      await writeFile(join(dataDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    }],
    ['corrupt marker count', async (dataDir: string) => {
      await writeFile(join(dataDir, HISTORY_PROVENANCE_FILE), `${JSON.stringify(createHistoryProvenance({
        fetchedAt: BACKFILL_GENERATED,
        fromTimestamp: BACKFILL_LATEST - 149 * HOUR,
        toTimestamp: BACKFILL_LATEST,
        snapshotCount: 168,
        overlapComparisons: 2_000,
      }))}\n`, 'utf8');
    }],
    ['insufficient retained snapshots', async (dataDir: string) => {
      const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as { snapshots: Array<{ timestamp: number }> };
      manifest.snapshots = manifest.snapshots.filter((entry) => entry.timestamp !== BACKFILL_LATEST - HOUR);
      await writeFile(join(dataDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    }],
  ])('rejects partial-aged provenance with %s before client creation', async (_kind, corrupt) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    await updateCloudHistory({
      dataDir,
      snapshot: { ...officialBackfillLatest(), timestamp: BACKFILL_LATEST + 9 * 24 * HOUR },
      generatedAt: '2026-09-10T12:10:00.000Z',
    });
    await corrupt(dataDir);
    const before = await dataBytes(dataDir);
    const createClient = vi.fn(() => ({ loadAll: vi.fn(async () => stockmarketRows()) }));

    await expect(runStockmarketBackfill({ dataDir, generatedAt: '2026-09-10T12:11:00.000Z', createClient, now: () => Date.parse('2026-09-10T12:11:00.000Z') }))
      .rejects.toThrow(/validation/i);
    expect(createClient).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  }, 30_000);

  it.each([
    ['invalid generatedAt', { generatedAt: 'not-an-instant', now: () => BACKFILL_NOW }],
    ['invalid now', { generatedAt: BACKFILL_GENERATED, now: () => Number.NaN }],
    ['negative now', { generatedAt: BACKFILL_GENERATED, now: () => -1 }],
    ['out-of-range now', { generatedAt: BACKFILL_GENERATED, now: () => MAX_DATE_MS + 1 }],
  ])('rejects %s before client creation and preserves all immutable files', async (_kind, timing) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    const before = await dataBytes(dataDir);
    const createClient = vi.fn(() => ({ loadAll: vi.fn(async () => stockmarketRows()) }));

    await expect(runStockmarketBackfill({ dataDir, createClient, ...timing }))
      .rejects.toThrow(/validation/i);
    expect(createClient).not.toHaveBeenCalled();
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  });

  it('force refetches only the fixed <=168-snapshot latest window', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows(168) }, now: () => BACKFILL_NOW });
    const client = { loadAll: vi.fn(async () => stockmarketRows(168)) };

    const result = await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client, now: () => BACKFILL_NOW, force: true });

    expect(client.loadAll).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ snapshotCount: 168, inserted: 0 });
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error('unexpected skip');
    expect(result.toTimestamp - result.fromTimestamp).toBeLessThanOrEqual(167 * HOUR);
  }, 30_000);

  it.each([
    ['no latest timestamp', async () => {
      const rows = stockmarketRows();
      for (const values of rows.values()) values.forEach((value) => { value.timestamp -= HOUR; });
      return rows;
    }],
    ['disjoint latest keys', async () => {
      const rows = stockmarketRows();
      for (const values of rows.values()) values[149]!.level = 1;
      return rows;
    }],
  ])('rejects %s before merge or provenance publication', async (_kind, loadAll) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    const before = await dataBytes(dataDir);
    const client = { loadAll };

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client, now: () => BACKFILL_NOW }))
      .rejects.toThrow(/validation/i);
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  }, 30_000);

  it.each([
    ['client', async () => { throw new Error('profile secret'); }],
    ['schema', async () => {
      const rows = stockmarketRows();
      rows.get('item_0000')![0]!.timestamp = -1;
      return rows;
    }],
    ['sparse', async () => stockmarketRows(149)],
    ['overlap', async () => {
      const rows = stockmarketRows();
      rows.get('item_0000')![149]!.a = 999;
      return rows;
    }],
  ])('preserves published files when %s validation fails without leaking payload details', async (_kind, loadAll) => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    const before = await dataBytes(dataDir);
    const client = { loadAll };

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client, now: () => BACKFILL_NOW, force: true }))
      .rejects.toThrow(/backfill/i);
    await expect(dataBytes(dataDir)).resolves.toEqual(before);
  }, 30_000);

  it('cleans an in-data-dir provenance temp when the atomic rename fails after merge publication', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    const removed: string[] = [];
    const fileSystem: Partial<CloudFileSystem> = {
      rename: async (from, to) => {
        if (to.endsWith(HISTORY_PROVENANCE_FILE)) throw new Error('private failure');
        await rename(from, to);
      },
      unlink: async (path) => {
        removed.push(path);
        await rm(path, { force: true });
      },
    };

    await expect(runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW, fileSystem }))
      .rejects.toThrow(/provenance/i);
    const afterFailedPublish = await dataBytes(dataDir);
    expect(afterFailedPublish.provenance).toBeNull();
    expect(removed.some((path) => path.startsWith(dataDir) && path.includes('.history-provenance.json.tmp-'))).toBe(true);
    const recovered = await runStockmarketBackfill({ dataDir, generatedAt: BACKFILL_GENERATED, client: { loadAll: async () => stockmarketRows() }, now: () => BACKFILL_NOW });
    expect(recovered).toMatchObject({ skipped: false, inserted: 0, snapshotCount: 150 });
    const recoveredBytes = await dataBytes(dataDir);
    expect({
      ...recoveredBytes,
      provenance: null,
      rootEntries: recoveredBytes.rootEntries.filter((entry) => entry !== HISTORY_PROVENANCE_FILE),
    }).toEqual(afterFailedPublish);
    expect(JSON.parse(recoveredBytes.provenance!)).toMatchObject({ snapshotCount: 150, sourceId: 'stockmarket-xin' });
  }, 30_000);

  it('accepts only required data-dir and optional force with safe fixed errors', () => {
    expect(parseBackfillArgs(['--data-dir', 'cloud-data'])).toEqual({ dataDir: 'cloud-data', force: false });
    expect(parseBackfillArgs(['--data-dir', 'cloud-data', '--force'])).toEqual({ dataDir: 'cloud-data', force: true });
    expect(parseBackfillArgs(['--force', '--data-dir', 'cloud-data'])).toEqual({ dataDir: 'cloud-data', force: true });
    for (const args of [[], ['--data-dir'], ['--data-dir', ''], ['--data-dir', 'x', '--data-dir', 'y'], ['--force', '--force', '--data-dir', 'x'], ['--origin', 'x'], ['--start', 'x'], ['--end', 'x']]) {
      expect(() => parseBackfillArgs(args)).toThrow(/Invalid stockmarket backfill arguments/);
    }
  });

  it('prints only a fixed safe CLI error when a client failure contains a payload secret', async () => {
    const dataDir = await backfillDataDir();
    await seedBackfillLatest(dataDir);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runBackfillCli(['--data-dir', dataDir], {
      client: { loadAll: async () => { throw new Error('profile secret payload'); } },
      now: () => BACKFILL_NOW,
    })).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith('Stockmarket backfill fetch failed');
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/profile secret|payload/i);
    error.mockRestore();
  });
});
