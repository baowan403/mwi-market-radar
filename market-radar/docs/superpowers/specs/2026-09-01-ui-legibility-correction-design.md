# MWI Market Radar UI legibility correction

## Goal

Keep the existing information architecture and calculations while removing controls whose text appears to escape rounded surfaces. Use restrained semantic color so players can scan movement, risk, and liquidity without turning the dashboard into a saturated heat map.

## Decisions

- Replace the always-expanded native multi-select for enhancement levels with a collapsed `details` picker. The summary reads `全部等級`, `+7`, or `已選 2 個`; the panel keeps multi-select checkboxes and an explicit clear action.
- Rounded controls must own their text: `min-width: 0`, bounded width, wrapping where appropriate, and vertically centered labels. Scroll is reserved for tables and intentional option panels.
- Follow the game's Chinese market convention: rising values use red, falling values use green. Use orange for warnings/capital pressure and blue for volume/informational values.
- Apply color primarily to numbers and compact status labels. Neutral navigation, item names, and ordinary copy stay neutral.
- Trend labels receive a subtle tinted background and border in addition to the arrow and text color, so meaning does not depend on color alone.

## Non-goals

- No changes to market calculations, strategy ranking, cloud collection, profile data, or chart behavior.
- No framework migration, new visual dependency, or broad layout rewrite.
- No decorative gradients or animation that competes with data density.

## Acceptance

- Enhancement levels remain multi-selectable but the control is one compact row when closed.
- At 393 px width, the status, data-source card, enhancement picker, buttons, and market flags do not overflow their rounded surfaces.
- Up/down trend labels remain identifiable by arrow, sign, and red/green styling; warnings and volume retain orange/blue semantics.
- Existing dashboard journeys and accessibility labels continue to pass.
