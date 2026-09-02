# Profile Assumptions And Compact Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the exact imported Milkonomy calculation assumptions in Radar and replace long large-number strings with a consistent K/M formatter that never emits B.

**Architecture:** Add one presentation-only compact-number utility in `src/core`, then route the market table, item detail, and strategy surfaces through it. Add a read-only assumptions renderer to the existing profile dialog; it reads normalized `PlayerProfile` data, receives item-name resolution from the dashboard catalog, and never mutates or auto-selects gear.

**Tech Stack:** TypeScript 5.8, DOM APIs, Vite, Vitest/jsdom, Playwright.

---

## File map

- Create `src/core/format-number.ts`: shared finite/null-safe K/M formatter.
- Create `tests/format-number.test.ts`: exact boundary and suffix contract.
- Modify `src/dashboard/table.ts`: compact market price, bid, ask, volume, and numeric percentages.
- Modify `src/dashboard/item-detail.ts`: compact detail metrics and chart tooltip/tick magnitudes without changing chart data.
- Modify `src/strategy/view.ts`: compact money, quantities, flows, and working capital.
- Modify `tests/dashboard.test.ts`, `tests/item-detail.test.ts`, and `tests/strategy-view.test.ts`: surface-level formatting assertions.
- Modify `src/profile/panel.ts`: render a compact read-only assumptions section.
- Modify `src/app.ts`: provide the catalog-backed Chinese item-name resolver to the profile panel.
- Modify `src/styles.css`: responsive assumptions grid and compact rows inside the existing dialog.
- Modify `tests/profile-panel.test.ts`: complete preset, sparse snapshot, no-auto-pick, and item-name assertions.
- Modify `e2e/profile-import.spec.ts`: player-visible acceptance of the assumptions block.

### Task 1: Shared compact-number contract

**Files:**
- Create: `src/core/format-number.ts`
- Create: `tests/format-number.test.ts`

- [ ] **Step 1: Write the failing formatter tests**

```ts
import { describe, expect, it } from 'vitest';
import { formatCompactNumber } from '../src/core/format-number';

describe('formatCompactNumber', () => {
  it.each([
    [null, '—'], [Number.NaN, '—'], [Number.POSITIVE_INFINITY, '—'],
    [0, '0'], [999, '999'], [1_000, '1K'], [1_234, '1.23K'],
    [12_300, '12.3K'], [999_999, '1,000K'], [1_000_000, '1M'],
    [1_234_567, '1.23M'], [1_000_000_000, '1,000M'],
    [-2_500_000, '-2.5M'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatCompactNumber(value)).toBe(expected);
  });

  it('never emits a billion suffix', () => {
    expect(formatCompactNumber(9_876_543_210)).not.toContain('B');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/format-number.test.ts`

Expected: FAIL because `src/core/format-number.ts` does not exist.

- [ ] **Step 3: Implement the presentation-only formatter**

```ts
const DISPLAY = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatCompactNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${DISPLAY.format(value / 1_000_000)}M`;
  if (magnitude >= 1_000) return `${DISPLAY.format(value / 1_000)}K`;
  return DISPLAY.format(value);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/format-number.test.ts`

Expected: PASS with all table cases, including `1,000M` and no `B`.

- [ ] **Step 5: Commit the formatter**

```powershell
git add src/core/format-number.ts tests/format-number.test.ts
git commit -m "feat: add compact K and M number format"
```

### Task 2: Adopt compact values on market and strategy surfaces

**Files:**
- Modify: `src/dashboard/table.ts`
- Modify: `src/dashboard/item-detail.ts`
- Modify: `src/strategy/view.ts`
- Modify: `tests/dashboard.test.ts`
- Modify: `tests/item-detail.test.ts`
- Modify: `tests/strategy-view.test.ts`

- [ ] **Step 1: Add failing surface assertions**

Add fixtures with values `1_234`, `56_430_000`, and `1_000_000_000`, then assert the rendered text includes `1.23K`, `56.43M`, and `1,000M`, excludes `1,234`, `56,430,000`, and excludes any standalone `B` suffix. Keep existing percentage arrows and suffix assertions unchanged.

```ts
expect(root.textContent).toContain('56.43M');
expect(root.textContent).toContain('1,000M');
expect(root.textContent).not.toContain('56,430,000');
expect(root.textContent).not.toMatch(/\d(?:\.\d+)?B\b/);
```

- [ ] **Step 2: Run the focused surface tests and verify they fail**

Run: `npm test -- tests/dashboard.test.ts tests/item-detail.test.ts tests/strategy-view.test.ts`

Expected: FAIL because the current views use raw `Intl.NumberFormat` output.

- [ ] **Step 3: Replace local magnitude formatters with the shared utility**

Import `formatCompactNumber` in all three views. In `table.ts`, use it for price, bid, ask, spread, volume, and trend values. In `item-detail.ts`, replace `valueText` with the shared formatter and configure chart ticks/tooltips to call it while leaving numeric datasets untouched. In `strategy/view.ts`, make `money`, `quantity`, and `metric` delegate to it:

```ts
function money(value: number): string {
  return formatCompactNumber(value);
}

function quantity(value: number): string {
  return formatCompactNumber(value);
}

function metric(value: number | null, suffix = ''): string {
  const rendered = formatCompactNumber(value);
  return rendered === '—' ? rendered : `${rendered}${suffix}`;
}
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- tests/dashboard.test.ts tests/item-detail.test.ts tests/strategy-view.test.ts`

Expected: PASS; calculations and sort order remain unchanged because only text rendering changed.

- [ ] **Step 5: Commit the view migration**

```powershell
git add src/dashboard/table.ts src/dashboard/item-detail.ts src/strategy/view.ts tests/dashboard.test.ts tests/item-detail.test.ts tests/strategy-view.test.ts
git commit -m "feat: use compact values across radar views"
```

### Task 3: Render imported calculation assumptions

**Files:**
- Modify: `src/profile/panel.ts`
- Modify: `src/app.ts`
- Modify: `src/styles.css`
- Modify: `tests/profile-panel.test.ts`

- [ ] **Step 1: Write failing profile-dialog tests**

Import the complete preset fixture, reopen the dialog, and assert that the visible assumptions contain `煉金 103`, resolved names for the holy alembic, alchemist top/bottom, guzzling pouch, all three teas, house level 4, production-efficiency buff 10, and shrine levels. Import the sparse Exporter fixture and assert missing optional fields do not crash and are labelled `未設定`. Also assert an item present only in `inventoryMap` is not silently selected.

```ts
await panel.importText(JSON.stringify(preset));
await panel.open();
const assumptions = document.querySelector('[data-profile-assumptions]');
expect(assumptions?.textContent).toContain('目前計算配置');
expect(assumptions?.textContent).toContain('煉金 103');
expect(assumptions?.textContent).toContain('神聖蒸餾器 +10');
expect(assumptions?.textContent).toContain('暴飲之囊 +5');
expect(assumptions?.textContent).toContain('究極煉金茶');
expect(assumptions?.textContent).not.toContain('warehouse-only-item');
```

- [ ] **Step 2: Run the profile-panel test and verify it fails**

Run: `npm test -- tests/profile-panel.test.ts`

Expected: FAIL because the dialog has no assumptions section.

- [ ] **Step 3: Add label maps and a pure assumptions renderer**

In `panel.ts`, add Chinese action, equipment-slot, buff, and shrine labels. Extend `ProfilePanelOptions` with an optional `itemName(hrid: string): string`. Render one `<details>` per action so ten actions remain mobile-manageable; each summary contains the action name and level. The expanded body lists tool, non-empty equipment, pouch from `specialEquipment`, teas, house, and applicable global modifiers. Missing tool/tea configuration uses `未設定`; empty optional equipment rows are omitted.

```ts
export interface ProfilePanelOptions {
  // existing fields
  itemName?: (hrid: string) => string;
}

function equipmentText(
  value: ProfileEquipment | null,
  itemName: (hrid: string) => string,
): string {
  if (value === null) return '未設定';
  return `${itemName(value.itemHrid)} +${value.enhancementLevel}`;
}
```

The renderer reads only `PlayerProfile`; it never reads `inventoryMap` and never writes to the profile.

- [ ] **Step 4: Wire catalog-backed Chinese item names from the app**

Create a mutable resolver before the panel is mounted, pass it through `itemName`, then replace it with the normalized catalog resolver once `catalogInput` is available. Use the existing HRID humanization only as a temporary fallback.

```ts
let profileItemName = (hrid: string): string => (
  hrid.split('/').at(-1)?.replaceAll('_', ' ') ?? hrid
);

const profilePanel = createProfilePanel({
  // existing options
  itemName: (hrid) => profileItemName(hrid),
});

// after normalized dashboard state exists
profileItemName = (hrid) => {
  const item = state.catalog.itemsByHrid.get(hrid);
  return item ? catalogItemName(item) : hrid.split('/').at(-1)?.replaceAll('_', ' ') ?? hrid;
};
```

- [ ] **Step 5: Add responsive styles without enlarging the dialog viewport**

Add `.profile-assumptions`, `.profile-assumption-action`, `.profile-assumption-grid`, and `.profile-assumption-modifiers` rules. Use the existing dialog width, a two-column label/value grid on desktop, one column under `640px`, wrapping text, and no fixed heights.

- [ ] **Step 6: Run profile tests and verify they pass**

Run: `npm test -- tests/profile-panel.test.ts tests/profile-import.test.ts tests/profile-store.test.ts`

Expected: PASS; existing import, selection, deletion, and local-only privacy assertions remain green.

- [ ] **Step 7: Commit the assumptions UI**

```powershell
git add src/profile/panel.ts src/app.ts src/styles.css tests/profile-panel.test.ts
git commit -m "feat: show imported calculation assumptions"
```

### Task 4: End-to-end acceptance and regression verification

**Files:**
- Modify: `e2e/profile-import.spec.ts`
- Modify: `docs/strategy-workflows-acceptance.md`

- [ ] **Step 1: Add a failing Playwright acceptance path**

Use the existing profile fixture import path, reopen `角色快照`, expand `煉金 103`, and assert that configured equipment, three teas, house, and modifiers are visible. Navigate to market and strategy surfaces and assert representative large values use `K`/`M` and no visible numeric text ends in `B`.

- [ ] **Step 2: Run the focused E2E test and address only product defects**

Run: `npx playwright test e2e/profile-import.spec.ts e2e/strategy-recommendations.spec.ts`

Expected: PASS. If a failure is caused by fixture magnitude rather than product output, raise the fixture value explicitly; do not weaken the assertion.

- [ ] **Step 3: Record manual acceptance instructions**

Add a section describing how to import `jotaro99`, open `目前計算配置`, compare the alchemy tool/top/bottom/pouch/three teas/house/buffs with Milkonomy, then verify a billion-value example renders as `1,000M` rather than `1B`.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm test
npm run build
npm run e2e
git diff --check
git status --short --branch
```

Expected: all Vitest and Playwright tests pass, production and userscript builds succeed, `git diff --check` is silent, and only intended files are modified before the final commit.

- [ ] **Step 5: Commit acceptance evidence**

```powershell
git add e2e/profile-import.spec.ts docs/strategy-workflows-acceptance.md
git commit -m "test: cover profile assumptions and compact values"
```

- [ ] **Step 6: Push after final verification**

Run: `git push`

Expected: the feature branch updates successfully; GitHub Pages deployment is then checked before reporting the public site updated.
