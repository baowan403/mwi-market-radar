# Sparse Market Capacity Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep profitable strategies actionable when recent market history has 4–11 covered hours while preserving a low-confidence warning.

**Architecture:** Reuse the already-normalized rolling 24-hour volume in `marketCapacity`. Separate the minimum needed to estimate capacity (four hours) from the existing twelve-hour confidence threshold.

**Tech Stack:** TypeScript, Vitest, Vite.

---

### Task 1: Reproduce sparse-history suppression

**Files:**
- Modify: `tests/strategy-liquidity.test.ts`
- Modify: `tests/strategy-session.test.ts`

- [ ] Change the eight-hour liquidity expectation from a null budget to a finite low-confidence budget.
- [ ] Add a three-hour case that remains unknown.
- [ ] Change the session regression to require five-hour history to remain actionable and three-hour history to remain pending.
- [ ] Run the focused assertions and verify the old implementation fails.

### Task 2: Implement the fallback

**Files:**
- Modify: `src/strategy/liquidity.ts`

- [ ] Name the four-hour estimate threshold.
- [ ] Allow any finite normalized rolling estimate meeting that threshold to seed `safeUnitsPerDay`.
- [ ] Keep `volume24hSufficient` tied to twelve covered hours.
- [ ] Run focused tests, the full suite, and the production build.

### Task 3: Verify production behavior

- [ ] Deploy the tested change.
- [ ] Confirm the formal site no longer collapses to only low-profit self-supply routes with five recent snapshots.
- [ ] Confirm rows below twelve covered hours still display low confidence.
