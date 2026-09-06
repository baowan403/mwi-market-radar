# Strategy performance implementation plan

**Goal:** Preserve formulas and ranking while avoiding repeated market, tea and UI work. Owner approved 2026-09-06.
**Architecture:** Computation-scoped caches, never persistent global profile caches. Market history cache is bounded to one view/analysis and historical timestamps never see future samples. Upgrade eligibility is checked before evaluation; zero/negative gains are omitted after exact evaluation.
**Tech Stack:** TypeScript, Vitest, existing browser worker.

1. Add regression tests for scoped market capacity/history and tea-buff reuse: cached values deep-equal direct calculations, new scope reflects changed data; run RED then implement GREEN.
2. Share capacity lookups in view, history series and upgrade analysis; reuse tea buffs within each candidate scan (all legal tea combinations retained).
3. Cache session assessments by selected duration; create detail DOM only when expanded; test search does not repeat assessments and details remain accessible.
4. Skip known unmet gear before enumeration. Safely skip equal income attributes only when concentration is equal (no monotonic-speed assumption under capacity limits). Evaluate trade-offs exactly and remove nonpositive rows. Update regression expectations for the approved positive-only goal board.
5. Benchmark reproducible 168-hour fixtures before/after with full output hashes; run full tests/build, verify browser, deploy. Do not compare production market values across changing snapshots.

No wallet filtering, no changes to tax, tea selection, candidate coverage or the 12-column strategy layout. Unknown eligibility is not falsely classified as unmet. No new dependencies.
