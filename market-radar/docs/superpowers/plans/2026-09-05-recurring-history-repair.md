# Recurring history repair

Goal: implement the Owner-approved official-current + stockmarket-history repair without changing strategy formulas or the12-column table.

Design: extend the existing validated seven-day backfill with an explicit `--repair-gaps` mode. Skip network when all168 hourly buckets exist; throttle attempts to once per6hours, including failures. Use one sequential client, existing bounded retry/body/time limits. Match latest official prices and volume before accepting external history; existing timestamps remain immutable. Preserve the official upper bound and provenance. Do not fabricate missing quotes or hours. Failure to fetch must not block the official collection/deployment; storage validation still gates deployment.

- [ ] Add command regressions: mode parsing, second repair after6h, immediate rerun no network, complete history no network, failure preserves market files and throttles retry, overlap mismatch rejection.
- [ ] Extend `scripts/backfill-stockmarket-history.ts` minimally; reuse client/aggregation/merge. Run `npx vitest run tests/stockmarket-backfill.test.ts` red then green.
- [ ] Add repair step to scheduled/manual workflow after official collection, with visible nonfatal fetch failure; leave one-time import available.
- [ ] Run full tests/build, review diff, commit/push. Trigger manual collection, verify public manifest coverage and example volumes after deployment. Do not claim full equipment history if upstream retention is sparse.

Approved plan: user's preceding “按照你的計畫修改”. No new infrastructure/account, market trades, or unrelated model changes.
