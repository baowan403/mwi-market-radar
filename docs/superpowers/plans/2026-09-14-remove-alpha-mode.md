# Remove Alpha Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant and blocking alpha mode while preserving normal duration-aware recommendations.

**Architecture:** Delete the alpha-only UI/filter branch from `strategy/view.ts` and the unused alpha annotations from `strategy/signals.ts`. Keep the existing top-50 lazy trend calculation and all normal recommendation surfaces unchanged.

**Tech Stack:** TypeScript, DOM, Vitest.

---

### Task 1: Lock the player surface

**Files:**
- Modify: `market-radar/tests/strategy-view.test.ts`

- [ ] Replace the alpha-filter test with assertions that neither the toolbar nor skill selector exposes alpha mode.
- [ ] Run `npx vitest run tests/strategy-view.test.ts` and confirm it fails because the alpha controls still exist.

### Task 2: Remove alpha-only behavior

**Files:**
- Modify: `market-radar/src/strategy/view.ts`
- Modify: `market-radar/src/strategy/signals.ts`

- [ ] Remove the alpha option, button, click handler, full-candidate signal scan and alpha-only copy.
- [ ] Remove unused alpha fields and calculations from `StrategySignal`.
- [ ] Run the focused test and confirm it passes.

### Task 3: Verify and publish

**Files:**
- No additional product files.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Verify the deployed site has no alpha entry and that 1H, 6H, 12H and 24H each render recommendations.
- [ ] Commit and push to `main` after all verification succeeds.
