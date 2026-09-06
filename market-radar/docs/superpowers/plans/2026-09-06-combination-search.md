# Approved cross-skill combination search

Goal: discover profitable two/three-action combinations across lifestyle skills while retaining existing seven-step manufacturing paths and single actions.

- Extend workflow balancing with explicit parent/output connections. A three-action tree may process two distinct products of one parent. All work fractions sum to one; shared intermediate flows cancel before pricing. Reject cycles and double allocation.
- Reconstruct recoverable unpriced steps from their physical ledger; unknown external inputs or terminal prices remain invalid. Never invent a zero market quote.
- Feed all prepared action/catalyst steps into a bounded three-action graph, not just standalone profitable candidates. Preserve direct-sale alternatives. Incidental rare/crate drops remain terminal EV; primary co-products may be processed.
- Keep current per-step tea policy; this version does not claim exhaustive joint tea/loadout optimization. Include all selected tea/coins/consumables and weighted time.
- Declare multi-terminal branches for market risk and use readable branch paths. Existing 12 columns remain.
- Regression cases: losing single step leading to winning chain, no intermediate Ask/Bid, multi-output split, branch double-spend/cycle rejection, weighted time/fees/tea, end-product market risk, legacy ranking coverage and throughput.
- Full tests/build and live verification before deployment. If exhaustive bounded graph exceeds practical runtime, report scope/diagnostics rather than silently claiming a global optimum.
