# ADR-002: Calculation Parity and Liquidity Evidence Contract

Status: Accepted
Date: 2026-09-04

## Goal

Radar must first be trustworthy as an MWI calculator, then outperform reference calculators in decision quality through throughput, safe profit, working capital, risk, momentum and Alpha.

## Evidence hierarchy

1. **MWI Runtime Observed** — directly reproducible UI or inventory/action behavior.
2. **MK Reference** — default theoretical benchmark when no Runtime observation contradicts it.
3. **Milkonomy / static GameData / Wiki** — implementation references and cross-checks.
4. **Radar / AI assumptions** — never sufficient by themselves to change production mechanics.

An AI explanation is not evidence.

## Theoretical layer vs Radar overlay

The theoretical layer owns:

- effective level, speed, efficiency and success mechanics;
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

## MK divergence rule

For the same profile, equipment, teas, catalyst, prices and tax assumptions:

- <= 1% theoretical profit difference: parity pass;
- > 1% to 3%: review;
- > 3%: disputed until the first divergent intermediate field is explained;
- > 10%: major formula incident; do not present as high-confidence verified.

Compare intermediate fields before explaining final profit:

`action time -> efficiency -> actions/h -> success -> input/action -> input/h -> output/success -> output/h -> tea/h -> coin fee -> revenue/h -> cost/h -> profit/day`.

## Golden-test evidence contract

Golden expected values must be independent from the production implementation under test.

Allowed labels:

- `observed`: directly observed in MWI;
- `derived`: derived from independently observed values and an explicit formula;
- `mk-reference`: independently recorded MK result;
- `unverified`: must not be used as a Golden oracle.

Never modify production GameData first and then use the modified output as proof that the modification was correct.

## Emp Tea Leaf incident

User-observed MWI behavior on 2026-09-04:

- raw decompose count: 10;
- bulk multiplier: 2;
- successful output: **20 Brewing Essence**.

No override is needed. Raw GameData already reproduces the observation.

## Liquidity evidence semantics

The official marketplace snapshot gives top ask/bid prices plus market volume/average-price evidence. Radar's current schema does **not** contain visible order-book depth quantities.

Therefore:

- `v` is throughput evidence, not proof of current displayed order-book inventory;
- 24h strategy demand must be compared with volume on a consistent daily unit basis;
- missing current ask/bid is a hard availability problem;
- incomplete historical volume is uncertainty, not automatically extreme risk;
- auxiliary tea must not dominate the production-share classification of the main strategy. Tea still requires a current ask and can produce a procurement warning;
- main external inputs and outputs remain subject to throughput evaluation;
- output history remains important because sell-through must be estimated.

## UI semantics

`insufficient` means data insufficient / verification needed, not proven extreme risk.

The fixed 12-column strategy table remains unchanged. Detailed evidence and warnings belong in tooltips or expanded details, not new columns.
