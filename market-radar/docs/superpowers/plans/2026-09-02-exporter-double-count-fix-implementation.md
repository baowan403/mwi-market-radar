# Exporter Double Count Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated Exporter equipment buffs and preserve void tea leaf in strategy paths.

**Architecture:** Two surgical predicate changes with focused regression tests; no formula or UI refactor.

**Tech Stack:** TypeScript, Vitest.

---

### Task 1: Exporter equipment ownership

**Files:**
- Modify: `src/profile/import.ts`
- Modify: `tests/profile-import.test.ts`

- [ ] Add a failing assertion that Exporter `specialEquipment` retains pouch but excludes `alchemy_tool`, `body`, and `legs`.

```ts
expect(profile.specialEquipment.pouch).toEqual({
  itemHrid: '/items/guzzling_pouch', enhancementLevel: 5,
});
expect(profile.specialEquipment).not.toHaveProperty('alchemy_tool');
expect(profile.specialEquipment).not.toHaveProperty('body');
expect(profile.specialEquipment).not.toHaveProperty('legs');
```

- [ ] Run `npm test -- tests/profile-import.test.ts` and confirm failure.
- [ ] Filter `specialEquipment` to shared slots only.

```ts
const actionSlots = new Set([
  ...SKILLING_ACTIONS.map((action) => `${action}_tool`),
  'body', 'legs', 'back', 'charm', 'amulet',
]);
const specialEquipment = Object.fromEntries(
  Object.entries(slots).filter(([slot]) => !actionSlots.has(slot)),
);
```

- [ ] Re-run the test and commit.

### Task 2: Void tea leaf path and release

**Files:**
- Modify: `src/strategy/candidates.ts`
- Modify: `tests/strategy-candidates.test.ts`

- [ ] Add a failing assertion that the positive void-tea-leaf decompose candidate path starts with `/items/void_tea_leaf`.

```ts
snapshot.quotes['/items/void_tea_leaf::0'] = { a: 116, b: 115, p: 115.5, v: 600_000 };
snapshot.quotes['/items/brewing_essence::0'] = { a: 292, b: 290, p: 291, v: 600_000 };
const result = buildStrategyCandidates({ profile, data, prices: createStrategyPriceBook(snapshot, data) });
const candidate = result.candidates.find((item) => item.kind === 'decompose'
  && item.steps[0]?.inputs.some((flow) => flow.itemHrid === '/items/void_tea_leaf'));
expect(candidate?.path).toEqual(['/items/void_tea_leaf', '/items/brewing_essence']);
```

- [ ] Run the focused test and confirm failure.
- [ ] Replace the broad `includes('tea')` check with `endsWith('_tea')`.

```ts
const input = step.inputs.find((flow) => (
  flow.market && !flow.itemHrid.endsWith('_tea')
))?.itemHrid;
```

- [ ] Run focused tests, then `npm test`, `npm run build`, and relevant E2E.
- [ ] Commit, push to `main`, and verify GitHub Pages deployment.
