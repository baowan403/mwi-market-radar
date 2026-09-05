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

## Same-profile Runtime check (September 5, 15:06 market snapshot)

An independent `jotaro99 MK核對` profile was imported from the active MK configuration. Do not confuse it with the existing auto-loadout Radar profile. With MK's equipment exclusion and volume filter, Top20 coverage is 20/20. Without those filters, raw Top20 coverage is 16/20: four missing Holy Plate Body workflows require level89, above this character's cheesesmithing68 even with the available level tea. Executable coverage in that unfiltered group is 16/16; raw coverage must not be described as100%.

Comparable daily profits (M, Radar / MK): arcane lumber decomposition53.12/53.1; emp tea leaf52.86/52.9; ultra cooking tea transmute52.87/52.8; coinification catalyst transmute53.09/52.7; umbral hide52.57/52.5; holy milk51.74/51.7; star fruit51.35/51.3. These pass the user's5% tolerance. All seven requested transmute candidate types were found. Beast bracers workflows48.72/50.5 and48.54/50.3 also pass. Historical burble spatula numbers were not reproduced: current Radar gathering chain and MK upgrade chain are different paths, so their headline values are not parity evidence.

The runtime Top30 displayed estimated numeric output shares or coin-sale exemption. Observed risk counts: low9, procurement pressure1/watch1/critical2, sell watch2/pressure3/critical3, two-sided9. Priority: highest1, medium17, low12. Partial volume is explicitly approximate, not a complete24h observation. This distribution is an observation, not a quota enforced by the model.

Follow-up defect fixed: tea used as actual alchemy feedstock was classified as an auxiliary drink. Its input now remains in candidate identity/path and participates in procurement risk. Full run:670 passed,33 pre-existing skips; production build passed. No profit formula was changed.

Remaining limitations: historical secondary-price completeness, any major workflow differences on genuinely identical paths, and reliable external scheduling if GitHub continues delaying runs. The exact scheduling-delay cause remains unproved. No claim of repaired hourly collection; historical gaps were not fabricated.
