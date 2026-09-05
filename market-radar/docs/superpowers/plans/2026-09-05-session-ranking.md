# Session ranking implementation plan

Owner approved the preceding design and requested implementation. Preserve12 columns, use 預估收益; duration selector30minutes/1/6/12/24hours/custom (0.5–24h). Default24h.

Reuse the existing5% conservative daily market capacity, with a fixed24h disposal reference. `executionHours=min(selectedHours,safeHoursPerDay)`; `estimatedProfit=profitPH*executionHours`. This is a capped production recommendation, NOT proceeds from producing excess stock. Show 限做XH whenever capped; unused hours earn nothing. Details show full-duration theoretical value, capped plan, and excess production if ignoring the cap. No guarantee of liquidation. Main output/input risk uses planned quantity divided by24h volume, not annualized quantity. Funding uses total cost including coin actions, minus actual material inventory replacement only. Unknown/missing-price/stale strategies are not silently ranked using theoretical profit; searchable or opt-in unranked candidates retain theoretical values in details.

- [ ] decision/realizable regressions:0.5h, unchanged safe daily budget, longer-duration rank inversion, planned risk, unknown no fallback, coin-inclusive funding, stable0.1M groups with priority/risk/cash/id tie breaks.
- [ ] view regressions:12 columns, time selector changes ordering/profit/cash/risk without recomputing base production, custom validation, preserve selection on refresh, capped badge and consistent detail schedule, opt-in unranked.
- [ ] implement helpers and view changes; keep underlying production formulas and historical1D/3D/7D profit series unchanged. Recompute contextual priority cheaply from cached series after duration changes.
- [ ] full tests/build, focused review, deploy and verify runtime dropdown/columns/limits. No MWI account actions.
