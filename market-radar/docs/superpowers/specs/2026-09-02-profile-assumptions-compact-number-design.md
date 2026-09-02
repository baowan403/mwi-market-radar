# Profile Assumptions And Compact Number Design

## Goal

Make every Radar profit result auditable without rebuilding Milkonomy's configuration editor, and make large values readable with one consistent `K`/`M` notation.

## Product decision

Milkonomy remains the configuration editor for action-specific equipment and tea choices. Radar imports the resulting preset or snapshot, calculates from those imported values, and shows the active assumptions in a compact read-only summary.

Radar will not infer the "best" equipment from warehouse contents in this slice. Such an inference depends on whether the player values profit, experience, speed, capital efficiency, or equipment preservation, so silently choosing gear would make results less trustworthy. Radar also will not duplicate Milkonomy's full equipment and tea editor in this slice.

## Profile assumption summary

The existing profile dialog gains a read-only section for the selected profile. It shows the values that materially affect strategy calculations:

- action name and skill level;
- tool and enhancement level;
- body, legs, back, charm, and pouch, omitting empty slots;
- up to three configured teas, preserving their imported order;
- relevant house level;
- community, achievement, and shrine modifiers already represented by the imported profile.

The summary must label missing configuration as `未設定`, not invent defaults. It must not claim that the displayed setup is optimal. The existing import, profile selection, deletion, and storage behavior remains unchanged.

Both supported import shapes remain valid:

- Milkonomy action preset data, including `actionConfigMap` and `specialEquimentMap`;
- Milkonomy Exporter snapshots, including current equipment and `actionTeas` where present.

When a snapshot only contains currently equipped items, Radar displays those items as imported. It does not scan `inventoryMap` to replace them.

## Compact number format

One shared formatter is used by the market table, item detail view, profile assumption summary where numeric magnitudes appear, and strategy recommendation view.

- absolute value below `1,000`: localized digits without a suffix;
- `1,000` through `999,999`: divide by `1,000` and append `K`;
- `1,000,000` and above: divide by `1,000,000` and append `M`;
- values at or above one billion continue using `M`, for example `1,000M`; `B` is never emitted;
- show at most two decimal places and remove trailing zeroes;
- preserve the sign for negative values;
- non-finite values render as `—`.

Examples:

| Input | Display |
|---:|:---|
| `999` | `999` |
| `1,234` | `1.23K` |
| `12,300` | `12.3K` |
| `1,234,567` | `1.23M` |
| `1,000,000,000` | `1,000M` |
| `-2,500,000` | `-2.5M` |

Rates and percentages retain their existing units. The formatter only replaces long magnitude formatting; it does not change calculations or rounding inside the strategy engine.

## Error handling

- A profile that cannot be parsed continues to use the existing import error path.
- Missing optional equipment, tea, house, or buff fields do not block import; the summary shows `未設定` or omits irrelevant empty rows.
- Formatting is presentation-only and never feeds rounded values back into calculations.

## Verification

Automated tests cover all number-format boundaries, negative and non-finite values, a complete Milkonomy action preset, and a sparse Exporter snapshot. UI tests verify that the profile dialog displays imported assumptions and that market and strategy screens use compact values without `B` or long comma-separated millions.

Manual acceptance uses the current `jotaro99` Milkonomy configuration and confirms that Radar exposes enough assumptions to explain any remaining profit difference without opening source code.

## Out of scope

- automatic warehouse scanning or automatic best-in-slot selection;
- a second full equipment or tea editor inside Radar;
- changing profit formulas, tax, liquidity gates, or strategy ranking;
- changing the Milkonomy export format.
