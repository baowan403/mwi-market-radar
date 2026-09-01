# Liquidity, trend, and backtest acceptance

Verified on 2026-09-01 (Asia/Taipei) against commit candidate after `a8d2c38`.

## Commands and evidence

- `npm test`: 51 test files, 475 tests passed.
- `npm run build`: TypeScript passed; dashboard and userscript production artifacts built.
- `npx playwright test`: 35 passed, 2 expected desktop skips.
- Desktop and 393 px Chrome strategy journeys both passed with a synthetic Milkonomy profile; no profile payload left the browser.

## Player-visible proofs

- The actionable view contains at least one `long-run` and one `limited` positive strategy and excludes `reject`／`insufficient` rows.
- The observation view contains at least one `reject` fake-high-profit strategy whose market share exceeds the safe threshold.
- Every row shows theoretical and realizable daily profit, safe hours, safe batch, sell-through estimate, market share, bottleneck, 24h capital, and expandable assumptions.
- A 31-day daily-history fixture merges with 72 recent hourly samples without overlapping dates.
- The strategy row shows a trend action, low confidence, 3D／7D backtest statistics, reasons, and explicit invalidation text.
- Under seven days, signals remain `wait` with no confidence. Medium/high confidence requires at least 30 days and a passing backtest; high additionally requires minimum sample and hit-rate gates.

## Data and safety proofs

- Cloud hourly retention includes the exact 10-day boundary and prunes older orphan files only after manifest publication.
- `daily-history.txt` is a bounded gzip/base64 JSON pack with up to 180 daily OHLCV／quote-quality summaries.
- The updater backfills completed retained days when migrating a data branch without a daily pack, then finalizes each UTC day only after it closes; the compressed pack changes at most once per day.
- The CLI validates the hourly manifest, every immutable snapshot, and the optional daily pack without logging corrupt payloads.
- The browser merges only daily points older than the hourly window; health-gap detection examines only the latest 10-day hourly window.
- Walk-forward tests prove the signal callback receives prefixes only; wait signals do not inflate hit rate.

## Deployment caveat

The implementation can retain 180 daily summaries, but historical days cannot be invented. The first scheduled run after deployment creates the pack and backfills only hourly snapshots already present in `market-data`; older daily history accumulates on subsequent real runs.
