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
  action: import('../src/profile/types').SkillingAction = 'crafting',
): StrategyStepResult {
  return {
    id,
    action,
    actionHrid: `/actions/${action}/${id}`,
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
      verificationStatus: 'unverified',
    },
    {
      id: 'decompose-coinify:pirate', kind: 'decompose-coinify', title: 'Coin',
      path: ['/items/pirate_refinement_shard', '/items/pirate_essence', '/items/coin'],
      profitPerHour: 1_500_000, profitPerDay: 36_000_000,
      costPerHour: 4_000_000, incomePerHour: 5_500_000, workingCapital24h: 96_000_000,
      steps: [],
      verificationStatus: 'unverified',
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
      now: () => snapshot.timestamp,
    });

    await view.render();
    expect(target.textContent).toContain('成交量');
    expect(target.textContent).toContain('日利');
    expect(target.textContent).toContain('48M');
    expect(target.textContent).toContain('紅杉原木 → 紅杉木板 → 紅杉弓');
    expect(target.textContent).not.toContain('48,000,000');
    expect(target.textContent).not.toMatch(/\d(?:\.\d+)?B\b/);
    expect([...target.querySelectorAll('col[data-strategy-column]')].map((column) => (
      column.getAttribute('data-strategy-column')
    ))).toEqual([
      'pin', 'step', 'path', 'profit', 'trend1d', 'trend3d', 'trend7d',
      'sparkline', 'marketShare', 'capital', 'classification', 'priority',
    ]);
    expect([...target.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      '自選', '步驟', '路徑', '日利', '1D', '3D', '7D', '72H走勢',
      '日產佔比', '資金/D', '風險', '優先級',
    ]);
    expect(target.querySelector('.strategy-step')).not.toBeNull();
    expect(target.querySelector('.strategy-path-cell')).not.toBeNull();
    expect(target.querySelector('.strategy-profit')).not.toBeNull();
    expect(target.querySelectorAll('[data-strategy-row] .strategy-trend-cell')).toHaveLength(6);
    expect(target.querySelector('.strategy-market-share')).not.toBeNull();
    expect(target.querySelector('.strategy-priority-cell')).not.toBeNull();
    const firstRow = target.querySelector('[data-strategy-row]')!;
    expect(firstRow.querySelectorAll(':scope > td')).toHaveLength(12);
    expect(firstRow.querySelector('.strategy-sparkline-cell')?.textContent).toBe('');
    const pin = target.querySelector<HTMLButtonElement>('[data-strategy-pin="workflow:redwood"]')!;
    pin.click();
    await vi.waitFor(async () => expect(await pinStore.list()).toEqual(['workflow:redwood']));
    await vi.waitFor(() => expect(pin.getAttribute('aria-pressed')).toBe('true'));
    view.destroy();
  });

  it('defaults to current profit and keeps reject or insufficient rows visible as risk metadata', async () => {
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
          verificationStatus: 'unverified',
        },
        {
          id: 'limited', kind: 'manufacture', title: 'limited', path: ['/items/limited_input', '/items/limited_output'],
          profitPerHour: 2_000, profitPerDay: 48_000, costPerHour: 1_000, incomePerHour: 3_000,
          workingCapital24h: 24_000, steps: [marketStep('limited', '/items/limited_input', '/items/limited_output', 200)],
          verificationStatus: 'unverified',
        },
        {
          id: 'reject', kind: 'manufacture', title: 'reject', path: ['/items/reject_input', '/items/reject_output'],
          profitPerHour: 3_000, profitPerDay: 72_000, costPerHour: 1_000, incomePerHour: 4_000,
          workingCapital24h: 24_000, steps: [marketStep('reject', '/items/reject_input', '/items/reject_output', 500)],
          verificationStatus: 'unverified',
        },
        {
          id: 'insufficient', kind: 'manufacture', title: 'insufficient', path: ['/items/missing_input', '/items/missing_output'],
          profitPerHour: 4_000, profitPerDay: 96_000, costPerHour: 1_000, incomePerHour: 5_000,
          workingCapital24h: 24_000, steps: [marketStep('insufficient', '/items/missing_input', '/items/missing_output', 1)],
          verificationStatus: 'unverified',
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
      now: () => snapshots.at(-1)!.timestamp,
    });

    await view.render();
    expect(target.querySelector('[data-strategy-scope]')).toBeNull();
    expect(target.querySelector('[data-strategy-mode]')).toBeNull();
    expect(target.querySelector('[data-strategy-hours]')).toBeNull();
    
    // 預設依當前日利排序；流動性不足與異常只標示風險，不再把高利策略隱藏或視為 0。
    const renderedRowIds = [...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((row) => row.dataset.strategyRow);
    expect(renderedRowIds).toEqual(['insufficient', 'reject', 'limited', 'long']);
    expect(target.querySelector('[data-strategy-row="insufficient"]')?.textContent).toContain('96K');
    expect(target.querySelector('[data-strategy-row="insufficient"] .strategy-classification')?.textContent).toBe('資料不足');
    expect(target.querySelector('[data-strategy-row="reject"]')?.textContent).toContain('72K');
    expect(target.querySelector('[data-strategy-row="long"]')?.textContent).toContain('低');
    expect(target.querySelector('[data-strategy-row="limited"]')?.textContent).toContain('高');
    expect(target.querySelector('[data-strategy-row="long"] [data-strategy-priority]')).not.toBeNull();
    expect(target.querySelector('[data-strategy-row="long"] .strategy-sparkline')).not.toBeNull();
    expect(target.querySelectorAll('[data-strategy-row="long"] .strategy-trend-cell')).toHaveLength(3);
    expect(target.querySelector('[data-strategy-row="long"] .strategy-market-share')).not.toBeNull();

    const longRow = target.querySelector<HTMLElement>('[data-strategy-row="long"]')!;
    longRow.click();
    const detail = target.querySelector<HTMLTableRowElement>('[data-strategy-detail-for="long"]')!;
    expect(detail.hidden).toBe(false);
    expect(detail.querySelector('td')?.colSpan).toBe(12);
    expect(detail.textContent).toContain('安全執行');
    expect(detail.textContent).toContain('所需啟動現金');
    expect(detail.textContent).toContain('瓶頸');
    expect(detail.textContent).toContain('掛機排程與原料採購規劃');

    view.destroy();
  });

  it('filters strategies by skill dropdown and matches multi-step strategies correctly', async () => {
    const target = document.createElement('section');
    const snapshots = history({
      '/items/milk': 1_000,
      '/items/essence': 1_000,
      '/items/coin': 1_000,
      '/items/bar': 1_000,
    });
    const result: StrategyCandidateResult = {
      diagnostics: [],
      candidates: [
        {
          id: 'multistep:milk_decompose', kind: 'workflow', title: '先擠奶再分解',
          path: ['/items/milk', '/items/essence', '/items/coin'],
          profitPerHour: 5_000, profitPerDay: 120_000, costPerHour: 1_000, incomePerHour: 6_000,
          workingCapital24h: 24_000,
          steps: [
            marketStep('step1', '/items/milk', '/items/essence', 10, 'milking'),
            marketStep('step2', '/items/essence', '/items/coin', 10, 'alchemy'),
          ],
          verificationStatus: 'unverified',
        },
        {
          id: 'single:smithing', kind: 'manufacture', title: '鍛造金條',
          path: ['/items/coin', '/items/bar'],
          profitPerHour: 3_000, profitPerDay: 72_000, costPerHour: 1_000, incomePerHour: 4_000,
          workingCapital24h: 24_000,
          steps: [
            marketStep('step_smith', '/items/coin', '/items/bar', 10, 'cheesesmithing'),
          ],
          verificationStatus: 'unverified',
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
      now: () => snapshots.at(-1)!.timestamp,
    });

    await view.render();
    const skillSelect = target.querySelector<HTMLSelectElement>('[data-strategy-skill]')!;
    expect(skillSelect).not.toBeNull();

    // 預設全部技能：兩個都出現
    expect(target.querySelectorAll('[data-strategy-row]')).toHaveLength(2);

    // 選擇「擠奶」：多步驟策略涵蓋擠奶，應命中
    skillSelect.value = 'milking';
    skillSelect.dispatchEvent(new Event('change'));
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([
      'multistep:milk_decompose',
    ]);

    // 選擇「煉金」：多步驟策略亦涵蓋煉金，應命中
    skillSelect.value = 'alchemy';
    skillSelect.dispatchEvent(new Event('change'));
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([
      'multistep:milk_decompose',
    ]);

    // 選擇「鍛造」：只有單步鍛造策略命中
    skillSelect.value = 'cheesesmithing';
    skillSelect.dispatchEvent(new Event('change'));
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([
      'single:smithing',
    ]);

    view.destroy();
  });

  it('keeps insufficient strategies visible by default and still supports item search', async () => {
    const target = document.createElement('section');
    const snapshots = history({
      '/items/goblin_fire_staff': 1_000,
      '/items/normal_cloth': 1_000,
    });
    const result: StrategyCandidateResult = {
      diagnostics: [],
      candidates: [
        {
          id: 'goblin_staff', kind: 'manufacture', title: '哥布林火棍',
          path: ['/items/missing', '/items/goblin_fire_staff'],
          profitPerHour: 2_000, profitPerDay: 48_000, costPerHour: 1_000, incomePerHour: 3_000,
          workingCapital24h: 24_000,
          steps: [marketStep('step_staff', '/items/missing', '/items/goblin_fire_staff', 1)], // insufficient units
          verificationStatus: 'unverified',
        },
        {
          id: 'cloth', kind: 'manufacture', title: '普通布匹',
          path: ['/items/normal_cloth', '/items/normal_cloth'],
          profitPerHour: 3_000, profitPerDay: 72_000, costPerHour: 1_000, incomePerHour: 4_000,
          workingCapital24h: 24_000,
          steps: [marketStep('step_cloth', '/items/normal_cloth', '/items/normal_cloth', 10)],
          verificationStatus: 'unverified',
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
      itemName: (hrid) => (hrid.includes('goblin_fire_staff') ? '哥布林火棍' : hrid.split('/').at(-1) ?? hrid),
      onImportProfile: vi.fn(),
      now: () => snapshots.at(-1)!.timestamp,
    });

    await view.render();
    const searchInput = target.querySelector<HTMLInputElement>('[data-strategy-search]')!;
    expect(searchInput).not.toBeNull();

    // 預設無搜尋：所有正收益項目均依當前日利顯示，資料不足只作標記。
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([
      'cloth', 'goblin_staff',
    ]);

    // 主動搜尋「哥布林」：只保留符合查詢的候選
    searchInput.value = '哥布林';
    searchInput.dispatchEvent(new Event('input'));
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([
      'goblin_staff',
    ]);
    expect(target.querySelector('[data-strategy-row="goblin_staff"] .strategy-classification')?.textContent).toBe('資料不足');

    view.destroy();
  });

  it('excludes intermediate products from procurement list in multi-step workflows', async () => {
    const target = document.createElement('section');
    const snapshots = history({
      '/items/raw_material': 10_000,
      '/items/intermediate_material': 10_000,
      '/items/final_product': 10_000,
    });
    const multiStepResult: StrategyCandidateResult = {
      diagnostics: [],
      candidates: [
        {
          id: 'workflow:chain', kind: 'workflow', title: '三步鏈條',
          path: ['/items/raw_material', '/items/intermediate_material', '/items/final_product'],
          profitPerHour: 5_000, profitPerDay: 120_000, costPerHour: 1_000, incomePerHour: 6_000,
          workingCapital24h: 24_000,
          steps: [
            {
              id: 'step1', action: 'crafting', actionHrid: '/actions/crafting/step1', outputHrid: '/items/intermediate_material',
              valid: true, actionsPerHour: 1, costPerHour: 1_000, incomePerHour: 2_000, profitPerHour: 1_000, experiencePerHour: 10,
              inputs: [{ itemHrid: '/items/raw_material', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 110, market: true }],
              outputs: [{ itemHrid: '/items/intermediate_material', enhancementLevel: 0, unitsPerHour: 20, unitPrice: 100, market: true }],
            },
            {
              id: 'step2', action: 'crafting', actionHrid: '/actions/crafting/step2', outputHrid: '/items/final_product',
              valid: true, actionsPerHour: 1, costPerHour: 2_000, incomePerHour: 6_000, profitPerHour: 4_000, experiencePerHour: 10,
              inputs: [{ itemHrid: '/items/intermediate_material', enhancementLevel: 0, unitsPerHour: 20, unitPrice: 100, market: true }],
              outputs: [{ itemHrid: '/items/final_product', enhancementLevel: 0, unitsPerHour: 5, unitPrice: 100, market: true }],
            },
          ],
          verificationStatus: 'unverified',
        },
      ],
    };

    const view = createStrategyView({
      target,
      getProfile: () => ({ ...profile, actions: { crafting: { playerLevel: 100 } } as any }),
      getSnapshots: () => snapshots,
      loadGameData: async () => ({ shopItemDetailMap: {}, openableLootDropMap: {}, itemsByHrid: new Map() }) as never,
      pinStore: createMemoryStrategyPinStore(),
      calculate: () => multiStepResult,
      itemName: (hrid) => hrid.split('/').at(-1) ?? hrid,
      onImportProfile: vi.fn(),
      now: () => snapshots.at(-1)!.timestamp,
    });

    await view.render();
    const detailRow = target.querySelector<HTMLElement>('.strategy-detail-row');
    expect(detailRow).not.toBeNull();
    const text = detailRow?.textContent ?? '';
    expect(text).toContain('raw_material');
    expect(text).not.toContain('採購 intermediate_material');

    view.destroy();
  });

  it('filters strategies by alpha opportunity when alpha skill option is selected', async () => {
    const target = document.createElement('section');
    const snapshots = history({
      '/items/steady_cloth': 10_000,
    });
    const result: StrategyCandidateResult = {
      diagnostics: [],
      candidates: [
        {
          id: 'steady_cloth', kind: 'manufacture', title: '平穩布匹',
          path: ['/items/steady_cloth', '/items/steady_cloth'],
          profitPerHour: 3_000, profitPerDay: 72_000, costPerHour: 1_000, incomePerHour: 4_000,
          workingCapital24h: 24_000,
          steps: [marketStep('cloth_step', '/items/steady_cloth', '/items/steady_cloth', 10)],
          verificationStatus: 'unverified',
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
      now: () => snapshots.at(-1)!.timestamp,
    });

    await view.render();
    const skillSelect = target.querySelector<HTMLSelectElement>('[data-strategy-skill]')!;
    expect(skillSelect).not.toBeNull();

    // 切換到 ⚡ 突發短缺 / 暴利
    skillSelect.value = 'alpha';
    skillSelect.dispatchEvent(new Event('change'));

    // 目前平穩布匹無突發利潤爆發（m1=0），應展示平穩提示
    expect(target.textContent).toContain('目前全市場暫無突發短缺或異常利差暴利機會');

    view.destroy();
  });

  it('defaults to current-profit ranking and keeps capacity ranking as an optional secondary view', async () => {
    const target = document.createElement('section');
    const snapshots = history({
      '/items/long_input': 1_000,
      '/items/long_output': 1_000,
      '/items/limited_input': 10,
      '/items/limited_output': 10,
    });
    const result: StrategyCandidateResult = {
      diagnostics: [],
      candidates: [
        {
          id: 'long', kind: 'manufacture', title: 'long', path: ['/items/long_input', '/items/long_output'],
          profitPerHour: 1_000, profitPerDay: 24_000, costPerHour: 1_000, incomePerHour: 2_000,
          workingCapital24h: 24_000, steps: [marketStep('long', '/items/long_input', '/items/long_output', 10)],
          verificationStatus: 'unverified',
        },
        {
          id: 'limited', kind: 'manufacture', title: 'limited', path: ['/items/limited_input', '/items/limited_output'],
          profitPerHour: 5_000, profitPerDay: 120_000, costPerHour: 1_000, incomePerHour: 6_000,
          workingCapital24h: 24_000, steps: [marketStep('limited', '/items/limited_input', '/items/limited_output', 500)],
          verificationStatus: 'unverified',
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
      now: () => snapshots.at(-1)!.timestamp,
    });

    await view.render();
    // 預設就是當前日利：高日利 limited 即使容量風險高，仍應排在第一並顯示完整 120K。
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual(['limited', 'long']);
    expect(target.querySelector('[data-strategy-row="limited"] .strategy-profit-main')?.textContent).toBe('120K');
    const sortButtons = target.querySelectorAll<HTMLButtonElement>('.strategy-sort-group button');
    const currentBtn = Array.from(sortButtons).find((b) => b.textContent?.includes('當前日利'))!;
    expect(currentBtn.classList.contains('active')).toBe(true);

    // 容量參考仍可選用，但不會把資料不足的策略隱藏，日利欄也不會變成破折號。
    const capacityBtn = Array.from(sortButtons).find((b) => b.textContent?.includes('容量參考'))!;
    capacityBtn.click();
    const rowsAfter = [...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow);
    expect(rowsAfter).toEqual(['long', 'limited']);
    expect(target.querySelector('[data-strategy-row="limited"] .strategy-profit-main')?.textContent).toBe('120K');

    view.destroy();
  });
});
