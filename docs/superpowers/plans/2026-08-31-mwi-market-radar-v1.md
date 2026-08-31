# MWI Market Radar v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, stock-style MWI market dashboard whose Tampermonkey collector stores hourly official market snapshots locally and supports watchlists, official categories, 1D/3D/7D trends, sorting, rankings, filters, and item charts without any trading action or AI request.

**Architecture:** A Vite/TypeScript static dashboard and one separately bundled `vite-plugin-monkey` userscript share pure market-domain modules. On MWI pages the userscript fetches the public official snapshot with credentials omitted, validates and stores compact day chunks in GM storage, and schedules hourly collection; on the dashboard origin it exposes an allowlisted CustomEvent bridge for read-only market data plus local watchlist/settings writes. The dashboard uses a sortable DOM table and Chart.js, while all calculations remain pure and covered by Vitest.

**Tech Stack:** TypeScript, Vite, vanilla DOM/CSS, Vitest + jsdom, vite-plugin-monkey, Chart.js, Playwright (local end-to-end only), Tampermonkey GM APIs.

---

## Scope and repository preconditions

- Implement under `market-radar/`; do not modify the copied Milkonomy or Azhu source trees.
- Do not create or publish a remote repository and do not choose a public URL. Deployment remains blocked until Owner confirms the GitHub account, repository name, and URL.
- The current workspace is not a Git repository. Before executing commit steps, initialize a local-only repository with `git init -b main`; this creates no remote and no public URL. If Owner declines local Git at execution time, skip only commit commands and preserve all verification steps.
- v1 retains eight days of hourly data. Year-long daily OHLC, import/export, alerts, mooket backfill, Windows scheduling, and Milkonomy profit integration remain outside this plan.
- The userscript never reads cookies, account storage, character data, inventory, chat, or orders. It never clicks or submits an MWI UI action.

## File map

```text
market-radar/
  package.json                    dependencies and scripts
  tsconfig.json                   strict TypeScript settings
  vite.config.ts                  dashboard build
  vite.userscript.config.ts       isolated userscript build and metadata
  index.html                      static dashboard entry
  public/catalog.json             committed item/category display catalog
  scripts/build-catalog.mjs       builds catalog from local current game maps
  src/
    app.ts                        dashboard composition and event wiring
    styles.css                    stock-style responsive visual system
    core/types.ts                 shared domain and bridge types
    core/market-schema.ts         official JSON validation/normalization
    core/price.ts                 price basis, spread, data-quality rules
    core/trends.ts                nearest-snapshot 1D/3D/7D calculations
    core/rankings.ts              filters, sorting, anomaly signals
    core/categories.ts            official categories and convenience groups
    core/storage-codec.ts         compact day-chunk serialization
    collector/market-store.ts     GM-backed snapshot/watchlist/settings repository
    collector/official-client.ts  credential-free official snapshot fetch
    collector/lock.ts             Web Locks plus GM lease fallback
    collector/scheduler.ts        immediate/hourly/retry schedule
    userscript/main.ts            origin router and userscript bootstrap
    userscript/gm.d.ts            typed legacy Tampermonkey GM grants
    userscript/game-collector.ts  MWI collector host
    userscript/dashboard-bridge.ts allowlisted dashboard bridge
    dashboard/client.ts           page-side bridge client
    dashboard/state.ts            view state and derived rows
    dashboard/table.ts            market/watchlist table rendering
    dashboard/filters.ts          category/search/liquidity controls
    dashboard/rankings-view.ts    leaderboard rendering
    dashboard/item-detail.ts      Chart.js item detail view
    dashboard/status.ts           collection and data-quality status
  tests/
    fixtures/marketplace.json     representative official snapshot
    market-schema.test.ts
    price.test.ts
    trends.test.ts
    rankings.test.ts
    storage-codec.test.ts
    market-store.test.ts
    scheduler.test.ts
    bridge.test.ts
    dashboard.test.ts
  e2e/dashboard.spec.ts           browser acceptance without live MWI writes
```

## Task 1: Scaffold the isolated TypeScript project

**Files:**
- Create: `market-radar/package.json`
- Create: `market-radar/tsconfig.json`
- Create: `market-radar/vite.config.ts`
- Create: `market-radar/vite.userscript.config.ts`
- Create: `market-radar/index.html`
- Create: `market-radar/src/app.ts`
- Create: `market-radar/src/styles.css`

- [ ] **Step 1: Initialize local Git only if the workspace still has no repository**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected before initialization: exit code 128 with `not a git repository`.

Run only after confirming local Git is acceptable:

```powershell
git init -b main
```

Expected: `Initialized empty Git repository` and no configured remote.

- [ ] **Step 2: Create the package manifest**

```json
{
  "name": "mwi-market-radar",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build && vite build --config vite.userscript.config.ts",
    "build:catalog": "node scripts/build-catalog.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "preview": "vite preview"
  },
  "dependencies": {
    "chart.js": "^4.4.9"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@types/node": "^22.15.30",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vite-plugin-monkey": "^5.0.8",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: Create strict TypeScript and Vite configuration**

`market-radar/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "vite.userscript.config.ts"]
}
```

`market-radar/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { outDir: 'dist', emptyOutDir: true } });
```

`market-radar/vite.userscript.config.ts`:

```ts
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const dashboardOrigins = (process.env.MWI_RADAR_DASHBOARD_ORIGINS ?? 'http://localhost:4173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: false },
  define: {
    __MWI_RADAR_DASHBOARD_ORIGINS__: JSON.stringify(dashboardOrigins),
  },
  plugins: [
    monkey({
      entry: 'src/userscript/main.ts',
      userscript: {
        name: 'MWI Market Radar Collector',
        namespace: 'local.mwi.market-radar',
        match: [
          'https://www.milkywayidle.com/*',
          'http://localhost:4173/*',
        ],
        connect: ['www.milkywayidle.com'],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_deleteValue',
          'GM_listValues',
        ],
      },
      build: { fileName: 'mwi-market-radar.user.js' },
    }),
  ],
});
```

- [ ] **Step 4: Create the visible shell**

`market-radar/index.html`:

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>MWI Market Radar</title>
  </head>
  <body>
    <main id="app" aria-live="polite"></main>
    <script type="module" src="/src/app.ts"></script>
  </body>
</html>
```

`market-radar/src/app.ts`:

```ts
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app');

root.innerHTML = `
  <header class="topbar">
    <div><p class="eyebrow">Milky Way Idle</p><h1>Market Radar</h1></div>
    <div id="collector-status" class="status">等待本機採集器</div>
  </header>
  <nav id="category-nav" aria-label="市場分類"></nav>
  <section id="toolbar" aria-label="行情工具列"></section>
  <section id="content"></section>
  <dialog id="item-detail"></dialog>
`;
```

`market-radar/src/styles.css` starts with tokens and a readable desktop/mobile shell:

```css
:root {
  color: #e9eef7;
  background: #0b1018;
  font-family: Inter, "Noto Sans TC", system-ui, sans-serif;
  --panel: #121a26;
  --line: #243044;
  --muted: #91a0b6;
  --up: #ff5a62;
  --down: #36c98f;
  --accent: #72a7ff;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
#app { max-width: 1440px; margin: 0 auto; padding: 20px; }
.topbar { display: flex; justify-content: space-between; align-items: end; gap: 16px; }
.eyebrow { color: var(--accent); margin: 0; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 4px 0 0; font-size: clamp(24px, 4vw, 42px); }
.status { color: var(--muted); text-align: right; }
@media (max-width: 700px) { #app { padding: 12px; } .topbar { align-items: start; } }
```

- [ ] **Step 5: Install and verify the empty build**

Run:

```powershell
cd market-radar
npm install
npm run build
```

Expected: TypeScript and Vite complete successfully and emit `dist/` plus the userscript bundle.

- [ ] **Step 6: Commit the scaffold**

```powershell
git add market-radar/package.json market-radar/tsconfig.json market-radar/vite.config.ts market-radar/vite.userscript.config.ts market-radar/index.html market-radar/src/app.ts market-radar/src/styles.css market-radar/package-lock.json
git commit -m "chore: scaffold MWI market radar"
```

## Task 2: Build and validate the item catalog

**Files:**
- Create: `market-radar/scripts/build-catalog.mjs`
- Create: `market-radar/public/catalog.json`
- Create: `market-radar/tests/catalog.test.ts`

- [ ] **Step 1: Write the failing catalog test**

```ts
import catalog from '../public/catalog.json';

describe('catalog', () => {
  it('uses only the ten official MWI categories', () => {
    const expected = new Set([
      '/item_categories/currency', '/item_categories/loot', '/item_categories/scroll',
      '/item_categories/labyrinth', '/item_categories/dungeon_key', '/item_categories/food',
      '/item_categories/drink', '/item_categories/ability_book', '/item_categories/equipment',
      '/item_categories/resource',
    ]);
    expect(catalog.items.length).toBeGreaterThan(100);
    expect(catalog.items.every((item) => expected.has(item.categoryHrid))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm the catalog is missing**

Run: `npm test -- tests/catalog.test.ts`

Expected: FAIL because `public/catalog.json` does not exist.

- [ ] **Step 3: Add the deterministic catalog builder**

`market-radar/scripts/build-catalog.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '../..');
const dataDir = process.env.MWI_GAME_DATA_DIR
  ? path.resolve(process.env.MWI_GAME_DATA_DIR)
  : path.join(root, 'work/azhu-sim-source/src/combatsimulator/data');
const itemMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'itemDetailMap.json'), 'utf8'));
const categoryMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'itemCategoryDetailMap.json'), 'utf8'));

const categories = Object.values(categoryMap)
  .map(({ hrid, name, sortIndex }) => ({ hrid, name, sortIndex }))
  .sort((a, b) => a.sortIndex - b.sortIndex);
const items = Object.values(itemMap)
  .filter((item) => categoryMap[item.categoryHrid])
  .map(({ hrid, name, categoryHrid, sortIndex = 0 }) => ({ hrid, name, categoryHrid, sortIndex }))
  .sort((a, b) => a.categoryHrid.localeCompare(b.categoryHrid) || a.sortIndex - b.sortIndex);

const output = { categories, items };
fs.writeFileSync(path.join(import.meta.dirname, '../public/catalog.json'), `${JSON.stringify(output)}\n`);
```

Unknown future HRIDs must remain displayable as their last path segment and category `未知`, rather than disappearing from the table.

- [ ] **Step 4: Build and test the catalog**

Run:

```powershell
npm run build:catalog
npm test -- tests/catalog.test.ts
```

Expected: PASS and `public/catalog.json` contains the ten categories.

- [ ] **Step 5: Commit the catalog pipeline**

```powershell
git add market-radar/scripts/build-catalog.mjs market-radar/public/catalog.json market-radar/tests/catalog.test.ts
git commit -m "feat: add official MWI item catalog"
```

## Task 3: Define the market contract and reject corrupt snapshots

**Files:**
- Create: `market-radar/src/core/types.ts`
- Create: `market-radar/src/core/market-schema.ts`
- Create: `market-radar/tests/fixtures/marketplace.json`
- Create: `market-radar/tests/market-schema.test.ts`

- [ ] **Step 1: Define the shared types**

```ts
export type Period = '1d' | '3d' | '7d';
export type MarketKey = `${string}::${number}`;
export interface Quote { a: number | null; b: number | null; p: number | null; v: number | null; }
export interface Snapshot { timestamp: number; quotes: Record<MarketKey, Quote>; }
export interface WatchItem { key: MarketKey; order: number; }
export interface RadarSettings {
  period: Period;
  minimumVolume: number;
  maximumSpreadPct: number | null;
  anomalyMovePct: number;
  anomalyVolumeMultiple: number;
}
export interface CatalogItem { hrid: string; name: string; categoryHrid: string; sortIndex: number; }
```

- [ ] **Step 2: Write failing validation tests**

```ts
import { parseOfficialSnapshot } from '../src/core/market-schema';

it('normalizes -1 to missing without inventing zero prices', () => {
  const result = parseOfficialSnapshot({
    timestamp: 1_700_000_000_000,
    marketData: { '/items/test': { '7': { a: -1, b: 100, p: -1, v: 4 } } },
  });
  expect(result.quotes['/items/test::7']).toEqual({ a: null, b: 100, p: null, v: 4 });
});

it('rejects malformed snapshots before storage', () => {
  expect(() => parseOfficialSnapshot({ timestamp: 'bad', marketData: {} })).toThrow('Invalid timestamp');
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/market-schema.test.ts`

Expected: FAIL because `parseOfficialSnapshot` is not implemented.

- [ ] **Step 4: Implement strict normalization**

```ts
import type { MarketKey, Quote, Snapshot } from './types';

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseOfficialSnapshot(raw: unknown): Snapshot {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid snapshot');
  const source = raw as { timestamp?: unknown; marketData?: unknown };
  if (typeof source.timestamp !== 'number' || !Number.isFinite(source.timestamp)) throw new Error('Invalid timestamp');
  if (!source.marketData || typeof source.marketData !== 'object') throw new Error('Invalid marketData');
  const quotes: Record<MarketKey, Quote> = {};
  for (const [hrid, levels] of Object.entries(source.marketData as Record<string, unknown>)) {
    if (!hrid.startsWith('/items/') || !levels || typeof levels !== 'object') continue;
    for (const [levelText, value] of Object.entries(levels as Record<string, unknown>)) {
      const level = Number(levelText);
      if (!Number.isInteger(level) || level < 0 || !value || typeof value !== 'object') continue;
      const quote = value as Record<string, unknown>;
      quotes[`${hrid}::${level}`] = {
        a: finiteOrNull(quote.a), b: finiteOrNull(quote.b),
        p: finiteOrNull(quote.p), v: finiteOrNull(quote.v),
      };
    }
  }
  if (Object.keys(quotes).length === 0) throw new Error('Snapshot contains no quotes');
  return { timestamp: source.timestamp, quotes };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/market-schema.test.ts`

Expected: PASS.

```powershell
git add market-radar/src/core/types.ts market-radar/src/core/market-schema.ts market-radar/tests/fixtures/marketplace.json market-radar/tests/market-schema.test.ts
git commit -m "feat: validate official market snapshots"
```

## Task 4: Implement price, trend, sorting, and anomaly rules

**Files:**
- Create: `market-radar/src/core/price.ts`
- Create: `market-radar/src/core/trends.ts`
- Create: `market-radar/src/core/categories.ts`
- Create: `market-radar/src/core/rankings.ts`
- Create: `market-radar/tests/price.test.ts`
- Create: `market-radar/tests/trends.test.ts`
- Create: `market-radar/tests/rankings.test.ts`

- [ ] **Step 1: Write failing price and trend tests**

```ts
import { priceBasis, spreadPct } from '../src/core/price';
import { calculateChange } from '../src/core/trends';

it('prefers official p and marks midpoint fallback', () => {
  expect(priceBasis({ a: 110, b: 90, p: 105, v: 2 })).toEqual({ value: 105, quality: 'official' });
  expect(priceBasis({ a: 110, b: 90, p: null, v: 2 })).toEqual({ value: 100, quality: 'midpoint' });
  expect(spreadPct({ a: 110, b: 90, p: null, v: 2 })).toBeCloseTo(20);
});

it('uses the nearest valid snapshot and reports actual elapsed hours', () => {
  const result = calculateChange('/items/test::0', 24, [
    { timestamp: 0, quotes: { '/items/test::0': { a: 100, b: 100, p: 100, v: 1 } } },
    { timestamp: 25 * 3_600_000, quotes: { '/items/test::0': { a: 110, b: 110, p: 110, v: 1 } } },
  ]);
  expect(result).toMatchObject({ pct: 10, elapsedHours: 25, samples: 2 });
});
```

- [ ] **Step 2: Implement price basis and missing-data rules**

```ts
import type { Quote } from './types';
export type PriceQuality = 'official' | 'midpoint' | 'ask-only' | 'bid-only' | 'missing';

export function priceBasis(q: Quote): { value: number | null; quality: PriceQuality } {
  if (q.p !== null) return { value: q.p, quality: 'official' };
  if (q.a !== null && q.b !== null) return { value: (q.a + q.b) / 2, quality: 'midpoint' };
  if (q.a !== null) return { value: q.a, quality: 'ask-only' };
  if (q.b !== null) return { value: q.b, quality: 'bid-only' };
  return { value: null, quality: 'missing' };
}

export function spreadPct(q: Quote): number | null {
  if (q.a === null || q.b === null || q.a + q.b === 0) return null;
  return ((q.a - q.b) / ((q.a + q.b) / 2)) * 100;
}
```

- [ ] **Step 3: Implement honest nearest-snapshot trends**

```ts
import type { MarketKey, Snapshot } from './types';
import { priceBasis } from './price';

export interface ChangeResult { pct: number | null; elapsedHours: number | null; samples: number; }
export function calculateChange(key: MarketKey, targetHours: number, snapshots: Snapshot[]): ChangeResult {
  const valid = snapshots
    .map((snapshot) => ({ timestamp: snapshot.timestamp, price: priceBasis(snapshot.quotes[key] ?? { a: null, b: null, p: null, v: null }).value }))
    .filter((row): row is { timestamp: number; price: number } => row.price !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (valid.length < 2) return { pct: null, elapsedHours: null, samples: valid.length };
  const latest = valid.at(-1)!;
  const target = latest.timestamp - targetHours * 3_600_000;
  const base = valid.reduce((best, row) => Math.abs(row.timestamp - target) < Math.abs(best.timestamp - target) ? row : best);
  const elapsedHours = (latest.timestamp - base.timestamp) / 3_600_000;
  if (base === latest || base.price === 0 || elapsedHours < targetHours * 0.75) return { pct: null, elapsedHours, samples: valid.length };
  return { pct: ((latest.price - base.price) / base.price) * 100, elapsedHours, samples: valid.length };
}
```

- [ ] **Step 4: Define official categories and convenience groups**

```ts
export const OFFICIAL_CATEGORIES = [
  'currency', 'loot', 'scroll', 'labyrinth', 'dungeon_key',
  'food', 'drink', 'ability_book', 'equipment', 'resource',
] as const;
export const CATEGORY_GROUPS: Record<string, string[]> = {
  resource: ['resource'],
  consumable: ['food', 'drink', 'scroll'],
  ability_book: ['ability_book'],
  labyrinth: ['labyrinth'],
  equipment: ['equipment'],
  other: ['currency', 'loot', 'dungeon_key'],
};
export function shortCategory(hrid: string): string { return hrid.replace('/item_categories/', ''); }
```

- [ ] **Step 5: Implement stable sort and anomaly flags, then run tests**

`rankRows` must treat null as last in both directions and use `name + key` as the stable tie-breaker. `flagsForRow` returns `move`, `volume-spike`, `wide-spread`, `one-sided`, and `thin` only when the corresponding source values are valid.

```ts
export function compareNullable(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}
```

Run: `npm test -- tests/price.test.ts tests/trends.test.ts tests/rankings.test.ts`

Expected: PASS for official price, midpoint, one-sided, missing, nearest-window, null-last sorting, and anomaly cases.

- [ ] **Step 6: Commit the market math**

```powershell
git add market-radar/src/core market-radar/tests/price.test.ts market-radar/tests/trends.test.ts market-radar/tests/rankings.test.ts
git commit -m "feat: calculate trustworthy market trends"
```

## Task 5: Store compact hourly snapshots and local preferences

**Files:**
- Create: `market-radar/src/core/storage-codec.ts`
- Create: `market-radar/src/collector/market-store.ts`
- Create: `market-radar/src/userscript/gm.d.ts`
- Create: `market-radar/tests/storage-codec.test.ts`
- Create: `market-radar/tests/market-store.test.ts`

- [ ] **Step 1: Write failing codec and retention tests**

```ts
it('round trips a day chunk without changing missing values', async () => {
  const encoded = await encodeDayChunk([snapshot]);
  expect(await decodeDayChunk(encoded)).toEqual([snapshot]);
});

it('keeps unique timestamps and removes chunks older than eight days', async () => {
  await store.saveSnapshot(snapshotAt('2026-08-20T00:08:00Z'));
  await store.saveSnapshot(snapshotAt('2026-08-20T00:08:00Z'));
  await store.saveSnapshot(snapshotAt('2026-08-29T00:08:00Z'));
  expect((await store.listSnapshots()).map((s) => s.timestamp)).toEqual([Date.parse('2026-08-29T00:08:00Z')]);
});
```

- [ ] **Step 2: Implement compact gzip/base64 day chunks**

```ts
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
export async function encodeDayChunk(value: unknown): Promise<string> {
  const stream = new Blob([encoder.encode(JSON.stringify(value))]).stream().pipeThrough(new CompressionStream('gzip'));
  return bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
export async function decodeDayChunk<T>(value: string): Promise<T> {
  const stream = new Blob([base64ToBytes(value)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(decoder.decode(await new Response(stream).arrayBuffer())) as T;
}
```

Tests use a plain JSON fallback adapter when jsdom lacks CompressionStream; production Chrome uses the native implementation.

- [ ] **Step 3: Define a narrow GM adapter and repository**

`market-radar/src/userscript/gm.d.ts`:

```ts
declare function GM_getValue<T>(key: string, defaultValue: T): T;
declare function GM_setValue<T>(key: string, value: T): void;
declare function GM_deleteValue(key: string): void;
declare function GM_listValues(): string[];
```

```ts
export interface KeyValueStore {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const PREFIX = 'mwi-radar:v1:';
const dayKey = (timestamp: number) => `${PREFIX}hourly:${new Date(timestamp).toISOString().slice(0, 10)}`;
```

`MarketStore.saveSnapshot` reads one day chunk, replaces any equal timestamp, sorts ascending, writes once, then deletes hourly keys whose date is older than `latestTimestamp - 8 days`. `getWatchlist`, `setWatchlist`, `getSettings`, and `setSettings` use separate versioned keys.

- [ ] **Step 4: Add quota failure behavior**

Wrap only the final adapter write. On failure, throw `StorageWriteError` containing the attempted key and preserve every existing chunk and watchlist. Never auto-delete watchlist or current-day data to hide the failure.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/storage-codec.test.ts tests/market-store.test.ts`

Expected: PASS for roundtrip, de-duplication, eight-day retention, browser restart adapter recreation, watchlist persistence, and write failure.

```powershell
git add market-radar/src/core/storage-codec.ts market-radar/src/collector/market-store.ts market-radar/src/userscript/gm.d.ts market-radar/tests/storage-codec.test.ts market-radar/tests/market-store.test.ts
git commit -m "feat: persist hourly market history locally"
```

## Task 6: Collect at startup and each hour without duplicate tab work

**Files:**
- Create: `market-radar/src/collector/official-client.ts`
- Create: `market-radar/src/collector/lock.ts`
- Create: `market-radar/src/collector/scheduler.ts`
- Create: `market-radar/src/userscript/game-collector.ts`
- Create: `market-radar/tests/scheduler.test.ts`

- [ ] **Step 1: Write failing schedule tests with fake timers**

```ts
it('schedules the next regular check at minute 08', () => {
  expect(nextHourlyRun(Date.parse('2026-08-31T10:07:30+08:00')))
    .toBe(Date.parse('2026-08-31T10:08:00+08:00'));
  expect(nextHourlyRun(Date.parse('2026-08-31T10:09:00+08:00')))
    .toBe(Date.parse('2026-08-31T11:08:00+08:00'));
});

it('retries once after ten minutes and then waits for the next hour', async () => {
  const check = vi.fn().mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'));
  const scheduler = createScheduler({ now: () => Date.now(), check });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(check).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Implement the credential-free client**

```ts
import { parseOfficialSnapshot } from '../core/market-schema';
const URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

export async function fetchOfficialSnapshot(fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${URL}?radar=${Date.now()}`, {
    method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new Error(`Official marketplace request failed: ${response.status}`);
  return parseOfficialSnapshot(await response.json());
}
```

- [ ] **Step 3: Implement lock and slot de-duplication**

Use `navigator.locks.request('mwi-market-radar-collector', { ifAvailable: true }, callback)` on MWI tabs. Inside the lock, compare the current hourly slot and `lastCheckedSlot` in GM storage before fetching. The fallback stores `{ owner, expiresAt }` under `mwi-radar:v1:lease`, waits a random 100–400 ms, verifies ownership, and expires after 120 seconds.

```ts
export const slotId = (timestamp: number) => Math.floor(timestamp / 3_600_000);
```

This makes duplicate snapshots impossible at the repository level and duplicate requests unlikely even under a simultaneous multi-tab launch.

- [ ] **Step 4: Implement immediate, hourly, and one-retry scheduling**

```ts
export function nextHourlyRun(now: number): number {
  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setMinutes(8);
  if (date.getTime() <= now) date.setHours(date.getHours() + 1);
  return date.getTime();
}
```

`start()` invokes one immediate locked check, then schedules `nextHourlyRun`. A failed or unchanged-timestamp result schedules exactly one retry at +10 minutes. Completion, second failure, and unchanged retry all return to the next regular `xx:08` slot.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/scheduler.test.ts tests/market-store.test.ts`

Expected: PASS for minute 08, startup check, one retry, no retry loop, and locked duplicate suppression.

```powershell
git add market-radar/src/collector market-radar/src/userscript/game-collector.ts market-radar/tests/scheduler.test.ts
git commit -m "feat: schedule safe hourly market collection"
```

## Task 7: Add the allowlisted dashboard bridge

**Files:**
- Create: `market-radar/src/userscript/main.ts`
- Create: `market-radar/src/userscript/dashboard-bridge.ts`
- Create: `market-radar/src/dashboard/client.ts`
- Create: `market-radar/tests/bridge.test.ts`

- [ ] **Step 1: Define typed request and response messages**

Add to `src/core/types.ts`:

```ts
export type BridgeRequest =
  | { id: string; type: 'bootstrap' }
  | { id: string; type: 'snapshots' }
  | { id: string; type: 'set-watchlist'; value: WatchItem[] }
  | { id: string; type: 'set-settings'; value: RadarSettings };
export type BridgeResponse =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: string };
```

- [ ] **Step 2: Write failing allowlist and roundtrip tests**

```ts
it('does not install a bridge on an unapproved origin', () => {
  const responses = vi.fn();
  window.addEventListener('mwi-radar:response', responses);
  installDashboardBridge({ origin: 'https://evil.example', allowedOrigins: ['http://localhost:4173'], store });
  window.dispatchEvent(new CustomEvent('mwi-radar:request', { detail: { id: '1', type: 'bootstrap' } }));
  expect(responses).not.toHaveBeenCalled();
});

it('returns snapshots and persists watchlist through request ids', async () => {
  const client = createDashboardClient(window);
  expect(await client.listSnapshots()).toEqual([snapshot]);
  await client.setWatchlist([{ key: '/items/test::0', order: 0 }]);
  expect(await store.getWatchlist()).toHaveLength(1);
});
```

- [ ] **Step 3: Implement a CustomEvent bridge with exact-origin checks**

Use event names `mwi-radar:request` and `mwi-radar:response`. Validate request shape, dispatch responses using the same opaque UUID, expose only the four operations in `BridgeRequest`, and never expose a generic GM read/write method.

```ts
if (!allowedOrigins.includes(location.origin)) return;
window.addEventListener('mwi-radar:request', async (event) => {
  if (!(event instanceof CustomEvent)) return;
  const request = event.detail as BridgeRequest;
  const response = await handleKnownRequest(request, store);
  window.dispatchEvent(new CustomEvent('mwi-radar:response', { detail: response }));
});
```

- [ ] **Step 4: Route the single userscript by origin**

```ts
import { startGameCollector } from './game-collector';
import { installDashboardBridge } from './dashboard-bridge';

declare const __MWI_RADAR_DASHBOARD_ORIGINS__: string[];
if (location.hostname === 'www.milkywayidle.com') {
  startGameCollector();
} else if (__MWI_RADAR_DASHBOARD_ORIGINS__.includes(location.origin)) {
  installDashboardBridge({ origin: location.origin, allowedOrigins: __MWI_RADAR_DASHBOARD_ORIGINS__ });
}
```

- [ ] **Step 5: Test and commit**

Run: `npm test -- tests/bridge.test.ts`

Expected: PASS for allowed origin, denied origin, request correlation, snapshot read, settings write, watchlist write, and unknown-operation rejection.

```powershell
git add market-radar/src/userscript market-radar/src/dashboard/client.ts market-radar/src/core/types.ts market-radar/tests/bridge.test.ts
git commit -m "feat: bridge local market data to dashboard"
```

## Task 8: Render official categories, watchlist, filters, and sortable quotes

**Files:**
- Create: `market-radar/src/dashboard/state.ts`
- Create: `market-radar/src/dashboard/table.ts`
- Create: `market-radar/src/dashboard/filters.ts`
- Create: `market-radar/src/dashboard/status.ts`
- Modify: `market-radar/src/app.ts`
- Modify: `market-radar/src/styles.css`
- Create: `market-radar/tests/dashboard.test.ts`

- [ ] **Step 1: Write failing DOM tests for the Owner-visible behavior**

```ts
it('shows watchlist first and preserves all ten official categories', async () => {
  await mountDashboard(fixtureClient);
  expect([...document.querySelectorAll('[data-view]')].map((node) => node.textContent)).toContain('自選');
  expect([...document.querySelectorAll('[data-official-category]')]).toHaveLength(10);
});

it('pins enhancement levels independently and sorts null values last', async () => {
  await clickRowPin('/items/gloves::7');
  expect(await fixtureClient.getWatchlist()).toEqual([{ key: '/items/gloves::7', order: 0 }]);
  clickHeader('changePct');
  expect(visibleKeys().at(-1)).toBe('/items/no-market::0');
});
```

- [ ] **Step 2: Build one derived row model**

`deriveRows` joins latest quotes, catalog entries, watchlist state, spread, price basis, 1D/3D/7D changes, and flags. It returns immutable rows keyed by `itemHrid::enhancementLevel`; unknown catalog entries use a readable HRID fallback and category `未知`.

- [ ] **Step 3: Render the navigation and controls**

Create primary buttons for `自選、全市場、資源、消耗品、技能書、迷宮、裝備、其他`, plus an expandable official-category menu containing all ten exact categories. Add period buttons `1D、3D、7D`, search, enhancement level, minimum volume, and maximum spread controls.

```html
<button type="button" data-period="1d" aria-pressed="true">1D</button>
<button type="button" data-period="3d" aria-pressed="false">3D</button>
<button type="button" data-period="7d" aria-pressed="false">7D</button>
```

- [ ] **Step 4: Render the quote table and watchlist behavior**

The table headers are buttons with `aria-sort`. Clicking cycles `desc → asc → default`. The pin button has an accessible label containing item name and enhancement level. Watchlist manual order is retained in storage; market sorting is temporary and switching to `自訂順序` restores it.

Columns: pin, name/+level, official category, price, bid, ask, spread, official volume, 1D, 3D, 7D, quality.

- [ ] **Step 5: Apply stock-style visual semantics**

Use red + ▲ for positive, green + ▼ for negative, gray + — for zero/missing. Make the table horizontally scrollable below 900 px; keep name and pin columns sticky without turning the layout into stacked cards.

- [ ] **Step 6: Test and commit**

Run: `npm test -- tests/dashboard.test.ts tests/rankings.test.ts`

Expected: PASS for navigation, official category count, convenience groups, independent enhancement pins, watchlist order, all sort cycles, filters, null-last, and color-independent arrows.

```powershell
git add market-radar/src/app.ts market-radar/src/styles.css market-radar/src/dashboard market-radar/tests/dashboard.test.ts
git commit -m "feat: add sortable market watchlist"
```

## Task 9: Add rankings and item history charts

**Files:**
- Create: `market-radar/src/dashboard/rankings-view.ts`
- Create: `market-radar/src/dashboard/item-detail.ts`
- Modify: `market-radar/src/app.ts`
- Modify: `market-radar/src/styles.css`
- Modify: `market-radar/tests/dashboard.test.ts`

- [ ] **Step 1: Add failing tests for ranking honesty and chart gaps**

```ts
it('marks a large move as thin instead of presenting it as a clean opportunity', () => {
  renderRankings([row({ changePct: 20, volume: 2, flags: ['move', 'thin'] })]);
  expect(screenText()).toContain('薄量');
});

it('passes null through to Chart.js instead of interpolating missing prices', () => {
  const model = buildChartModel('/items/test::0', snapshotsWithGap);
  expect(model.datasets.find((set) => set.label === '市場價')?.data).toContain(null);
  expect(model.datasets.find((set) => set.label === '市場價')?.spanGaps).toBe(false);
});
```

- [ ] **Step 2: Render the seven rankings**

Create tabs for `漲幅、跌幅、成交量、異常量、波動、大價差、無買／無賣`. Reuse the current category/search/liquidity filters; never calculate a ranking from filtered-out hidden values or substitute zero for null.

- [ ] **Step 3: Build the item detail model**

Return labels in Asia/Taipei and datasets for `p`, ask, bid, and volume. Include actual sample count, actual elapsed interval, high/low, gaps, and one-sided quote warnings. Chart.js datasets set `spanGaps: false`.

- [ ] **Step 4: Render the detail dialog**

Clicking a market row opens a native `<dialog>` with item name/+level, pin button, 1D/3D/7D selector, price chart, volume chart, stats, and explicit data-quality text. Clicking the pin button in the row must stop propagation so it does not also open the dialog.

- [ ] **Step 5: Test and commit**

Run: `npm test -- tests/dashboard.test.ts tests/rankings.test.ts`

Expected: PASS for seven rankings, shared filters, thin-market label, item dialog, independent pin action, null chart gaps, and Taipei labels.

```powershell
git add market-radar/src/dashboard/rankings-view.ts market-radar/src/dashboard/item-detail.ts market-radar/src/app.ts market-radar/src/styles.css market-radar/tests/dashboard.test.ts
git commit -m "feat: add market rankings and item charts"
```

## Task 10: Make failures visible and keep the privacy boundary testable

**Files:**
- Modify: `market-radar/src/dashboard/status.ts`
- Modify: `market-radar/src/userscript/game-collector.ts`
- Modify: `market-radar/src/dashboard/client.ts`
- Modify: `market-radar/tests/dashboard.test.ts`
- Create: `market-radar/tests/privacy.test.ts`

- [ ] **Step 1: Add failure-state tests**

```ts
it('explains that Tampermonkey is missing instead of showing demo quotes', async () => {
  await expect(connectWithTimeout(50)).rejects.toThrow('collector bridge unavailable');
  expect(document.body.textContent).toContain('尚未偵測到 MWI Market Radar 腳本');
  expect(document.querySelectorAll('[data-market-row]')).toHaveLength(0);
});

it('uses credential omission for the official endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValue(okFixtureResponse());
  await fetchOfficialSnapshot(fetcher);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
});
```

- [ ] **Step 2: Render collector status**

Show official snapshot time, local collection time, next scheduled collection, and one of: `正常、等待遊戲分頁、重試中、資料格式異常、儲存空間不足、腳本未安裝`. Missing intervals show the exact time range and never claim continuity.

- [ ] **Step 3: Enforce the no-private-data surface**

Search the production source for disallowed access and keep the test allowlist empty:

```ts
const disallowed = ['document.cookie', 'localStorage', 'sessionStorage', '/v1/characters', 'WebSocket('];
for (const token of disallowed) expect(productionSource).not.toContain(token);
```

The only network URL in production collector code must be the public official `marketplace.json`. Chart.js and app assets are bundled.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/privacy.test.ts tests/dashboard.test.ts tests/market-schema.test.ts`

Expected: PASS and no private storage/account/network token occurs in production source.

```powershell
git add market-radar/src/dashboard/status.ts market-radar/src/userscript/game-collector.ts market-radar/src/dashboard/client.ts market-radar/tests/dashboard.test.ts market-radar/tests/privacy.test.ts
git commit -m "feat: expose collection health safely"
```

## Task 11: Add local end-to-end acceptance without touching MWI actions

**Files:**
- Create: `market-radar/playwright.config.ts`
- Create: `market-radar/e2e/dashboard.spec.ts`
- Create: `market-radar/e2e/bridge-fixture.ts`

- [ ] **Step 1: Configure the local preview server**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 800 } },
  webServer: { command: 'npm run build && npm run preview -- --host 127.0.0.1', port: 4173, reuseExistingServer: false },
});
```

- [ ] **Step 2: Inject a deterministic page-side bridge fixture**

The fixture implements the exact four bridge operations in memory before `app.ts` connects. It contains three timestamps, one enhancement pair, one missing market, one thin large mover, and one normal high-volume mover. It never imitates an MWI page or submits a game action.

- [ ] **Step 3: Write the five Owner-visible journeys**

```ts
import { bridgeFixtureSource } from './bridge-fixture';

test('watchlist, categories, sorting, period, and chart journey', async ({ page }) => {
  await page.addInitScript({ content: bridgeFixtureSource });
  await page.goto('/');
  await page.getByRole('button', { name: '自選' }).click();
  await page.getByLabel('釘選 時空手套 +7').click();
  await page.getByRole('button', { name: '裝備' }).click();
  await page.getByRole('button', { name: '7D' }).click();
  await page.getByRole('button', { name: '7D 漲跌幅' }).click();
  await page.getByText('時空手套 +7').click();
  await expect(page.getByRole('dialog')).toContainText('樣本');
});
```

Add separate assertions that all ten categories are reachable, missing values are `—`, thin movers say `薄量`, reload preserves the fixture watchlist, and mobile width remains horizontally usable.

- [ ] **Step 4: Run unit, build, and end-to-end verification**

Run:

```powershell
npm test
npm run build
npx playwright test
```

Expected: all Vitest and Playwright tests PASS; `dist/` contains the dashboard and `mwi-market-radar.user.js`.

- [ ] **Step 5: Commit end-to-end acceptance**

```powershell
git add market-radar/playwright.config.ts market-radar/e2e
git commit -m "test: cover market radar user journeys"
```

## Task 12: Perform live read-only collection acceptance and prepare handoff

**Files:**
- Create: `market-radar/README.md`
- Create: `market-radar/docs/manual-acceptance.md`
- Modify: `market-radar/vite.config.ts` only after Owner approves the deployed origin

- [ ] **Step 1: Document installation and the no-trade boundary**

The README gives exact local commands, how to install the generated userscript in Tampermonkey, why MWI must remain open for collection, why offline gaps are expected, where local history lives, how to remove it, and a bold statement that the tool never submits market actions.

- [ ] **Step 2: Verify one real official snapshot read**

With Owner's existing MWI Chrome page open, install the local userscript and observe only its status/storage. Do not open a buy/sell dialog. Confirm one stored timestamp equals the official JSON timestamp and that a second game tab does not create a second stored snapshot.

- [ ] **Step 3: Verify 1D/3D/7D with seeded local history**

Use the bridge's development-only import fixture in local preview, not a production import feature. Check one known +10%, one −10%, one single-sided quote, one `-1/-1`, and one enhancement-level pair. Remove fixture data afterward and confirm the real watchlist remains intact.

- [ ] **Step 4: Run the final verification suite**

Run:

```powershell
npm test
npm run build
npx playwright test
git status --short
git log --oneline -12
```

Expected: tests/build PASS; only intentionally untracked local evidence may remain; commit history contains the focused task commits above.

- [ ] **Step 5: Stop before deployment and ask for URL decisions**

Present the local build and request exactly:

1. GitHub account or organization.
2. Repository name.
3. Desired GitHub Pages URL or custom domain.
4. Public/private repository preference and Pages availability.

Do not add a Git remote, push, publish Pages, or add the final production `@match` until Owner answers.

- [ ] **Step 6: Commit documentation**

```powershell
git add market-radar/README.md market-radar/docs/manual-acceptance.md
git commit -m "docs: hand off local market radar"
```

## Final spec coverage check

- Official snapshot parsing, `-1`, one-sided quotes, timestamp de-duplication: Tasks 3, 5, 6.
- Hourly `xx:08`, startup check, one retry, multi-tab lock: Task 6.
- Ten MWI categories and convenience views: Tasks 2, 4, 8.
- Watchlist, independent enhancement levels, manual and market sorting: Task 8.
- 1D/3D/7D, nearest valid sample, no interpolation: Tasks 4, 9.
- Gainers, losers, volume, abnormal volume, volatility, spread, missing sides: Task 9.
- Eight-day retention and browser restart persistence: Task 5.
- Missing-script, quota, schema, offline-gap states: Task 10.
- No cookies, account data, trading actions, uploads, or AI calls: Tasks 6, 7, 10, 12.
- No remote URL or deployment without Owner confirmation: Task 12.
