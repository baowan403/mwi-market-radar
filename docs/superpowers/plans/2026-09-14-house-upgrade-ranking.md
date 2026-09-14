# House Upgrade Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank cumulative house upgrades alongside equipment and simplify upgrade controls.

**Architecture:** Add validated `houseRoomDetailMap` to the pinned strategy data, calculate cumulative replacement-cost house targets in a pure module, and represent them as typed upgrade rows evaluated through the existing profile-clone calculation. Keep quick and verified result sets separate in the view so verification never destroys the complete quick list.

**Tech Stack:** TypeScript, JSON game data, DOM/CSS, Vitest.

---

### Task 1: House data and cost model

**Files:**
- Modify: `market-radar/scripts/import-milkonomy-reference.ts`
- Modify: `market-radar/src/strategy/types.ts`
- Modify: `market-radar/src/strategy/game-data.ts`
- Create: `market-radar/src/strategy/house-upgrades.ts`
- Test: `market-radar/tests/strategy-game-data.test.ts`
- Test: `market-radar/tests/strategy-house-upgrades.test.ts`

- [ ] Add failing tests for validated house data, next-level targets, cumulative costs and missing asks.
- [ ] Add the versioned house map and pure cumulative cost calculator.
- [ ] Regenerate the pinned strategy artifact from the reviewed Milkonomy commit.
- [ ] Run focused data and cost tests.

### Task 2: Unified investment rows

**Files:**
- Modify: `market-radar/src/strategy/upgrades.ts`
- Test: `market-radar/tests/strategy-upgrades.test.ts`

- [ ] Add a failing test that a Laboratory level target is evaluated beside equipment.
- [ ] Add typed house rows, cloned house-level scenarios and material details.
- [ ] Ensure marginal comparisons and priority work within each house or equipment family.
- [ ] Run the upgrade analysis tests.

### Task 3: Simplified controls and preserved candidates

**Files:**
- Modify: `market-radar/src/strategy/upgrade-view.ts`
- Modify: `market-radar/src/styles.css`
- Modify: `market-radar/tests/strategy-upgrade-view.test.ts`
- Modify: `market-radar/src/profile/panel.ts`

- [ ] Add failing tests for the three-action UI, house labels/details and complete quick-list preservation.
- [ ] Fix the internal reference count at3, remove pending controls, add the show-more button and rename verification.
- [ ] Preserve quick and verified datasets separately and cap house inputs from game data at8.
- [ ] Run focused view and profile tests.

### Task 4: Verify and deploy

**Files:**
- No additional product files.

- [ ] Run `npm test -- --run` and `npm run build`.
- [ ] Deploy only after CI succeeds.
- [ ] Verify current jotaro99 results include house rows, +5 accessories under show-more, and no removed controls.
