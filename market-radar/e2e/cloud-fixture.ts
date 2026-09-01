import type { Page } from '@playwright/test';
import { createManifest, type CloudManifest, type CloudSnapshotEntry } from '../src/cloud/manifest';
import { encodeDayChunk } from '../src/core/storage-codec';
import { aggregateDailySummary } from '../src/cloud/daily-summary';
import { createDailyHistoryPack, encodeDailyHistoryPack } from '../src/cloud/daily-history';
import { createHistoryProvenance } from '../src/cloud/provenance';
import type { MarketKey, Quote, Snapshot } from '../src/core/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface CloudFixtureOptions {
  latestTimestamp?: number;
  corruptTimestamp?: number | null;
  stale?: boolean;
  strategyQuotes?: boolean;
  historyHours?: number;
  historyProvenance?: boolean;
  dailyHistoryDays?: number;
}

export interface CloudFixture {
  readonly snapshots: Snapshot[];
  readonly manifest: CloudManifest;
  readonly manifestFetches: number;
  readonly snapshotFetches: number;
  install(page: Page): Promise<void>;
  advance(): Promise<void>;
  setCorrupt(timestamp: number | null): void;
}

function marketKey(itemHrid: string, level: number): MarketKey {
  return `${itemHrid}::${level}` as MarketKey;
}

function quote(price: number | null, volume: number | null, ask = price === null ? null : price + 2, bid = price === null ? null : price - 2): Quote {
  return { a: ask, b: bid, p: price, v: volume };
}

function createSnapshot(timestamp: number, offset: number, latest: boolean, strategyQuotes = false): Snapshot {
  const quotes: Snapshot['quotes'] = {
    [marketKey('/items/chrono_gloves', 7)]: quote(100 + offset, 60),
    [marketKey('/items/chrono_gloves', 10)]: quote(105 + offset, 30),
    [marketKey('/items/cowbell', 0)]: quote(50 + offset, 2),
    [marketKey('/items/apple', 0)]: latest ? quote(null, 20, 42, null) : quote(30 + offset, 20),
    [marketKey('/items/coin', 0)]: quote(200 + offset, 15),
  };

  if (strategyQuotes) {
    Object.assign(quotes, {
      [marketKey('/items/redwood_log', 0)]: quote(95 + offset, 10_000, 100 + offset, 90 + offset),
      [marketKey('/items/redwood_lumber', 0)]: quote(310 + offset, 5_000, 320 + offset, 300 + offset),
      [marketKey('/items/ginkgo_bow', 0)]: quote(24_000, 800, 25_000, 23_000),
      [marketKey('/items/redwood_bow', 0)]: quote(57_500, 500, 60_000, 55_000),
      [marketKey('/items/crafting_essence', 0)]: quote(1_050, 1_000, 1_100, 1_000),
      [marketKey('/items/branch_of_insight', 0)]: quote(1_050_000, 10, 1_100_000, 1_000_000),
      [marketKey('/items/medium_artisans_crate', 0)]: quote(525_000, 50, 550_000, 500_000),
      [marketKey('/items/large_artisans_crate', 0)]: quote(1_050_000, 100, 1_100_000, 1_000_000),
      [marketKey('/items/pirate_refinement_shard', 0)]: quote(215_000, 100, 220_000, 210_000),
      [marketKey('/items/pirate_essence', 0)]: quote(675, 100_000, 700, 650),
      [marketKey('/items/catalyst_of_decomposition', 0)]: quote(9_500, 1_000, 10_000, 9_000),
      [marketKey('/items/catalyst_of_coinification', 0)]: quote(10_500, 1_000, 11_000, 10_000),
      [marketKey('/items/prime_catalyst', 0)]: quote(19_500, 1_000, 20_000, 19_000),
      [marketKey('/items/ultra_alchemy_tea', 0)]: quote(4_750, 1_000, 5_000, 4_500),
      [marketKey('/items/efficiency_tea', 0)]: quote(1_900, 1_000, 2_000, 1_800),
      [marketKey('/items/catalytic_tea', 0)]: quote(2_900, 1_000, 3_000, 2_800),
      [marketKey('/items/alchemy_essence', 0)]: quote(1_900, 10_000, 2_000, 1_800),
    });
  }

  if (latest) {
    quotes[marketKey('/items/unknown_item', 0)] = quote(null, null, null, null);
    for (let level = 1; level <= 300; level += 1) {
      quotes[marketKey('/items/coin', level)] = quote(200 + level + offset, 10 + level);
    }
  }

  return { timestamp, quotes };
}

export async function createCloudFixture(options: CloudFixtureOptions = {}): Promise<CloudFixture> {
  const currentHour = Math.floor(Date.now() / HOUR) * HOUR;
  const latestTimestamp = options.latestTimestamp
    ?? (options.stale ? currentHour - 3 * HOUR : currentHour);
  const snapshots: Snapshot[] = [];
  const files = new Map<string, string>();
  const entries: CloudSnapshotEntry[] = [];
  let manifestFetches = 0;
  let snapshotFetches = 0;
  let corruptTimestamp = options.corruptTimestamp ?? null;
  let currentManifest: CloudManifest;
  const historyHours = Number.isSafeInteger(options.historyHours) && (options.historyHours ?? 0) >= 1
    ? options.historyHours!
    : 24;
  const dailyHistoryDays = Number.isSafeInteger(options.dailyHistoryDays) && (options.dailyHistoryDays ?? 0) > 0
    ? options.dailyHistoryDays!
    : 0;

  for (let index = historyHours; index >= 0; index -= 1) {
    const timestamp = latestTimestamp - index * HOUR;
    const current = createSnapshot(timestamp, historyHours - index, index === 0, options.strategyQuotes === true);
    const encoded = await encodeDayChunk([current]);
    const file = `snapshots/${timestamp}.txt` as `snapshots/${number}.txt`;
    snapshots.push(current);
    files.set(file, encoded);
    entries.push({ timestamp, file, bytes: Buffer.byteLength(encoded, 'utf8') });
  }
  currentManifest = createManifest(entries, new Date(latestTimestamp + 60_000));
  const hourlyStart = latestTimestamp - historyHours * HOUR;
  const dailyHistoryText = dailyHistoryDays === 0
    ? ''
    : await encodeDailyHistoryPack(createDailyHistoryPack(
      Array.from({ length: dailyHistoryDays }, (_, index) => {
        const timestamp = hourlyStart - (dailyHistoryDays - index) * DAY;
        return aggregateDailySummary([
          createSnapshot(timestamp, index, false, options.strategyQuotes === true),
        ]);
      }),
      new Date(latestTimestamp + 60_000).toISOString(),
    ));
  const firstHourlyTimestamp = currentManifest.snapshots[0]?.timestamp ?? latestTimestamp;
  const historyProvenanceText = options.historyProvenance === true
    ? JSON.stringify(createHistoryProvenance({
      fetchedAt: new Date(latestTimestamp + 60_000).toISOString(),
      fromTimestamp: firstHourlyTimestamp,
      toTimestamp: latestTimestamp,
      snapshotCount: currentManifest.snapshots.length,
      overlapComparisons: 1,
    }))
    : '';

  const fulfillText = async (route: Parameters<Parameters<Page['route']>[1]>[0], body: string, contentType: string): Promise<void> => {
    const bytes = Buffer.byteLength(body, 'utf8');
    await route.fulfill({
      status: 200,
      body,
      headers: {
        'cache-control': 'no-store',
        'content-length': String(bytes),
        'content-type': contentType,
      },
    });
  };

  const fixture: CloudFixture = {
    get snapshots() {
      return snapshots;
    },
    get manifest() {
      return currentManifest;
    },
    get manifestFetches() {
      return manifestFetches;
    },
    get snapshotFetches() {
      return snapshotFetches;
    },
    async install(page: Page): Promise<void> {
      await page.route('**/data/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/history-provenance.json')) {
          if (historyProvenanceText.length === 0) {
            await route.fulfill({ status: 404, body: 'not found' });
            return;
          }
          await fulfillText(route, historyProvenanceText, 'application/json');
          return;
        }
        if (url.pathname.endsWith('/daily-history.txt')) {
          await route.fulfill({ status: 200, body: dailyHistoryText, contentType: 'text/plain' });
          return;
        }
        if (!url.pathname.endsWith('/manifest.json') && !url.pathname.includes('/data/snapshots/')) {
          await route.fulfill({ status: 404, body: 'not found' });
          return;
        }
        if (url.pathname.endsWith('/manifest.json')) {
          manifestFetches += 1;
          await fulfillText(route, JSON.stringify(currentManifest), 'application/json');
          return;
        }

        const file = decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/data/') + '/data/'.length));
        const timestampMatch = /^snapshots\/(\d+)\.txt$/.exec(file);
        if (!timestampMatch) {
          await route.fulfill({ status: 404, body: 'not found' });
          return;
        }
        snapshotFetches += 1;
        const timestamp = Number(timestampMatch[1]);
        if (timestamp === corruptTimestamp) {
          await fulfillText(route, 'mwi-radar:gzip-json:v1:corrupt', 'text/plain');
          return;
        }
        const body = files.get(file);
        if (body === undefined) {
          await route.fulfill({ status: 404, body: 'not found' });
          return;
        }
        await fulfillText(route, body, 'text/plain');
      });
    },
    async advance(): Promise<void> {
      const previous = currentManifest.latestTimestamp;
      if (previous === null) return;
      const timestamp = previous + HOUR;
      const current = createSnapshot(timestamp, snapshots.length, true, options.strategyQuotes === true);
      const encoded = await encodeDayChunk([current]);
      const file = `snapshots/${timestamp}.txt` as `snapshots/${number}.txt`;
      snapshots.push(current);
      files.set(file, encoded);
      currentManifest = createManifest([
        ...currentManifest.snapshots,
        { timestamp, file, bytes: Buffer.byteLength(encoded, 'utf8') },
      ], new Date(timestamp + 60_000));
    },
    setCorrupt(timestamp: number | null): void {
      corruptTimestamp = timestamp;
    },
  };

  return fixture;
}
