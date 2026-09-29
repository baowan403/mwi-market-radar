# Strategy Performance Repair Implementation Plan

**Goal:** Remove duplicate candidate explosion and avoid unchanged rescans.

1. Add failing render-cache and tea-pool regression tests.
2. Verify the current candidate benchmark and live repeat-navigation delay.
3. Cache a completed candidate scan for the current profile/snapshot/data tuple.
4. Remove irrelevant Artisan Tea combinations from Alchemy operations.
5. Run focused tests, the full suite, type check, build, benchmark and production smoke verification.
