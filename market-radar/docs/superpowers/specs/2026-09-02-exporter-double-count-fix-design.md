# Exporter Double Count Fix Design

## Goal

Stop Milkonomy Exporter profiles from applying the same action equipment twice and show alchemy source items correctly in strategy paths.

## Changes

1. `importExporter` continues assigning each action its own tool, body, legs, back, and charm.
2. Exporter `specialEquipment` retains only equipment not already copied into action profiles. It excludes every `*_tool` slot plus `body`, `legs`, `back`, `charm`, and `amulet`; shared slots such as head, hands, feet, neck, earrings, ring, off-hand, and pouch remain.
3. `stepPath` excludes actual drink tea HRIDs ending in `_tea`. It no longer excludes every HRID merely containing `tea`, so `/items/void_tea_leaf` remains visible.

## Verification

- Import regression: action equipment appears once and shared equipment remains available.
- Strategy regression: void tea leaf decompose path is `虛空茶葉 → 沖泡精華`.
- Existing MK preset calculations remain unchanged.

## Out of scope

- formula rewrites;
- profile editor changes;
- unrelated ranking, liquidity, or UI changes.
