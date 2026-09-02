# Strategy Table Layout Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore native table alignment and give every strategy column an intentional width and compact information hierarchy matching the market table.

**Architecture:** Keep the existing semantic table and recommendation data, add a colgroup width contract, and place multi-line content in inner wrappers rather than changing `<td>` display behavior. CSS handles sticky columns, row density, horizontal scrolling, and responsive behavior without changing strategy calculations.

**Tech Stack:** TypeScript DOM APIs, vanilla CSS, Vitest/jsdom, Playwright.

---

### Task 1: Semantic column and content structure

**Files:**
- Modify: `src/strategy/view.ts`
- Modify: `tests/strategy-view.test.ts`

- [ ] **Step 1: Write failing structure tests**

Assert that the rendered table has ten named `<col>` elements, that name/signal/safe/market content is wrapped inside dedicated child elements, and that the existing cells remain `<td>` elements.

```ts
expect([...target.querySelectorAll('col[data-strategy-column]')].map((col) => col.getAttribute('data-strategy-column'))).toEqual([
  'pin', 'path', 'classification', 'signal', 'theoretical',
  'realizable', 'safe', 'market', 'capital', 'assumptions',
]);
expect(target.querySelector('.strategy-name-cell > .strategy-name-content')).not.toBeNull();
expect(target.querySelector('.strategy-signal-cell > .strategy-signal-content')).not.toBeNull();
expect(target.querySelector('[data-strategy-column-cell="safe"] > .strategy-metric-stack')).not.toBeNull();
expect(target.querySelector('[data-strategy-column-cell="market"] > .strategy-metric-stack')).not.toBeNull();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/strategy-view.test.ts`

Expected: FAIL because the current table has no colgroup or inner content wrappers.

- [ ] **Step 3: Add the colgroup and compact wrappers**

In `renderResults`, append a `<colgroup>` before the table head using the ten stable column keys. In `strategyRow`, wrap multi-line children in `.strategy-name-content`, `.strategy-signal-content`, and `.strategy-metric-stack`; set `data-strategy-column-cell` on safe and market cells. Keep every existing text value and native `<details>` element.

Use shorter disclosure labels `理由` and `${candidate.steps.length} 步` while preserving their full accessible contents.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/strategy-view.test.ts`

Expected: PASS with unchanged ranking, pins, strategy values, and disclosure content.

- [ ] **Step 5: Commit the semantic structure**

```powershell
git add src/strategy/view.ts tests/strategy-view.test.ts
git commit -m "refactor: structure strategy table columns"
```

### Task 2: Market-table-density CSS and geometry evidence

**Files:**
- Modify: `src/styles.css`
- Modify: `e2e/strategy-recommendations.spec.ts`

- [ ] **Step 1: Write failing Playwright geometry assertions**

At desktop and mobile projects, assert:

- all visible body cells compute to `display: table-cell`;
- path width is greater than classification and assumptions widths;
- closed first-row height is at most `104px`;
- theoretical and realizable cells use `white-space: nowrap`;
- the table is wider than the mobile scroll viewport without body-page horizontal overflow;
- expanding `理由` increases only the selected row height and does not change the path column width.

- [ ] **Step 2: Run the focused E2E test and verify it fails**

Run: `npx playwright test e2e/strategy-recommendations.spec.ts`

Expected: FAIL because current name, signal, and metric `<td>` elements compute to grid and current widths are uncontrolled.

- [ ] **Step 3: Replace broken cell-grid CSS with wrapper-grid CSS**

Set `.strategy-table` to fixed layout with an intentional minimum width. Define the ten `col[data-strategy-column]` widths from the approved spec. Remove `display: grid` and `min-width` from table cells; apply layout to the new child wrappers. Match market-table header, padding, separators, hover, tabular figures, and sticky pin/path columns. Keep wrapping only for path, reasons, bottleneck, and expanded assumptions.

- [ ] **Step 4: Run the focused E2E and unit tests**

Run:

```powershell
npm test -- tests/strategy-view.test.ts
npx playwright test e2e/strategy-recommendations.spec.ts
```

Expected: PASS in desktop and mobile projects; table functionality and compact values remain unchanged.

- [ ] **Step 5: Commit the visual correction**

```powershell
git add src/styles.css e2e/strategy-recommendations.spec.ts
git commit -m "fix: align strategy table layout"
```

### Task 3: Integrate with the pending profile and compact-number release

**Files:**
- Modify: `docs/strategy-workflows-acceptance.md`
- Existing pending acceptance: `e2e/profile-import.spec.ts`

- [ ] **Step 1: Record the layout acceptance criteria**

Append a short manual check: compare strategy and market header/row alignment, verify full-width separators, inspect first five rows at 1220px desktop width, scroll horizontally at mobile width, and expand one reason and one step disclosure without altering adjacent column widths.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test
npm run build
npm run e2e
git diff --check
git status --short --branch
```

Expected: all Vitest and Playwright tests pass, both builds succeed, diff check is silent, and only the pending acceptance files remain for the final evidence commit.

- [ ] **Step 3: Commit all acceptance evidence**

```powershell
git add e2e/profile-import.spec.ts e2e/strategy-recommendations.spec.ts docs/strategy-workflows-acceptance.md
git commit -m "test: cover compact profile and strategy layout"
```

- [ ] **Step 4: Push and verify the public deployment**

Run `git push`, wait for the GitHub Pages workflow, then open the deployed Radar and confirm the latest commit is live before reporting completion.
