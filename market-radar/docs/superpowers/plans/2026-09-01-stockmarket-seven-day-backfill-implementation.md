# Stockmarket Seven-Day Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill the public Market Radar with one authorized, provenance-labelled set of up to 168 hourly stockmarket.xin snapshots, then continue exclusively from official MWI hourly collection.

**Architecture:** A fixed-origin Node client fetches the public item index and per-item hourly history with bounded concurrency, converts deterministic rows into existing `Snapshot` objects, validates density and exact overlap against official snapshots, and atomically publishes the retained manifest in the temporary `market-data` worktree. A separate strict provenance file is optional for old deployments but mandatory for this backfill, and the dashboard projects it into the existing source label without adding a new page.

**Tech Stack:** TypeScript, Node.js 22 fetch, Vitest, existing gzip/base64 cloud codec, GitHub Actions, Vite, Playwright.

---

## File map

- Create `src/backfill/stockmarket-schema.ts`: strict public API parsing and sentinel normalization.
- Create `src/backfill/stockmarket-client.ts`: fixed-origin fetching, bounded concurrency, timeout, retry, and delay.
- Create `src/backfill/stockmarket-backfill.ts`: deterministic timestamp aggregation, density gates, overlap validation, and merge orchestration.
- Create `src/cloud/provenance.ts`: strict history provenance schema and codec.
- Create `scripts/backfill-stockmarket-history.ts`: one-shot CLI for the temporary data worktree.
- Create `tests/stockmarket-schema.test.ts`, `tests/stockmarket-client.test.ts`, `tests/stockmarket-backfill.test.ts`, and `tests/cloud-provenance.test.ts`.
- Modify `src/cloud/history-store.ts`: bulk insertion of older immutable snapshots and completed-day rebuild.
- Modify `src/dashboard/cloud-client.ts`, `src/dashboard/hybrid-client.ts`, and `src/dashboard/status.ts`: optional provenance load and source label projection.
- Modify `tests/cloud-history-store.test.ts`, `tests/cloud-client.test.ts`, `tests/cloud-dashboard.test.ts`, and `e2e/cloud-dashboard.spec.ts`.
- Modify `scripts/update-cloud-history.ts`, `package.json`, `.github/workflows/market-radar-pages.yml`, `docs/cloud-operations.md`, `docs/cloud-deployment-checklist.md`, `README.md`, and `THIRD_PARTY_NOTICES.md`.

### Task 1: Parse stockmarket.xin public responses

**Files:**
- Create: `src/backfill/stockmarket-schema.ts`
- Create: `tests/stockmarket-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseStockmarketHistory, parseStockmarketItemNames } from '../src/backfill/stockmarket-schema';

describe('stockmarket.xin schema', () => {
  it('deduplicates and sorts item names from latest-status', () => {
    expect(parseStockmarketItemNames({ item: null, data: [
      { item_name: 'redwood_lumber' },
      { item_name: 'arcane_log' },
      { item_name: 'redwood_lumber' },
    ] })).toEqual(['arcane_log', 'redwood_lumber']);
  });

  it('normalizes seconds, levels, and negative sentinels without inventing volume', () => {
    expect(parseStockmarketHistory({ item: 'redwood_lumber', level: 0, history: [{
      item_name: 'redwood_lumber', level: 7, price_a: -1, price_b: 3820,
      price_p: -1, volume: 0, timestamp: 1788271560,
      timestamp_str: '2026-09-01T22:06:00+08:00',
    }] }, 'redwood_lumber')).toEqual([{
      itemName: 'redwood_lumber', level: 7, timestamp: 1788271560000,
      a: null, b: 3820, p: null, v: null,
    }]);
  });

  it('rejects unsafe names, mismatched items, and invalid timestamps', () => {
    expect(() => parseStockmarketItemNames({ data: [{ item_name: '../secret' }] })).toThrow();
    expect(() => parseStockmarketHistory({ history: [{
      item_name: 'arcane_log', level: 0, price_a: 1, price_b: 1,
      price_p: 1, volume: 1, timestamp: 1788271560,
    }] }, 'redwood_lumber')).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run tests/stockmarket-schema.test.ts`

Expected: FAIL because `src/backfill/stockmarket-schema.ts` does not exist.

- [ ] **Step 3: Implement the strict parser**

```ts
import type { Quote } from '../core/types';

export interface StockmarketHistoryPoint extends Quote {
  itemName: string;
  level: number;
  timestamp: number;
}

const SAFE_ITEM = /^[a-z0-9_]+$/;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stockmarket data');
  return value as Record<string, unknown>;
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseStockmarketItemNames(value: unknown): string[] {
  const data = record(value).data;
  if (!Array.isArray(data)) throw new Error('Invalid stockmarket item list');
  const names = data.map((raw) => String(record(raw).item_name ?? ''));
  if (names.some((name) => !SAFE_ITEM.test(name))) throw new Error('Invalid stockmarket item name');
  return [...new Set(names)].sort();
}

export function parseStockmarketHistory(value: unknown, expectedItem: string): StockmarketHistoryPoint[] {
  if (!SAFE_ITEM.test(expectedItem)) throw new Error('Invalid stockmarket item name');
  const history = record(value).history;
  if (!Array.isArray(history)) throw new Error('Invalid stockmarket history');
  return history.map((raw) => {
    const row = record(raw);
    if (row.item_name !== expectedItem) throw new Error('Stockmarket item mismatch');
    if (!Number.isSafeInteger(row.level) || (row.level as number) < 0) throw new Error('Invalid stockmarket level');
    if (!Number.isSafeInteger(row.timestamp) || (row.timestamp as number) < 0) throw new Error('Invalid stockmarket timestamp');
    const a = nonnegative(row.price_a);
    const b = nonnegative(row.price_b);
    const p = nonnegative(row.price_p);
    const rawVolume = nonnegative(row.volume);
    return {
      itemName: expectedItem,
      level: row.level as number,
      timestamp: (row.timestamp as number) * 1_000,
      a, b, p,
      v: a === null && b === null && p === null && rawVolume === 0 ? null : rawVolume,
    };
  });
}
```

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run: `npm test -- --run tests/stockmarket-schema.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the parser**

```bash
git add market-radar/src/backfill/stockmarket-schema.ts market-radar/tests/stockmarket-schema.test.ts
git commit -m "feat: parse stockmarket history safely"
```

### Task 2: Fetch with bounded concurrency and retry

**Files:**
- Create: `src/backfill/stockmarket-client.ts`
- Create: `tests/stockmarket-client.test.ts`

- [ ] **Step 1: Write failing client tests with an injected fetcher and clock**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createStockmarketClient } from '../src/backfill/stockmarket-client';

describe('stockmarket client', () => {
  it('uses only the fixed HTTPS origin and limit 200', async () => {
    const fetcher = vi.fn(async (input: string | URL) => new Response(
      String(input).endsWith('/api/latest-status')
        ? JSON.stringify({ data: [{ item_name: 'redwood_lumber' }] })
        : JSON.stringify({ history: [] }),
      { status: 200 },
    ));
    const client = createStockmarketClient({ fetcher, sleep: async () => undefined });
    await expect(client.loadAll()).resolves.toEqual(new Map([['redwood_lumber', []]]));
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      'https://www.stockmarket.xin/api/latest-status',
      'https://www.stockmarket.xin/api/item/redwood_lumber/history?limit=200',
    ]);
  });

  it('never exceeds four in-flight item requests', async () => {
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('/api/latest-status')) {
        return new Response(JSON.stringify({ data: Array.from({ length: 12 }, (_, i) => ({ item_name: `item_${i}` })) }));
      }
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return new Response(JSON.stringify({ history: [] }));
    });
    await createStockmarketClient({ fetcher, sleep: async () => undefined }).loadAll();
    expect(maximum).toBeLessThanOrEqual(4);
  });

  it('retries only transient statuses and stops after three retries', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ item_name: 'redwood_lumber' }] })))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ history: [] }), { status: 200 }));
    await createStockmarketClient({ fetcher, sleep: async () => undefined }).loadAll();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run tests/stockmarket-client.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the fixed-origin client**

```ts
import { parseStockmarketHistory, parseStockmarketItemNames, type StockmarketHistoryPoint } from './stockmarket-schema';

const ORIGIN = 'https://www.stockmarket.xin';
const RETRYABLE = new Set([429, 502, 503, 504]);

export function createStockmarketClient(options: {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  concurrency?: number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 4));

  const request = async (path: string): Promise<unknown> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetcher(new URL(path, ORIGIN), {
        headers: { 'User-Agent': 'mwi-market-radar-authorized-backfill/1' },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return response.json();
      if (!RETRYABLE.has(response.status) || attempt === 3) throw new Error('Stockmarket request failed');
      await sleep(500 * (attempt + 1));
    }
    throw new Error('Stockmarket request failed');
  };

  return {
    async loadAll(): Promise<Map<string, StockmarketHistoryPoint[]>> {
      const names = parseStockmarketItemNames(await request('/api/latest-status'));
      const result = new Map<string, StockmarketHistoryPoint[]>();
      let cursor = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (cursor < names.length) {
          const name = names[cursor++]!;
          const raw = await request(`/api/item/${encodeURIComponent(name)}/history?limit=200`);
          result.set(name, parseStockmarketHistory(raw, name));
          await sleep(100);
        }
      }));
      return new Map([...result].sort(([left], [right]) => left.localeCompare(right)));
    },
  };
}
```

- [ ] **Step 4: Run the client tests and verify GREEN**

Run: `npm test -- --run tests/stockmarket-client.test.ts`

Expected: 3 tests pass with maximum concurrency 4.

- [ ] **Step 5: Commit the client**

```bash
git add market-radar/src/backfill/stockmarket-client.ts market-radar/tests/stockmarket-client.test.ts
git commit -m "feat: fetch authorized market history"
```

### Task 3: Aggregate seven days and reject unsafe history

**Files:**
- Create: `src/backfill/stockmarket-backfill.ts`
- Create: `tests/stockmarket-backfill.test.ts`

- [ ] **Step 1: Write failing aggregation and overlap tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildBackfillSnapshots, validateOfficialOverlap } from '../src/backfill/stockmarket-backfill';

const latest = 1_788_271_560_000;

describe('stockmarket seven-day backfill', () => {
  it('aggregates sorted levels at the original hourly timestamp', () => {
    const rows = new Map([['redwood_lumber', [
      { itemName: 'redwood_lumber', level: 7, timestamp: latest, a: 10, b: 9, p: 9, v: 2 },
      { itemName: 'redwood_lumber', level: 0, timestamp: latest, a: 4, b: 3, p: 3, v: 5 },
    ]]]);
    expect(buildBackfillSnapshots(rows, latest, { minimumHours: 1, minimumQuotes: 2 })).toEqual([{
      timestamp: latest,
      quotes: {
        '/items/redwood_lumber::0': { a: 4, b: 3, p: 3, v: 5 },
        '/items/redwood_lumber::7': { a: 10, b: 9, p: 9, v: 2 },
      },
    }]);
  });

  it('rejects sparse history and future rows', () => {
    expect(() => buildBackfillSnapshots(new Map(), latest)).toThrow(/150/);
    const future = new Map([['redwood_lumber', [
      { itemName: 'redwood_lumber', level: 0, timestamp: latest + 3_600_000, a: 1, b: 1, p: 1, v: 1 },
    ]]]);
    expect(() => buildBackfillSnapshots(future, latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/future/i);
  });

  it('keeps official overlap and rejects a real bid or ask mismatch', () => {
    const imported = { timestamp: latest, quotes: { '/items/redwood_lumber::0': { a: 4, b: 3, p: null, v: null } } };
    const official = { timestamp: latest, quotes: { '/items/redwood_lumber::0': { a: 4, b: 3, p: 3, v: 0 } } };
    expect(validateOfficialOverlap([imported], [official]).snapshots).toEqual([official]);
    expect(() => validateOfficialOverlap([
      { ...imported, quotes: { '/items/redwood_lumber::0': { a: 5, b: 3, p: null, v: null } } },
    ], [official])).toThrow(/overlap/i);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run tests/stockmarket-backfill.test.ts`

Expected: FAIL because aggregation functions do not exist.

- [ ] **Step 3: Implement deterministic aggregation and official precedence**

```ts
import type { MarketKey, Snapshot } from '../core/types';
import type { StockmarketHistoryPoint } from './stockmarket-schema';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

export function buildBackfillSnapshots(
  rowsByItem: ReadonlyMap<string, readonly StockmarketHistoryPoint[]>,
  latestOfficialTimestamp: number,
  gates = { minimumHours: 150, minimumQuotes: 1_000 },
): Snapshot[] {
  const byTimestamp = new Map<number, Map<MarketKey, StockmarketHistoryPoint>>();
  for (const [itemName, rows] of [...rowsByItem].sort(([a], [b]) => a.localeCompare(b))) {
    for (const row of [...rows].sort((a, b) => a.timestamp - b.timestamp || a.level - b.level)) {
      if (row.timestamp > latestOfficialTimestamp) throw new Error('Stockmarket history contains future data');
      if (row.timestamp < latestOfficialTimestamp - SEVEN_DAYS_MS) continue;
      const quoteMap = byTimestamp.get(row.timestamp) ?? new Map();
      quoteMap.set(`/items/${itemName}::${row.level}` as MarketKey, row);
      byTimestamp.set(row.timestamp, quoteMap);
    }
  }
  const snapshots = [...byTimestamp].sort(([a], [b]) => a - b).map(([timestamp, rows]) => ({
    timestamp,
    quotes: Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [
      key, { a: row.a, b: row.b, p: row.p, v: row.v },
    ])),
  })) as Snapshot[];
  if (snapshots.length < gates.minimumHours) throw new Error(`Stockmarket backfill requires ${gates.minimumHours} hours`);
  if (snapshots.some((snapshot) => Object.keys(snapshot.quotes).length < gates.minimumQuotes)) {
    throw new Error(`Stockmarket backfill requires ${gates.minimumQuotes} quotes per hour`);
  }
  return snapshots;
}

export function validateOfficialOverlap(imported: readonly Snapshot[], official: readonly Snapshot[]) {
  const officialByTime = new Map(official.map((snapshot) => [snapshot.timestamp, snapshot]));
  let comparisons = 0;
  const snapshots = imported.map((snapshot) => {
    const authority = officialByTime.get(snapshot.timestamp);
    if (!authority) return snapshot;
    for (const [key, quote] of Object.entries(snapshot.quotes)) {
      const expected = authority.quotes[key as MarketKey];
      if (!expected) continue;
      if (quote.a !== null && expected.a !== null && quote.a !== expected.a) throw new Error('Stockmarket overlap ask mismatch');
      if (quote.b !== null && expected.b !== null && quote.b !== expected.b) throw new Error('Stockmarket overlap bid mismatch');
      comparisons += 1;
    }
    return authority;
  });
  return { snapshots, comparisons };
}
```

- [ ] **Step 4: Run aggregation tests and verify GREEN**

Run: `npm test -- --run tests/stockmarket-backfill.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the aggregation boundary**

```bash
git add market-radar/src/backfill/stockmarket-backfill.ts market-radar/tests/stockmarket-backfill.test.ts
git commit -m "feat: build safe seven-day snapshots"
```

### Task 4: Bulk-merge older snapshots into cloud history

**Files:**
- Modify: `src/cloud/history-store.ts`
- Modify: `tests/cloud-history-store.test.ts`

- [ ] **Step 1: Add a failing bulk merge test**

```ts
it('bulk merges older snapshots, preserves official duplicates, and is idempotent', async () => {
  const dataDir = 'cloud-data';
  const latest = snapshot(LATEST, 900);
  await updateCloudHistory({ dataDir, snapshot: latest, generatedAt: GENERATED, fileSystem: adapter });
  const older = snapshot(LATEST - 2 * HOUR, 100);
  const first = await mergeCloudHistory({
    dataDir, snapshots: [older, latest], generatedAt: GENERATED, fileSystem: adapter,
  });
  const firstManifest = adapter.values.get(`${dataDir}/manifest.json`);
  const second = await mergeCloudHistory({
    dataDir, snapshots: [older, latest], generatedAt: GENERATED, fileSystem: adapter,
  });
  expect(first.inserted).toBe(1);
  expect(second.inserted).toBe(0);
  expect(adapter.values.get(`${dataDir}/manifest.json`)).toBe(firstManifest);
  expect(first.manifest.snapshots.map((entry) => entry.timestamp)).toEqual([older.timestamp, latest.timestamp]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run tests/cloud-history-store.test.ts`

Expected: FAIL because `mergeCloudHistory` is not exported.

- [ ] **Step 3: Implement `mergeCloudHistory` by reusing immutable file and manifest helpers**

```ts
export interface MergeCloudHistoryOptions {
  dataDir: string;
  snapshots: readonly Snapshot[];
  generatedAt: ManifestGeneratedAt;
  fileSystem?: Partial<CloudFileSystem>;
}

export async function mergeCloudHistory(options: MergeCloudHistoryOptions) {
  const fileSystem: CloudFileSystem = { ...defaultFileSystem, ...(options.fileSystem ?? {}) };
  await fileSystem.mkdir(options.dataDir, { recursive: true });
  await fileSystem.mkdir(snapshotsDir(options.dataDir), { recursive: true });
  const previous = await readCurrentManifest(options.dataDir, options.generatedAt, fileSystem);
  const existing = new Map(previous.snapshots.map((entry) => [entry.timestamp, entry]));
  let inserted = 0;
  for (const snapshot of [...options.snapshots].sort((a, b) => a.timestamp - b.timestamp)) {
    const encoded = await encodeSnapshot(snapshot);
    const file = await ensureImmutableSnapshotFile(options.dataDir, snapshot, encoded, fileSystem);
    const entry = existing.get(snapshot.timestamp);
    if (entry && entry.bytes !== file.bytes) throw mismatchError();
    if (!entry) {
      existing.set(snapshot.timestamp, {
        timestamp: snapshot.timestamp,
        file: relativeSnapshotPath(snapshot.timestamp),
        bytes: file.bytes,
      });
      inserted += 1;
    }
  }
  const next = createManifest([...existing.values()], options.generatedAt);
  if (inserted > 0) await publishManifest(options.dataDir, next, fileSystem);
  const latestSnapshot = options.snapshots.find((snapshot) => snapshot.timestamp === next.latestTimestamp);
  if (latestSnapshot) await rebuildCurrentDailyHistory(options.dataDir, latestSnapshot, next, fileSystem);
  const cleanupErrors = await pruneSnapshotFiles(options.dataDir, next, fileSystem);
  return { inserted, manifest: next, cleanupErrors };
}
```

- [ ] **Step 4: Run cloud history tests and verify GREEN**

Run: `npm test -- --run tests/cloud-history-store.test.ts`

Expected: all cloud history tests pass, including deterministic second-run hashes.

- [ ] **Step 5: Commit bulk merge support**

```bash
git add market-radar/src/cloud/history-store.ts market-radar/tests/cloud-history-store.test.ts
git commit -m "feat: merge historical cloud snapshots"
```

### Task 5: Persist and display strict provenance

**Files:**
- Create: `src/cloud/provenance.ts`
- Create: `tests/cloud-provenance.test.ts`
- Modify: `src/dashboard/cloud-client.ts`
- Modify: `src/dashboard/hybrid-client.ts`
- Modify: `src/dashboard/status.ts`
- Modify: `tests/cloud-client.test.ts`
- Modify: `tests/cloud-dashboard.test.ts`

- [ ] **Step 1: Write failing provenance codec and dashboard tests**

```ts
it('round-trips authorized stockmarket provenance', () => {
  const value = createHistoryProvenance({
    fetchedAt: '2026-09-01T15:00:00.000Z',
    fromTimestamp: 1787666760000,
    toTimestamp: 1788271560000,
    snapshotCount: 168,
    overlapComparisons: 6_188,
  });
  expect(parseHistoryProvenance(JSON.parse(JSON.stringify(value)))).toEqual(value);
});

it('renders distinct historical and live sources', () => {
  renderDataSource(target, {
    source: 'cloud', latestTimestamp: 1788271560000,
    generatedAt: '2026-09-01T15:00:00.000Z', stale: false,
    historySourceLabel: '牛牛股市',
  });
  expect(target.querySelector('[data-source-label]')?.textContent)
    .toBe('歷史回填：牛牛股市；最新行情：MWI 官方');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run tests/cloud-provenance.test.ts tests/cloud-client.test.ts tests/cloud-dashboard.test.ts`

Expected: FAIL because provenance types and source-label projection do not exist.

- [ ] **Step 3: Implement the strict provenance schema**

```ts
export interface HistoryProvenance {
  schemaVersion: 1;
  sourceId: 'stockmarket-xin';
  sourceLabel: '牛牛股市';
  sourceUrl: 'https://www.stockmarket.xin';
  permission: 'owner-confirmed';
  fetchedAt: string;
  fromTimestamp: number;
  toTimestamp: number;
  snapshotCount: number;
  overlapComparisons: number;
  liveSource: 'mwi-official';
}

export function createHistoryProvenance(input: Omit<HistoryProvenance,
  'schemaVersion' | 'sourceId' | 'sourceLabel' | 'sourceUrl' | 'permission' | 'liveSource'>): HistoryProvenance {
  return parseHistoryProvenance({
    schemaVersion: 1, sourceId: 'stockmarket-xin', sourceLabel: '牛牛股市',
    sourceUrl: 'https://www.stockmarket.xin', permission: 'owner-confirmed',
    liveSource: 'mwi-official', ...input,
  });
}
```

`parseHistoryProvenance` must require exactly these fields, safe integer timestamps/counts, `fromTimestamp <= toTimestamp`, a valid ISO `fetchedAt`, and the fixed source constants.

- [ ] **Step 4: Load optional provenance in the cloud client**

Add `historySourceLabel: string | null` to `CloudSourceInfo`, `CloudMarketData`, `HybridSourceInfo`, and `DashboardDataSourceInfo`. Resolve only `history-provenance.json` under the existing data base URL. Treat HTTP 404 as absent; if a non-empty file exists but fails strict parsing, throw `cloud_data_invalid`. Cache it with the current manifest and include it in `sourceFor`.

- [ ] **Step 5: Project the player-facing source label**

```ts
label.textContent = sourceInfo?.historySourceLabel
  ? `歷史回填：${sourceInfo.historySourceLabel}；最新行情：MWI 官方`
  : DATA_SOURCE_LABELS[source];
```

- [ ] **Step 6: Run provenance and dashboard tests and verify GREEN**

Run: `npm test -- --run tests/cloud-provenance.test.ts tests/cloud-client.test.ts tests/cloud-dashboard.test.ts`

Expected: focused tests pass; missing provenance retains `雲端共同行情`.

- [ ] **Step 7: Commit provenance support**

```bash
git add market-radar/src/cloud/provenance.ts market-radar/src/dashboard/cloud-client.ts market-radar/src/dashboard/hybrid-client.ts market-radar/src/dashboard/status.ts market-radar/tests/cloud-provenance.test.ts market-radar/tests/cloud-client.test.ts market-radar/tests/cloud-dashboard.test.ts
git commit -m "feat: disclose historical market provenance"
```

### Task 6: Build the one-shot CLI

**Files:**
- Create: `scripts/backfill-stockmarket-history.ts`
- Modify: `scripts/update-cloud-history.ts`
- Modify: `package.json`
- Modify: `tests/stockmarket-backfill.test.ts`

- [ ] **Step 1: Add a failing orchestration test**

The test injects a fixture client containing 150 hourly timestamps with at least 350 historical keys, an existing official latest snapshot with at least 1,000 comparable ask/bid fields, and a memory filesystem. It asserts that `runStockmarketBackfill` writes `history-provenance.json`, inserts only absent timestamps, preserves the official duplicate, and returns unchanged without network calls when valid provenance already exists.

```ts
const first = await runStockmarketBackfill({
  dataDir: 'data', generatedAt: GENERATED, client: fixtureClient,
  fileSystem: adapter, now: () => Date.parse(GENERATED),
});
expect(first.inserted).toBe(149);
expect(JSON.parse(adapter.values.get('data/history-provenance.json')!)).toMatchObject({
  sourceId: 'stockmarket-xin', snapshotCount: 150, liveSource: 'mwi-official',
});
const secondClient = { loadAll: vi.fn(async () => { throw new Error('must not fetch'); }) };
const second = await runStockmarketBackfill({
  dataDir: 'data', generatedAt: GENERATED, client: secondClient,
  fileSystem: adapter, now: () => Date.parse(GENERATED),
});
expect(second.skipped).toBe(true);
expect(secondClient.loadAll).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run tests/stockmarket-backfill.test.ts`

Expected: FAIL because `runStockmarketBackfill` does not exist.

- [ ] **Step 3: Implement orchestration and atomic provenance publish**

`runStockmarketBackfill` must:

1. Read and strictly validate the existing manifest and immutable official snapshots.
2. Return `{ skipped: true }` before creating a client request when valid provenance exists and `force` is false.
3. Fetch all authorized history, build seven-day snapshots, and run full overlap validation.
4. Call `mergeCloudHistory` only after every request and validation succeeds.
5. Write `history-provenance.json` through a uniquely named temporary file followed by rename.
6. Return only counts and timestamps.

The CLI accepts only `--data-dir <path>` and optional `--force`; it never accepts an alternate remote origin. Add:

```json
"cloud:backfill-stockmarket": "tsx scripts/backfill-stockmarket-history.ts"
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run tests/stockmarket-backfill.test.ts tests/cloud-history-store.test.ts tests/cloud-provenance.test.ts`

Expected: all focused tests pass; second run performs zero client requests.

- [ ] **Step 5: Commit the CLI**

```bash
git add market-radar/scripts/backfill-stockmarket-history.ts market-radar/scripts/update-cloud-history.ts market-radar/package.json market-radar/package-lock.json market-radar/tests/stockmarket-backfill.test.ts
git commit -m "feat: add one-shot seven-day backfill"
```

### Task 7: Gate the backfill behind manual GitHub Actions input

**Files:**
- Modify: `.github/workflows/market-radar-pages.yml`
- Modify: `docs/cloud-operations.md`
- Modify: `docs/cloud-deployment-checklist.md`
- Modify: `README.md`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Add the explicit workflow input**

```yaml
workflow_dispatch:
  inputs:
    backfill_stockmarket_7d:
      description: "One-time authorized stockmarket.xin seven-day backfill"
      required: false
      type: boolean
      default: false
```

- [ ] **Step 2: Add a manual-only backfill step after official collection**

```yaml
- name: Backfill the authorized seven-day public history
  if: github.event_name == 'workflow_dispatch' && inputs.backfill_stockmarket_7d == true
  working-directory: market-radar
  env:
    DATA_WT: ${{ steps.data-worktree.outputs.path }}
  run: npm run cloud:backfill-stockmarket -- --data-dir "$DATA_WT/data"
```

Scheduled and push events must not reference or call the backfill script.

- [ ] **Step 3: Document authority, one-shot operation, and recovery**

Document the public source, Owner-confirmed permission, fixed endpoint, 4-request concurrency cap, 168-hour target, 150-hour minimum, 350-key historical minimum, exact 1,000-field official overlap gate, provenance label, idempotent rerun, and the rule that normal hourly runs remain official-only. Add a notice that this project does not claim ownership of stockmarket.xin history and uses the authorized snapshot solely for the initial seven-day bootstrap.

- [ ] **Step 4: Validate workflow syntax through existing build and static tests**

Run: `npm test -- --run tests/cloud-history-store.test.ts tests/cloud-client.test.ts tests/cloud-dashboard.test.ts`

Expected: focused cloud tests pass.

- [ ] **Step 5: Commit workflow and documentation**

```bash
git add .github/workflows/market-radar-pages.yml market-radar/docs/cloud-operations.md market-radar/docs/cloud-deployment-checklist.md market-radar/README.md market-radar/THIRD_PARTY_NOTICES.md
git commit -m "ops: gate authorized history backfill"
```

### Task 8: Full verification, deployment, and one-time run

**Files:**
- Modify: `e2e/cloud-dashboard.spec.ts`
- Modify: `docs/cloud-deployment-checklist.md`

- [ ] **Step 1: Add the failing E2E source and 7D behavior assertion**

Extend the cloud fixture with provenance plus at least 150 hourly points. Assert:

```ts
await expect(page.locator('[data-source-label]'))
  .toHaveText('歷史回填：牛牛股市；最新行情：MWI 官方');
await page.getByRole('button', { name: '7D' }).click();
await expect(page.getByRole('row', { name: /红杉木板/ })).not.toContainText('— — —');
```

- [ ] **Step 2: Run the E2E test and verify RED before fixture/client support is complete**

Run: `npx playwright test e2e/cloud-dashboard.spec.ts --project=chrome-cloud-desktop`

Expected: FAIL on the provenance label or 7D row until the fixture carries the new files.

- [ ] **Step 3: Complete the fixture and verify E2E GREEN**

Run: `npx playwright test e2e/cloud-dashboard.spec.ts --project=chrome-cloud-desktop --project=chrome-cloud-mobile`

Expected: cloud desktop and mobile journeys pass.

- [ ] **Step 4: Run all verification gates**

Run:

```bash
npm test
npm run build
npm run e2e
git diff --check
```

Expected: all unit tests pass, both production artifacts build, Playwright passes with only the two existing expected desktop skips, and `git diff --check` is silent.

- [ ] **Step 5: Commit final acceptance evidence**

Record test counts, build output, E2E counts, commit SHA, and the planned workflow input in `docs/cloud-deployment-checklist.md`.

```bash
git add market-radar/e2e/cloud-dashboard.spec.ts market-radar/docs/cloud-deployment-checklist.md
git commit -m "test: verify seven-day history bootstrap"
```

- [ ] **Step 6: Push source and verify the normal push deployment first**

Run: `git push origin HEAD:main`

Expected: the push-triggered workflow succeeds without calling stockmarket.xin and deploys code capable of reading optional provenance.

- [ ] **Step 7: Trigger exactly one manual backfill run**

Run `MWI Market Radar Pages` with `backfill_stockmarket_7d=true`. Do not trigger another manual run while it is queued or active.

Expected workflow evidence:

- 150–168 imported hourly timestamps;
- every retained historical snapshot has at least 350 keys, while the latest official overlap has at least 1,000 comparable ask/bid fields;
- official overlap mismatch count is zero;
- provenance exists and validates;
- `market-data` contains only `data/**` changes;
- deploy succeeds.

- [ ] **Step 8: Verify the public site and stop the external dependency**

Open `https://baowan403.github.io/mwi-market-radar/` and verify the provenance label, latest official timestamp, 1D／3D／7D values, gap count, and strategy 3D／7D liquidity fields. Confirm the following scheduled run appends a newer official snapshot without any stockmarket.xin request. Record the actual range, snapshot count, overlap comparison count, data commit SHA, workflow run URL, and player-visible result in the deployment checklist.

- [ ] **Step 9: Final commit only if acceptance evidence changed after deployment**

```bash
git add market-radar/docs/cloud-deployment-checklist.md
git commit -m "docs: record seven-day backfill evidence"
git push origin HEAD:main
```
