import type { SkillingAction, PlayerProfile } from '../profile/types';
import type { ActionBuffs } from './buffs';
import { actionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import type { StrategyActionDetail } from './types';
import type { MarketPriceBook } from './price-book';
import { calculateManufacture, type PricedCount } from './manufacture';

const COIN_HRID = '/items/coin';

function taxable(itemHrid: string, data: NormalizedStrategyGameData): boolean {
  if (itemHrid === COIN_HRID) return false;
  return data.itemsByHrid.get(itemHrid)?.isTradable !== false;
}

/**
 * 依生活技能定義候選茶飲池：
 * 1. tiered: 專屬技能等級茶（普通/超級/究極，三者互斥，最多選 1 種）
 * 2. generic: 適用於該技能的通用生活茶
 */
export interface ActionTeaPool {
  tiered: string[];
  generic: string[];
}

export const TEA_POOLS_BY_ACTION: Record<SkillingAction, ActionTeaPool> = {
  brewing: {
    tiered: ['/items/ultra_brewing_tea', '/items/super_brewing_tea', '/items/brewing_tea'],
    generic: ['/items/gourmet_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  },
  cooking: {
    tiered: ['/items/ultra_cooking_tea', '/items/super_cooking_tea', '/items/cooking_tea'],
    generic: ['/items/gourmet_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  },
  alchemy: {
    tiered: ['/items/ultra_alchemy_tea', '/items/super_alchemy_tea', '/items/alchemy_tea'],
    generic: ['/items/catalytic_tea', '/items/efficiency_tea', '/items/artisan_tea'],
  },
  cheesesmithing: {
    tiered: ['/items/ultra_cheesesmithing_tea', '/items/super_cheesesmithing_tea', '/items/cheesesmithing_tea'],
    generic: ['/items/artisan_tea', '/items/efficiency_tea'],
  },
  crafting: {
    tiered: ['/items/ultra_crafting_tea', '/items/super_crafting_tea', '/items/crafting_tea'],
    generic: ['/items/artisan_tea', '/items/efficiency_tea'],
  },
  tailoring: {
    tiered: ['/items/ultra_tailoring_tea', '/items/super_tailoring_tea', '/items/tailoring_tea'],
    generic: ['/items/artisan_tea', '/items/efficiency_tea'],
  },
  woodcutting: {
    tiered: ['/items/ultra_woodcutting_tea', '/items/super_woodcutting_tea', '/items/woodcutting_tea'],
    generic: ['/items/gathering_tea', '/items/processing_tea', '/items/efficiency_tea'],
  },
  foraging: {
    tiered: ['/items/ultra_foraging_tea', '/items/super_foraging_tea', '/items/foraging_tea'],
    generic: ['/items/gathering_tea', '/items/processing_tea', '/items/efficiency_tea'],
  },
  milking: {
    tiered: ['/items/ultra_milking_tea', '/items/super_milking_tea', '/items/milking_tea'],
    generic: ['/items/gathering_tea', '/items/processing_tea', '/items/efficiency_tea'],
  },
  enhancing: {
    tiered: ['/items/ultra_enhancing_tea', '/items/super_enhancing_tea', '/items/enhancing_tea'],
    generic: ['/items/efficiency_tea', '/items/blessed_tea'],
  },
};

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const head = arr[0];
  const tail = arr.slice(1);
  if (head === undefined) return [];
  const withHead = combinations(tail, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * 生成指定生活技能的所有合法茶飲組合（最多 3 杯，同階互斥）
 */
export function getLegalTeaCombinations(action: SkillingAction): string[][] {
  const pool = TEA_POOLS_BY_ACTION[action];
  if (!pool) return [[]];

  const results: string[][] = [];

  // 情況 A：不選任何階級茶（0 杯 tiered），從 generic 中選 0~3 杯
  for (let k = 0; k <= Math.min(3, pool.generic.length); k++) {
    results.push(...combinations(pool.generic, k));
  }

  // 情況 B：選 1 杯階級茶（tiered 中選 1 杯），再從 generic 中選 0~2 杯
  for (const tieredTea of pool.tiered) {
    for (let k = 0; k <= Math.min(2, pool.generic.length); k++) {
      for (const genericCombo of combinations(pool.generic, k)) {
        results.push([tieredTea, ...genericCombo]);
      }
    }
  }

  return results;
}

export interface OptimalTeaResult {
  teas: string[];
  profitPerHour: number | null;
  buffs: ActionBuffs;
}

/**
 * 為具體的製造或煉金動作配方，枚舉合法茶飲組合，尋找「淨每小時利潤 (profitPerHour)」最高的最佳三茶。
 */
export function findOptimalTeasForManufacture(options: {
  action: SkillingAction;
  detail: StrategyActionDetail;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
}): OptimalTeaResult {
  const { action, detail, profile, data, prices } = options;
  const legalCombos = getLegalTeaCombinations(action);

  const ingredients: PricedCount[] = [];
  if (typeof detail.upgradeItemHrid === 'string' && detail.upgradeItemHrid.startsWith('/items/')) {
    ingredients.push({
      itemHrid: detail.upgradeItemHrid,
      count: 1,
      price: prices.ask(detail.upgradeItemHrid),
      artisanEligible: false,
    });
  }
  for (const item of detail.inputItems ?? []) {
    ingredients.push({
      itemHrid: item.itemHrid,
      count: item.count,
      price: prices.ask(item.itemHrid),
      artisanEligible: true,
    });
  }

  const products: PricedCount[] = (detail.outputItems ?? []).map((item: { itemHrid: string; count: number }) => ({
    itemHrid: item.itemHrid,
    count: item.count,
    price: prices.bid(item.itemHrid),
    taxable: taxable(item.itemHrid, data),
  }));

  const drops = (table: unknown): Array<{ itemHrid: string; dropRate: number }> => (
    Array.isArray(table) ? table : []
  );
  const pricedDrop = (drop: { itemHrid: string; dropRate: number }): PricedCount => ({
    itemHrid: drop.itemHrid,
    count: 1,
    rate: drop.dropRate,
    price: prices.bid(drop.itemHrid),
    taxable: taxable(drop.itemHrid, data),
  });

  const essenceDrops = drops(detail.essenceDropTable).map(pricedDrop);
  const rareDrops = drops(detail.rareDropTable).map(pricedDrop);

  let bestTeas: string[] = [];
  let bestProfit = -Infinity;
  let bestBuffs: ActionBuffs | null = null;

  for (const combo of legalCombos) {
    const tempProfile: PlayerProfile = {
      ...profile,
      actions: {
        ...profile.actions,
        [action]: {
          ...profile.actions[action],
          teas: combo,
        },
      },
    };

    const buffs = actionBuffs(tempProfile, action, data);
    if (buffs.Level < detail.levelRequirement.level) continue;

    const teaInputs: PricedCount[] = combo
      .filter((hrid) => prices.ask(hrid) !== null)
      .map((hrid) => ({
        itemHrid: hrid,
        count: 1,
        price: prices.ask(hrid),
      }));

    const result = calculateManufacture({
      baseTimeCost: detail.baseTimeCost,
      actionLevel: detail.levelRequirement.level,
      playerLevel: buffs.Level,
      buffs,
      ingredients,
      products,
      essenceDrops,
      rareDrops,
      teas: teaInputs,
    });

    if (result.valid && result.profitPerHour !== null) {
      if (result.profitPerHour > bestProfit) {
        bestProfit = result.profitPerHour;
        bestTeas = combo;
        bestBuffs = buffs;
      }
    }
  }

  if (bestBuffs === null) {
    const defaultBuffs = actionBuffs(profile, action, data);
    return {
      teas: [],
      profitPerHour: null,
      buffs: defaultBuffs,
    };
  }

  return {
    teas: bestTeas,
    profitPerHour: bestProfit,
    buffs: bestBuffs,
  };
}

export function findOptimalTeasForGathering(options: {
  action: SkillingAction;
  detail: StrategyActionDetail;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
}): OptimalTeaResult {
  const { action, detail, profile, data, prices } = options;
  const legalCombos = getLegalTeaCombinations(action);
  const dropItems = Array.isArray(detail.dropTable) ? detail.dropTable : [];

  let bestTeas: string[] = [];
  let bestProfit = -Infinity;
  let bestBuffs: ActionBuffs | null = null;

  for (const combo of legalCombos) {
    const tempProfile: PlayerProfile = {
      ...profile,
      actions: {
        ...profile.actions,
        [action]: {
          ...profile.actions[action],
          teas: combo,
        },
      },
    };

    const buffs = actionBuffs(tempProfile, action, data);
    if (buffs.Level < detail.levelRequirement.level) continue;

    const gatheringFactor = 1 + (buffs.Gathering ?? 0);
    const products: PricedCount[] = dropItems.map((drop) => ({
      itemHrid: drop.itemHrid,
      count: ((drop.minCount + drop.maxCount) / 2) * drop.dropRate * gatheringFactor,
      price: prices.bid(drop.itemHrid),
      taxable: taxable(drop.itemHrid, data),
    }));

    const teaInputs: PricedCount[] = combo
      .filter((hrid) => prices.ask(hrid) !== null)
      .map((hrid) => ({
        itemHrid: hrid,
        count: 1,
        price: prices.ask(hrid),
      }));

    const result = calculateManufacture({
      baseTimeCost: detail.baseTimeCost,
      actionLevel: detail.levelRequirement.level,
      playerLevel: buffs.Level,
      buffs,
      ingredients: [],
      products,
      essenceDrops: (detail.essenceDropTable ?? []).map((drop) => ({
        itemHrid: drop.itemHrid,
        count: 1,
        rate: drop.dropRate,
        price: prices.bid(drop.itemHrid),
        taxable: taxable(drop.itemHrid, data),
      })),
      rareDrops: (detail.rareDropTable ?? []).map((drop) => ({
        itemHrid: drop.itemHrid,
        count: 1,
        rate: drop.dropRate,
        price: prices.bid(drop.itemHrid),
        taxable: taxable(drop.itemHrid, data),
      })),
      teas: teaInputs,
    });

    if (result.valid && result.profitPerHour !== null) {
      if (result.profitPerHour > bestProfit) {
        bestProfit = result.profitPerHour;
        bestTeas = combo;
        bestBuffs = buffs;
      }
    }
  }

  if (bestBuffs === null) {
    const defaultBuffs = actionBuffs(profile, action, data);
    return {
      teas: [],
      profitPerHour: null,
      buffs: defaultBuffs,
    };
  }

  return {
    teas: bestTeas,
    profitPerHour: bestProfit,
    buffs: bestBuffs,
  };
}

export function findOptimalTeasForAlchemy(options: {
  kind: 'decompose' | 'coinify';
  itemHrid: string;
  catalystRank: 0 | 1 | 2;
  enhancementLevel: number;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
  calculateFn: (opts: any) => { valid: boolean; profitPerHour: number | null };
}): OptimalTeaResult {
  const { kind, itemHrid, catalystRank, enhancementLevel, profile, data, prices, calculateFn } = options;
  const legalCombos = getLegalTeaCombinations('alchemy');

  let bestTeas: string[] = [];
  let bestProfit = -Infinity;
  let bestBuffs: ActionBuffs | null = null;

  for (const combo of legalCombos) {
    const tempProfile: PlayerProfile = {
      ...profile,
      actions: {
        ...profile.actions,
        alchemy: {
          ...profile.actions.alchemy,
          teas: combo,
        },
      },
    };

    const buffs = actionBuffs(tempProfile, 'alchemy', data);
    const result = calculateFn({
      itemHrid,
      catalystRank,
      enhancementLevel,
      profile: tempProfile,
      data,
      prices,
      buffs,
    });

    if (result.valid && result.profitPerHour !== null) {
      if (result.profitPerHour > bestProfit) {
        bestProfit = result.profitPerHour;
        bestTeas = combo;
        bestBuffs = buffs;
      }
    }
  }

  if (bestBuffs === null) {
    const defaultBuffs = actionBuffs(profile, 'alchemy', data);
    return {
      teas: [],
      profitPerHour: null,
      buffs: defaultBuffs,
    };
  }

  return {
    teas: bestTeas,
    profitPerHour: bestProfit,
    buffs: bestBuffs,
  };
}
