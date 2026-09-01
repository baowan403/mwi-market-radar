import type { PlayerProfile, SkillingAction } from '../profile/types';
import { actionBuffs, type ActionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import { calculateManufacture, type PricedCount } from './manufacture';
import type { MarketPriceBook } from './price-book';
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
): StrategyFlow[] {
  return Object.entries(units).map(([itemHrid, unitsPerHour]) => ({
    itemHrid,
    enhancementLevel: 0,
    unitsPerHour,
    unitPrice: side === 'ask' ? prices.ask(itemHrid) : prices.bid(itemHrid),
    market: true,
  }));
}

function pricedDrop(drop: DropItem, prices: MarketPriceBook): PricedCount {
  return {
    itemHrid: drop.itemHrid,
    count: drop.maxCount,
    rate: drop.dropRate,
    price: prices.bid(drop.itemHrid),
  };
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
  const buffs = options.buffs ?? actionBuffs(profile, action, data);
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
  }));
  const teas: PricedCount[] = profile.actions[action].teas.map((itemHrid) => ({
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
    essenceDrops: drops(detail.essenceDropTable).map((drop) => pricedDrop(drop, prices)),
    rareDrops: drops(detail.rareDropTable).map((drop) => pricedDrop(drop, prices)),
    teas,
  });
  const baseExperience = detail.experienceGain?.value ?? 0;

  return {
    id: `manufacture:${actionHrid}`,
    action,
    actionHrid,
    outputHrid: detail.outputItems[0]!.itemHrid,
    valid: result.valid,
    actionsPerHour: result.actionsPerHour,
    costPerHour: result.costPerHour,
    incomePerHour: result.incomePerHour,
    profitPerHour: result.profitPerHour,
    experiencePerHour: baseExperience * (1 + buffs.Experience) * result.actionsPerHour,
    inputs: priceFlow(result.ingredientUnitsPerHour, 'ask', prices),
    outputs: priceFlow(result.productUnitsPerHour, 'bid', prices),
  };
}
