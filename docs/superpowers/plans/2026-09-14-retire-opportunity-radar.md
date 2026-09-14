# Retire Opportunity Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove an unvalidated recommendation surface that duplicates the main strategy ranking.

**Architecture:** Remove the opportunity panel and journal from the strategy view lifecycle, delete their isolated modules and styles, and retain duration-aware ranking plus upgrade analysis. Do not delete browser-stored historical records.

**Tech Stack:** TypeScript, DOM/CSS, Vitest.

---

### Task 1: Lock the remaining navigation

**Files:**
- Modify: `market-radar/tests/strategy-view.test.ts`

- [ ] Assert that the opportunity button and panel are absent while strategy and upgrade switching still work.
- [ ] Run `npx vitest run tests/strategy-view.test.ts` and confirm the old UI fails the new assertions.

### Task 2: Remove the feature

**Files:**
- Modify: `market-radar/src/strategy/view.ts`
- Modify: `market-radar/src/styles.css`
- Delete: `market-radar/src/strategy/opportunities.ts`
- Delete: `market-radar/src/strategy/opportunity-view.ts`
- Delete: `market-radar/src/strategy/opportunity-journal.ts`
- Delete: `market-radar/tests/strategy-opportunities.test.ts`
- Delete: `market-radar/tests/strategy-opportunity-view.test.ts`
- Delete: `market-radar/tests/strategy-opportunity-journal.test.ts`

- [ ] Remove the button, panel construction, invalidation hooks and journal lifecycle.
- [ ] Remove orphaned modules, tests and CSS selectors.
- [ ] Run the focused strategy-view test.

### Task 3: Verify and publish

**Files:**
- No additional product files.

- [ ] Run `npm test -- --run` and `npm run build`.
- [ ] Deploy only after CI succeeds.
- [ ] Verify the production site has only Strategy Recommendation and Upgrade Target, and that 1H／6H／12H／24H rankings still render.
