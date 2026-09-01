// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createMemoryStrategyPinStore } from '../src/strategy/store';
import { createStrategyView } from '../src/strategy/view';
import type { StrategyCandidateResult } from '../src/strategy/candidates';
import type { PlayerProfile } from '../src/profile/types';
import type { Snapshot } from '../src/core/types';

const profile = {
  id: 'character:1', name: '測試牛', actions: { alchemy: { playerLevel: 103 } },
} as unknown as PlayerProfile;
const snapshot: Snapshot = { timestamp: 1, quotes: {} };
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
      getSnapshot: () => snapshot,
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
      getSnapshot: () => snapshot,
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
    expect(target.textContent).toContain('尚未套用市場承接量');
    expect(target.textContent).toContain('48,000,000');
    expect(target.textContent).toContain('紅杉原木 → 紅杉木板 → 紅杉弓');
    expect(target.textContent).toContain('72,000,000');
    const pin = target.querySelector<HTMLButtonElement>('[data-strategy-pin="workflow:redwood"]')!;
    pin.click();
    await vi.waitFor(async () => expect(await pinStore.list()).toEqual(['workflow:redwood']));
    await vi.waitFor(() => expect(pin.getAttribute('aria-pressed')).toBe('true'));
    view.destroy();
  });
});
