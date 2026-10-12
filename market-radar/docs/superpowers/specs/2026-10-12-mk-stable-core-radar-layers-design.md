# MK-Stable Core and Radar Intelligence Layers Design

## Product objective

Radar must reliably answer two separate questions:

1. **Current Profit:** With this character and the current market, what earns the most right now?
2. **Decision Intelligence:** Which currently competitive strategy has better capacity, momentum, risk, or upgrade potential?

Current Profit is the product foundation. Historical data and advanced analysis may enrich it, but may never hide, zero, discount, or block an otherwise calculable current-profit candidate.

## Reference architecture

Milkonomy is the reality check for current-profit formulas, candidate coverage, bounded computation, cache invalidation, and graceful data fallback. Radar retains its own trend, duration, liquidity, forecasting, and upgrade features as separate layers.

Directly forking Milkonomy is out of scope. Radar will preserve its codebase and reuse the stable architectural principles.

## Layer 1: current market and Current Profit

### Market source order

1. Fetch the official `marketplace.json` with `cache: no-store` and a bounded timeout.
2. Fall back to the same-origin last-known-good snapshot.
3. Fall back to the locally cached last-known-good snapshot in IndexedDB.
4. If none is available, show a clear blocking error rather than fabricated values.

The current snapshot has an explicit timestamp and source status: live, same-origin fallback, or local cache.

### Calculation contract

Current Profit uses only:

- the selected character profile;
- current Ask acquisition prices;
- current Bid liquidation prices;
- the current market sale tax;
- skill levels, equipment, buffs, houses, shrines, and configured consumables;
- expected-value rare and essence outputs;
- deterministic bounded candidate paths.

The default leaderboard always sorts by current profit for the selected duration. Missing history cannot remove or modify a current-profit row.

### Candidate generation

The fast path enumerates known recipes, actions, and bounded upgrade/manufacturing chains. It does not perform an unconstrained graph search.

Current-profit calculation is cached by:

- market timestamp;
- profile/configuration version;
- tax version;
- buy/sell pricing mode;
- rare-output setting;
- locale/formula version when relevant.

Search, pagination, sorting, and duration changes operate on cached candidates instead of regenerating them.

## Layer 2: market context

Historical context is loaded independently after Current Profit is visible:

- 1D, 3D, and 7D profit/margin change;
- 72-hour sparkline;
- input procurement share;
- final-output production share;
- sell-through and price-anomaly warnings;
- confidence and data coverage.

Missing or stale history produces `—` or `歷史不足` in the affected cells. It does not mark the entire candidate invalid.

The primary table retains twelve columns:

`自選｜步驟｜路徑｜當前日利｜1D｜3D｜7D｜72H走勢｜產量占比｜所需資金｜風險｜優先級`

Multi-output routes show `多產物` or `—` in the production-share cell. Per-output liquidation and capacity appear only in expanded details. The internal term `衍生清算` is not repeated across the main table.

## Layer 3: explicit steady recommendation mode

The default mode is `當前日利`.

An explicit `穩健推薦` mode may rank using:

- selected idle duration;
- current profit;
- input availability;
- output sell-through;
- production share;
- 1D/3D/7D momentum;
- working capital;
- data confidence.

This mode always displays the unadjusted Current Profit beside the recommendation. It cannot rewrite the canonical Current Profit value.

## Layer 4: Radar differentiation

Advanced features remain independent and on demand:

- likely next opportunity and advance-material preparation;
- best tea configuration;
- multi-step hidden-profit discovery;
- equipment, house, pouch, jewelry, and tool upgrade priority;
- return-on-investment and experience-aware upgrade comparison.

They may consume Current Profit results but cannot block the base leaderboard.

## Tea optimization and performance

Common actions use verified tea templates for the fast pass. The top twenty candidates may receive exhaustive tea comparison in a background worker. Results are cached by action/profile/market configuration and update affected rows without rescanning the full candidate space.

The UI exposes a compact status: `快速估算`, `精算中`, or `精算完成`.

Performance targets:

- cached Current Profit render: at most 250 ms;
- cold Current Profit render: at most 3 seconds;
- search, pagination, duration, and sort: no candidate rescan;
- history and exact optimization never block the initial table.

## Reliability and failure behavior

- Official market fetch failure uses the same-origin snapshot, then local cache.
- Historical collection failure leaves Current Profit fully usable.
- One candidate calculation failure is isolated and recorded; it does not abort the list.
- Invalid candidate market-history updates never replace last-known-good history.
- Derived history may be rebuilt from immutable source snapshots.
- Only the absence of any valid current market snapshot blocks Current Profit.

## Quality gates

Every release must verify:

1. Milkonomy Top-30 candidate coverage.
2. Same-strategy Current Profit parity:
   - below 5%: pass;
   - 5–10%: investigate only when ranking changes materially;
   - above 10%: block release.
3. Golden cases for all nine non-enhancing life skills.
4. No-history, stale-history, official-fetch failure, and cache-fallback behavior.
5. Cold and cached performance budgets.
6. No history or liquidity state can remove a calculable Current Profit candidate.

## Delivery slices

### Slice 1 — stable Current Profit core

- separate current-market loading from historical loading;
- implement official → same-origin → IndexedDB fallback;
- make default ranking history-independent;
- restore complete Current Profit candidate coverage;
- add MK Top-30 parity and performance gates.

### Slice 2 — independent market context

- attach trends, volume, capacity, and risk asynchronously;
- replace main-table `衍生清算` with concise multi-output presentation;
- add clear data-health status without suppressing rows.

### Slice 3 — explicit steady recommendation

- add the opt-in risk-adjusted mode;
- keep raw Current Profit visible;
- verify duration-aware ranking against sell/procurement constraints.

### Slice 4 — differentiated intelligence

- opportunity forecasting;
- background exact tea optimization;
- upgrade-investment recommendations;
- bounded multi-step discovery.

Each slice must remain independently deployable and must not regress earlier gates.
