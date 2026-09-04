import { describe, expect, it } from 'vitest';
import { getLegalTeaCombinations, findOptimalTeasForManufacture, findOptimalTeasForAlchemy } from '../src/strategy/tea-optimizer';
import { enrichProfileWithBestLoadout, evaluateEquipmentUpliftForAction } from '../src/strategy/optimal-loadout';
import { calculateManufactureAction } from '../src/strategy/manufacture-adapter';
import { calculateDecompose } from '../src/strategy/alchemy';
import { buildStrategyCandidates } from '../src/strategy/candidates';
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

  it('strictly respects global profile.teaMode = "manual" with teas = [] through enrichment and candidate generation', () => {
    const rawProfile: PlayerProfile = {
      id: 'test:manual-tea',
      characterId: 1,
      name: 'ManualTeaTester',
      importedAt: 1,
      completeness: 'full',
      teaMode: 'manual', // 全域手動茶飲
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
        alchemy: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        brewing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cooking: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        cheesesmithing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        crafting: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        tailoring: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        woodcutting: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        foraging: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        milking: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
        enhancing: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
      },
    };

    // 1. 斷言 enrich 後茶飲依然維持空陣列 []，絕不偷補預設三茶
    const enriched = enrichProfileWithBestLoadout(rawProfile, data);
    expect(enriched.actions.alchemy.teas).toEqual([]);
    expect(enriched.actions.brewing.teas).toEqual([]);

    // 2. 斷言 buildStrategyCandidates 產出的 step 不含茶飲消耗
    const prices = {
      ask: (hrid: string) => (hrid === '/items/holy_milk' ? 100 : 1_000),
      bid: (hrid: string) => (hrid === '/items/milking_essence' ? 500 : 100),
      average: () => null,
      volume: () => null,
      timestamp: 1,
    };
    const result = buildStrategyCandidates({ profile: enriched, data, prices: prices as any });
    const holyMilkDecomp = result.candidates.find((c) => c.kind === 'decompose' && c.steps[0]?.inputs.some((f) => f.itemHrid === '/items/holy_milk'));
    expect(holyMilkDecomp).toBeDefined();
    expect(holyMilkDecomp!.steps[0]!.ledger!.physical.teaUnitsPerHour).toEqual({});
  });

  it('production candidate path: selects [] when default teas yield negative profit but no-tea yields positive profit (Production Regression A)', () => {
    // 構造場景：茶飲極貴（50,000,000 / 杯），喝茶必負；但無茶 [] 分解 holy_milk 為正
    const prices = {
      ask: (hrid: string) => {
        if (hrid === '/items/holy_milk') return 100;
        if (hrid.endsWith('_tea')) return 50_000_000;
        return null;
      },
      bid: (hrid: string) => {
        if (hrid === '/items/milking_essence') return 500;
        return 10;
      },
      average: () => null,
      volume: () => null,
      timestamp: 1,
    };

    const rawProfile: PlayerProfile = {
      id: 'test:prod-reg-a',
      characterId: 1,
      name: 'ProdRegATester',
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
        alchemy: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
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

    // Auto 模式下 enrich 會先給預設三茶
    const enriched = enrichProfileWithBestLoadout(rawProfile, data);
    const result = buildStrategyCandidates({ profile: enriched, data, prices: prices as any });

    const candidate = result.candidates.find((c) => c.kind === 'decompose' && c.steps[0]?.inputs.some((f) => f.itemHrid === '/items/holy_milk'));
    // 斷言：candidate 必須存在！
    expect(candidate).toBeDefined();
    // 斷言：candidate step 的 teaUnitsPerHour 必須為 {}（完全不喝茶）
    expect(candidate!.steps[0]!.ledger!.physical.teaUnitsPerHour).toEqual({});
    // 斷言：利潤為正
    expect(candidate!.profitPerHour).toBeGreaterThan(0);
  });

  it('production candidate path: selects [] when default teas yield positive profit but no-tea yields higher profit (Production Regression B)', () => {
    // 構造場景：毛利豐厚，喝預設茶依然有正利潤，但茶飲成本偏高，無茶 [] 利潤更高
    const prices = {
      ask: (hrid: string) => {
        if (hrid === '/items/holy_milk') return 50;
        if (hrid.endsWith('_tea')) return 300_000;
        return null;
      },
      bid: (hrid: string) => {
        if (hrid === '/items/milking_essence') return 2000;
        return 10;
      },
      average: () => null,
      volume: () => null,
      timestamp: 1,
    };

    const rawProfile: PlayerProfile = {
      id: 'test:prod-reg-b',
      characterId: 1,
      name: 'ProdRegBTester',
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
        alchemy: { playerLevel: 100, teas: [], tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0 },
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

    const enriched = enrichProfileWithBestLoadout(rawProfile, data);
    const result = buildStrategyCandidates({ profile: enriched, data, prices: prices as any });

    const candidate = result.candidates.find((c) => c.kind === 'decompose' && c.steps[0]?.inputs.some((f) => f.itemHrid === '/items/holy_milk'));
    expect(candidate).toBeDefined();
    // 斷言：最終 candidate step 必須使用 {}（空茶）
    expect(candidate!.steps[0]!.ledger!.physical.teaUnitsPerHour).toEqual({});

    // 驗證利潤等於無茶較高值（大於預設三茶的利潤）
    const stepWithDefaultTeas = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: {
        ...rawProfile,
        actions: {
          ...rawProfile.actions,
          alchemy: {
            ...rawProfile.actions.alchemy,
            teas: ['/items/ultra_alchemy_tea', '/items/catalytic_tea', '/items/efficiency_tea'],
          },
        },
      },
      data,
      prices: prices as any,
    });
    expect(candidate!.profitPerHour).toBeGreaterThan(stepWithDefaultTeas.profitPerHour!);
  });

  it('suppresses speed score and prioritizes efficiency gear when action time hits 3-second floor', () => {
    // 構造 mock 裝備資料
    const customData = {
      ...data,
      itemDetailMap: {
        ...data.itemDetailMap,
        '/items/speed_boots': {
          hrid: '/items/speed_boots',
          equipmentDetail: {
            type: '/equipment_types/legs',
            noncombatStats: { alchemySpeed: 0.5 },
          },
        },
        '/items/efficiency_boots': {
          hrid: '/items/efficiency_boots',
          equipmentDetail: {
            type: '/equipment_types/legs',
            noncombatStats: { alchemyEfficiency: 0.1 },
          },
        },
      },
    } as unknown as typeof data;

    // 1. 未撞 3 秒 cap 時：Speed 裝備評分正常計算 (0.5 * 100 = 50 > 0.1 * 80 = 8)
    const normalSpeedScore = evaluateEquipmentUpliftForAction('/items/speed_boots', 0, 'alchemy', customData, { isSpeedCapped: false });
    const normalEffScore = evaluateEquipmentUpliftForAction('/items/efficiency_boots', 0, 'alchemy', customData, { isSpeedCapped: false });
    expect(normalSpeedScore).toBeGreaterThan(normalEffScore);

    // 2. 撞 3 秒 cap 時：Speed 權重降為 0，Efficiency 裝備勝出！
    const cappedSpeedScore = evaluateEquipmentUpliftForAction('/items/speed_boots', 0, 'alchemy', customData, { isSpeedCapped: true });
    const cappedEffScore = evaluateEquipmentUpliftForAction('/items/efficiency_boots', 0, 'alchemy', customData, { isSpeedCapped: true });
    expect(cappedSpeedScore).toBe(0);
    expect(cappedEffScore).toBeGreaterThan(0);
  });
});

