# Sparse Market Capacity Fallback Design

## Problem

The official quote snapshot remains complete, but recent cloud history may contain only 4–11 covered hours. The current capacity model produces a normalized 24-hour volume estimate at four hours, yet refuses to create a safe production budget until twelve hours. Strategy sessions therefore become non-actionable and the default table hides otherwise valid, profitable candidates.

## Approved behavior

- Four or more covered hours: use the existing normalized 24-hour volume estimate to create a conservative capacity budget.
- Twelve or more covered hours: keep the current high-confidence designation.
- Fewer than four covered hours: keep capacity unknown and withhold executable profit.
- Keep the existing low-confidence UI marker for coverage below twelve hours.
- Do not change profit formulas, taxes, candidate generation, ranking columns, or quote validation.

## Acceptance

With five recent snapshots, a positive strategy receives a finite safe duration and remains visible as a limited, low-confidence recommendation. With only three snapshots, it remains pending.
