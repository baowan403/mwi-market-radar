# Market History Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invalid scheduled history updates from blocking deployment or collapsing the strategy table.

**Architecture:** Update a temporary candidate data tree, rebuild only derived daily history when needed, validate before publication, and retain the last-known-good tree on failure. The UI keeps executable rankings authoritative and fills unused rows with clearly pending positive candidates.

**Tech Stack:** TypeScript, Vitest, GitHub Actions, Vite.

---

### Task 1: Derived daily-history repair

**Files:**
- Modify: `src/cloud/history-store.ts`
- Modify: `scripts/update-cloud-history.ts`
- Modify: `package.json`
- Test: `tests/cloud-history-store.test.ts`

- [ ] Add a failing test that seeds valid manifest/snapshot files plus corrupt `daily-history.txt`, runs the repair command, and expects a valid pack rebuilt from completed non-cutoff UTC dates.
- [ ] Add a failing test proving corrupt manifest/snapshot files are not repaired silently.
- [ ] Export a focused `rebuildDailyHistoryFromSnapshots` operation and a `--repair-derived` CLI mode.
- [ ] Run focused cloud-history tests and confirm they pass.

### Task 2: Last-known-good workflow fallback

**Files:**
- Modify: `.github/workflows/market-radar-pages.yml`
- Test: `tests/workflow.test.ts`

- [ ] Add failing workflow contract tests requiring a candidate data directory, preflight validation of the existing tree, candidate repair/validation, publish-on-valid, and fallback-on-invalid.
- [ ] Change scheduled/manual collection to mutate the candidate copy only.
- [ ] Synchronize candidate data to the data worktree only after validation; otherwise emit a warning and retain existing data.
- [ ] Keep push builds read-only against the existing data tree.
- [ ] Run workflow contract tests.

### Task 3: Pending strategy fallback rows

**Files:**
- Modify: `src/strategy/view.ts`
- Test: `tests/strategy-view.test.ts`

- [ ] Add failing tests where only three candidates are actionable and capacity-unknown/stale positive candidates fill the remaining rows.
- [ ] Verify no-ask/no-bid/price-anomaly candidates remain hidden by default.
- [ ] Sort pending fallback rows after actionable rows by theoretical selected-duration profit.
- [ ] Display `容量待確認` or `行情過期`, with no executable capital or priority claim.
- [ ] Run focused strategy-view tests.

### Task 4: Full verification and deployment

- [ ] Run all tests with a workspace-local temporary directory.
- [ ] Run TypeScript checking and both production builds.
- [ ] Publish to `main` and wait for GitHub Actions.
- [ ] Confirm the scheduled workflow can reuse last-known-good data without failing deployment.
- [ ] Confirm the live jotaro99 table no longer collapses to three or four rows.
