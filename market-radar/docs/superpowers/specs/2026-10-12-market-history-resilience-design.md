# Market History Resilience Design

## Goal

Keep the Radar useful and deployable when a scheduled market-history update is invalid, while preserving strict validation and never presenting unknown liquidity as executable profit.

## Failure chain

The official snapshot fetch succeeds, but a later history validation can fail during UTC-day rollover. Because data collection, validation, tests, build, and deployment share one job, the invalid candidate aborts the entire workflow. The `market-data` branch remains safe, but cloud history becomes stale. A browser may then have too few recent buckets to calculate capacity, and the default actionable-only table hides most positive strategies.

## Design

### Candidate data transaction

Scheduled and manual collection operate on a temporary copy of the last-known-good `market-data/data` tree. The candidate tree is updated, derived daily history is repaired from immutable hourly snapshots, and the whole tree is validated. Only a valid candidate is synchronized into the `market-data` worktree. If the candidate remains invalid, the workflow emits a warning, keeps the previous data tree, and continues testing, building, and deploying.

The workflow fails only when the last-known-good data tree is itself invalid or when the application tests/build fail.

### Derived-history repair

`daily-history.txt` is derived data. A repair command rebuilds it exclusively from the validated manifest and immutable snapshot files. It excludes the latest incomplete UTC day and the retention-clipped boundary day, then validates the rebuilt pack. Manifest and snapshot corruption remain hard failures and are never silently discarded.

Validation errors expose only a safe category and affected relative path/timestamp; they never print market payloads.

### UI degradation

Executable strategies remain first and continue using realizable session profit. If fewer than 50 executable strategies exist, the table fills remaining rows with positive-profit candidates whose only blocker is stale or insufficient capacity history. These rows show no executable profit or capital amount and are labeled `行情過期` or `容量待確認`. Missing quotes, no bid, no ask, and price anomalies remain hidden unless the user explicitly searches or enables pending candidates.

## Acceptance

1. A corrupt derived daily pack is rebuilt from valid hourly snapshots and validates successfully.
2. A corrupt manifest or immutable snapshot still fails safely.
3. An invalid candidate update leaves last-known-good data byte-identical and the site build continues.
4. A valid candidate update is published normally.
5. With only three executable strategies, positive capacity-unknown candidates appear afterward with explicit pending labels.
6. Pending candidates never receive an executable profit, funding amount, or high priority badge.
