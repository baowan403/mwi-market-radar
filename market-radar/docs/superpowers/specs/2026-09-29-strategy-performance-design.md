# Strategy Performance Repair Design

## Goal

Make repeated Strategy Recommendation navigation responsive without changing profit formulas, the fixed 12-column table, or the required high-value multi-step routes.

## Root cause

The current full-coverage scan produces more than twenty thousand candidate object graphs and is expensive. Pruning that graph removed legitimate high-profit routes in production. This repair therefore eliminates unchanged rescans while leaving the cold full-coverage scan intact.

## Design

1. Preserve the existing candidate coverage; performance work must not prune profitable paths.
2. Cache one completed scan by profile contents, latest snapshot timestamp and normalized game-data identity. Re-entering the strategy surface reuses it; a profile, price snapshot or data change invalidates it.
3. Keep candidate, trend, liquidity, tax, tea and profit formulas unchanged.

## Acceptance

- Known important one-, two- and three-step strategies remain covered.
- Re-rendering with the same profile, snapshot and data does not scan again.
- A changed profile or snapshot scans again.
- Re-entering Strategy Recommendation with unchanged inputs restores the completed DOM immediately instead of rebuilding liquidity and trend assessments.

## Known limitation

A cold page load or a new hourly market snapshot still performs the full scan. Further cold-start optimization requires a coverage-preserving algorithm change and is outside this bounded repair.

