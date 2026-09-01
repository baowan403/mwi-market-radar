import type { Page } from '@playwright/test';
import { createManifest, type CloudManifest, type CloudSnapshotEntry } from '../src/cloud/manifest';
import { encodeDayChunk } from '../src/core/storage-codec';
import type { MarketKey, Quote, Snapshot } from '../src/core/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface CloudFixtureOptions {
  latestTimestamp?: number;
  corruptTimestamp?: number | null;
  stale?: boolean;
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

function createSnapshot(timestamp: number, offset: number, latest: boolean): Snapshot {
  const quotes: Snapshot['quotes'] = {
    [marketKey('/items/chrono_gloves', 7)]: quote(100 + offset, 60),
    [marketKey('/items/chrono_gloves', 10)]: quote(105 + offset, 30),
    [marketKey('/items/cowbell', 0)]: quote(50 + offset, 2),
    [marketKey('/items/apple', 0)]: latest ? quote(null, 20, 42, null) : quote(30 + offset, 20),
    [marketKey('/items/coin', 0)]: quote(200 + offset, 15),
  };

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

  for (let index = 24; index >= 0; index -= 1) {
    const timestamp = latestTimestamp - index * HOUR;
    const current = createSnapshot(timestamp, 24 - index, index === 0);
    const encoded = await encodeDayChunk([current]);
    const file = `snapshots/${timestamp}.txt` as `snapshots/${number}.txt`;
    snapshots.push(current);
    files.set(file, encoded);
    entries.push({ timestamp, file, bytes: Buffer.byteLength(encoded, 'utf8') });
  }
  currentManifest = createManifest(entries, new Date(latestTimestamp + 60_000));

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
        if (!url.pathname.endsWith('/manifest.json') && !url.pathname.includes('/data/snapshots/')) {
          await route.continue();
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
      const current = createSnapshot(timestamp, snapshots.length, true);
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
