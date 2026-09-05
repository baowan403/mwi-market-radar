# Market assessment repair — 2026-09-05

Baseline: GitHub main bbef2ce. Existing local governance branch was preserved; work uses codex/market-assessment-repair.

## Evidence

Public manifest ending 2026-09-05 14:06 Taipei contains only eight distinct snapshots in the preceding 24 hours. The observed successful scheduled Actions align with these timestamps and finish in approximately 90 seconds. Thus no 12-hour volume gate can pass on cloud data in this window. The configured 15-minute cron does not provide an observed hourly service guarantee; the precise GitHub scheduling delay cause is not established.

Read-only decoding of these snapshots gives indicative normalized volumes: emp_tea_leaf 7,342,512; brewing_essence 20,409,636; ginkgo_lumber 815,760. All have eight covered hours. These are estimates, not complete 24-hour totals.

## Changes

- At least four covered hours permit an indicative volume estimate; under 12 hours never qualifies for safe execution capacity. The UI marks partial coverage with approximately, coverage hours and low confidence below 12 hours.
- Main list always sorts by current profit. Capacity mode buttons removed; capacity remains in details.
- One-day and three-day trends can appear before seven days. Baseline lookup cannot invent a horizon before the earliest observation and allows at most six hours of timing offset.
- Alpha cannot override constrained-market risk. Profit below 90% of the current leader caps positive priority at medium.
- Removed unsupported claims that the entire market is balanced when no Alpha candidate appears.

## Verification and remaining work

Full unit run: 669 passed, 33 pre-existing dashboard tests skipped. Production build passes. No profit formulas changed.

Outstanding: same-profile MK Top20 runtime coverage audit; major workflow parity cases; historical secondary-price completeness; reliable external scheduling if GitHub continues delaying runs. No claim of coverage percentage or repaired hourly collection is made by this slice. Existing historical gaps were not filled or fabricated.
