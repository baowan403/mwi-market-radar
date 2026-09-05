// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createUpgradePanel } from '../src/strategy/upgrade-view';
import type { PlayerProfile } from '../src/profile/types';

const profile = {
  id: 'profile-1',
  actions: {
    milking: { playerLevel: 80 },
    foraging: { playerLevel: 99 },
    woodcutting: { playerLevel: 75 },
    cheesesmithing: { playerLevel: 80 },
    crafting: { playerLevel: 90 },
    tailoring: { playerLevel: 70 },
    cooking: { playerLevel: 85 },
    brewing: { playerLevel: 88 },
    alchemy: { playerLevel: 95 },
    enhancing: { playerLevel: 120 },
  },
} as unknown as PlayerProfile;

const data = { itemsByHrid: new Map() } as never;
const snapshots = [] as never;

function evaluation(profit: number, route: string[]) {
  return { profit, route, theoreticalProfit: profit + 10 };
}

function analysis() {
  return {
    action: 'foraging',
    hoursPerDay: 24,
    baseline: evaluation(100, ['base']),
    testedVariants: 3,
    warnings: [],
    rows: [
      {
        itemHrid: '/items/alpha_shears', enhancementLevel: 5, slot: 'tool', price: null,
        owned: false, eligibility: 'met', requirements: ['採摘等級 90'], after: evaluation(190, ['base', 'alpha']),
        delta: 90, paybackDays: null, priority: '高', marginal: undefined,
      },
      {
        itemHrid: '/items/beta_shears', enhancementLevel: 6, slot: 'tool', price: 100,
        owned: false, eligibility: 'met', requirements: ['採摘等級 90'], after: evaluation(150, ['base', 'beta']),
        delta: 50, paybackDays: 2, priority: '中', marginal: {
          lowerEnhancement: 5, extraCost: 40, extraGain: 20, paybackDays: 2,
        },
      },
      {
        itemHrid: '/items/gamma_shears', enhancementLevel: 7, slot: 'tool', price: 200,
        owned: true, eligibility: 'unknown', requirements: ['需要確認裝備資格'], after: null,
        delta: null, paybackDays: null, priority: '觀察', marginal: undefined,
      },
    ],
  };
}

describe('upgrade target panel', () => {
  it('shows nine skills excluding enhancing, defaults to strongest skill and 24H, and has no budget control', () => {
    const panel = createUpgradePanel({
      profile, data, snapshots, itemName: (hrid) => hrid,
      analyze: vi.fn(async () => analysis()) as never,
    });

    const skill = panel.element.querySelector<HTMLSelectElement>('[data-upgrade-skill]')!;
    const hours = panel.element.querySelector<HTMLSelectElement>('[data-upgrade-hours]')!;
    const sort = panel.element.querySelector<HTMLSelectElement>('[data-upgrade-sort]')!;
    expect([...skill.options]).toHaveLength(9);
    expect([...skill.options].some((option) => option.value === 'enhancing')).toBe(false);
    expect(skill.value).toBe('foraging');
    expect(hours.value).toBe('24');
    expect([...hours.options].map((option) => option.value)).toEqual(['6', '12', '24', 'custom']);
    expect(sort.value).toBe('gain');
    expect(panel.element.querySelector('[data-upgrade-budget]')).toBeNull();
    expect(panel.element.textContent).not.toContain('錢包');
  });

  it('runs only on explicit analysis, keeps unknown prices visible, sorts by gain, and folds details', async () => {
    const analyze = vi.fn(async (_options:unknown) => analysis());
    const panel = createUpgradePanel({
      profile, data, snapshots, itemName: (hrid) => hrid,
      analyze: analyze as never,
    });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-upgrade-analyze]')!;
    expect(analyze).not.toHaveBeenCalled();
    button.click();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledOnce());

    expect(analyze.mock.calls[0]![0]).toMatchObject({ action: 'foraging', hoursPerDay: 24 });
    expect(panel.element.querySelectorAll('[data-upgrade-row]')).toHaveLength(3);
    expect([...panel.element.querySelectorAll<HTMLElement>('[data-upgrade-row]')]
      .map((row) => row.dataset.upgradeRow)).toEqual([
        '/items/alpha_shears::5', '/items/beta_shears::6', '/items/gamma_shears::7',
      ]);
    expect(panel.element.querySelector('[data-upgrade-row="/items/alpha_shears::5"]')?.textContent).toContain('—');
    expect(panel.element.querySelector('[data-upgrade-row="/items/alpha_shears::5"]')?.textContent).toContain('90');
    expect(panel.element.querySelector('[data-upgrade-row="/items/gamma_shears::7"]')?.textContent).toContain('已持有');
    expect(panel.element.querySelectorAll('thead th')).toHaveLength(7);
    expect(panel.element.querySelector('thead')?.textContent).toContain('每日增益');
    expect(panel.element.querySelector('thead')?.textContent).toContain('回本天數');
    expect(panel.element.querySelector('[data-upgrade-detail]')).not.toBeNull();
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-upgrade-detail]')!.open).toBe(false);
    expect(panel.element.textContent).toContain('單件比較不可直接相加');
    expect(panel.element.textContent).toContain('不假設出售舊裝');
    expect(panel.element.textContent).toContain('不保證成交深度');
  });

  it('marks changed controls stale until explicit analysis and supports custom duration', async () => {
    const analyze = vi.fn(async (_options:unknown) => analysis());
    const panel = createUpgradePanel({
      profile, data, snapshots, itemName: (hrid) => hrid,
      analyze: analyze as never,
    });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-upgrade-analyze]')!;
    const skill = panel.element.querySelector<HTMLSelectElement>('[data-upgrade-skill]')!;
    const hours = panel.element.querySelector<HTMLSelectElement>('[data-upgrade-hours]')!;
    const custom = panel.element.querySelector<HTMLInputElement>('[data-upgrade-custom-hours]')!;

    button.click();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledOnce());
    skill.value = 'alchemy';
    skill.dispatchEvent(new Event('change'));
    hours.value = 'custom';
    hours.dispatchEvent(new Event('change'));
    custom.value = '3.5';
    custom.dispatchEvent(new Event('change'));
    expect(analyze).toHaveBeenCalledOnce();
    expect(panel.element.textContent).toContain('請重新分析');

    button.click();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    expect(analyze.mock.calls[1]![0]).toMatchObject({ action: 'alchemy', hoursPerDay: 3.5 });
  });
});
