// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createMemoryStrategyPinStore } from '../src/strategy/store';
import { createStrategyView } from '../src/strategy/view';
import type { StrategyCandidateResult } from '../src/strategy/candidates';
import type { PlayerProfile } from '../src/profile/types';
import type { MarketKey, Snapshot } from '../src/core/types';
import type { StrategyStepResult } from '../src/strategy/types';

const profile = {
  id: 'character:1', name: '測試牛', actions: { alchemy: { playerLevel: 103 } },
} as unknown as PlayerProfile;
const snapshot: Snapshot = { timestamp: 1, quotes: {} };

function marketStep(
  id: string,
  inputHrid: string,
  outputHrid: string,
  unitsPerHour: number,
): StrategyStepResult {
  return {
    id,
    action: 'crafting',
    actionHrid: `/actions/crafting/${id}`,
    outputHrid,
    valid: true,
    actionsPerHour: 1,
    costPerHour: 1_000,
    incomePerHour: 2_000,
    profitPerHour: 1_000,
    experiencePerHour: 100,
    inputs: [{ itemHrid: inputHrid, enhancementLevel: 0, unitsPerHour, unitPrice: 100, market: true }],
    outputs: [{ itemHrid: outputHrid, enhancementLevel: 0, unitsPerHour, unitPrice: 200, market: true }],
  };
}

function history(volumes: Record<string, number>, count = 169): Snapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * 3_600_000,
    quotes: Object.fromEntries(Object.entries(volumes).map(([hrid, volume]) => [
      `${hrid}::0` as MarketKey,
      hrid.includes('output')
        ? { a: 310, b: 300, p: 305, v: volume }
        : { a: 110, b: 100, p: 105, v: volume },
    ])),
  }));
}
const calculated: StrategyCandidateResult = {
  diagnostics: [],
  candidates: [
    {
      id: 'workflow:redwood', kind: 'workflow', title: 'Redwood Bow',
      path: ['/items/redwood_log', '/items/redwood_lumber', '/items/redwood_bow'],
      profitPerHour: 2_000_000, profitPerDay: 48_000_000,
      costPerHour: 3_000_000, incomePerHour: 5_000_000, workingCapital24h: 72_000_000,
      steps: [],
    },
    {
      id: 'decompose-coinify:pirate', kind: 'decompose-coinify', title: 'Coin',
      path: ['/items/pirate_refinement_shard', '/items/pirate_essence', '/items/coin'],
      profitPerHour: 1_500_000, profitPerDay: 36_000_000,
      costPerHour: 4_000_000, incomePerHour: 5_500_000, workingCapital24h: 96_000_000,
      steps: [],
    },
  ],
};

describe('strategy recommendation view', () => {
  it('shows one import action without an active profile', async () => {
    const target = document.createElement('section');
    const onImportProfile = vi.fn();
    const view = createStrategyView({
      target,
      getProfile: () => null,
      getSnapshots: () => [snapshot],
      loadGameData: vi.fn(),
      pinStore: createMemoryStrategyPinStore(),
      calculate: vi.fn(),
      itemName: (hrid) => hrid,
      onImportProfile,
    });

    await view.render();
    expect(target.textContent).toContain('導入角色快照後計算');
    (target.querySelector('[data-strategy-import]') as HTMLButtonElement).click();
    expect(onImportProfile).toHaveBeenCalledOnce();
    view.destroy();
  });

  it('renders theoretical profit, path, capital, and persistent strategy pins', async () => {
    const target = document.createElement('section');
    const pinStore = createMemoryStrategyPinStore();
    const view = createStrategyView({
      target,
      getProfile: () => profile,
      getSnapshots: () => [snapshot],
      loadGameData: async () => ({
        shopItemDetailMap: {},
        openableLootDropMap: {},
        itemsByHrid: new Map(),
      }) as never,
      pinStore,
      calculate: () => calculated,
      itemName: (hrid) => ({
        '/items/redwood_log': '紅杉原木',
        '/items/redwood_lumber': '紅杉木板',
        '/items/redwood_bow': '紅杉弓',
        '/items/pirate_refinement_shard': '海盜精煉碎片',
        '/items/pirate_essence': '海盜精華',
        '/items/coin': '金幣',
      }[hrid] ?? hrid),
      onImportProfile: vi.fn(),
    });

    await view.render();
    expect(target.textContent).toContain('成交量承接估計');
    expect(target.textContent).toContain('可實現日利');
    expect(target.textContent).toContain('48M');
    expect(target.textContent).toContain('紅杉原木 → 紅杉木板 → 紅杉弓');
    expect(target.textContent).toContain('72M');
    expect(target.textContent).not.toContain('48,000,000');
    expect(target.textContent).not.toMatch(/\d(?:\.\d+)?B\b/);
    const pin = target.querySelector<HTMLButtonElement>('[data-strategy-pin="workflow:redwood"]')!;
    pin.click();
    await vi.waitFor(async () => expect(await pinStore.list()).toEqual(['workflow:redwood']));
    await vi.waitFor(() => expect(pin.getAttribute('aria-pressed')).toBe('true'));
    view.destroy();
  });

  it('ranks actionable strategies by realizable profit and separates reject or insufficient rows', async () => {
    const target = document.createElement('section');
    const snapshots = history({
      '/items/long_input': 1_000,
      '/items/long_output': 1_000,
      '/items/limited_input': 1_000,
      '/items/limited_output': 1_000,
      '/items/reject_input': 1_000,
      '/items/reject_output': 1_000,
    });
    const result: StrategyCandidateResult = {
      diagnostics: [],
      candidates: [
        {
          id: 'long', kind: 'manufacture', title: 'long', path: ['/items/long_input', '/items/long_output'],
          profitPerHour: 1_000, profitPerDay: 24_000, costPerHour: 1_000, incomePerHour: 2_000,
          workingCapital24h: 24_000, steps: [marketStep('long', '/items/long_input', '/items/long_output', 10)],
        },
        {
          id: 'limited', kind: 'manufacture', title: 'limited', path: ['/items/limited_input', '/items/limited_output'],
          profitPerHour: 2_000, profitPerDay: 48_000, costPerHour: 1_000, incomePerHour: 3_000,
          workingCapital24h: 24_000, steps: [marketStep('limited', '/items/limited_input', '/items/limited_output', 200)],
        },
        {
          id: 'reject', kind: 'manufacture', title: 'reject', path: ['/items/reject_input', '/items/reject_output'],
          profitPerHour: 3_000, profitPerDay: 72_000, costPerHour: 1_000, incomePerHour: 4_000,
          workingCapital24h: 24_000, steps: [marketStep('reject', '/items/reject_input', '/items/reject_output', 500)],
        },
        {
          id: 'insufficient', kind: 'manufacture', title: 'insufficient', path: ['/items/missing_input', '/items/missing_output'],
          profitPerHour: 4_000, profitPerDay: 96_000, costPerHour: 1_000, incomePerHour: 5_000,
          workingCapital24h: 24_000, steps: [marketStep('insufficient', '/items/missing_input', '/items/missing_output', 1)],
        },
      ],
    };
    const view = createStrategyView({
      target,
      getProfile: () => profile,
      getSnapshots: () => snapshots,
      loadGameData: async () => ({ shopItemDetailMap: {}, openableLootDropMap: {}, itemsByHrid: new Map() }) as never,
      pinStore: createMemoryStrategyPinStore(),
      calculate: () => result,
      itemName: (hrid) => hrid.split('/').at(-1) ?? hrid,
      onImportProfile: vi.fn(),
    });

    await view.render();
    expect(target.querySelector('[data-strategy-scope="actionable"]')?.getAttribute('aria-pressed')).toBe('true');
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((row) => row.dataset.strategyRow)).toEqual([
      'long', 'limited',
    ]);
    expect(target.querySelector('[data-strategy-row="long"]')?.textContent).toContain('可長掛');
    expect(target.querySelector('[data-strategy-row="limited"]')?.textContent).toContain('限量製作');
    expect(target.querySelector('[data-strategy-row="limited"]')?.textContent).toContain('12K');
    expect(target.querySelector('[data-strategy-row="long"] [data-strategy-signal="wait"]')?.textContent).toContain('等待');
    expect(target.querySelector('[data-strategy-row="long"]')?.textContent).toContain('信心 低');
    expect(target.querySelector('[data-strategy-row="long"]')?.textContent).toContain('回測 3D');
    expect(target.textContent).toContain('安全批量');
    expect(target.textContent).toContain('市場占比');

    (target.querySelector('[data-strategy-scope="limited"]') as HTMLButtonElement).click();
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((row) => row.dataset.strategyRow)).toEqual([
      'insufficient', 'reject',
    ]);
    expect(target.querySelector('[data-strategy-row="reject"]')?.textContent).toContain('不建議');
    expect(target.querySelector('[data-strategy-row="insufficient"]')?.textContent).toContain('資料不足');
    view.destroy();
  });
});
