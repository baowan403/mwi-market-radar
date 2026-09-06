# Approved upgrade copy and MK audit

Owner approved nine columns: 裝備 / 部位 / 價格 / 存錢天數 / 每日增益 / 換裝後收益 / 回本天數 / 優先級 / 備註.

- Remove repeated purchasing labels and eligibility labels from the slot cell. Keep actual restrictions in notes and full detail. Unknown forecasts remain conditional.
- Saving days = full Ask / highest current 24h executable estimated return across all character strategies. No wallet or reserve reading. Zero/unknown income or unknown quote => unknown, never infinity/free. Explain the denominator once above the table. Keep daily usage setting for upgrade deltas separate from this fixed 24h saving reference.
- Reuse existing 24h assessments; no extra candidate enumeration.
- Tests: header and colSpan, no repeated copy, 100/50=2 days, unknown and zero guards; existing main 12 columns unchanged.
- MK changelog audit: read v2.0.0–2.7.0 and relevant source, compare data structurally. Fix proven decompose/coinify XP success weighting; leave current-profit formulas intact. Test failed-attempt 10% XP and unchanged economics.
- Full tests/build, push including pending eye-watch fix, verify deployed UI and saved sdve1 loadout.
