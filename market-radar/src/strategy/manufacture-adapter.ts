import type { PlayerProfile, SkillingAction } from '../profile/types';
import { actionBuffs, type ActionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import { expandStrategyLiquidation } from './liquidation';
import { calculateManufacture, type PricedCount } from './manufacture';
import type { MarketPriceBook } from './price-book';
import { findOptimalTeasForManufacture, findOptimalTeasForGathering } from './tea-optimizer';
import { optimalTeasForAction } from './optimal-loadout';
import type { DropItem, StrategyActionDetail, StrategyFlow, StrategyStepResult } from './types';

const MANUFACTURING_ACTIONS = new Set<SkillingAction>([
  'cheesesmithing',
  'crafting',
  'tailoring',
  'cooking',
  'brewing',
]);

export class StrategyRecipeError extends Error {
  readonly code = 'strategy_recipe';

  constructor() {
    super('策略配方無法使用');
    this.name = 'StrategyRecipeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function actionFromHrid(hrid: string): SkillingAction {
  const action = hrid.split('/')[2] as SkillingAction | undefined;
  if (!action || !MANUFACTURING_ACTIONS.has(action)) throw new StrategyRecipeError();
  return action;
}

function drops(value: DropItem[] | null | undefined): DropItem[] {
  return Array.isArray(value) ? value : [];
}

function priceFlow(
  units: Record<string, number>,
  side: 'ask' | 'bid',
  prices: MarketPriceBook,
  data: NormalizedStrategyGameData,
): StrategyFlow[] {
  return Object.entries(units).map(([itemHrid, unitsPerHour]) => ({
    itemHrid,
    enhancementLevel: 0,
    unitsPerHour,
    unitPrice: side === 'ask' ? prices.ask(itemHrid) : prices.bid(itemHrid),
    market: data.itemsByHrid.get(itemHrid)?.isTradable === true,
  }));
}

function taxable(itemHrid: string, data: NormalizedStrategyGameData): boolean {
  return itemHrid !== '/items/coin' && data.itemsByHrid.get(itemHrid)?.isTradable === true;
}

function pricedDrop(drop: DropItem, prices: MarketPriceBook, data: NormalizedStrategyGameData): PricedCount {
  return {
    itemHrid: drop.itemHrid,
    count: (drop.minCount + drop.maxCount) / 2,
    rate: drop.dropRate,
    price: prices.bid(drop.itemHrid),
    taxable: taxable(drop.itemHrid, data),
  };
}

function liquidateOutputs(
  units: Record<string, number>,
  data: NormalizedStrategyGameData,
  prices: MarketPriceBook,
): { complete: boolean; flows: StrategyFlow[] } {
  const aggregated = new Map<string, StrategyFlow>();
  for (const [itemHrid, unitsPerHour] of Object.entries(units)) {
    const liquidation = expandStrategyLiquidation({ itemHrid, unitsPerHour, data, prices });
    if (!liquidation.complete) return { complete: false, flows: [] };
    for (const flow of liquidation.flows) {
      const key = `${flow.itemHrid}::${flow.enhancementLevel}`;
      const current = aggregated.get(key);
      if (!current) aggregated.set(key, { ...flow });
      else if (current.unitPrice === flow.unitPrice && current.market === flow.market) {
        current.unitsPerHour += flow.unitsPerHour;
      } else return { complete: false, flows: [] };
    }
  }
  return { complete: true, flows: [...aggregated.values()] };
}

export function calculateManufactureAction(options: {
  actionHrid: string;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
  buffs?: ActionBuffs;
}): StrategyStepResult {
  const { actionHrid, profile, data, prices } = options;
  const action = actionFromHrid(actionHrid);
  const detail = data.actionsByHrid.get(actionHrid) as StrategyActionDetail | undefined;
  if (!detail || !Array.isArray(detail.outputItems) || detail.outputItems.length === 0) {
    throw new StrategyRecipeError();
  }
  let activeTeas = profile.actions[action]?.teas ?? [];
  const isAutoOptimal = profile.actions[action]?.teaMode !== 'manual';

  let buffs: ActionBuffs;
  if (isAutoOptimal) {
    const optimal = findOptimalTeasForManufacture({ action, detail, profile, data, prices });
    activeTeas = optimal.teas;
    buffs = optimal.buffs;
  } else if (options.buffs) {
    buffs = options.buffs;
  } else {
    buffs = actionBuffs(profile, action, data);
  }

  if (buffs.Level < detail.levelRequirement.level) throw new StrategyRecipeError();
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
  const products: PricedCount[] = detail.outputItems.map((item) => ({
    itemHrid: item.itemHrid,
    count: item.count,
    price: prices.bid(item.itemHrid),
    taxable: taxable(item.itemHrid, data),
  }));
  const teas: PricedCount[] = activeTeas
    .filter((itemHrid) => prices.ask(itemHrid) !== null)
    .map((itemHrid) => ({
      itemHrid,
      count: 1,
      price: prices.ask(itemHrid),
    }));

  const result = calculateManufacture({
    baseTimeCost: detail.baseTimeCost,
    actionLevel: detail.levelRequirement.level,
    playerLevel: buffs.Level,
    buffs,
    ingredients,
    products,
    essenceDrops: drops(detail.essenceDropTable).map((drop) => pricedDrop(drop, prices, data)),
    rareDrops: drops(detail.rareDropTable).map((drop) => pricedDrop(drop, prices, data)),
    teas,
  });
  const baseExperience = detail.experienceGain?.value ?? 0;
  const liquidation = result.valid
    ? liquidateOutputs(result.productUnitsPerHour, data, prices)
    : { complete: false, flows: [] };
  const valid = result.valid && liquidation.complete;

  return {
    id: `manufacture:${actionHrid}`,
    action,
    actionHrid,
    outputHrid: detail.outputItems[0]!.itemHrid,
    valid,
    actionsPerHour: result.actionsPerHour,
    costPerHour: valid ? result.costPerHour : null,
    incomePerHour: valid ? result.incomePerHour : null,
    profitPerHour: valid ? result.profitPerHour : null,
    experiencePerHour: baseExperience * (1 + buffs.Experience) * result.actionsPerHour,
    inputs: priceFlow(result.ingredientUnitsPerHour, 'ask', prices, data),
    outputs: liquidation.flows,
    ledger: result.ledger,
  };
}

const GATHERING_ACTIONS = new Set<SkillingAction>([
  'milking',
  'foraging',
  'woodcutting',
]);

export function calculateGatherAction(options: {
  actionHrid: string;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
  buffs?: ActionBuffs;
}): StrategyStepResult {
  const { actionHrid, profile, data, prices } = options;
  const action = actionHrid.split('/')[2] as SkillingAction | undefined;
  if (!action || !GATHERING_ACTIONS.has(action)) throw new StrategyRecipeError();
  const detail = data.actionsByHrid.get(actionHrid) as StrategyActionDetail | undefined;
  if (!detail) throw new StrategyRecipeError();

  let activeTeas = profile.actions[action]?.teas ?? [];
  const isAutoOptimal = profile.actions[action]?.teaMode !== 'manual';
  let buffs: ActionBuffs;

  if (isAutoOptimal) {
    const optimal = findOptimalTeasForGathering({ action, detail, profile, data, prices });
    activeTeas = optimal.teas;
    buffs = optimal.buffs;
  } else if (options.buffs) {
    buffs = options.buffs;
  } else {
    buffs = actionBuffs(profile, action, data);
  }

  if (buffs.Level < detail.levelRequirement.level) throw new StrategyRecipeError();

  const dropItems = drops(detail.dropTable);
  if (dropItems.length === 0) throw new StrategyRecipeError();

  const gatheringFactor = 1 + (buffs.Gathering ?? 0);
  const products: PricedCount[] = dropItems.map((drop) => ({
    itemHrid: drop.itemHrid,
    count: ((drop.minCount + drop.maxCount) / 2) * drop.dropRate * gatheringFactor,
    price: prices.bid(drop.itemHrid),
    taxable: taxable(drop.itemHrid, data),
  }));

  const teas: PricedCount[] = activeTeas
    .filter((itemHrid) => prices.ask(itemHrid) !== null)
    .map((itemHrid) => ({
      itemHrid,
      count: 1,
      price: prices.ask(itemHrid),
    }));

  const result = calculateManufacture({
    baseTimeCost: detail.baseTimeCost,
    actionLevel: detail.levelRequirement.level,
    playerLevel: buffs.Level,
    buffs,
    ingredients: [],
    products,
    essenceDrops: drops(detail.essenceDropTable).map((drop) => pricedDrop(drop, prices, data)),
    rareDrops: drops(detail.rareDropTable).map((drop) => pricedDrop(drop, prices, data)),
    teas,
  });

  const baseExperience = detail.experienceGain?.value ?? 0;
  const liquidation = result.valid
    ? liquidateOutputs(result.productUnitsPerHour, data, prices)
    : { complete: false, flows: [] };
  const valid = result.valid && liquidation.complete;

  return {
    id: `gather:${actionHrid}`,
    action,
    actionHrid,
    outputHrid: dropItems[0]!.itemHrid,
    valid,
    actionsPerHour: result.actionsPerHour,
    costPerHour: valid ? result.costPerHour : null,
    incomePerHour: valid ? result.incomePerHour : null,
    profitPerHour: valid ? result.profitPerHour : null,
    experiencePerHour: baseExperience * (1 + buffs.Experience) * result.actionsPerHour,
    inputs: priceFlow(result.ingredientUnitsPerHour, 'ask', prices, data),
    outputs: liquidation.flows,
    ledger: result.ledger,
  };
}
