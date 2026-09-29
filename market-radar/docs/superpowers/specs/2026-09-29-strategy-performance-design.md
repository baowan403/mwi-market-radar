# Strategy Performance Repair Design

## Goal

Make Strategy Recommendations responsive without changing profit formulas, the fixed 12-column table, or the required high-value multi-step routes.

## Root cause

The current scan runs both a legacy manufacturing DFS up to seven steps and a newer two/three-step combination search. A full scan produces more than twenty thousand candidate object graphs, transfers all of them from a Worker, retains them while rendering only the top fifty, and repeats the scan whenever the user re-enters the strategy surface.

## Design

1. Enforce the existing player promise that combination strategies contain at most three actions.
2. Bound per-root combination exploration and retained variants while preserving known cross-skill, co-product and decompose-to-coinify routes.
3. Cache one completed scan by profile contents, latest snapshot timestamp and normalized game-data identity. Re-entering the strategy surface reuses it; a profile, price snapshot or data change invalidates it.
4. Keep trend, liquidity, tax, tea and profit formulas unchanged.

## Acceptance

- No returned candidate has more than three steps.
- Known important one-, two- and three-step strategies remain covered.
- Re-rendering with the same profile, snapshot and data does not scan again.
- A changed profile or snapshot scans again.
- Representative candidate benchmark returns below the existing five-second regression budget.
