# Liquidity, Safe Capacity, and Strategy Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace theoretical-profit-only recommendations with liquidity-adjusted realizable profit, safe production limits, sell-through estimates, 3D/7D strategy-margin trends, and walk-forward evidence.

**Architecture:** Evaluate every market input and output flow against the same hourly snapshot history. The narrowest edge limits the strategy. Recalculate each fixed strategy across historical snapshots to produce a margin series, then derive explainable signals and backtest them without future leakage.

**Tech Stack:** TypeScript, existing cloud snapshots, Vitest, Chart.js, Playwright, GitHub Actions/Pages.

---

### Task 1: Robust hourly market capacity

**Files:** `src/strategy/liquidity.ts`, `tests/strategy-liquidity.test.ts`

- [x] Test 3D/7D hourly medians, insufficient samples, one-sided quotes, missing volume, and a one-day volume spike.
- [x] Implement `marketCapacity(key, snapshots)` using non-negative hourly samples in each window so zero-volume periods are not silently discarded.

```ts
safeUnitsPerHour = 0.05 * Math.min(median3d, median7d)
```

- [x] Require at least 24 valid 3D samples and 72 valid 7D samples; otherwise confidence is insufficient and long-hang is false.
- [x] Commit `feat: calculate robust market capacity`.

### Task 2: Apply capacity to every strategy edge

**Files:** `src/strategy/realizable.ts`, `tests/strategy-realizable.test.ts`, `src/strategy/candidates.ts`

- [x] Test output bottleneck, input bottleneck, multiple inputs, coin/nonmarket flows, and equipment with low daily volume.
- [x] For every market flow compute `playerUnitsPerHour / median7d` and safe throughput ratio.
- [x] The strategy bottleneck is the minimum safe ratio across all market inputs and outputs.
- [x] Return:

```ts
interface RealizableStrategy {
  theoreticalProfitPerDay: number;
  realizableProfitPerDay: number | null;
  safeHoursPerDay: number | null;
  safeBatchUnits: number | null;
  sellThroughDays: number | null;
  marketSharePct: number | null;
  bottleneckHrid: string | null;
  classification: 'long-run' | 'small-test' | 'limited' | 'reject' | 'insufficient';
}
```

- [x] Classification: ≤5% long-run; >5–10% small-test; >10–25% limited; >25% reject; missing samples insufficient.
- [x] Commit `feat: calculate realizable strategy profit`.

### Task 3: Publish actionable liquidity recommendations

**Files:** `src/strategy/view.ts`, `src/styles.css`, `tests/strategy-view.test.ts`, `e2e/strategy-recommendations.spec.ts`

- [x] Replace the theoretical-only warning with side-by-side theoretical and realizable daily profit.
- [x] Add safe hours, safe batch, estimated sell-through days, market share, bottleneck, and classification.
- [x] Default ranking uses realizable profit; rejected/insufficient strategies move to a separate limited-opportunity filter and never appear as long-run recommendations.
- [x] Preserve the exact assumptions in expandable details.
- [x] Commit `feat: show liquidity-adjusted recommendations`.

### Task 4: Build historical strategy margin series

**Files:** `src/strategy/margin-series.ts`, `tests/strategy-margin-series.test.ts`

- [ ] Re-evaluate a fixed profile and path at each historical snapshot without changing recipe/equipment assumptions.
- [ ] Record cost/hour, income/hour, theoretical profit/hour, realizable profit/day, bottleneck capacity, and data completeness.
- [ ] Require no future snapshots while calculating an earlier point.
- [ ] Commit `feat: derive historical strategy margins`.

### Task 5: Explain 3D/7D signals and invalidation

**Files:** `src/strategy/signals.ts`, `tests/strategy-signals.test.ts`, `src/strategy/view.ts`

- [ ] Test expanding margin with rising volume, price-only rise without volume, input inflation, spread widening, and margin reversal.
- [ ] Emit `execute`, `prepare`, `wait`, `sell`, or `stop`, plus reasons, confidence, and explicit invalidation thresholds.
- [ ] Under 7 days: no trend. 7–29 days: low confidence. ≥30 days with passing backtest: medium/high allowed.
- [ ] Commit `feat: add explainable strategy trend signals`.

### Task 6: Walk-forward backtest and longer daily history

**Files:** `src/strategy/backtest.ts`, `tests/strategy-backtest.test.ts`, `src/cloud/history-store.ts`, `scripts/update-cloud-history.ts`, cloud tests/docs`

- [ ] Keep 10 days of hourly snapshots and aggregate up to 180 days of daily OHLCV/quality summaries.
- [ ] Backtest each signal using only data available at signal time; measure 3D/7D hit rate, average change, and maximum adverse change.
- [ ] Never label a signal high confidence without minimum sample evidence.
- [ ] Commit `feat: backtest strategy trend signals`.

### Task 7: Full public acceptance and deploy

- [ ] Unit full suite, build, all E2E.
- [ ] Public journey proves one long-run strategy, one limited strategy, one rejected fake-high-profit strategy, and one trend signal with reasons/invalidation.
- [ ] Update README and acceptance evidence.
- [ ] Push `HEAD:main`, wait for Pages success, and verify the live dashboard.
