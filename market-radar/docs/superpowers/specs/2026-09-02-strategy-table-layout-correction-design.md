# Strategy Table Layout Correction Design

## Goal

Make the strategy recommendation table as orderly and information-dense as the market table while preserving every strategy calculation, filter, pin, disclosure, and liquidity decision.

## Root cause

Several strategy `<td>` elements are currently changed to `display: grid`. This removes them from normal table-cell layout behavior, so column boundaries no longer align consistently. The result is excessive empty space, partial row separators, overly wide short fields, and forced wrapping in fields that need more room.

## Table contract

The table keeps its ten existing information groups:

1. 自選
2. 策略路徑
3. 判定
4. 趨勢
5. 理論日利
6. 可實現日利
7. 安全執行
8. 市場承接
9. 24h 資金
10. 假設

All `<th>` and `<td>` elements retain native table display semantics. A `<colgroup>` defines intentional widths so short fields cannot consume disproportionate space:

| Column | Width |
|---|---:|
| 自選 | 52px |
| 策略路徑 | 220px |
| 判定 | 84px |
| 趨勢 | 120px |
| 理論日利 | 105px |
| 可實現日利 | 108px |
| 安全執行 | 145px |
| 市場承接 | 185px |
| 24h 資金 | 105px |
| 假設 | 90px |

The table uses fixed layout with a minimum width derived from those columns. Narrow viewports scroll horizontally like the market table; they do not squeeze long cells into unreadable fragments.

## Information hierarchy

- Strategy path uses two compact visual levels: type and output name on the first line, path on the second line.
- Classification remains one small badge.
- Trend puts the signal badge and confidence on one line. The existing reasons and invalidation remain closed under a short disclosure on the next line.
- Theoretical profit, realizable profit, and working capital stay on one line, right aligned, with tabular figures and the shared K/M formatter.
- Safe execution and market capacity use compact stacked lines inside a wrapper element. Only their inner wrapper uses grid; the surrounding table cell remains a table cell.
- Step assumptions remain closed by default and use a short disclosure label. Expanding details may increase that row's height but must not change column widths.

## Visual behavior

- Row separators span the full table width.
- Rows receive the same restrained hover treatment as market rows.
- Header labels, numeric alignment, padding, and color hierarchy follow the market table.
- Pin and strategy columns remain stable on horizontal scroll, matching the market table's sticky-column behavior.
- No new font, color system, card layout, side panel, or dependency is introduced.

## Accessibility

- Table semantics, column headers, disclosure controls, pin labels, focus rings, and keyboard behavior remain intact.
- No content is hidden without an accessible native `<details>` disclosure.
- Text may wrap only in strategy paths, reasons, market bottleneck names, and expanded assumption content.

## Verification

Automated DOM tests verify the colgroup contract, compact wrapper structure, native table-cell display, disclosure labels, and unchanged strategy ordering and values. Playwright checks desktop and mobile viewports for full-width row separators, bounded row height while disclosures are closed, readable column widths, horizontal scrolling, and absence of overlapping or clipped text.

## Out of scope

- changing calculations, ranking, liquidity gates, trend signals, or recommendations;
- removing any strategy information;
- converting rows into cards or adding a drawer/detail page;
- redesigning the market table or global shell.
