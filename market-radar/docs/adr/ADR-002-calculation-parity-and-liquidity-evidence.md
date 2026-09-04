# ADR-002: Calculation Parity and Liquidity Evidence Contract

Status: Accepted for strategy calculations
Date: 2026-09-04

## Context

MWI Market Radar exists to make decisions that a pure theoretical calculator cannot make: market throughput, safe execution size, 24h capital, risk, momentum and shortage/Alpha signals.

That differentiation is only useful if the underlying MWI mechanics are at least as trustworthy as established calculators. A prior review incorrectly promoted an unverified claim that Emp Tea Leaf produced 40 Brewing Essence per successful decompose. Production GameData was then overridden to force that value even though the raw data (`count=10`, `bulkMultiplier=2`) already matched the user's live MWI observation of 20. The resulting theoretical profit was approximately doubled.

A second failure mode treated incomplete traded-volume history for auxiliary tea as proof of zero market availability and marked otherwise liquid strategies as `insufficient` / extreme risk.

## Decision

### 1. Evidence hierarchy

Use this order for theoretical MWI mechanics:

1. **MWI Runtime Observed** — directly reproducible UI or inventory/action behavior.
2. **MK parity reference** — default theoretical benchmark when no Level-1 evidence contradicts it.
3. **Milkonomy / static GameData / Wiki** — useful implementation references and cross-checks.
4. **Radar / AI assumptions** — never sufficient by themselves to change production mechanics.

An AI explanation is not evidence.

### 2. Theoretical layer vs Radar overlay

The theoretical layer owns:

- level, speed, efficiency and success mechanics;
- input/output quantities;
- tea/catalyst/coin costs;
- current ask/bid valuation and tax;
- theoretical profit.

The Radar overlay owns:

- traded-volume throughput;
- safe execution size / safe profit;
- working capital;
- liquidity warnings;
- momentum / Alpha / priority.

Overlay calculations must not mutate physical mechanics merely to create a different result from MK.

### 3. MK divergence rule

For the same profile, equipment, teas, catalyst, prices and tax assumptions:

- <=1% theoretical profit difference: parity pass;
- >1% to 3%: review;
- >3%: disputed until the first divergent intermediate field is explained;
- >10%: major formula incident; do not present the strategy as high-confidence verified.

Always compare intermediate fields before explaining the final profit difference:

`action time -> efficiency -> actions/h -> success -> input/action -> input/h -> output/success -> output/h -> tea/h -> coin fee -> revenue/h -> cost/h -> profit/day`.

### 4. Golden-test evidence contract

Golden expected values must be independent from the production implementation under test.

Allowed evidence labels:

- `observed`: directly observed in MWI;
- `derived`: derived from independently observed values and an explicit formula;
- `mk-reference`: independently recorded MK result;
- `unverified`: must not be used as a Golden oracle.

Never change production GameData first and then use the changed output as proof that the change was correct.

### 5. Emp Tea Leaf correction

User-observed MWI behavior on 2026-09-04:

- raw decompose count: 10;
- bulk multiplier: 2;
- successful output: **20 Brewing Essence**.

There is no production override for this item. The raw data naturally reproduces the observation.

### 6. Liquidity evidence semantics

`marketplace.json` supplies executable top ask/bid prices and hourly market volume/average-price evidence. The `v` field is **not a visible order-book depth quantity** in Radar's current schema.

Therefore:

- volume history is a throughput proxy, not proof of current displayed order-book inventory;
- 24h strategy demand must be compared to volume on a consistent daily unit basis;
- missing current ask/bid is a hard availability problem;
- incomplete historical volume is uncertainty, not automatically `extreme risk`;
- auxiliary tea must not dominate the production-share classification of the main strategy. Tea still requires a current ask and remains visible as a procurement warning when volume evidence is weak;
- main external inputs and outputs remain subject to throughput evaluation;
- output history is especially important because sell-through must be estimated.

### 7. UI semantics

`insufficient` means **data insufficient / verification needed**, not proven extreme risk.

The fixed 12-column strategy table remains unchanged. Detailed evidence and warnings belong in tooltips / expanded detail rows rather than new columns.

## Consequences

- Radar theoretical profit should normally track MK closely.
- Radar should outperform MK in decision quality through market-aware overlays, not by inventing different base mechanics.
- Any future deliberate divergence from MK requires a documented differential finding with reproducible MWI evidence.
