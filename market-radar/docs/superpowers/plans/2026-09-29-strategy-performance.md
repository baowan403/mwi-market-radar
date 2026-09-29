# Strategy Performance Repair Implementation Plan

**Goal:** Remove duplicate candidate explosion and avoid unchanged rescans.

1. Add failing candidate-depth and render-cache regression tests.
2. Verify the current candidate benchmark exceeds five seconds.
3. Limit legacy workflows and budget combination discovery.
4. Cache a completed candidate scan for the current profile/snapshot/data tuple.
5. Run focused tests, the full suite, type check, build, benchmark and production smoke verification.
