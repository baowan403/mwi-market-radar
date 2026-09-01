# MWI Market Radar Cloud History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Market Radar as a GitHub Pages site backed by a shared eight-day hourly market history collected by GitHub Actions, while keeping Tampermonkey as an optional local fallback.

**Architecture:** A Node/TypeScript collector fetches and validates the public MWI marketplace snapshot, writes one immutable compressed text file per timestamp plus a manifest, and a GitHub Actions workflow commits those files to `market-data` before deploying the site. The dashboard loads cloud history first, stores only watchlist/settings in browser IndexedDB, optionally merges local GM snapshots by timestamp, and exposes a manual cloud refresh without any MWI write path.

**Tech Stack:** TypeScript, Node 22 + `tsx`, Vite, Vitest/jsdom, IndexedDB, GitHub Actions, GitHub Pages, Playwright/system Chrome.

---

## Scope and deployment boundary

- Work only in the existing `feature/mwi-market-radar-v1` worktree.
- Implement and test workflow files locally, but do not add a Git remote, create a GitHub repository, push, enable Pages, or choose the final URL until Owner confirms GitHub account and repository name.
- Cloud market data contains only the public official `marketplace.json` fields. Browser IndexedDB contains only Radar watchlist and settings.
- Keep current Tampermonkey collection working as fallback; public cloud mode must work without it.
- Do not add character imports, accounts, cookies, orders, alerts, trading, Cloudflare, or more than eight days of hourly history.

## File map

```text
.github/workflows/market-radar-pages.yml       hourly collect + build + Pages deploy
market-radar/
  package.json                                 add cloud scripts and tsx
  src/cloud/types.ts                           manifest and update-result contracts
  src/cloud/manifest.ts                        validation, retention, deterministic ordering
  src/cloud/history-store.ts                   immutable snapshot files + atomic manifest update
  scripts/update-cloud-history.ts              safe Node CLI for official fetch/update
  src/dashboard/cloud-client.ts                manifest/snapshot HTTP loader
  src/dashboard/preferences-store.ts            IndexedDB watchlist/settings only
  src/dashboard/hybrid-client.ts                cloud-first + local snapshot fallback
  src/dashboard/status.ts                       cloud/local/stale source labels
  src/app.ts                                    provider wiring + manual refresh
  tests/cloud-manifest.test.ts
  tests/cloud-history-store.test.ts
  tests/cloud-client.test.ts
  tests/preferences-store.test.ts
  tests/hybrid-client.test.ts
  tests/cloud-dashboard.test.ts
  tests/workflow.test.ts
  e2e/cloud-fixture.ts
  e2e/cloud-dashboard.spec.ts
  docs/cloud-operations.md
```

## Task 1: Define and validate the cloud manifest

**Files:**
- Create: `market-radar/src/cloud/types.ts`
- Create: `market-radar/src/cloud/manifest.ts`
- Create: `market-radar/tests/cloud-manifest.test.ts`

- [ ] **Step 1: Write failing manifest tests**

```ts
import { describe, expect, it } from 'vitest';
import { createManifest, parseManifest, retainEightDays } from '../src/cloud/manifest';

describe('cloud manifest', () => {
  it('sorts unique snapshots and retains the exact eight-day boundary', () => {
    const latest = Date.parse('2026-09-01T01:06:00Z');
    const manifest = createManifest([
      { timestamp: latest, file: `snapshots/${latest}.txt`, bytes: 42 },
      { timestamp: latest - 8 * 86_400_000, file: `snapshots/${latest - 8 * 86_400_000}.txt`, bytes: 40 },
      { timestamp: latest - 8 * 86_400_000 - 1, file: 'snapshots/old.txt', bytes: 40 },
    ], latest + 1_000);
    expect(retainEightDays(manifest).snapshots.map((entry) => entry.timestamp)).toEqual([
      latest - 8 * 86_400_000,
      latest,
    ]);
  });

  it('rejects duplicate timestamps, unsafe paths, and inconsistent latestTimestamp', () => {
    expect(() => parseManifest({ schemaVersion: 1, generatedAt: 'bad', latestTimestamp: 1, snapshots: [] }))
      .toThrow('Invalid cloud manifest');
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/cloud-manifest.test.ts`

Expected: FAIL because `src/cloud/manifest.ts` does not exist.

- [ ] **Step 3: Implement the manifest contract**

```ts
export interface CloudSnapshotEntry {
  timestamp: number;
  file: `snapshots/${number}.txt`;
  bytes: number;
}

export interface CloudManifest {
  schemaVersion: 1;
  generatedAt: string;
  latestTimestamp: number | null;
  snapshots: CloudSnapshotEntry[];
}

export const CLOUD_RETENTION_MS = 8 * 24 * 60 * 60 * 1_000;
```

`parseManifest` accepts only plain JSON data, safe millisecond timestamps, safe relative `snapshots/<timestamp>.txt` paths, nonnegative byte sizes, strict ascending unique entries, and a latestTimestamp equal to the final entry. `createManifest` sorts/deduplicates deterministically and serializes `generatedAt` from an injected time. `retainEightDays` uses the latest snapshot as the cutoff anchor and keeps `timestamp >= cutoff`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/cloud-manifest.test.ts`

Expected: PASS.

```powershell
git add market-radar/src/cloud/types.ts market-radar/src/cloud/manifest.ts market-radar/tests/cloud-manifest.test.ts
git commit -m "feat: define cloud market manifest"
```

## Task 2: Build the deterministic cloud history updater

**Files:**
- Create: `market-radar/src/cloud/history-store.ts`
- Create: `market-radar/scripts/update-cloud-history.ts`
- Create: `market-radar/tests/cloud-history-store.test.ts`
- Modify: `market-radar/package.json`
- Modify: `market-radar/package-lock.json`

- [ ] **Step 1: Add the CLI dependency and scripts**

Add `tsx` to devDependencies and scripts:

```json
{
  "scripts": {
    "cloud:update": "tsx scripts/update-cloud-history.ts",
    "cloud:validate": "tsx scripts/update-cloud-history.ts --validate-only"
  },
  "devDependencies": {
    "tsx": "^4.20.0"
  }
}
```

Run: `npm install`

- [ ] **Step 2: Write failing filesystem tests**

```ts
it('writes one immutable encoded snapshot and an atomic manifest', async () => {
  const result = await updateCloudHistory({ dataDir, snapshot, generatedAt: snapshot.timestamp + 1_000 });
  expect(result).toMatchObject({ inserted: true, latestTimestamp: snapshot.timestamp, snapshotCount: 1 });
  expect(await readFile(join(dataDir, 'snapshots', `${snapshot.timestamp}.txt`), 'utf8'))
    .toMatch(/^mwi-radar:gzip-json:v1:/);
  expect(parseManifest(JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8'))).latestTimestamp)
    .toBe(snapshot.timestamp);
});

it('is idempotent and prunes current tree files older than eight days', async () => {
  await updateCloudHistory({ dataDir, snapshot: oldSnapshot, generatedAt: oldSnapshot.timestamp });
  await updateCloudHistory({ dataDir, snapshot: currentSnapshot, generatedAt: currentSnapshot.timestamp });
  const duplicate = await updateCloudHistory({ dataDir, snapshot: currentSnapshot, generatedAt: currentSnapshot.timestamp + 1 });
  expect(duplicate.inserted).toBe(false);
  await expect(access(join(dataDir, 'snapshots', `${oldSnapshot.timestamp}.txt`))).rejects.toThrow();
});
```

- [ ] **Step 3: Implement atomic updates**

`updateCloudHistory` loads an existing manifest or creates an empty one, encodes `[snapshot]` with the existing codec, writes new files using `flag: 'wx'`, writes `manifest.json.tmp`, renames it over `manifest.json`, then removes pruned current-tree snapshot files. Any validation or write failure leaves the previous manifest readable. Same/older timestamps return a deterministic no-change result.

The CLI supports:

```text
--data-dir <absolute-or-relative-path>
--source-url <https-url>
--fixture <json-file>
--min-quotes <integer>
--validate-only
```

Defaults: official MWI marketplace URL, `./cloud-data`, minimum 1000 quote keys. It uses `fetchOfficialSnapshot`, sends no cookie/auth header, logs only timestamp, quote count, inserted state, snapshot count, and encoded bytes, and exits nonzero on failure.

- [ ] **Step 4: Verify updater behavior**

Run:

```powershell
npm test -- tests/cloud-history-store.test.ts
npm run cloud:update -- --fixture tests/fixtures/marketplace.json --data-dir .tmp-cloud-data --min-quotes 1
npm run cloud:validate -- --data-dir .tmp-cloud-data
```

Expected: tests PASS; one manifest/snapshot is created; validation reports one valid snapshot without printing payload data.

- [ ] **Step 5: Commit**

```powershell
git add market-radar/package.json market-radar/package-lock.json market-radar/src/cloud market-radar/scripts/update-cloud-history.ts market-radar/tests/cloud-history-store.test.ts
git commit -m "feat: update shared cloud market history"
```

## Task 3: Persist cloud-site preferences in IndexedDB

**Files:**
- Create: `market-radar/src/dashboard/preferences-store.ts`
- Create: `market-radar/tests/preferences-store.test.ts`

- [ ] **Step 1: Write failing preference tests**

```ts
it('persists only validated watchlist and Radar settings across store instances', async () => {
  const first = createPreferencesStore(adapter);
  await first.setWatchlist([{ key: '/items/test::7', order: 0 }]);
  await first.setSettings(DEFAULT_SETTINGS);
  const restarted = createPreferencesStore(adapter);
  expect(await restarted.getWatchlist()).toEqual([{ key: '/items/test::7', order: 0 }]);
  expect(await restarted.getSettings()).toEqual(DEFAULT_SETTINGS);
});

it('does not expose arbitrary keys', () => {
  expect(Object.keys(createPreferencesStore(adapter)).sort()).toEqual([
    'getSettings', 'getWatchlist', 'setSettings', 'setWatchlist',
  ]);
});
```

- [ ] **Step 2: Implement IndexedDB and memory adapters**

Use database `mwi-market-radar`, object store `preferences`, version 1, keys `watchlist` and `settings`. The production adapter wraps IndexedDB transactions; tests use a memory adapter with the same narrow interface. Reuse MarketStore validation semantics without importing GM APIs. Corrupt values return fixed preference errors rather than silently exposing arbitrary data.

- [ ] **Step 3: Verify privacy and persistence**

Run: `npm test -- tests/preferences-store.test.ts tests/privacy.test.ts`

Expected: PASS; production source still contains no localStorage, cookies, account API, or order operations. IndexedDB usage is limited to the two Radar preference keys.

- [ ] **Step 4: Commit**

```powershell
git add market-radar/src/dashboard/preferences-store.ts market-radar/tests/preferences-store.test.ts market-radar/tests/privacy.test.ts
git commit -m "feat: persist cloud dashboard preferences"
```

## Task 4: Load cloud history and merge optional local fallback

**Files:**
- Create: `market-radar/src/dashboard/cloud-client.ts`
- Create: `market-radar/src/dashboard/hybrid-client.ts`
- Create: `market-radar/tests/cloud-client.test.ts`
- Create: `market-radar/tests/hybrid-client.test.ts`
- Modify: `market-radar/src/core/types.ts`

- [ ] **Step 1: Write failing cloud client tests**

```ts
it('loads a valid manifest and paged compressed snapshot files', async () => {
  const result = await cloud.load();
  expect(result.snapshots.map((snapshot) => snapshot.timestamp)).toEqual([1000, 2000]);
  expect(result.source).toBe('cloud');
});

it('rejects partial, mismatched, and stale snapshot files without inventing data', async () => {
  await expect(cloud.load()).rejects.toMatchObject({ code: 'cloud_data_invalid' });
});
```

- [ ] **Step 2: Implement bounded cloud downloads**

`CloudMarketClient` fetches a same-origin manifest with `cache: 'no-store'`, validates it, downloads at most six snapshot files concurrently, decodes each with `decodeDayChunk`, verifies file timestamp equals snapshot timestamp, and returns sorted unique snapshots plus manifest metadata. A 15-second timeout and AbortSignal cover every request. Errors use fixed codes: `cloud_unavailable`, `cloud_stale`, `cloud_data_invalid`.

- [ ] **Step 3: Implement the dashboard client contract**

`HybridDashboardClient` implements the existing `DashboardClient` methods:

```ts
interface DashboardMarketSource {
  bootstrap(): Promise<BridgeBootstrap>;
  listSnapshots(): Promise<Snapshot[]>;
  setWatchlist(value: WatchItem[]): Promise<void>;
  setSettings(value: RadarSettings): Promise<void>;
  refresh(): Promise<void>;
}
```

Cloud snapshots are primary. If the optional local bridge becomes ready, local snapshots are merged and timestamp-deduplicated; equal timestamps keep cloud. Cloud failure with local success reports source `local-fallback`. Cloud and local failure reports no snapshots. Watchlist/settings always use IndexedDB in cloud mode, never shared cloud files.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npm test -- tests/cloud-client.test.ts tests/hybrid-client.test.ts
npm run build
```

Expected: PASS and dual build succeeds.

```powershell
git add market-radar/src/dashboard/cloud-client.ts market-radar/src/dashboard/hybrid-client.ts market-radar/src/core/types.ts market-radar/tests/cloud-client.test.ts market-radar/tests/hybrid-client.test.ts
git commit -m "feat: load shared cloud market history"
```

## Task 5: Wire cloud mode, refresh, and truthful status into the dashboard

**Files:**
- Modify: `market-radar/src/app.ts`
- Modify: `market-radar/src/dashboard/status.ts`
- Modify: `market-radar/src/styles.css`
- Create: `market-radar/tests/cloud-dashboard.test.ts`

- [ ] **Step 1: Add failing cloud-only UI tests**

```ts
it('mounts cloud data without a userscript and exposes manual refresh', async () => {
  await mountDashboard({ root, client: cloudOnlyClient, loadCatalog });
  expect(root.querySelector('[data-market-row]')).not.toBeNull();
  expect(root.querySelector('[data-source="cloud"]')?.textContent).toContain('雲端共同行情');
  (root.querySelector('[data-cloud-refresh]') as HTMLButtonElement).click();
  await flushPromises();
  expect(cloudOnlyClient.refresh).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Refactor production provider creation**

Production `mountDashboard` creates IndexedDB preferences, cloud client rooted at `new URL('./data/', document.baseURI)`, and an optional Tampermonkey bridge discovered within the existing bounded ready window. It does not wait for the bridge before displaying valid cloud data.

- [ ] **Step 3: Add source/stale UI and manual refresh**

Display one of `雲端共同行情`, `雲端＋本機備援`, `本機備援`, `資料不可用`. Add an `立即重新整理` button that disables while a refresh is active, keeps the prior rows on failure, updates manifest/status on success, and never calls MWI. The existing 60-second poll reads manifest metadata and downloads snapshot files only when latestTimestamp changes. Cloud latest older than 2.5 hours is warning/stale.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/cloud-dashboard.test.ts tests/dashboard.test.ts tests/health-status.test.ts`

Expected: PASS for cloud-only, hybrid, local fallback, refresh, stale, error, and destroy/in-flight behavior.

```powershell
git add market-radar/src/app.ts market-radar/src/dashboard/status.ts market-radar/src/styles.css market-radar/tests/cloud-dashboard.test.ts
git commit -m "feat: run dashboard from shared cloud data"
```

## Task 6: Add cloud-only browser acceptance

**Files:**
- Create: `market-radar/e2e/cloud-fixture.ts`
- Create: `market-radar/e2e/cloud-dashboard.spec.ts`
- Modify: `market-radar/playwright.config.ts`
- Modify: `market-radar/tests/e2e-fixture.test.ts`

- [ ] **Step 1: Create a real static cloud fixture**

The fixture route serves `data/manifest.json` and encoded snapshot text files without installing the local bridge. It contains at least 25 hourly timestamps across 24 hours, multiple enhancement levels, missing sides, low volume, and a changed latest manifest for refresh testing.

- [ ] **Step 2: Add cloud-only journeys**

Test desktop and responsive viewport:

- cloud site loads with zero userscript marker/bridge;
- source label is cloud;
- 1D trend and item chart use cloud files;
- watchlist survives reload through IndexedDB;
- refresh loads a new timestamp without rebuilding when unchanged;
- stale manifest warns but keeps rows;
- corrupt file fails closed;
- 100-row pagination, rankings, filters, and chart geometry remain stable.

- [ ] **Step 3: Run browser acceptance**

Run:

```powershell
npm test -- --run
npm run build
npm run e2e
```

Expected: all unit tests PASS; build emits dashboard/userscript; existing local and new cloud E2E suites PASS with only the intentional desktop skip of the mobile-specific check.

- [ ] **Step 4: Commit**

```powershell
git add market-radar/e2e/cloud-fixture.ts market-radar/e2e/cloud-dashboard.spec.ts market-radar/playwright.config.ts market-radar/tests/e2e-fixture.test.ts
git commit -m "test: cover cloud-only market radar"
```

## Task 7: Add GitHub Actions collection and Pages deployment

**Files:**
- Create: `.github/workflows/market-radar-pages.yml`
- Create: `market-radar/tests/workflow.test.ts`
- Create: `market-radar/docs/cloud-operations.md`
- Modify: `market-radar/README.md`

- [ ] **Step 1: Write failing workflow structure tests**

```ts
it('collects at minute 13, supports manual runs, and deploys Pages from one concurrency group', () => {
  expect(workflow).toContain('cron: "13 * * * *"');
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).toContain('pages: write');
  expect(workflow).toContain('id-token: write');
  expect(workflow).toContain('actions/deploy-pages@v4');
  expect(workflow).not.toMatch(/cookie|authorization|characterId/i);
});
```

Also parse YAML enough to verify schedule/dispatch/push triggers, permissions, concurrency, Node 22, `npm ci`, cloud update/validate/test/build, data branch commit, Pages artifact, and deploy dependency order.

- [ ] **Step 2: Implement the workflow**

Use `actions/checkout@v6`, `actions/setup-node@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v4`, and `actions/deploy-pages@v4`. Configure git user as `github-actions[bot]`. On schedule/dispatch, fetch/create an orphan `market-data` worktree, run the updater, commit only `data/**`, and push `HEAD:market-data`. On push, read the existing data branch without collecting. Copy `market-data/data` into `market-radar/public/data`, run unit/cloud validation/build, upload `market-radar/dist`, and deploy within the same workflow.

Use one concurrency group with `cancel-in-progress: false`. Fail before deployment if the manifest is absent or invalid; an unsuccessful run must leave the prior Pages deployment active.

- [ ] **Step 3: Document operations and limitations**

`cloud-operations.md` covers manual dispatch, stale diagnosis, workflow re-enable after inactivity, data branch inspection, safe rollback to prior Pages deployment, expected repo growth, and the explicit prohibition on secrets/character data. README changes public usage to “open the Pages URL”; local preview/Tampermonkey moves to developer/fallback instructions.

- [ ] **Step 4: Verify workflow and commit**

Run:

```powershell
npm test -- tests/workflow.test.ts tests/privacy.test.ts
npm test -- --run
npm run build
npm run e2e
git diff --check
```

Expected: all checks PASS; no remote exists; no cloud/private credentials appear in source.

```powershell
git add .github/workflows/market-radar-pages.yml market-radar/tests/workflow.test.ts market-radar/docs/cloud-operations.md market-radar/README.md
git commit -m "feat: deploy shared market history to Pages"
```

## Task 8: Prepare deployment without creating the remote

**Files:**
- Modify: `market-radar/docs/manual-acceptance.md`
- Create: `market-radar/docs/cloud-deployment-checklist.md`

- [ ] **Step 1: Record local cloud acceptance**

Run the collector twice against fixture data to prove insert/idempotence, advance an injected timestamp to prove retention, serve `dist` locally with fixture cloud data, and complete cloud-only E2E. Record timestamp, file count, manifest count, build hashes, unit/E2E results, and that no MWI tab was required.

- [ ] **Step 2: Create the deployment checklist**

Require Owner-provided GitHub owner, repository name, visibility, and domain choice. Include exact post-creation checks: Actions permission, Pages source GitHub Actions, initial manual workflow, `market-data` branch, manifest URL, public page source label, official timestamp match, second scheduled run, stale alert, and no secrets.

- [ ] **Step 3: Final verification and commit**

Run:

```powershell
npm test -- --run
npm run build
npm run e2e
git status --short
git remote -v
```

Expected: tests/build/E2E PASS; worktree clean after documentation commit; `git remote -v` empty.

```powershell
git add market-radar/docs/manual-acceptance.md market-radar/docs/cloud-deployment-checklist.md
git commit -m "docs: prepare cloud market radar deployment"
```

Stop before remote creation and ask Owner for the four deployment inputs from the approved specification.

## Final specification coverage

- Shared hourly public history and eight-day retention: Tasks 1–2.
- Cloud-only visitors and IndexedDB preferences: Tasks 3–5.
- Optional local Tampermonkey fallback with timestamp deduplication: Task 4.
- Manual refresh, 60-second polling, stale/error truth: Task 5.
- Cloud-only real-browser behavior: Task 6.
- Scheduled collection, data branch, Pages deployment, failure safety: Task 7.
- No remote or URL without Owner confirmation: Task 8.
- No account, cookie, character, order, trade, Cloudflare, or AI dependency: all tasks and privacy tests.
