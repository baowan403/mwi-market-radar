# Strategy Momentum Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make strategy momentum readable and consistent without changing the fixed 12-column table.

**Architecture:** Keep 1D/3D/7D as current-profit comparisons. Add one pure non-overlapping momentum classifier in `signals.ts`; render its colored label below a true 72-hour theoretical-profit sparkline and use the same phase as a bounded priority input for every selected session duration.

**Tech Stack:** TypeScript, DOM/CSS, Vitest.

---

### Task 1: Momentum semantics

**Files:**
- Modify: `market-radar/src/strategy/signals.ts`
- Test: `market-radar/tests/strategy-signals.test.ts`

- [ ] Add failing tests for accelerating, stable rise, cooling, pullback, weakening, and missing history using non-overlapping 0–1D, 1–3D, and 3–7D segments.
- [ ] Run `npx vitest run tests/strategy-signals.test.ts` and confirm the new API is missing.
- [ ] Implement the smallest exported momentum classifier and feed its phase into existing priority selection.
- [ ] Run the focused test and confirm it passes.

### Task 2: True 72-hour sparkline and colored label

**Files:**
- Modify: `market-radar/src/strategy/sparkline.ts`
- Modify: `market-radar/src/strategy/view.ts`
- Modify: `market-radar/src/styles.css`
- Test: `market-radar/tests/strategy-sparkline.test.ts`
- Test: `market-radar/tests/strategy-view.test.ts`

- [ ] Add failing tests proving the sparkline excludes points older than 72 hours, uses theoretical profit, and the table renders the momentum label.
- [ ] Run both focused tests and confirm failure for the new behavior.
- [ ] Apply the 72-hour filter, render the label inside the existing trend cell, and add compact semantic colors.
- [ ] Run focused tests and confirm they pass.

### Task 3: Verification and release

**Files:**
- No additional product files.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Inspect the 6H, 12H, and 24H table paths in the deployed site; confirm each shows the same momentum semantics with duration-specific profit ranking.
- [ ] Commit and push to `main` only after verification succeeds.
