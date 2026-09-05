import type { PlayerProfile } from '../profile/types';
import type { CatalystRank } from './alchemy';
import { actionBuffs, type ActionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import { expandStrategyLiquidation } from './liquidation';
import type { MarketPriceBook } from './price-book';
import { marketTaxFactor } from './tax';
import type {
  PhysicalLedger,
  StrategyFlow,
  StrategyLedger,
  StrategyStepResult,
} from './types';

const HOUR_NS = 3_600_000_000_000;
const MINUTE_NS = 60_000_000_000;
const MIN_ACTION_TIME_NS = 3_000_000_000;
const COIN_HRID = '/items/coin';

interface TransmuteOptions {
  itemHrid: string;
  catalystRank: CatalystRank;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
  buffs?: ActionBuffs;
}

interface TransmuteDrop {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
}

interface TransmuteItem {
  itemLevel: number;
  sellPrice: number;
  bulkMultiplier: number;
  baseSuccessRate: number;
  drops: TransmuteDrop[];
}

export interface TransmuteStepResult extends StrategyStepResult {
  successRate: number;
  catalystRank: CatalystRank;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, fallback = Number.NaN): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function transmuteItem(hrid: string, data: NormalizedStrategyGameData): TransmuteItem {
  const raw = record(data.itemsByHrid.get(hrid));
  const detail = record(raw?.alchemyDetail);
  const itemLevel = finite(raw?.itemLevel);
  const sellPrice = finite(raw?.sellPrice);
  const bulkMultiplier = finite(detail?.bulkMultiplier);
  const baseSuccessRate = finite(detail?.transmuteSuccessRate);
  const rawDrops = Array.isArray(detail?.transmuteDropTable) ? detail.transmuteDropTable : [];
  const drops = rawDrops.map((rawDrop): TransmuteDrop | null => {
    const drop = record(rawDrop);
    const itemHrid = typeof drop?.itemHrid === 'string' ? drop.itemHrid : '';
    const dropRate = finite(drop?.dropRate, 1);
    const minCount = finite(drop?.minCount, 0);
    const maxCount = finite(drop?.maxCount);
    if (
      !itemHrid.startsWith('/items/')
      || dropRate < 0
      || minCount < 0
      || maxCount < minCount
    ) return null;
    return { itemHrid, dropRate, minCount, maxCount };
  }).filter((drop): drop is TransmuteDrop => drop !== null);

  if (
    !raw
    || !detail
    || !Number.isFinite(itemLevel)
    || itemLevel < 0
    || !Number.isFinite(sellPrice)
    || sellPrice < 0
    || !Number.isFinite(bulkMultiplier)
    || bulkMultiplier <= 0
    || !Number.isFinite(baseSuccessRate)
    || baseSuccessRate < 0
    || drops.length === 0
  ) throw new Error('煉金轉化策略無法使用');

  return { itemLevel, sellPrice, bulkMultiplier, baseSuccessRate, drops };
}

function catalystRatio(rank: CatalystRank): number {
  return rank === 0 ? 0 : rank * 0.1 + 0.05;
}

function successRate(
  base: number,
  playerLevel: number,
  itemLevel: number,
  successBuff: number,
  rank: CatalystRank,
): number {
  const levelRatio = playerLevel >= itemLevel ? 0 : -0.9 * (1 - playerLevel / itemLevel);
  return Math.max(0, Math.min(1, base * (1 + levelRatio + successBuff + catalystRatio(rank))));
}

function catalystHrid(rank: CatalystRank): string | null {
  if (rank === 0) return null;
  return rank === 2 ? '/items/prime_catalyst' : '/items/catalyst_of_transmutation';
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

function effectiveDropRate(drop: TransmuteDrop): number {
  // Milkonomy treats a missing/zero rate as the default deterministic rate of 1.
  return drop.dropRate || 1;
}

function addUnit(target: Record<string, number>, itemHrid: string, units: number): void {
  target[itemHrid] = (target[itemHrid] ?? 0) + units;
}

function addFlow(target: Map<string, StrategyFlow>, flow: StrategyFlow): void {
  const key = `${flow.itemHrid}::${flow.enhancementLevel}`;
  const current = target.get(key);
  if (!current) {
    target.set(key, { ...flow });
    return;
  }
  if (current.unitPrice !== flow.unitPrice || current.market !== flow.market) {
    throw new Error('煉金轉化策略無法使用');
  }
  current.unitsPerHour += flow.unitsPerHour;
}

export function calculateTransmute(options: TransmuteOptions): TransmuteStepResult {
  const { itemHrid, catalystRank: rank, profile, data, prices } = options;
  if (![0, 1, 2].includes(rank)) throw new Error('煉金轉化策略無法使用');
  const item = transmuteItem(itemHrid, data);
  const actionHrid = '/actions/alchemy/transmute';
  const action = data.actionsByHrid.get(actionHrid);
  if (!action) throw new Error('煉金轉化策略無法使用');

  const buffs = options.buffs ?? actionBuffs(profile, 'alchemy', data);
  const rate = successRate(
    item.baseSuccessRate,
    buffs.Level,
    item.itemLevel,
    buffs.Success,
    rank,
  );
  const efficiency = 1 + Math.max(0, (buffs.Level - item.itemLevel) * 0.01) + buffs.Efficiency;
  const speed = 1 + buffs.Speed;
  const effectiveTime = Math.max(action.baseTimeCost / speed, MIN_ACTION_TIME_NS);
  const actionsPerHour = HOUR_NS / effectiveTime * efficiency;
  const successfulActionsPerHour = actionsPerHour * rate;
  const selfDrop = item.drops.find((drop) => drop.itemHrid === itemHrid);
  const sameItemCounter = selfDrop
    ? Math.min(1, selfDrop.maxCount * effectiveDropRate(selfDrop) * rate)
    : 0;
  const netInputPerAction = item.bulkMultiplier * (1 - sameItemCounter);
  const coinCostPerInput = Math.max(Math.floor(item.sellPrice / 5), 50);
  const coinCostPerAction = item.bulkMultiplier * coinCostPerInput;
  const catalyst = catalystHrid(rank);
  const activeTeas = profile.actions.alchemy?.teas ?? [];

  // Physical production remains price independent. The self-return is netted against
  // the purchased input exactly as Milkonomy's sameItemCounter accounting does.
  const physicalInputs: Record<string, number> = {
    [itemHrid]: netInputPerAction * actionsPerHour,
    [COIN_HRID]: coinCostPerAction * actionsPerHour,
  };
  if (catalyst) physicalInputs[catalyst] = successfulActionsPerHour;

  const teaUnitsPerHour: Record<string, number> = {};
  for (const teaHrid of activeTeas) {
    const units = 12 * (1 + buffs.drinkConcentration);
    teaUnitsPerHour[teaHrid] = units;
    addUnit(physicalInputs, teaHrid, units);
  }

  const outputUnitsPerSuccess: Record<string, number> = {};
  const outputUnitsPerHour: Record<string, number> = {};
  for (const drop of item.drops) {
    if (drop.itemHrid === itemHrid) continue;
    const expectedPerSuccess = drop.maxCount * item.bulkMultiplier * effectiveDropRate(drop);
    addUnit(outputUnitsPerSuccess, drop.itemHrid, expectedPerSuccess);
    addUnit(outputUnitsPerHour, drop.itemHrid, expectedPerSuccess * successfulActionsPerHour);
  }

  const rareAndEssenceUnitsPerHour: Record<string, number> = {};
  const rare = rareDrop(item.itemLevel, action.baseTimeCost);
  rareAndEssenceUnitsPerHour[rare.itemHrid] = actionsPerHour
    * rare.rate
    * (1 + buffs.RareFind);
  rareAndEssenceUnitsPerHour['/items/alchemy_essence'] = actionsPerHour
    * essenceRate(item.itemLevel, action.baseTimeCost)
    * (1 + buffs.EssenceFind);

  const physical: PhysicalLedger = {
    effectiveLevel: buffs.Level,
    speed,
    efficiency,
    successRate: rate,
    actionTimeSeconds: effectiveTime / 1_000_000_000,
    actionsPerHour,
    successfulActionsPerHour,
    inputUnitsPerHour: physicalInputs,
    outputUnitsPerSuccess,
    outputUnitsPerHour,
    rareAndEssenceUnitsPerHour,
    teaUnitsPerHour,
  };

  const inputs = new Map<string, StrategyFlow>();
  const outputs = new Map<string, StrategyFlow>();
  let liquidationComplete = true;
  const addLiquidation = (outputHrid: string, unitsPerHour: number): void => {
    const result = expandStrategyLiquidation({ itemHrid: outputHrid, unitsPerHour, data, prices });
    if (!result.complete) {
      liquidationComplete = false;
      return;
    }
    for (const flow of result.flows) addFlow(outputs, flow);
  };

  addFlow(inputs, {
    itemHrid,
    enhancementLevel: 0,
    unitsPerHour: netInputPerAction * actionsPerHour,
    unitPrice: prices.ask(itemHrid),
    market: data.itemsByHrid.get(itemHrid)?.isTradable === true,
  });
  addFlow(inputs, {
    itemHrid: COIN_HRID,
    enhancementLevel: 0,
    unitsPerHour: coinCostPerAction * actionsPerHour,
    unitPrice: 1,
    market: false,
  });
  if (catalyst) {
    addFlow(inputs, {
      itemHrid: catalyst,
      enhancementLevel: 0,
      unitsPerHour: successfulActionsPerHour,
      unitPrice: prices.ask(catalyst),
      market: true,
    });
  }
  for (const teaHrid of activeTeas) {
    addFlow(inputs, {
      itemHrid: teaHrid,
      enhancementLevel: 0,
      unitsPerHour: 12 * (1 + buffs.drinkConcentration),
      unitPrice: prices.ask(teaHrid),
      market: true,
    });
  }

  for (const [outputHrid, unitsPerHour] of Object.entries(outputUnitsPerHour)) {
    addLiquidation(outputHrid, unitsPerHour);
  }
  addLiquidation(rare.itemHrid, rareAndEssenceUnitsPerHour[rare.itemHrid]!);
  addLiquidation(
    '/items/alchemy_essence',
    rareAndEssenceUnitsPerHour['/items/alchemy_essence']!,
  );

  const inputList = [...inputs.values()];
  const outputList = liquidationComplete ? [...outputs.values()] : [];
  const valid = liquidationComplete && [...inputList, ...outputList].every((flow) => (
    typeof flow.unitPrice === 'number'
    && Number.isFinite(flow.unitPrice)
    && flow.unitPrice >= 0
  ));
  const costPerHour = valid
    ? inputList.reduce((sum, flow) => sum + flow.unitsPerHour * flow.unitPrice!, 0)
    : null;
  const incomePerHour = valid
    ? outputList.reduce((sum, flow) => (
      sum + flow.unitsPerHour
        * flow.unitPrice!
        * (flow.market ? marketTaxFactor(flow.itemHrid) : 1)
    ), 0)
    : null;

  const inputAskPrices: Record<string, number | null> = {};
  for (const flow of inputList) inputAskPrices[flow.itemHrid] = flow.unitPrice;
  const outputBidPrices: Record<string, number | null> = {};
  const outputValuations: Record<string, import('./types').OutputValuation> = {};
  for (const flow of outputList) {
    outputBidPrices[flow.itemHrid] = flow.unitPrice;
    const taxFactor = flow.market ? marketTaxFactor(flow.itemHrid) : 1;
    const hasPrice = typeof flow.unitPrice === 'number' && Number.isFinite(flow.unitPrice);
    outputValuations[flow.itemHrid] = {
      itemHrid: flow.itemHrid,
      unitsPerHour: flow.unitsPerHour,
      unitBidPrice: flow.unitPrice,
      taxFactor,
      netValuePerHour: hasPrice ? flow.unitsPerHour * flow.unitPrice! * taxFactor : null,
    };
  }
  const teaAskPrices: Record<string, number | null> = {};
  for (const teaHrid of activeTeas) teaAskPrices[teaHrid] = prices.ask(teaHrid);

  const profitPerHour = valid ? incomePerHour! - costPerHour! : null;
  const economic: import('./types').EconomicLedger = {
    complete: valid,
    inputAskPrices,
    outputBidPrices,
    outputValuations,
    teaAskPrices,
    revenuePerHour: incomePerHour,
    costPerHour,
    profitPerHour,
    profitPerDay: profitPerHour === null ? null : profitPerHour * 24,
  };
  const ledger: StrategyLedger = { physical, economic };
  const outputHrid = item.drops.find((drop) => drop.itemHrid !== itemHrid)?.itemHrid
    ?? item.drops[0]!.itemHrid;
  const successExperienceFactor = rate + 0.1 * (1 - rate);

  return {
    id: `transmute:${itemHrid}:0:c${rank}`,
    action: 'alchemy',
    actionHrid,
    outputHrid,
    valid,
    actionsPerHour,
    costPerHour,
    incomePerHour,
    profitPerHour,
    experiencePerHour: 1.6
      * (10 + item.itemLevel)
      * (1 + buffs.Experience)
      * successExperienceFactor
      * actionsPerHour,
    inputs: inputList,
    outputs: outputList,
    successRate: rate,
    catalystRank: rank,
    ledger,
  };
}
