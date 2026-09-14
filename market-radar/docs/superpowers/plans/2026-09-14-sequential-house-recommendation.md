# Sequential House Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default upgrade table recommend only the next sequential house level while retaining all future levels in the expanded list.

**Architecture:** Change only the quick-list presentation filter in `upgrade-view.ts`. House rows select the lowest eligible target level; equipment rows retain gain/efficiency leaders. The analysis and valuation model remain unchanged.

**Tech Stack:** TypeScript, Vitest, jsdom

---

### Task 1: Lock and implement sequential house display

**Files:**
- Modify: `tests/strategy-upgrade-view.test.ts`
- Modify: `src/strategy/upgrade-view.ts`

- [ ] Add a UI regression test with Lv5–Lv8 house rows that expects only Lv5 by default and all four after expansion.
- [ ] Run the focused test and confirm it fails because Lv8 is also selected as the gain leader.
- [ ] Special-case the `house` slot to select only its lowest eligible level in the default leader set.
- [ ] Run the focused test, full test suite, type check, and production build.
- [ ] Commit and deploy the verified change.
