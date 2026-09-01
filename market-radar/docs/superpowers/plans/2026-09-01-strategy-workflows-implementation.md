# Personalized Strategy Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing local player profile, pinned game data, and cloud market snapshots into a visible Strategy Recommendations page covering one-step manufacturing, multi-step manufacturing/brewing, and decompose-to-coinify paths.

**Architecture:** Build pure strategy adapters above the existing `actionBuffs` and `calculateManufacture` foundation. Every strategy step consumes an explicit `MarketPriceBook`, produces hourly input/output flows, and is combined by a workflow engine that cancels internal intermediates and balances stage time. The dashboard receives already-calculated strategy cards; it does not reimplement formulas.

**Tech Stack:** TypeScript, Vitest, IndexedDB profile store, existing static strategy data, existing cloud/local snapshot clients, jsdom, Playwright.

---

## Scope

Included:

- latest snapshot price book using ask for purchases and bid for market sales;
- actual MWI manufacturing recipe adapter for crafting, tailoring, cheesesmithing, cooking, and brewing;
- one-to-seven-step acyclic manufacturing workflows;
- decompose and coinify calculators with catalyst options 0/1/2;
- decompose→coinify composed strategies;
- personalized theoretical profit, cost, income, actions/hour, working capital, and step breakdown;
- Strategy Recommendations tab, gated by a local active profile;
- strategy pinning in local IndexedDB.

Deferred to the next plans:

- 5% market-share capacity, safe batch, sell-through days, and realizable profit;
- 3D/7D strategy-margin trend and backtesting;
- enhancement and transmutation risk models.

## New files

- `src/strategy/price-book.ts`
- `src/strategy/manufacture-adapter.ts`
- `src/strategy/workflow.ts`
- `src/strategy/alchemy.ts`
- `src/strategy/candidates.ts`
- `src/strategy/store.ts`
- `src/strategy/view.ts`
- `tests/strategy-price-book.test.ts`
- `tests/strategy-manufacture-adapter.test.ts`
- `tests/strategy-workflow.test.ts`
- `tests/strategy-alchemy.test.ts`
- `tests/strategy-candidates.test.ts`
- `tests/strategy-store.test.ts`
- `tests/strategy-view.test.ts`
- `e2e/strategy-recommendations.spec.ts`

## Modified files

- `src/strategy/types.ts`
- `src/app.ts`
- `src/styles.css`
- `playwright.config.ts`
- `README.md`

---

### Task 1: Create the conservative market price book

**Files:**
- Create: `src/strategy/price-book.ts`
- Create: `tests/strategy-price-book.test.ts`

- [ ] Write a failing test proving `ask('/items/log', 0)` and `bid('/items/plank', 0)` preserve null and enhancement identity.

```ts
const book = createMarketPriceBook(snapshot);
expect(book.ask('/items/log')).toBe(100);
expect(book.bid('/items/plank')).toBe(250);
expect(book.bid('/items/gloves', 7)).toBe(50_000_000);
expect(book.ask('/items/missing')).toBeNull();
```

- [ ] Run `npm test -- --run tests/strategy-price-book.test.ts`; expect module-not-found failure.

- [ ] Implement:

```ts
export interface MarketPriceBook {
  ask(hrid: string, level?: number): number | null;
  bid(hrid: string, level?: number): number | null;
  average(hrid: string, level?: number): number | null;
  volume(hrid: string, level?: number): number | null;
  timestamp: number;
}

export function createMarketPriceBook(snapshot: Snapshot): MarketPriceBook {
  const quote = (hrid: string, level = 0) => snapshot.quotes[`${hrid}::${level}` as MarketKey];
  const value = (input: unknown) => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
  return {
    timestamp: snapshot.timestamp,
    ask: (hrid, level = 0) => value(quote(hrid, level)?.a),
    bid: (hrid, level = 0) => value(quote(hrid, level)?.b),
    average: (hrid, level = 0) => value(quote(hrid, level)?.p),
    volume: (hrid, level = 0) => value(quote(hrid, level)?.v),
  };
}
```

- [ ] Run the focused test and `npx tsc --noEmit`; expect PASS.

- [ ] Commit: `feat: add strategy market price book`.

### Task 2: Adapt real manufacturing recipes to the pure calculator

**Files:**
- Create: `src/strategy/manufacture-adapter.ts`
- Create: `tests/strategy-manufacture-adapter.test.ts`
- Modify: `src/strategy/types.ts`

- [ ] Write failing tests for one actual fixture action and for missing input ask/output bid.

```ts
const result = calculateManufactureAction({
  actionHrid: '/actions/crafting/redwood_lumber', profile, data, prices,
});
expect(result.valid).toBe(true);
expect(result.action).toBe('crafting');
expect(result.ingredients.some((item) => item.itemHrid === '/items/redwood_log')).toBe(true);
```

- [ ] Run the focused test; expect missing adapter failure.

- [ ] Add `StrategyStepResult`:

```ts
export interface StrategyFlow { itemHrid: string; enhancementLevel: number; unitsPerHour: number; unitPrice: number; market: boolean }
export interface StrategyStepResult {
  id: string;
  action: SkillingAction;
  actionHrid: string;
  outputHrid: string;
  valid: boolean;
  actionsPerHour: number;
  costPerHour: number | null;
  incomePerHour: number | null;
  profitPerHour: number | null;
  experiencePerHour: number;
  inputs: StrategyFlow[];
  outputs: StrategyFlow[];
}
```

- [ ] Implement `calculateManufactureAction` by looking up the action, deriving the action from its HRID, resolving `actionBuffs`, pricing recipe inputs at ask, outputs/drops at bid, adding selected teas, then delegating arithmetic to `calculateManufacture`.

- [ ] Run adapter, buff, manufacture, and strategy-data tests; expect PASS.

- [ ] Commit: `feat: adapt MWI manufacturing recipes`.

### Task 3: Balance and net multi-step workflows

**Files:**
- Create: `src/strategy/workflow.ts`
- Create: `tests/strategy-workflow.test.ts`

- [ ] Write failing tests for `a→2b`, `b→3c`, `c→5d`, `d→7e`; expect normalized stage time weights `[1,2,6,30]/39`, internal `b/c/d` removed, and only external `a/e` retained.

- [ ] Run the focused test; expect missing workflow module.

- [ ] Implement:

```ts
export interface WorkflowResult {
  id: string;
  steps: Array<StrategyStepResult & { workFraction: number }>;
  valid: boolean;
  costPerHour: number | null;
  incomePerHour: number | null;
  profitPerHour: number | null;
  inputs: StrategyFlow[];
  outputs: StrategyFlow[];
}
```

Use the Milkonomy reviewed algorithm: determine each downstream stage's required multiple from upstream output/hour divided by downstream input/hour, form cumulative multipliers, normalize their sum to one hour, multiply every step flow/result by its work fraction, then net identical `hrid::level` inputs and outputs. Reject cycles, missing links, zero rates, and more than seven steps.

- [ ] Run workflow tests and the existing `tests/workflow.test.ts`; expect PASS.

- [ ] Commit: `feat: calculate balanced strategy workflows`.

### Task 4: Port decompose and coinify formulas

**Files:**
- Create: `src/strategy/alchemy.ts`
- Create: `tests/strategy-alchemy.test.ts`

- [ ] Write failing golden tests for no catalyst, dedicated catalyst, prime catalyst, coin output without tax, and a decompose→coinify intermediate.

- [ ] Run the focused test; expect missing alchemy module.

- [ ] Implement success rate:

```ts
const levelRatio = playerLevel >= itemLevel ? 0 : -0.9 * (1 - playerLevel / itemLevel);
const catalystRatio = catalystRank === 0 ? 0 : catalystRank * 0.1 + 0.05;
const successRate = Math.min(1, baseSuccessRate * (1 + levelRatio + buffs.Success + catalystRatio));
```

Decompose uses base success `0.6`, `/actions/alchemy/decompose` time, bulk item ask, coin fee `bulk × (50 + 5 × itemLevel)`, catalyst consumption `successRate`, decompose outputs, alchemy essence EV, artisan-crate EV, and enhancing essence for enhanced inputs.

Coinify uses base success `0.7`, `/actions/alchemy/coinify` time, bulk item ask, catalyst consumption `successRate`, and untaxed coin output `sellPrice × 5 × bulkMultiplier`, plus essence/rare EV.

- [ ] Run alchemy, buff, price-book, and manufacture tests; expect PASS.

- [ ] Commit: `feat: add decompose and coinify calculators`.

### Task 5: Enumerate personalized candidates

**Files:**
- Create: `src/strategy/candidates.ts`
- Create: `tests/strategy-candidates.test.ts`

- [ ] Write failing tests that enumerate single manufacturing, 2–7-step manufacturing, single decompose/coinify, and decompose→coinify without duplicate ids or cycles.

- [ ] Run the focused test; expect missing candidates module.

- [ ] Implement `buildStrategyCandidates({ profile, data, prices })` returning immutable cards sorted by theoretical profit/day descending, with missing-price candidates excluded from the positive ranking but retained in diagnostics.

```ts
export interface StrategyCandidate {
  id: string;
  kind: 'manufacture' | 'workflow' | 'decompose' | 'coinify' | 'decompose-coinify';
  title: string;
  path: string[];
  profitPerHour: number;
  profitPerDay: number;
  costPerHour: number;
  incomePerHour: number;
  workingCapital24h: number;
  steps: StrategyStepResult[];
}
```

- [ ] Run candidate tests and a bounded performance test requiring completion under two seconds for the full committed data fixture.

- [ ] Commit: `feat: enumerate personalized strategy candidates`.

### Task 6: Persist strategy pins and add the Strategy Recommendations page

**Files:**
- Create: `src/strategy/store.ts`
- Create: `src/strategy/view.ts`
- Create: `tests/strategy-store.test.ts`
- Create: `tests/strategy-view.test.ts`
- Modify: `src/app.ts`
- Modify: `src/styles.css`

- [ ] Write failing IndexedDB tests for independent item pins vs strategy pins and DOM tests for no-profile, calculating, results, empty, and error states.

- [ ] Implement a `strategy-pins` object store in a dedicated `mwi-market-radar-strategies` IndexedDB; expose only list/toggle/close.

- [ ] Add top-level `市場行情` and `策略推薦` modes. Without an active profile, Strategy Recommendations shows one clear import CTA. With a profile, lazy-load the pinned strategy data JSON, calculate candidates off the main interaction path, and render:

```text
建議／策略路徑／理論日利／每小時利潤／24h資金／步驟／自選
```

Label all results `理論收益；尚未套用市場承接量` until the liquidity plan lands.

- [ ] Run view/store/app/dashboard tests and build; expect PASS.

- [ ] Commit: `feat: add personalized strategy recommendations`.

### Task 7: Prove the public workflow journey and deploy

**Files:**
- Create: `e2e/strategy-recommendations.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`

- [ ] Add E2E: public cloud view works without profile; import fixture; open Strategy Recommendations; verify at least one manufacturing and one decompose→coinify candidate; pin one; reload; verify pin remains; ensure no profile data leaves in request bodies.

- [ ] Run `npm test -- --run`, `npm run build`, and `npx playwright test`; expect zero failures except the existing expected skip.

- [ ] Update README with delivered and deferred boundaries.

- [ ] Commit: `feat: deploy personalized strategy workflows`.

- [ ] Push explicitly with `git push origin HEAD:main`, wait for GitHub Actions success, and verify the public Pages Strategy Recommendations journey.
