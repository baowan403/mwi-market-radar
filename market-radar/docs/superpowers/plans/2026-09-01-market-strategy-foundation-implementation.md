# Market Strategy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable foundation for personalized MWI strategy recommendations: Traditional Chinese catalog data, Milkonomy-compatible local profile import, isolated IndexedDB profile storage, an auditable strategy-data artifact, and a pure single-step calculator that matches Milkonomy's conservative market assumptions.

**Architecture:** Keep the existing public cloud market dashboard intact. Add independent `profile`, `catalog`, and `strategy` domain modules with no Pinia, Vue, MWI DOM, React, WebSocket, or private server dependencies. Use the public Milkonomy repository only as a pinned MIT-licensed reference and golden-output oracle; commit generated reference artifacts so production builds never require Milkonomy or 牛牛股市 to be online.

**Tech Stack:** TypeScript 5.8, Vite 6, Vitest 3, fake-indexeddb, jsdom, Playwright, static JSON artifacts, GitHub Pages cloud market data.

---

## Scope and execution boundary

This is the first of five implementation plans derived from `docs/superpowers/specs/2026-09-01-market-strategy-recommendation-design.md`.

This plan delivers Slice A only:

- bilingual catalog and Chinese-first display/search;
- Milkonomy `version: 1` and preset import;
- local multi-profile storage and profile selection UI;
- pinned game-data subset for strategy calculations;
- action-buff evaluation;
- one-step manufacturing calculation with Milkonomy parity fixtures.

It does **not** add workflow search, decomposition-to-coinify, liquidity-adjusted rankings, 3D/7D strategy trend signals, enhancement, or transmutation. Those receive separate plans after this foundation passes.

Do not stage or commit the existing unrelated modifications in:

- `docs/cloud-deployment-checklist.md`
- `docs/cloud-operations.md`
- `docs/manual-acceptance.md`

## Locked file structure

### New files

- `THIRD_PARTY_NOTICES.md` — exact Milkonomy reference commit, MIT notice, and 牛牛股市 reference-only boundary.
- `scripts/import-milkonomy-reference.ts` — one-time, explicit vendor importer; reads a caller-provided Milkonomy clone and emits committed deterministic artifacts.
- `scripts/vendor/milkonomy/source.json` — source URL, commit, game-data version, and file hashes.
- `scripts/vendor/milkonomy/zh-tw.json` — committed translation dictionary used by catalog builds.
- `scripts/vendor/milkonomy/strategy-data.json` — committed minimal game-data subset used by strategy calculations.
- `src/core/catalog.ts` — Chinese-first display/search helpers with English fallback.
- `src/profile/types.ts` — normalized local player profile types.
- `src/profile/import.ts` — strict adapters for Milkonomy Exporter v1 and Milkonomy preset.
- `src/profile/store.ts` — dedicated IndexedDB and memory profile stores.
- `src/profile/panel.ts` — profile import/select/delete dialog controller.
- `src/strategy/types.ts` — pinned strategy-data and calculation result types.
- `src/strategy/game-data.ts` — validator/index for committed strategy data.
- `src/strategy/buffs.ts` — pure player/action buff evaluator.
- `src/strategy/manufacture.ts` — pure one-step manufacturing calculator.
- `tests/fixtures/profile-export-v1.json` — synthetic complete profile.
- `tests/fixtures/profile-preset.json` — synthetic preset profile.
- `tests/fixtures/milkonomy-manufacture-golden.json` — source-pinned expected results.
- `tests/profile-import.test.ts`
- `tests/profile-store.test.ts`
- `tests/profile-panel.test.ts`
- `tests/strategy-game-data.test.ts`
- `tests/strategy-buffs.test.ts`
- `tests/strategy-manufacture.test.ts`
- `e2e/profile-import.spec.ts`

### Modified files

- `package.json` — add explicit reference-import and strategy-data validation scripts.
- `scripts/build-catalog.mjs` — emit Chinese and English names from the pinned translation artifact.
- `public/catalog.json` — regenerated bilingual catalog.
- `src/core/types.ts` — extend catalog types without changing market snapshot contracts.
- `src/dashboard/state.ts` — derive Chinese-first display names and bilingual search text.
- `src/dashboard/filters.ts` — search the precomputed bilingual text.
- `src/app.ts` — add profile status/import controls only; strategy ranking is deferred.
- `src/styles.css` — profile dialog and status styling.
- `tests/catalog.test.ts`
- `tests/dashboard-state.test.ts`
- `tests/privacy.test.ts`

## Reference contracts

Pin Milkonomy to:

```text
Repository: https://github.com/Polokikiki/Milkonomy.git
Commit: febe90f14f7ea1e51937cc888f6f6e1907c58fff
License: MIT
```

Reference these source files during review:

```text
src/pages/dashboard/components/ActionConfig.vue
src/calculator/index.ts
src/calculator/manufacture.ts
src/calculator/workflow.ts
src/common/apis/player/index.ts
src/pinia/stores/game.ts
src/common/constants/market.ts
src/locales/lang/zh-tw.ts
public/data/data.json
```

牛牛股市 remains a UX/data-shape reference only. Do not call its private or undocumented APIs from production code.

---

### Task 1: Pin third-party provenance and deterministic reference import

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `scripts/import-milkonomy-reference.ts`
- Create: `scripts/vendor/milkonomy/source.json`
- Create: `scripts/vendor/milkonomy/zh-tw.json`
- Create: `scripts/vendor/milkonomy/strategy-data.json`
- Modify: `package.json`
- Test: `tests/strategy-game-data.test.ts`

- [ ] **Step 1: Write a failing provenance/artifact test**

Create `tests/strategy-game-data.test.ts` with the initial contract:

```ts
import source from '../scripts/vendor/milkonomy/source.json';
import translations from '../scripts/vendor/milkonomy/zh-tw.json';
import strategyData from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';

describe('pinned Milkonomy reference artifacts', () => {
  it('pins the reviewed MIT source and keeps deterministic metadata', () => {
    expect(source).toMatchObject({
      repository: 'https://github.com/Polokikiki/Milkonomy.git',
      commit: 'febe90f14f7ea1e51937cc888f6f6e1907c58fff',
      license: 'MIT',
    });
    expect(source.gameVersion).toMatch(/^v\d+\./);
    expect(source.files).toEqual(expect.objectContaining({
      gameDataSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      translationsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('contains translations and only the strategy maps needed by the browser', () => {
    expect(Object.keys(translations).length).toBeGreaterThan(500);
    expect(strategyData).toEqual(expect.objectContaining({
      gameVersion: expect.any(String),
      enhancementLevelTotalBonusMultiplierTable: expect.any(Array),
      itemDetailMap: expect.any(Object),
      actionDetailMap: expect.any(Object),
      communityBuffTypeDetailMap: expect.any(Object),
      achievementTierDetailMap: expect.any(Object),
      personalBuffTypeDetailMap: expect.any(Object),
    }));
    expect(strategyData).not.toHaveProperty('monsterDetailMap');
    expect(strategyData).not.toHaveProperty('chat');
    expect(strategyData).not.toHaveProperty('character');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing artifacts fail**

Run:

```powershell
npx vitest run tests/strategy-game-data.test.ts
```

Expected: FAIL because the three `scripts/vendor/milkonomy/*.json` modules do not exist.

- [ ] **Step 3: Implement the explicit reference importer**

Create `scripts/import-milkonomy-reference.ts`. It must reject a dirty, wrong, or unpinned clone and emit stable sorted JSON:

```ts
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_COMMIT = 'febe90f14f7ea1e51937cc888f6f6e1907c58fff';
const REPOSITORY = 'https://github.com/Polokikiki/Milkonomy.git';
const milkonomyDirectory = process.env.MWI_MILKONOMY_DIR?.trim();
if (!milkonomyDirectory) throw new Error('MWI_MILKONOMY_DIR is required');

const safeDirectoryArgs = ['-c', `safe.directory=${absoluteMilkonomyDirectory}`];
const head = execFileSync('git', [...safeDirectoryArgs, 'rev-parse', 'HEAD'], {
  cwd: milkonomyDirectory,
  encoding: 'utf8',
}).trim();
const status = execFileSync('git', [...safeDirectoryArgs, 'status', '--porcelain'], {
  cwd: milkonomyDirectory,
  encoding: 'utf8',
}).trim();
if (head !== EXPECTED_COMMIT) throw new Error(`Unexpected Milkonomy commit: ${head}`);
if (status !== '') throw new Error('Milkonomy reference clone must be clean');

const gameDataPath = path.join(milkonomyDirectory, 'public', 'data', 'data.json');
const translationPath = path.join(milkonomyDirectory, 'src', 'locales', 'lang', 'zh-tw.ts');
const gameDataRaw = await readFile(gameDataPath, 'utf8');
const gameData = JSON.parse(gameDataRaw) as Record<string, unknown>;
const translationModule = await import(pathToFileURL(translationPath).href);
const translations = translationModule.default as Record<string, string>;

const strategyData = {
  gameVersion: gameData.gameVersion,
  versionTimestamp: gameData.versionTimestamp,
  enhancementLevelTotalBonusMultiplierTable: gameData.enhancementLevelTotalBonusMultiplierTable,
  itemDetailMap: gameData.itemDetailMap,
  actionDetailMap: gameData.actionDetailMap,
  communityBuffTypeDetailMap: gameData.communityBuffTypeDetailMap,
  achievementTierDetailMap: gameData.achievementTierDetailMap,
  personalBuffTypeDetailMap: gameData.personalBuffTypeDetailMap,
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function json(value: unknown): string {
  return `${JSON.stringify(stable(value))}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const output = path.resolve('scripts', 'vendor', 'milkonomy');
await mkdir(output, { recursive: true });
const translationsJson = json(translations);
const strategyDataJson = json(strategyData);
await writeFile(path.join(output, 'zh-tw.json'), translationsJson, 'utf8');
await writeFile(path.join(output, 'strategy-data.json'), strategyDataJson, 'utf8');
await writeFile(path.join(output, 'source.json'), json({
  repository: REPOSITORY,
  commit: EXPECTED_COMMIT,
  license: 'MIT',
  gameVersion: gameData.gameVersion,
  versionTimestamp: gameData.versionTimestamp,
  files: {
    gameDataSha256: sha256(gameDataRaw),
    translationsSha256: sha256(translationsJson),
    strategyDataSha256: sha256(strategyDataJson),
  },
}), 'utf8');
```

Add to `package.json`:

```json
"reference:milkonomy": "tsx scripts/import-milkonomy-reference.ts"
```

Run the importer against the reviewed local clone:

```powershell
$env:MWI_MILKONOMY_DIR='..\..\..\work\milkonomy-source'
npm run reference:milkonomy
Remove-Item Env:MWI_MILKONOMY_DIR
```

Create `THIRD_PARTY_NOTICES.md` with the full Milkonomy MIT license text already present in the reference clone, the repository URL, the pinned commit, and this statement:

```markdown
The Milkonomy reference is used for game-data normalization, Traditional Chinese localization, import compatibility, and numerical parity tests. MWI Market Radar does not embed Milkonomy's Vue/Pinia application and does not call Milkonomy at runtime.

牛牛股市 (`stockmarket.xin`) was inspected as a public UX reference. No private or undocumented 牛牛股市 API, account system, player data, or backend code is included or called by MWI Market Radar.
```

- [ ] **Step 4: Run the focused test and reference determinism check**

Run the importer twice and verify no diff appears:

```powershell
$env:MWI_MILKONOMY_DIR='..\..\..\work\milkonomy-source'
npm run reference:milkonomy
$first = git diff -- scripts/vendor/milkonomy
npm run reference:milkonomy
$second = git diff -- scripts/vendor/milkonomy
Remove-Item Env:MWI_MILKONOMY_DIR
if ($first -ne $second) { throw 'Reference import is not deterministic' }
npx vitest run tests/strategy-game-data.test.ts
```

Expected: importer exits 0 twice; focused test PASS.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add market-radar/THIRD_PARTY_NOTICES.md market-radar/package.json market-radar/scripts/import-milkonomy-reference.ts market-radar/scripts/vendor/milkonomy market-radar/tests/strategy-game-data.test.ts
git commit -m "chore: pin Milkonomy strategy reference"
```

---

### Task 2: Generate and display a Chinese-first bilingual catalog

**Files:**
- Create: `src/core/catalog.ts`
- Modify: `src/core/types.ts`
- Modify: `scripts/build-catalog.mjs`
- Modify: `public/catalog.json`
- Modify: `src/dashboard/state.ts`
- Modify: `src/core/rankings.ts`
- Modify: `tests/catalog.test.ts`
- Modify: `tests/dashboard-state.test.ts`

- [ ] **Step 1: Extend failing catalog tests for bilingual identity and search**

Add to `tests/catalog.test.ts`:

```ts
it('provides Chinese-first bilingual names without changing HRID identity', () => {
  const translated = catalog.items.filter((item) => item.nameZhHant);
  expect(translated.length).toBeGreaterThan(100);
  expect(catalog.items.every((item) => typeof item.nameEn === 'string' && item.nameEn.length > 0)).toBe(true);
  expect(catalog.categories.every((category) => typeof category.nameZhHant === 'string')).toBe(true);
});
```

Update the local fixture in `tests/dashboard-state.test.ts`:

```ts
items: [
  { hrid: '/items/gloves', name: '時空手套', nameZhHant: '時空手套', nameEn: 'Chrono Gloves', categoryHrid: '/item_categories/equipment', sortIndex: 2 },
  { hrid: '/items/apple', name: '紅蘋果', nameZhHant: '紅蘋果', nameEn: 'Apple', categoryHrid: '/item_categories/food', sortIndex: 1 },
],
```

Add a search assertion:

```ts
expect(filterViewRows(rows, { query: 'Chrono' }).map((row) => row.key)).toEqual(['/items/gloves::7']);
```

- [ ] **Step 2: Run the focused tests and verify the missing fields fail**

```powershell
npx vitest run tests/catalog.test.ts tests/dashboard-state.test.ts
```

Expected: FAIL because catalog entries and `MarketRow` do not expose bilingual search text.

- [ ] **Step 3: Implement bilingual catalog helpers and generator output**

Extend `CatalogItem` and `CatalogCategory` in `src/core/types.ts`:

```ts
export interface CatalogItem {
  hrid: string;
  name: string;
  nameZhHant: string | null;
  nameEn: string;
  categoryHrid: string;
  sortIndex: number;
}

export interface CatalogCategory {
  hrid: string;
  name: string;
  nameZhHant: string;
  nameEn: string;
  sortIndex: number;
}
```

Create `src/core/catalog.ts`:

```ts
import type { CatalogCategory, CatalogItem } from './types';

export function catalogItemName(item: CatalogItem): string {
  return item.nameZhHant?.trim() || item.nameEn;
}

export function catalogCategoryName(category: CatalogCategory): string {
  return category.nameZhHant.trim() || category.nameEn;
}

export function catalogSearchText(item: CatalogItem): string {
  return [catalogItemName(item), item.nameEn, item.hrid]
    .join(' ')
    .toLocaleLowerCase('zh-Hant');
}
```

Modify `scripts/build-catalog.mjs` to read `scripts/vendor/milkonomy/zh-tw.json` and emit both names:

```js
const translations = readJson(path.join(projectDirectory, 'scripts', 'vendor', 'milkonomy', 'zh-tw.json'));
const CATEGORY_ZH_HANT = {
  '/item_categories/currency': '貨幣',
  '/item_categories/loot': '戰利品',
  '/item_categories/scroll': '卷軸',
  '/item_categories/labyrinth': '迷宮',
  '/item_categories/dungeon_key': '地下城鑰匙',
  '/item_categories/food': '食物',
  '/item_categories/drink': '飲料',
  '/item_categories/ability_book': '技能書',
  '/item_categories/equipment': '裝備',
  '/item_categories/resource': '資源',
};
```

Emit categories with:

```js
return {
  hrid,
  name: CATEGORY_ZH_HANT[hrid],
  nameZhHant: CATEGORY_ZH_HANT[hrid],
  nameEn: category.name,
  sortIndex: category.sortIndex,
};
```

Emit items with:

```js
const nameZhHant = typeof translations[item.name] === 'string' ? translations[item.name] : null;
items.push({
  hrid: item.hrid,
  name: nameZhHant || item.name,
  nameZhHant,
  nameEn: item.name,
  categoryHrid: item.categoryHrid,
  sortIndex: item.sortIndex,
});
```

In `src/dashboard/state.ts`, use `catalogItemName(catalogItem)` for `row.name` and add `searchText: catalogSearchText(catalogItem)` to `DerivedMarketRow`. Extend `MarketRow` in `src/core/rankings.ts` with `searchText: string`, and make `filterRows` compare `row.searchText` instead of only `row.name` and `row.key`.

Regenerate:

```powershell
npm run build:catalog
```

- [ ] **Step 4: Run catalog, dashboard, and build verification**

```powershell
npx vitest run tests/catalog.test.ts tests/dashboard-state.test.ts tests/rankings.test.ts
npm run build
```

Expected: focused tests PASS; TypeScript/Vite/userscript build exits 0.

- [ ] **Step 5: Commit Task 2 files**

```powershell
git add market-radar/scripts/build-catalog.mjs market-radar/public/catalog.json market-radar/src/core/catalog.ts market-radar/src/core/types.ts market-radar/src/core/rankings.ts market-radar/src/dashboard/state.ts market-radar/tests/catalog.test.ts market-radar/tests/dashboard-state.test.ts
git commit -m "feat: localize market catalog in Traditional Chinese"
```

---

### Task 3: Normalize Milkonomy Exporter and preset profiles

**Files:**
- Create: `src/profile/types.ts`
- Create: `src/profile/import.ts`
- Create: `tests/fixtures/profile-export-v1.json`
- Create: `tests/fixtures/profile-preset.json`
- Create: `tests/profile-import.test.ts`

- [ ] **Step 1: Write failing profile import tests**

Use synthetic names and values; do not commit Owner character exports. Create fixtures with all ten skilling actions, synthetic equipment HRIDs, houses, buffs, shrines, achievements, and teas.

Create `tests/profile-import.test.ts`:

```ts
import exporter from './fixtures/profile-export-v1.json';
import preset from './fixtures/profile-preset.json';
import { describe, expect, it } from 'vitest';
import { ProfileImportError, importPlayerProfile } from '../src/profile/import';

describe('Milkonomy profile import', () => {
  it('normalizes version-one exporter data without retaining unknown private fields', () => {
    const profile = importPlayerProfile(JSON.stringify(exporter), 1_788_220_800_000);
    expect(profile).toMatchObject({
      id: 'character:700001',
      name: '測試牛一號',
      source: 'milkonomy-v1',
      importedAt: 1_788_220_800_000,
      completeness: 'full',
    });
    expect(profile.actions.alchemy.playerLevel).toBe(103);
    expect(profile.actions.alchemy.tool).toEqual({ itemHrid: '/items/holy_alembic', enhancementLevel: 10 });
    expect(profile.communityBuffs.production_efficiency).toBe(10);
    expect(profile.shrines.rhythm).toBe(3);
    expect(JSON.stringify(profile)).not.toContain('token');
    expect(JSON.stringify(profile)).not.toContain('cookie');
  });

  it('imports presets as partial profiles and reports absent fields', () => {
    const profile = importPlayerProfile(JSON.stringify(preset), 1_788_220_800_000);
    expect(profile.source).toBe('milkonomy-preset');
    expect(profile.completeness).toBe('partial');
    expect(profile.missingFields).toEqual(expect.arrayContaining(['characterId', 'inventoryMap']));
    expect(profile.actions.brewing.teas).toHaveLength(3);
  });

  it('rejects unrecognized, oversized, and invalid documents with a fixed safe error', () => {
    expect(() => importPlayerProfile('{}')).toThrow(ProfileImportError);
    expect(() => importPlayerProfile('{"version":1,"skills":[]}')).toThrow(ProfileImportError);
    expect(() => importPlayerProfile('x'.repeat(1_000_001))).toThrow(ProfileImportError);
    try {
      importPlayerProfile('{"password":"secret-value"}');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-value');
    }
  });
});
```

- [ ] **Step 2: Run the test and verify importer absence fails**

```powershell
npx vitest run tests/profile-import.test.ts
```

Expected: FAIL because `src/profile/import.ts` does not exist.

- [ ] **Step 3: Implement strict normalized profile types and adapters**

Create `src/profile/types.ts`:

```ts
export const SKILLING_ACTIONS = [
  'milking', 'foraging', 'woodcutting', 'cheesesmithing', 'crafting',
  'tailoring', 'cooking', 'brewing', 'alchemy', 'enhancing',
] as const;
export type SkillingAction = typeof SKILLING_ACTIONS[number];

export interface ProfileEquipment {
  itemHrid: string;
  enhancementLevel: number;
}

export interface ActionProfile {
  playerLevel: number;
  tool: ProfileEquipment | null;
  body: ProfileEquipment | null;
  legs: ProfileEquipment | null;
  back: ProfileEquipment | null;
  charm: ProfileEquipment | null;
  houseLevel: number;
  teas: string[];
}

export interface PlayerProfile {
  id: string;
  characterId: number | null;
  name: string;
  source: 'milkonomy-v1' | 'milkonomy-preset';
  importedAt: number;
  completeness: 'full' | 'partial';
  missingFields: string[];
  actions: Record<SkillingAction, ActionProfile>;
  specialEquipment: Record<string, ProfileEquipment>;
  communityBuffs: Record<string, number>;
  shrines: Record<string, number>;
  achievements: Record<string, boolean>;
  inventoryMap: Record<string, number>;
}
```

Create `src/profile/import.ts` with these exported contracts:

```ts
import { SKILLING_ACTIONS, type ActionProfile, type PlayerProfile, type ProfileEquipment, type SkillingAction } from './types';

const MAX_PROFILE_BYTES = 1_000_000;
const SKILL_HRIDS = Object.fromEntries(SKILLING_ACTIONS.map((action) => [`/skills/${action}`, action])) as Record<string, SkillingAction>;

export class ProfileImportError extends Error {
  readonly code = 'profile_import';
  constructor() {
    super('角色快照格式無法辨識');
    this.name = 'ProfileImportError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function equipment(value: unknown): ProfileEquipment | null {
  const item = record(value);
  const itemHrid = typeof item?.itemHrid === 'string' ? item.itemHrid : typeof item?.hrid === 'string' ? item.hrid : '';
  if (!itemHrid.startsWith('/items/')) return null;
  return { itemHrid, enhancementLevel: integer(item?.enhancementLevel ?? item?.enhanceLevel) };
}

function emptyAction(): ActionProfile {
  return { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] };
}

function safeMap(value: unknown): Record<string, number> {
  const source = record(value) ?? {};
  return Object.fromEntries(Object.entries(source)
    .filter(([key, item]) => key.startsWith('/') && typeof item === 'number' && Number.isFinite(item))
    .map(([key, item]) => [key, item as number]));
}

export function importPlayerProfile(text: string, importedAt = Date.now()): PlayerProfile {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new ProfileImportError();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProfileImportError(); }
  const data = record(parsed);
  if (!data) throw new ProfileImportError();
  if (data.version === 1 && record(data.skills)) return importExporter(data, importedAt);
  if (record(data.actionConfigMap) && record(data.specialEquimentMap)) return importPreset(data, importedAt);
  throw new ProfileImportError();
}
```

Implement the private adapters in the same file with these normalization helpers and mappings:

```ts
function actionRecord(): Record<SkillingAction, ActionProfile> {
  return Object.fromEntries(SKILLING_ACTIONS.map((action) => [action, emptyAction()])) as Record<SkillingAction, ActionProfile>;
}

function nameOf(data: Record<string, unknown>): string {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 80) throw new ProfileImportError();
  return name;
}

function teaList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && item.startsWith('/items/')))].slice(0, 3);
}

function numericRecord(value: unknown, stripPrefix = false): Record<string, number> {
  const source = record(value) ?? {};
  return Object.fromEntries(Object.entries(source).flatMap(([key, item]) => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) return [];
    const normalizedKey = stripPrefix ? key.split('/').at(-1) ?? '' : key;
    return normalizedKey ? [[normalizedKey, item]] : [];
  }));
}

function achievementRecord(value: unknown): { characterId: number | null; completed: Record<string, boolean> } {
  if (!Array.isArray(value)) return { characterId: null, completed: {} };
  let characterId: number | null = null;
  const completed: Record<string, boolean> = {};
  for (const raw of value) {
    const item = record(raw);
    const hrid = typeof item?.achievementHrid === 'string' ? item.achievementHrid : '';
    if (characterId === null && typeof item?.characterID === 'number' && Number.isSafeInteger(item.characterID)) {
      characterId = item.characterID;
    }
    if (hrid.startsWith('/achievements/')) completed[hrid] = item?.isCompleted === true;
  }
  return { characterId, completed };
}

function equipmentSlots(value: unknown): Record<string, ProfileEquipment> {
  const result: Record<string, ProfileEquipment> = {};
  for (const [locationHrid, raw] of Object.entries(record(value) ?? {})) {
    const normalized = equipment(raw);
    const slot = locationHrid.split('/').at(-1);
    if (normalized && slot) result[slot] = normalized;
  }
  return result;
}

function importExporter(data: Record<string, unknown>, importedAt: number): PlayerProfile {
  const name = nameOf(data);
  const actions = actionRecord();
  const slots = equipmentSlots(data.equipment);
  for (const [skillHrid, rawLevel] of Object.entries(record(data.skills) ?? {})) {
    const action = SKILL_HRIDS[skillHrid];
    if (action) actions[action].playerLevel = integer(rawLevel, 1);
  }
  const houses = numericRecord(data.houses);
  const actionTeas = record(data.actionTeas) ?? {};
  for (const action of SKILLING_ACTIONS) {
    actions[action].tool = slots[`${action}_tool`] ?? null;
    actions[action].body = slots.body ?? null;
    actions[action].legs = slots.legs ?? null;
    actions[action].back = slots.back ?? null;
    actions[action].charm = slots.charm ?? slots.amulet ?? null;
    const room = Object.entries(houses).find(([hrid]) => hrid.includes(action));
    actions[action].houseLevel = room?.[1] ?? 0;
    actions[action].teas = teaList(actionTeas[action]);
  }
  const achievements = achievementRecord(data.achievements);
  const inventoryMap = safeMap(data.inventoryMap);
  const missingFields = [
    ...(achievements.characterId === null ? ['characterId'] : []),
    ...(Object.keys(inventoryMap).length === 0 ? ['inventoryMap'] : []),
  ];
  return {
    id: achievements.characterId === null ? `milkonomy-v1:${name}` : `character:${achievements.characterId}`,
    characterId: achievements.characterId,
    name,
    source: 'milkonomy-v1',
    importedAt,
    completeness: missingFields.length === 0 ? 'full' : 'partial',
    missingFields,
    actions,
    specialEquipment: slots,
    communityBuffs: numericRecord(data.communityBuffs, true),
    shrines: numericRecord(data.shrines, true),
    achievements: achievements.completed,
    inventoryMap,
  };
}

function importPreset(data: Record<string, unknown>, importedAt: number): PlayerProfile {
  const name = nameOf(data);
  const actions = actionRecord();
  for (const action of SKILLING_ACTIONS) {
    const raw = record(record(data.actionConfigMap)?.[action]);
    if (!raw) continue;
    actions[action] = {
      playerLevel: integer(raw.playerLevel, 1),
      tool: equipment(raw.tool),
      body: equipment(raw.body),
      legs: equipment(raw.legs),
      back: equipment(raw.back),
      charm: equipment(raw.charm),
      houseLevel: integer(raw.houseLevel),
      teas: teaList(raw.tea),
    };
  }
  const specialEquipment = Object.fromEntries(Object.entries(record(data.specialEquimentMap) ?? {})
    .flatMap(([slot, raw]) => {
      const normalized = equipment(raw);
      return normalized ? [[slot, normalized]] : [];
    }));
  const communityBuffs = Object.fromEntries(Object.entries(record(data.communityBuffMap) ?? {})
    .flatMap(([key, raw]) => {
      const level = record(raw)?.level;
      return typeof level === 'number' && Number.isFinite(level) ? [[key, level]] : [];
    }));
  const shrines = Object.fromEntries(Object.entries(record(data.shrineBuffMap) ?? {})
    .flatMap(([key, raw]) => {
      const level = record(raw)?.level;
      return typeof level === 'number' && Number.isFinite(level) ? [[key, level]] : [];
    }));
  const achievements = Object.fromEntries(Object.entries(record(data.achievementBuffMap) ?? {})
    .map(([key, raw]) => [key, record(raw)?.enabled === true]));
  return {
    id: `milkonomy-preset:${name}`,
    characterId: null,
    name,
    source: 'milkonomy-preset',
    importedAt,
    completeness: 'partial',
    missingFields: ['characterId', 'inventoryMap'],
    actions,
    specialEquipment,
    communityBuffs,
    shrines,
    achievements,
    inventoryMap: {},
  };
}
```

These functions initialize all ten actions, accept at most three unique teas, and never preserve unknown top-level fields.

- [ ] **Step 4: Run importer tests and full type-check**

```powershell
npx vitest run tests/profile-import.test.ts
npx tsc --noEmit
```

Expected: importer tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit Task 3 files**

```powershell
git add market-radar/src/profile/types.ts market-radar/src/profile/import.ts market-radar/tests/fixtures/profile-export-v1.json market-radar/tests/fixtures/profile-preset.json market-radar/tests/profile-import.test.ts
git commit -m "feat: import Milkonomy player profiles"
```

---

### Task 4: Persist profiles in an isolated IndexedDB store

**Files:**
- Create: `src/profile/store.ts`
- Create: `tests/profile-store.test.ts`

- [ ] **Step 1: Write failing memory and IndexedDB store tests**

Create `tests/profile-store.test.ts` using `fake-indexeddb/auto` with this complete matrix:

```ts
import 'fake-indexeddb/auto';
import exporter from './fixtures/profile-export-v1.json';
import preset from './fixtures/profile-preset.json';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { PROFILE_DATABASE_NAME, createMemoryProfileStore, createProfileStore } from '../src/profile/store';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PROFILE_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe.each([
  ['memory', () => createMemoryProfileStore()],
  ['indexeddb', () => createProfileStore()],
])('%s profile store', (_name, create) => {
  it('keeps multiple characters isolated and preserves one active id', async () => {
    const store = create();
    const first = importPlayerProfile(JSON.stringify(exporter), 100);
    const second = importPlayerProfile(JSON.stringify(preset), 200);
    await store.put(first);
    await store.put(second);
    await store.setActiveId(second.id);
    expect((await store.list()).map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(await store.getActiveId()).toBe(second.id);
    expect((await store.get(first.id))?.actions.alchemy.playerLevel).toBe(103);
    store.close();
  });

  it('deletes only the selected profile and clears its active pointer', async () => {
    const store = create();
    const profile = importPlayerProfile(JSON.stringify(exporter));
    await store.put(profile);
    await store.setActiveId(profile.id);
    await store.delete(profile.id);
    expect(await store.get(profile.id)).toBeNull();
    expect(await store.getActiveId()).toBeNull();
    store.close();
  });
});
```

- [ ] **Step 2: Run the test and verify missing store failure**

```powershell
npx vitest run tests/profile-store.test.ts
```

Expected: FAIL because `src/profile/store.ts` does not exist.

- [ ] **Step 3: Implement the explicit profile-store interface**

Create `src/profile/store.ts` with no generic public key/value methods:

```ts
import type { PlayerProfile } from './types';

export const PROFILE_DATABASE_NAME = 'mwi-market-radar-profiles';
export const PROFILE_DATABASE_VERSION = 1;
const PROFILE_STORE = 'profiles';
const META_STORE = 'meta';
const ACTIVE_ID_KEY = 'active-profile-id';

export interface ProfileStore {
  list(): Promise<PlayerProfile[]>;
  get(id: string): Promise<PlayerProfile | null>;
  put(profile: PlayerProfile): Promise<void>;
  delete(id: string): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
  close(): void;
}
```

Implement `createMemoryProfileStore()` with a private `Map<string, PlayerProfile>` and `structuredClone` on every read/write. Implement `createProfileStore({ indexedDB = globalThis.indexedDB } = {})` with two fixed stores created in `onupgradeneeded`. `put` uses profile id as key; `delete` removes only that key and clears `ACTIVE_ID_KEY` only when it matches. Wrap open/read/write failures in a fixed `ProfileStoreError('profile_storage')` whose message contains no profile contents.

- [ ] **Step 4: Run profile store and privacy tests**

```powershell
npx vitest run tests/profile-store.test.ts tests/privacy.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit Task 4 files**

```powershell
git add market-radar/src/profile/store.ts market-radar/tests/profile-store.test.ts
git commit -m "feat: persist local player profiles"
```

---

### Task 5: Add the profile import/select/delete player surface

**Files:**
- Create: `src/profile/panel.ts`
- Create: `tests/profile-panel.test.ts`
- Modify: `src/app.ts`
- Modify: `src/styles.css`
- Test: `e2e/profile-import.spec.ts`

- [ ] **Step 1: Write failing DOM tests for the profile panel**

Create `tests/profile-panel.test.ts` under jsdom. The controller contract is:

```ts
import exporter from './fixtures/profile-export-v1.json';
import { describe, expect, it } from 'vitest';
import { createMemoryProfileStore } from '../src/profile/store';
import { createProfilePanel } from '../src/profile/panel';

describe('profile panel', () => {
  it('imports, activates, and renders one local profile without network access', async () => {
    document.body.innerHTML = '<button id="open"></button><span id="summary"></span><dialog id="dialog"></dialog>';
    const store = createMemoryProfileStore();
    const panel = createProfilePanel({
      openButton: document.querySelector('#open')!,
      summary: document.querySelector('#summary')!,
      dialog: document.querySelector('#dialog')!,
      store,
      now: () => 1_788_220_800_000,
    });
    await panel.importText(JSON.stringify(exporter));
    expect(document.querySelector('#summary')?.textContent).toContain('測試牛一號');
    expect(document.querySelector('#summary')?.textContent).toContain('煉金 103');
    expect(await store.getActiveId()).toBe('character:700001');
    panel.destroy();
  });
});
```

- [ ] **Step 2: Run the panel test and verify missing controller failure**

```powershell
npx vitest run tests/profile-panel.test.ts
```

Expected: FAIL because `src/profile/panel.ts` does not exist.

- [ ] **Step 3: Implement and mount the profile panel**

Create `src/profile/panel.ts` exporting:

```ts
export interface ProfilePanel {
  importText(text: string): Promise<void>;
  refresh(): Promise<void>;
  destroy(): void;
}

export function createProfilePanel(options: {
  openButton: HTMLButtonElement;
  summary: HTMLElement;
  dialog: HTMLDialogElement;
  store: ProfileStore;
  now?: () => number;
}): ProfilePanel;
```

The dialog contains exactly:

- active profile summary and snapshot age;
- profile select list;
- textarea labeled `貼上 Milkonomy 角色快照`;
- `導入並使用` button;
- `刪除此角色` button with a named confirmation;
- `關閉` button;
- safe fixed error text `角色快照格式無法辨識`.

`importText` calls `importPlayerProfile`, `store.put`, `store.setActiveId`, clears the textarea, and refreshes. It performs no fetch, form submission, postMessage, or storage outside `ProfileStore`.

Modify `src/app.ts` markup:

```html
<div class="profile-control">
  <span id="profile-summary">尚未導入角色</span>
  <button id="profile-open" class="toolbar-button" type="button">角色快照</button>
</div>
<dialog id="profile-dialog" aria-label="角色快照" hidden></dialog>
```

Mount `createProfileStore()` and `createProfilePanel()` after the dashboard root is created; close/destroy both in `DashboardMountHandle.destroy()`.

Add focused CSS for a maximum 680px dialog, stacked mobile fields, readable JSON textarea, and no changes to the existing market table geometry.

- [ ] **Step 4: Add and run the public profile journey E2E**

Create `e2e/profile-import.spec.ts`. It must open the built dashboard with cloud fixture data, assert `尚未導入角色`, paste `tests/fixtures/profile-export-v1.json`, click `導入並使用`, reload, and assert the same active profile remains. Capture requests during import and assert no request body contains `測試牛一號`, `character:700001`, or `/items/holy_alembic`.

Run:

```powershell
npx vitest run tests/profile-panel.test.ts tests/profile-store.test.ts tests/profile-import.test.ts
npm run build
npx playwright test e2e/profile-import.spec.ts
```

Expected: unit tests PASS; build exits 0; E2E PASS.

- [ ] **Step 5: Commit Task 5 files**

```powershell
git add market-radar/src/profile/panel.ts market-radar/src/app.ts market-radar/src/styles.css market-radar/tests/profile-panel.test.ts market-radar/e2e/profile-import.spec.ts
git commit -m "feat: add local profile import surface"
```

---

### Task 6: Validate and index the pinned strategy game data

**Files:**
- Create: `src/strategy/types.ts`
- Create: `src/strategy/game-data.ts`
- Modify: `tests/strategy-game-data.test.ts`

- [ ] **Step 1: Add failing runtime-validation tests**

Append to `tests/strategy-game-data.test.ts`:

```ts
import { normalizeStrategyGameData, StrategyDataError } from '../src/strategy/game-data';

it('normalizes the committed data and rejects missing calculator maps', () => {
  const normalized = normalizeStrategyGameData(strategyData);
  expect(normalized.itemsByHrid.size).toBeGreaterThan(100);
  expect(normalized.actionsByHrid.size).toBeGreaterThan(100);
  expect(() => normalizeStrategyGameData({ gameVersion: 'bad' })).toThrow(StrategyDataError);
});
```

- [ ] **Step 2: Run the focused test and verify missing validator failure**

```powershell
npx vitest run tests/strategy-game-data.test.ts
```

Expected: FAIL because `normalizeStrategyGameData` does not exist.

- [ ] **Step 3: Implement minimal typed strategy-data normalization**

Create `src/strategy/types.ts` with only fields consumed by Slice A:

```ts
export interface CountedItem { itemHrid: string; count: number }
export interface DropItem extends CountedItem { dropRate: number; maxCount: number }
export interface StrategyActionDetail {
  hrid: string;
  levelRequirement: { level: number };
  baseTimeCost: number;
  inputItems: CountedItem[];
  outputItems: CountedItem[];
  essenceDropTable?: DropItem[] | null;
  rareDropTable?: DropItem[] | null;
}
export interface StrategyItemDetail {
  hrid: string;
  name: string;
  itemLevel: number;
  categoryHrid: string;
  equipmentDetail?: Record<string, unknown> | null;
  consumableDetail?: Record<string, unknown> | null;
}
export interface StrategyGameDataInput {
  gameVersion: string;
  versionTimestamp: string;
  enhancementLevelTotalBonusMultiplierTable: number[];
  itemDetailMap: Record<string, StrategyItemDetail>;
  actionDetailMap: Record<string, StrategyActionDetail>;
  communityBuffTypeDetailMap: Record<string, unknown>;
  achievementTierDetailMap: Record<string, unknown>;
  personalBuffTypeDetailMap: Record<string, unknown>;
}
```

Create `src/strategy/game-data.ts` that validates nonempty maps, HRID/key equality, finite nonnegative counts/times, and returns immutable maps:

```ts
export interface NormalizedStrategyGameData extends StrategyGameDataInput {
  itemsByHrid: ReadonlyMap<string, StrategyItemDetail>;
  actionsByHrid: ReadonlyMap<string, StrategyActionDetail>;
}

export class StrategyDataError extends Error {
  readonly code = 'strategy_data';
  constructor() { super('策略遊戲資料無法使用'); }
}
```

Do not return raw validation errors or the malformed input.

- [ ] **Step 4: Run data validation tests and build**

```powershell
npx vitest run tests/strategy-game-data.test.ts
npm run build
```

Expected: focused tests PASS; build exits 0.

- [ ] **Step 5: Commit Task 6 files**

```powershell
git add market-radar/src/strategy/types.ts market-radar/src/strategy/game-data.ts market-radar/tests/strategy-game-data.test.ts
git commit -m "feat: validate strategy game data"
```

---

### Task 7: Port Milkonomy-compatible action buffs as pure functions

**Files:**
- Create: `src/strategy/buffs.ts`
- Create: `tests/strategy-buffs.test.ts`

- [ ] **Step 1: Write failing buff-composition tests**

Create `tests/strategy-buffs.test.ts` with a minimal game-data fixture and profile covering equipment enhancement, house, tea concentration, community buff, shrine, and action level:

```ts
import { describe, expect, it } from 'vitest';
import { actionBuffs } from '../src/strategy/buffs';
import type { PlayerProfile } from '../src/profile/types';
import type { NormalizedStrategyGameData } from '../src/strategy/game-data';

const profileFixture = {
  id: 'character:1', characterId: 1, name: 'buff fixture', source: 'milkonomy-v1',
  importedAt: 0, completeness: 'full', missingFields: [], inventoryMap: {}, achievements: {},
  communityBuffs: { production_efficiency: 10 },
  shrines: { rhythm: 1 },
  specialEquipment: { pouch: { itemHrid: '/items/test_pouch', enhancementLevel: 0 } },
  actions: Object.fromEntries([
    'milking', 'foraging', 'woodcutting', 'cheesesmithing', 'crafting',
    'tailoring', 'cooking', 'brewing', 'alchemy', 'enhancing',
  ].map((action) => [action, {
    playerLevel: action === 'alchemy' ? 103 : 1,
    tool: action === 'alchemy' ? { itemHrid: '/items/test_alembic', enhancementLevel: 5 } : null,
    body: null, legs: null, back: null, charm: null,
    houseLevel: action === 'alchemy' ? 4 : 0,
    teas: action === 'alchemy' ? ['/items/test_success_tea'] : [],
  }])),
} as PlayerProfile;

const items = new Map([
  ['/items/test_pouch', { hrid: '/items/test_pouch', equipmentDetail: {
    noncombatStats: { drinkConcentration: 0.1 }, noncombatEnhancementBonuses: {},
  } }],
  ['/items/test_alembic', { hrid: '/items/test_alembic', equipmentDetail: {
    noncombatStats: { alchemyEfficiency: 0.05 },
    noncombatEnhancementBonuses: { alchemyEfficiency: 0.01 },
  } }],
  ['/items/test_success_tea', { hrid: '/items/test_success_tea', consumableDetail: {
    buffs: [{ typeHrid: '/buff_types/alchemy_success', ratioBoost: 0.06, flatBoost: 0 }],
  } }],
]);
const gameDataFixture = {
  enhancementLevelTotalBonusMultiplierTable: [0, 1, 2, 3, 4, 5],
  itemsByHrid: items,
  communityBuffTypeDetailMap: {
    production_efficiency: { buff: { typeHrid: '/buff_types/efficiency', flatBoost: 0.14, flatBoostLevelBonus: 0 } },
  },
  achievementTierDetailMap: {}, personalBuffTypeDetailMap: {}, actionsByHrid: new Map(),
} as unknown as NormalizedStrategyGameData;

it('combines only buffs applicable to the selected action', () => {
  const buffs = actionBuffs(profileFixture, 'alchemy', gameDataFixture);
  expect(buffs.Level).toBeCloseTo(103);
  expect(buffs.Speed).toBeCloseTo(0.005);
  expect(buffs.Efficiency).toBeCloseTo(0.14 + 0.015 * 4 + 0.05 + 0.01 * 5);
  expect(buffs.Success).toBeCloseTo(0.06 * 1.1);
  expect(buffs.Artisan).toBe(0);
  expect(buffs.drinkConcentration).toBeCloseTo(0.1);
});

it('does not apply crafting equipment or tea to alchemy', () => {
  const buffs = actionBuffs(profileFixture, 'alchemy', gameDataFixture);
  expect(buffs).not.toHaveProperty('craftingEfficiency');
  expect(buffs.RareFind).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Run the test and verify missing buff engine failure**

```powershell
npx vitest run tests/strategy-buffs.test.ts
```

Expected: FAIL because `src/strategy/buffs.ts` does not exist.

- [ ] **Step 3: Implement the action-scoped buff evaluator**

Create `src/strategy/buffs.ts`:

```ts
import type { PlayerProfile, SkillingAction } from '../profile/types';
import type { NormalizedStrategyGameData } from './game-data';

export interface ActionBuffs {
  Level: number;
  Speed: number;
  Efficiency: number;
  Experience: number;
  Gathering: number;
  Processing: number;
  Artisan: number;
  Gourmet: number;
  Success: number;
  Blessed: number;
  EssenceFind: number;
  RareFind: number;
  drinkConcentration: number;
}

const ZERO_BUFFS: ActionBuffs = {
  Level: 0, Speed: 0, Efficiency: 0, Experience: 0, Gathering: 0,
  Processing: 0, Artisan: 0, Gourmet: 0, Success: 0, Blessed: 0,
  EssenceFind: 0, RareFind: 0, drinkConcentration: 0,
};
```

Implement `actionBuffs(profile, action, data)` in the same ordering as Milkonomy `initBuffMap`:

1. global special equipment;
2. community buffs;
3. completed achievement-tier buffs;
4. action tool/body/legs/back/charm equipment;
5. house (`Efficiency 0.015`, `Experience 0.0005`, `RareFind 0.002` per level; enhancing uses Milkonomy's special house map);
6. tea buffs multiplied by `1 + drinkConcentration`;
7. shrine buffs.

Equipment uses:

```text
base noncombat stat + enhancement bonus × enhancementLevelTotalBonusMultiplierTable[level]
```

Return `Level` as base player level plus level buffs; all other fields are additive ratios. Filter equipment stats so action-scoped properties must start with the chosen action while truly global noncombat properties remain eligible.

- [ ] **Step 4: Run buff and profile tests**

```powershell
npx vitest run tests/strategy-buffs.test.ts tests/profile-import.test.ts
```

Expected: focused tests PASS.

- [ ] **Step 5: Commit Task 7 files**

```powershell
git add market-radar/src/strategy/buffs.ts market-radar/tests/strategy-buffs.test.ts
git commit -m "feat: calculate player skilling buffs"
```

---

### Task 8: Implement a pure one-step manufacturing calculator and Milkonomy parity

**Files:**
- Create: `src/strategy/manufacture.ts`
- Create: `tests/fixtures/milkonomy-manufacture-golden.json`
- Create: `tests/strategy-manufacture.test.ts`

- [ ] **Step 1: Commit a source-pinned golden fixture and failing parity test**

Create `tests/fixtures/milkonomy-manufacture-golden.json` with this provenance and synthetic market/profile case:

```json
{
  "source": {
    "repository": "https://github.com/Polokikiki/Milkonomy.git",
    "commit": "febe90f14f7ea1e51937cc888f6f6e1907c58fff",
    "calculator": "ManufactureCalculator"
  },
  "case": {
    "action": "crafting",
    "actionHrid": "/actions/crafting/test_plank",
    "playerLevel": 100,
    "actionLevel": 90,
    "baseTimeCost": 10000000000,
    "inputs": [{ "itemHrid": "/items/test_log", "count": 2, "ask": 100 }],
    "outputs": [{ "itemHrid": "/items/test_plank", "count": 1, "bid": 300 }]
  },
  "expected": {
    "efficiency": 1.1,
    "speed": 1,
    "actionsPerHour": 396,
    "costPerHour": 79200,
    "incomePerHour": 112860,
    "profitPerHour": 33660,
    "profitPerDay": 807840
  }
}
```

Create `tests/strategy-manufacture.test.ts`:

```ts
import golden from './fixtures/milkonomy-manufacture-golden.json';
import { describe, expect, it } from 'vitest';
import { calculateManufacture, type ManufactureInput } from '../src/strategy/manufacture';

const zeroBuffs = {
  Speed: 0, Efficiency: 0, Artisan: 0, Gourmet: 0,
  EssenceFind: 0, RareFind: 0, drinkConcentration: 0,
};

function buildGoldenInput(value: typeof golden.case): ManufactureInput {
  return {
    baseTimeCost: value.baseTimeCost,
    actionLevel: value.actionLevel,
    playerLevel: value.playerLevel,
    buffs: zeroBuffs,
    ingredients: value.inputs.map((item) => ({ itemHrid: item.itemHrid, count: item.count, price: item.ask })),
    products: value.outputs.map((item) => ({ itemHrid: item.itemHrid, count: item.count, price: item.bid })),
    essenceDrops: [], rareDrops: [], teas: [],
  };
}

const coinOutputInput: ManufactureInput = {
  baseTimeCost: 3_600_000_000_000, actionLevel: 1, playerLevel: 1, buffs: zeroBuffs,
  ingredients: [], products: [{ itemHrid: '/items/coin', count: 100, price: 1 }],
  essenceDrops: [], rareDrops: [], teas: [],
};
const teaInput: ManufactureInput = {
  ...coinOutputInput,
  ingredients: [{ itemHrid: '/items/input', count: 1, price: 10 }],
  teas: [{ itemHrid: '/items/tea', count: 1, price: 5 }],
};
const missingAskInput: ManufactureInput = {
  ...coinOutputInput,
  ingredients: [{ itemHrid: '/items/input', count: 1, price: null }],
};
const missingBidInput: ManufactureInput = {
  ...coinOutputInput,
  products: [{ itemHrid: '/items/output', count: 1, price: null }],
};

describe('one-step manufacture parity', () => {
  it('matches Milkonomy ask-in, bid-out, five-percent-tax arithmetic', () => {
    const result = calculateManufacture(buildGoldenInput(golden.case));
    expect(result.efficiency).toBeCloseTo(golden.expected.efficiency, 12);
    expect(result.speed).toBeCloseTo(golden.expected.speed, 12);
    expect(result.actionsPerHour).toBeCloseTo(golden.expected.actionsPerHour, 9);
    expect(result.costPerHour).toBeCloseTo(golden.expected.costPerHour, 6);
    expect(result.incomePerHour).toBeCloseTo(golden.expected.incomePerHour, 6);
    expect(result.profitPerHour).toBeCloseTo(golden.expected.profitPerHour, 6);
    expect(result.profitPerDay).toBeCloseTo(golden.expected.profitPerDay, 4);
  });

  it('keeps coin output untaxed, charges tea consumption, and rejects missing quotes', () => {
    expect(calculateManufacture(coinOutputInput).incomePerHour).toBe(100);
    expect(calculateManufacture(teaInput).costPerHour).toBe(70);
    expect(calculateManufacture(missingAskInput).valid).toBe(false);
    expect(calculateManufacture(missingBidInput).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the parity test and verify missing calculator failure**

```powershell
npx vitest run tests/strategy-manufacture.test.ts
```

Expected: FAIL because `src/strategy/manufacture.ts` does not exist.

- [ ] **Step 3: Implement the pure calculator**

Create `src/strategy/manufacture.ts` with explicit inputs:

```ts
const HOUR_NS = 3_600_000_000_000;
const MIN_ACTION_TIME_NS = 3_000_000_000;
const SELL_TAX_FACTOR = 0.95;
const COIN_HRID = '/items/coin';

export interface PricedCount {
  itemHrid: string;
  count: number;
  price: number | null;
  rate?: number;
}

export interface ManufactureInput {
  baseTimeCost: number;
  actionLevel: number;
  playerLevel: number;
  buffs: {
    Speed: number;
    Efficiency: number;
    Artisan: number;
    Gourmet: number;
    EssenceFind: number;
    RareFind: number;
    drinkConcentration: number;
  };
  ingredients: PricedCount[];
  products: PricedCount[];
  essenceDrops: PricedCount[];
  rareDrops: PricedCount[];
  teas: PricedCount[];
}

export interface ManufactureResult {
  valid: boolean;
  efficiency: number;
  speed: number;
  actionsPerHour: number;
  costPerHour: number | null;
  incomePerHour: number | null;
  profitPerHour: number | null;
  profitPerDay: number | null;
  ingredientUnitsPerHour: Record<string, number>;
  productUnitsPerHour: Record<string, number>;
}
```

Implement exactly:

```ts
const efficiency = 1 + Math.max(0, (input.playerLevel - input.actionLevel) * 0.01) + input.buffs.Efficiency;
const speed = 1 + input.buffs.Speed;
const effectiveTime = Math.max(input.baseTimeCost / speed, MIN_ACTION_TIME_NS);
const actionsPerHour = HOUR_NS / effectiveTime * efficiency;
```

Costs:

- recipe ingredient count is multiplied by `1 - Artisan`;
- tea consumption is `12 × (1 + drinkConcentration)` units/hour per selected tea;
- ingredient and tea prices are asks supplied by the caller.

Income:

- normal outputs are multiplied by `1 + Gourmet` and sold at caller-provided bids after 5% tax;
- essence and rare outputs use `count × rate × (1 + relevant find buff)`;
- `/items/coin` output is not taxed;
- any required null/nonfinite/nonpositive quote makes `valid=false` and all money outputs null.

- [ ] **Step 4: Run parity, calculator, and full unit suites**

```powershell
npx vitest run tests/strategy-manufacture.test.ts tests/strategy-buffs.test.ts tests/strategy-game-data.test.ts
npm test -- --run
```

Expected: focused tests PASS; full unit suite has zero failures.

- [ ] **Step 5: Commit Task 8 files**

```powershell
git add market-radar/src/strategy/manufacture.ts market-radar/tests/fixtures/milkonomy-manufacture-golden.json market-radar/tests/strategy-manufacture.test.ts
git commit -m "feat: add Milkonomy-parity manufacture calculator"
```

---

### Task 9: Prove privacy, build integrity, and Slice A acceptance

**Files:**
- Modify: `tests/privacy.test.ts`
- Modify: `README.md`
- Create: `docs/strategy-foundation-acceptance.md`

- [ ] **Step 1: Add failing privacy boundary assertions**

Extend `tests/privacy.test.ts` to scan production source and built dashboard for forbidden profile egress:

```ts
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function readFiles(entries: string[]): Promise<string> {
  const contents: string[] = [];
  async function visit(entry: string): Promise<void> {
    const stats = await readdir(entry, { withFileTypes: true }).catch(() => null);
    if (stats === null) {
      contents.push(await readFile(entry, 'utf8'));
      return;
    }
    for (const child of stats) {
      const childPath = path.join(entry, child.name);
      if (child.isDirectory()) await visit(childPath);
      else if (/\.(?:ts|js|mjs)$/.test(child.name)) contents.push(await readFile(childPath, 'utf8'));
    }
  }
  for (const entry of entries) await visit(entry);
  return contents.join('\n');
}

it('keeps player profiles out of cloud, userscript, and postMessage payloads', async () => {
  const forbidden = ['PlayerProfile', 'profile-import', 'active-profile-id'];
  const cloudSources = await readFiles([
    'src/cloud', 'src/collector', 'src/userscript', 'scripts/update-cloud-history.ts',
  ]);
  for (const token of forbidden) expect(cloudSources).not.toContain(token);
  const panelSource = await readFile('src/profile/panel.ts', 'utf8');
  expect(panelSource).not.toMatch(/fetch\s*\(|postMessage\s*\(|sendBeacon\s*\(/);
});
```

- [ ] **Step 2: Run privacy tests and verify any accidental coupling fails**

```powershell
npx vitest run tests/privacy.test.ts
```

Expected: FAIL if profile code was imported by cloud, collector, or userscript modules; otherwise PASS after the new assertion is in place.

- [ ] **Step 3: Document the working player journey and known boundary**

Update `README.md` with:

- Chinese-first catalog and bilingual search;
- supported profile formats;
- IndexedDB-only profile data;
- no profile upload or automatic MWI page scraping;
- single-step parity foundation only;
- multi-step recommendations, liquidity adjustment, and trend signals are not yet delivered.

Create `docs/strategy-foundation-acceptance.md` with exact manual checks:

1. Open public dashboard without MWI and verify market view works in Chinese.
2. Search one item by Traditional Chinese and English.
3. Open `角色快照`, paste the synthetic v1 fixture, import, and verify active summary.
4. Reload and verify the same profile remains.
5. Import the preset fixture and verify it is marked partial.
6. Switch profiles and verify levels/equipment do not mix.
7. Delete only the active synthetic profile.
8. Inspect network requests during import and verify no profile JSON leaves the browser.
9. Record that the strategy recommendation ranking remains intentionally unavailable until the next plan.

- [ ] **Step 4: Run the complete verification matrix**

```powershell
npm test -- --run
npm run build
npx playwright test
git diff --check
```

Expected:

- all unit tests PASS with zero failures;
- TypeScript, dashboard, and userscript builds exit 0;
- all E2E tests PASS except pre-existing explicitly expected skips;
- `git diff --check` emits no whitespace errors.

- [ ] **Step 5: Commit Task 9 files and record final status**

```powershell
git add market-radar/tests/privacy.test.ts market-radar/README.md market-radar/docs/strategy-foundation-acceptance.md
git commit -m "docs: verify strategy foundation privacy"
git status --short
```

Expected final status: only the three pre-existing unrelated cloud documentation modifications remain; no Slice A file is untracked or unstaged.

---

## Plan self-review checklist

- Spec coverage: Slice A bilingual catalog, both profile formats, local isolation, pinned data, buff calculation, one-step parity, privacy, and player import UI all have tasks.
- Scope boundary: multi-step workflows, decomposition/coinify, liquidity, trend, enhancement, and transmutation are explicitly deferred to separate plans.
- Type consistency: `PlayerProfile`, `ProfileStore`, `StrategyGameDataInput`, `ActionBuffs`, and `ManufactureInput/Result` are defined before use.
- Data integrity: HRID remains canonical; Chinese and English names are display/search fields only.
- Runtime independence: production never calls Milkonomy or 牛牛股市.
- Security: importer size limit, strict normalization, fixed errors, local-only IndexedDB, and network-negative tests are explicit.
- Verification: every implementation task starts with a failing test, runs a focused green test, and commits only named files.
