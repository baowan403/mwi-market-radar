import type { PlayerProfile } from '../profile/types';
import { actionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import type { MarketPriceBook } from './price-book';
import type { StrategyFlow, StrategyStepResult } from './types';

const HOUR_NS = 3_600_000_000_000;
const MIN_ACTION_TIME_NS = 3_000_000_000;
const SELL_TAX_FACTOR = 0.95;
const MINUTE_NS = 60_000_000_000;
const COIN_HRID = '/items/coin';

export type CatalystRank = 0 | 1 | 2;

export interface AlchemyStepResult extends StrategyStepResult {
  successRate: number;
  catalystRank: CatalystRank;
}

interface AlchemyOptions {
  itemHrid: string;
  catalystRank: CatalystRank;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
}

interface AlchemyItem {
  hrid: string;
  itemLevel: number;
  sellPrice: number;
  bulkMultiplier: number;
  decomposeItems: Array<{ itemHrid: string; count: number }>;
  isCoinifiable: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function array<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function alchemyItem(hrid: string, data: NormalizedStrategyGameData): AlchemyItem {
  const raw = record(data.itemsByHrid.get(hrid));
  const detail = record(raw?.alchemyDetail);
  const itemLevel = finite(raw?.itemLevel, -1);
  const bulkMultiplier = finite(detail?.bulkMultiplier, -1);
  if (!raw || !detail || itemLevel < 0 || bulkMultiplier <= 0) throw new Error('煉金策略無法使用');
  const decomposeItems = array(detail.decomposeItems as Record<string, unknown> | Record<string, unknown>[] | null)
    .map((item) => ({ itemHrid: String(item.itemHrid ?? ''), count: finite(item.count, -1) }))
    .filter((item) => item.itemHrid.startsWith('/items/') && item.count >= 0);
  return {
    hrid,
    itemLevel,
    sellPrice: finite(raw.sellPrice),
    bulkMultiplier,
    decomposeItems,
    isCoinifiable: detail.isCoinifiable === true,
  };
}

function catalystRatio(rank: CatalystRank): number {
  return rank === 0 ? 0 : rank * 0.1 + 0.05;
}

function successRate(base: number, playerLevel: number, itemLevel: number, successBuff: number, rank: CatalystRank): number {
  const levelRatio = playerLevel >= itemLevel ? 0 : -0.9 * (1 - playerLevel / itemLevel);
  return Math.max(0, Math.min(1, base * (1 + levelRatio + successBuff + catalystRatio(rank))));
}

function catalystHrid(kind: 'decompose' | 'coinify', rank: CatalystRank): string | null {
  if (rank === 0) return null;
  if (rank === 2) return '/items/prime_catalyst';
  return kind === 'decompose'
    ? '/items/catalyst_of_decomposition'
    : '/items/catalyst_of_coinification';
}

function rareDrop(itemLevel: number, timeCost: number): { itemHrid: string; rate: number } {
  let itemHrid = '/items/small_artisans_crate';
  let scale: number;
  if (itemLevel < 35) {
    scale = (itemLevel + 100) / 100;
  } else if (itemLevel < 70) {
    itemHrid = '/items/medium_artisans_crate';
    scale = (itemLevel - 35 + 100) / 150;
  } else {
    itemHrid = '/items/large_artisans_crate';
    scale = (itemLevel - 70 + 100) / 200;
  }
  return { itemHrid, rate: timeCost / (8 * HOUR_NS) * scale };
}

function essenceRate(itemLevel: number, timeCost: number): number {
  return timeCost / (6 * MINUTE_NS) * ((itemLevel + 100) / 100);
}

function addFlow(target: Map<string, StrategyFlow>, flow: StrategyFlow): void {
  const key = `${flow.itemHrid}::${flow.enhancementLevel}`;
  const current = target.get(key);
  if (!current) {
    target.set(key, { ...flow });
    return;
  }
  if (current.unitPrice !== flow.unitPrice || current.market !== flow.market) throw new Error('煉金策略無法使用');
  current.unitsPerHour += flow.unitsPerHour;
}

function calculate(kind: 'decompose' | 'coinify', options: AlchemyOptions & { enhancementLevel?: number }): AlchemyStepResult {
  const { itemHrid, catalystRank: rank, profile, data, prices } = options;
  if (![0, 1, 2].includes(rank)) throw new Error('煉金策略無法使用');
  const item = alchemyItem(itemHrid, data);
  if (kind === 'decompose' && item.decomposeItems.length === 0) throw new Error('煉金策略無法使用');
  if (kind === 'coinify' && !item.isCoinifiable) throw new Error('煉金策略無法使用');
  const actionHrid = `/actions/alchemy/${kind === 'decompose' ? 'decompose' : 'coinify'}`;
  const action = data.actionsByHrid.get(actionHrid);
  if (!action) throw new Error('煉金策略無法使用');
  const buffs = actionBuffs(profile, 'alchemy', data);
  const rate = successRate(kind === 'decompose' ? 0.6 : 0.7, buffs.Level, item.itemLevel, buffs.Success, rank);
  const efficiency = 1 + Math.max(0, (buffs.Level - item.itemLevel) * 0.01) + buffs.Efficiency;
  const speed = 1 + buffs.Speed;
  const effectiveTime = Math.max(action.baseTimeCost / speed, MIN_ACTION_TIME_NS);
  const actionsPerHour = HOUR_NS / effectiveTime * efficiency;
  const successfulActionsPerHour = actionsPerHour * rate;
  const inputs = new Map<string, StrategyFlow>();
  const outputs = new Map<string, StrategyFlow>();
  const enhancementLevel = options.enhancementLevel ?? 0;

  addFlow(inputs, {
    itemHrid, enhancementLevel, unitsPerHour: item.bulkMultiplier * actionsPerHour,
    unitPrice: prices.ask(itemHrid, enhancementLevel), market: true,
  });
  if (kind === 'decompose') {
    addFlow(inputs, {
      itemHrid: COIN_HRID, enhancementLevel: 0,
      unitsPerHour: item.bulkMultiplier * (50 + 5 * item.itemLevel) * actionsPerHour,
      unitPrice: 1, market: false,
    });
  }
  const catalyst = catalystHrid(kind, rank);
  if (catalyst) {
    addFlow(inputs, {
      itemHrid: catalyst, enhancementLevel: 0, unitsPerHour: successfulActionsPerHour,
      unitPrice: prices.ask(catalyst), market: true,
    });
  }
  for (const teaHrid of profile.actions.alchemy.teas) {
    addFlow(inputs, {
      itemHrid: teaHrid, enhancementLevel: 0,
      unitsPerHour: 12 * (1 + buffs.drinkConcentration),
      unitPrice: prices.ask(teaHrid), market: true,
    });
  }

  if (kind === 'decompose') {
    for (const output of item.decomposeItems) {
      addFlow(outputs, {
        itemHrid: output.itemHrid, enhancementLevel: 0,
        unitsPerHour: output.count * item.bulkMultiplier * successfulActionsPerHour,
        unitPrice: prices.bid(output.itemHrid), market: true,
      });
    }
    if (enhancementLevel > 0) {
      const count = Math.round(2 * (0.5 + 0.1 * 1.05 ** item.itemLevel) * 2 ** enhancementLevel);
      addFlow(outputs, {
        itemHrid: '/items/enhancing_essence', enhancementLevel: 0,
        unitsPerHour: count * successfulActionsPerHour,
        unitPrice: prices.bid('/items/enhancing_essence'), market: true,
      });
    }
  } else {
    addFlow(outputs, {
      itemHrid: COIN_HRID, enhancementLevel: 0,
      unitsPerHour: item.sellPrice * 5 * item.bulkMultiplier * successfulActionsPerHour,
      unitPrice: 1, market: false,
    });
  }

  const rare = rareDrop(item.itemLevel, action.baseTimeCost);
  addFlow(outputs, {
    itemHrid: rare.itemHrid, enhancementLevel: 0,
    unitsPerHour: actionsPerHour * rare.rate * (1 + buffs.RareFind),
    unitPrice: prices.bid(rare.itemHrid), market: true,
  });
  addFlow(outputs, {
    itemHrid: '/items/alchemy_essence', enhancementLevel: 0,
    unitsPerHour: actionsPerHour * essenceRate(item.itemLevel, action.baseTimeCost) * (1 + buffs.EssenceFind),
    unitPrice: prices.bid('/items/alchemy_essence'), market: true,
  });

  const inputList = [...inputs.values()];
  const outputList = [...outputs.values()];
  const valid = [...inputList, ...outputList].every((flow) => (
    typeof flow.unitPrice === 'number' && Number.isFinite(flow.unitPrice) && flow.unitPrice >= 0
  ));
  const costPerHour = valid
    ? inputList.reduce((sum, flow) => sum + flow.unitsPerHour * flow.unitPrice!, 0)
    : null;
  const incomePerHour = valid
    ? outputList.reduce((sum, flow) => sum + flow.unitsPerHour * flow.unitPrice! * (flow.market ? SELL_TAX_FACTOR : 1), 0)
    : null;
  const baseExp = (kind === 'decompose' ? 1.4 : 1) * (10 + item.itemLevel);

  return {
    id: `${kind}:${itemHrid}:${enhancementLevel}:c${rank}`,
    action: 'alchemy',
    actionHrid,
    outputHrid: kind === 'decompose' ? item.decomposeItems[0]!.itemHrid : COIN_HRID,
    valid,
    actionsPerHour,
    costPerHour,
    incomePerHour,
    profitPerHour: valid ? incomePerHour! - costPerHour! : null,
    experiencePerHour: baseExp * (1 + buffs.Experience) * actionsPerHour,
    inputs: inputList,
    outputs: outputList,
    successRate: rate,
    catalystRank: rank,
  };
}

export function calculateDecompose(options: AlchemyOptions & { enhancementLevel: number }): AlchemyStepResult {
  return calculate('decompose', options);
}

export function calculateCoinify(options: AlchemyOptions): AlchemyStepResult {
  return calculate('coinify', options);
}
