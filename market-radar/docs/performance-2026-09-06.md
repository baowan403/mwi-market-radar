# 2026-09-06 performance verification

Scope: keep candidate coverage, formulas, pricing, trend and ranking. Filter known-unwearable and calculated nonpositive upgrades per Owner approval. No wallet filter.

Reproduction: `node --import tsx scripts/benchmark-strategy.ts` from market-radar. Uses public game data + repository test character + synthetic 168-hour market, NOT live income advice.

| Work | Before (ms) | After (ms) | Identical output check |
|---|---:|---:|---|
| All candidates | 11050 | 4035 | 11200 candidates, SHA256 prefix 80646ae3390da786 |
| 12 historical series | 433 | 161 | cfdf13eb567e7db0 |
| Crafting upgrade scan | 36719 | 5443 | 82 positive targets, 9b11371d1e425b1f |

Timing is a local sample, not a promise for every browser/profile. The earlier unoptimized run also returned 107 targets, of which 99 were eligible or unknown; the current run evaluates those 99 and returns the same 82 positive outcomes. Arithmetic hashes omit changed display-only metadata.

Implementation:
- `tea-optimizer`: per-scan action/tea buff cache; all tea combinations retained.
- `liquidity` + `realizable` + `margin-series`: explicit per-analysis capacity lookup, historical prefix sharing without future data.
- `view`: reuse session evaluations until hours change, cache displayed signals, lazily create hidden details.
- `candidate-worker`: initial scan runs off main thread; abort obsolete renders and discard stale results.
- `upgrades`: filter unmet before evaluation; reuse equal economic buffs (exclude XP only), share market lookups and batch timer yields; omit nonpositive gains.

No global or persistent economic caches; a fresh render/analysis makes a fresh scope. New snapshot/profile/data must not inherit old scope. Regression tests cover changed market bid, changed level, historical prefixes, search reuse, detail expansion, worker cancellation and filtering.
