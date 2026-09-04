import { describe, expect, it } from 'vitest';
import { getLegalTeaCombinations, findOptimalTeasForManufacture, findOptimalTeasForAlchemy } from '../src/strategy/tea-optimizer';
import { enrichProfileWithBestLoadout } from '../src/strategy/optimal-loadout';
import { calculateManufactureAction } from '../src/strategy/manufacture-adapter';
import { calculateDecompose } from '../src/strategy/alchemy';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import type { PlayerProfile } from '../src/profile/types';

describe('Dynamic Tea Optimizer & Guzzling Pouch', () => {
  const data = normalizeStrategyGameData(strategyDataJson);

  it('generates strictly legal tea combinations with max 3 teas and tier exclusivity', () => {
    const brewingCombos = getLegalTeaCombinations('brewing');
    expect(brewingCombos.length).toBeGreaterThan(0);

    for (const combo of brewingCombos) {
      expect(combo.length).toBeLessThanOrEqual(3);

      // 檢查是否同時包含同階茶
      const tiered = combo.filter((t) => t.includes('brewing_tea'));
      expect(tiered.length).toBeLessThanOrEqual(1);
    }

    const cookingCombos = getLegalTeaCombinations('cooking');
    for (const combo of cookingCombos) {
      expect(combo.length).toBeLessThanOrEqual(3);
      const tiered = combo.filter((t) => t.includes('cooking_tea'));
      expect(tiered.length).toBeLessThanOrEqual(1);
    }
  });

  it('automatically selects gourmet + artisan + efficiency tea for brewing when profitable', () => {
    const prices = {
      ask: (hrid: string) => {
        if (hrid === '/items/ultra_brewing_tea') return 9_200;
        if (hrid === '/items/gourmet_tea') return 1_500;
        if (hrid === '/items/artisan_tea') return 3_300;
        if (hrid === '/items/efficiency_tea') return 3_000;
        if (hrid.includes('coffee_bean')) return 1_200;
        if (hrid.includes('milk')) return 500;
        if (hrid.includes('plum') || hrid.includes('peach')) return 200;
        return 500;
      },
      bid: (hrid: string) => {
        if (hrid.includes('coffee')) return 4_000;
        if (hrid.includes('essence')) return 300;
        return 400;
      },
      average: () => null,
      volume: () => null,
      timestamp: 1,
    };

    const profile: PlayerProfile = {
      id: 'test:player',
      characterId: 1,
      name: 'Tester',
      importedAt: 1,
      completeness: 'full',
      missingFields: [],
      source: 'milkonomy-v1',
      achievements: {},
      communityBuffs: {},
      shrines: {},
      seals: [],
      specialEquipment: {},
      inventoryMap: {},
      materialInventoryMap: {},
      actions: {
        brewing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cooking: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        alchemy: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cheesesmithing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        crafting: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        tailoring: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        woodcutting: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        foraging: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        milking: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        enhancing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
      },
    };

    const actionHrid = '/actions/brewing/wisdom_coffee';
    const detail = data.actionsByHrid.get(actionHrid)!;
    const optimal = findOptimalTeasForManufacture({
      action: 'brewing',
      detail,
      profile,
      data,
      prices: prices as any,
    });

    console.log('Optimal chosen teas:', optimal.teas, 'profit:', optimal.profitPerHour);
    // 驗證動態選擇了美食茶與工匠茶，且排除了性價比過低的究極沖泡茶
    expect(optimal.teas).toContain('/items/gourmet_tea');
    expect(optimal.teas).toContain('/items/artisan_tea');
    expect(optimal.teas).not.toContain('/items/ultra_brewing_tea');
    expect(optimal.profitPerHour).toBeGreaterThan(0);
  });

  it('automatically equips Guzzling Pouch from inventory and amplifies drinkConcentration', () => {
    const rawProfile: PlayerProfile = {
      id: 'test:player',
      characterId: 1,
      name: 'Tester',
      importedAt: 1,
      completeness: 'full',
      missingFields: [],
      source: 'milkonomy-v1',
      achievements: {},
      communityBuffs: {},
      shrines: {},
      seals: [],
      specialEquipment: {}, // 未配置 pouch
      inventoryMap: {
        '/items/guzzling_pouch': 5, // 倉庫有 +5 暴飲之囊
      },
      materialInventoryMap: {},
      actions: {
        brewing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cooking: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        alchemy: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cheesesmithing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        crafting: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        tailoring: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        woodcutting: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        foraging: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        milking: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        enhancing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
      },
    };

    const enriched = enrichProfileWithBestLoadout(rawProfile, data);
    expect(enriched.specialEquipment.pouch).toEqual({
      itemHrid: '/items/guzzling_pouch',
      enhancementLevel: 5,
    });
  });

  it('retains candidate and selects [] when default teas yield negative profit but no-tea yields positive profit (Regression A)', () => {
    // 構造場景：所有茶飲極為昂貴（單杯千萬），喝任何茶必然虧損；但無茶 [] 分解本身獲利為正
    const prices = {
      ask: (hrid: string) => {
        if (hrid === '/items/holy_milk') return 100;
        if (hrid.endsWith('_tea')) return 50_000_000;
        return 1_000;
      },
      bid: (hrid: string) => {
        if (hrid === '/items/milking_essence') return 500;
        return 100;
      },
      average: () => null,
      volume: () => null,
      timestamp: 1,
    };

    const profile: PlayerProfile = {
      id: 'test:player',
      characterId: 1,
      name: 'Tester',
      importedAt: 1,
      completeness: 'full',
      missingFields: [],
      source: 'milkonomy-v1',
      achievements: {},
      communityBuffs: {},
      shrines: {},
      seals: [],
      specialEquipment: {},
      inventoryMap: {},
      materialInventoryMap: {},
      actions: {
        alchemy: {
          playerLevel: 100,
          teas: ['/items/ultra_alchemy_tea', '/items/catalytic_tea', '/items/efficiency_tea'],
          tool: null,
          body: null,
          legs: null,
          back: null,
          charm: null,
          houseLevel: 0,
        },
        brewing: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cooking: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cheesesmithing: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        crafting: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        tailoring: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        woodcutting: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        foraging: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        milking: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        enhancing: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
      },
    };

    // 1. 驗證以預設三茶執行時，利潤為負
    const stepWithDefaultTeas = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile,
      data,
      prices,
    });
    expect(stepWithDefaultTeas.valid).toBe(true);
    expect(stepWithDefaultTeas.profitPerHour).toBeLessThan(0);

    // 2. 執行煉金 Auto Tea optimizer
    const opt = findOptimalTeasForAlchemy({
      kind: 'decompose',
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile,
      data,
      prices,
      calculateFn: calculateDecompose,
    });

    // 3. 斷言：必須選擇無茶 []，且獲利為正
    expect(opt.teas).toEqual([]);
    expect(opt.profitPerHour).toBeGreaterThan(0);
  });

  it('selects [] when default teas yield positive profit but no-tea yields higher profit (Regression B)', () => {
    // 構造場景：毛利豐厚，喝預設茶依然有正利潤（例如 +50萬/h），但茶飲成本高於增幅，無茶 [] 利潤更高
    const prices = {
      ask: (hrid: string) => {
        if (hrid === '/items/holy_milk') return 50;
        if (hrid.endsWith('_tea')) return 50_000;
        return 100;
      },
      bid: (hrid: string) => {
        if (hrid === '/items/milking_essence') return 2000;
        return 100;
      },
      average: () => null,
      volume: () => null,
      timestamp: 1,
    };

    const profile: PlayerProfile = {
      id: 'test:player',
      characterId: 1,
      name: 'Tester',
      importedAt: 1,
      completeness: 'full',
      missingFields: [],
      source: 'milkonomy-v1',
      achievements: {},
      communityBuffs: {},
      shrines: {},
      seals: [],
      specialEquipment: {},
      inventoryMap: {},
      materialInventoryMap: {},
      actions: {
        alchemy: {
          playerLevel: 100,
          teas: ['/items/ultra_alchemy_tea', '/items/catalytic_tea', '/items/efficiency_tea'],
          tool: null,
          body: null,
          legs: null,
          back: null,
          charm: null,
          houseLevel: 0,
        },
        brewing: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cooking: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cheesesmithing: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        crafting: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        tailoring: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        woodcutting: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        foraging: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        milking: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        enhancing: { playerLevel: 1, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
      },
    };

    const stepWithDefaultTeas = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile,
      data,
      prices,
    });
    expect(stepWithDefaultTeas.valid).toBe(true);
    expect(stepWithDefaultTeas.profitPerHour).toBeGreaterThan(0);

    const opt = findOptimalTeasForAlchemy({
      kind: 'decompose',
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile,
      data,
      prices,
      calculateFn: calculateDecompose,
    });

    // 斷言：[] 的利潤超越預設三茶，且 optimizer 正確選取了 []
    expect(opt.profitPerHour).toBeGreaterThan(stepWithDefaultTeas.profitPerHour!);
    expect(opt.teas).toEqual([]);
  });
});

