import { marketTaxFactor } from './tax';

const HOUR_NS = 3_600_000_000_000;
const MIN_ACTION_TIME_NS = 3_000_000_000;
const COIN_HRID = '/items/coin';

export interface PricedCount {
  itemHrid: string;
  count: number;
  price: number | null;
  rate?: number;
  artisanEligible?: boolean;
  taxable?: boolean;
}

export interface ManufactureInput {
  baseTimeCost: number;
  actionLevel: number;
  playerLevel: number;
  buffs: {
    Speed: number;
    Efficiency: number;
    Artisan: number;
    Gourmet: number;
    EssenceFind: number;
    RareFind: number;
    drinkConcentration: number;
  };
  ingredients: PricedCount[];
  products: PricedCount[];
  essenceDrops: PricedCount[];
  rareDrops: PricedCount[];
  teas: PricedCount[];
}

import type { StrategyLedger } from './types';

export interface ManufactureResult {
  valid: boolean;
  efficiency: number;
  speed: number;
  actionsPerHour: number;
  costPerHour: number | null;
  incomePerHour: number | null;
  profitPerHour: number | null;
  profitPerDay: number | null;
  ingredientUnitsPerHour: Record<string, number>;
  productUnitsPerHour: Record<string, number>;
  ledger?: StrategyLedger;
}

function validNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validPriced(item: PricedCount): item is PricedCount & { price: number } {
  return item.itemHrid.startsWith('/items/')
    && validNumber(item.count)
    && typeof item.price === 'number'
    && validNumber(item.price)
    && (item.rate === undefined || validNumber(item.rate));
}

function addUnit(target: Record<string, number>, hrid: string, count: number): void {
  target[hrid] = (target[hrid] ?? 0) + count;
}

function invalidResult(efficiency: number, speed: number, actionsPerHour: number): ManufactureResult {
  return {
    valid: false,
    efficiency,
    speed,
    actionsPerHour,
    costPerHour: null,
    incomePerHour: null,
    profitPerHour: null,
    profitPerDay: null,
    ingredientUnitsPerHour: {},
    productUnitsPerHour: {},
  };
}

export function calculateManufacture(input: ManufactureInput): ManufactureResult {
  const efficiency = 1
    + Math.max(0, (input.playerLevel - input.actionLevel) * 0.01)
    + input.buffs.Efficiency;
  const speed = 1 + input.buffs.Speed;
  if (
    !Number.isFinite(input.baseTimeCost)
    || input.baseTimeCost <= 0
    || !Number.isFinite(efficiency)
    || efficiency <= 0
    || !Number.isFinite(speed)
    || speed <= 0
  ) {
    return invalidResult(efficiency, speed, 0);
  }

  const effectiveTime = Math.max(input.baseTimeCost / speed, MIN_ACTION_TIME_NS);
  const actionsPerHour = HOUR_NS / effectiveTime * efficiency;
  const allPriced = [
    ...input.ingredients,
    ...input.products,
    ...input.essenceDrops,
    ...input.rareDrops,
    ...input.teas,
  ];
  if (!allPriced.every(validPriced)) {
    return invalidResult(efficiency, speed, actionsPerHour);
  }

  const ingredientUnitsPerHour: Record<string, number> = {};
  const productUnitsPerHour: Record<string, number> = {};
  let costPerHour = 0;
  let incomePerHour = 0;

  const artisanFactor = Math.max(0, 1 - input.buffs.Artisan);
  for (const ingredient of input.ingredients as Array<PricedCount & { price: number }>) {
    const units = ingredient.count
      * (ingredient.artisanEligible === false ? 1 : artisanFactor)
      * actionsPerHour;
    addUnit(ingredientUnitsPerHour, ingredient.itemHrid, units);
    costPerHour += units * ingredient.price;
  }

  const teaUnitsFactor = 12 * (1 + input.buffs.drinkConcentration);
  for (const tea of input.teas as Array<PricedCount & { price: number }>) {
    const units = tea.count * teaUnitsFactor;
    addUnit(ingredientUnitsPerHour, tea.itemHrid, units);
    costPerHour += units * tea.price;
  }

  const addIncome = (item: PricedCount & { price: number }, units: number): void => {
    addUnit(productUnitsPerHour, item.itemHrid, units);
    const taxFactor = marketTaxFactor(item.itemHrid, item.taxable !== false);
    incomePerHour += units * item.price * taxFactor;
  };

  const gourmetFactor = 1 + input.buffs.Gourmet;
  for (const product of input.products as Array<PricedCount & { price: number }>) {
    addIncome(product, product.count * gourmetFactor * actionsPerHour * (product.rate ?? 1));
  }
  const rareAndEssenceUnitsPerHour: Record<string, number> = {};
  for (const essence of input.essenceDrops as Array<PricedCount & { price: number }>) {
    const units = essence.count * (essence.rate ?? 1) * (1 + input.buffs.EssenceFind) * actionsPerHour;
    addIncome(essence, units);
    rareAndEssenceUnitsPerHour[essence.itemHrid] = (rareAndEssenceUnitsPerHour[essence.itemHrid] ?? 0) + units;
  }
  for (const rare of input.rareDrops as Array<PricedCount & { price: number }>) {
    const units = rare.count * (rare.rate ?? 1) * (1 + input.buffs.RareFind) * actionsPerHour;
    addIncome(rare, units);
    rareAndEssenceUnitsPerHour[rare.itemHrid] = (rareAndEssenceUnitsPerHour[rare.itemHrid] ?? 0) + units;
  }

  const teaUnitsPerHour: Record<string, number> = {};
  for (const tea of input.teas as Array<PricedCount & { price: number }>) {
    teaUnitsPerHour[tea.itemHrid] = tea.count * teaUnitsFactor;
  }

  const outputUnitsPerSuccess: Record<string, number> = {};
  for (const product of input.products as Array<PricedCount & { price: number }>) {
    outputUnitsPerSuccess[product.itemHrid] = product.count * gourmetFactor * (product.rate ?? 1);
  }

  const profitPerHour = incomePerHour - costPerHour;
  const ledger: StrategyLedger = {
    physical: {
      effectiveLevel: input.playerLevel,
      speed,
      efficiency,
      successRate: 1,
      actionTimeSeconds: effectiveTime / 1_000_000_000,
      actionsPerHour,
      successfulActionsPerHour: actionsPerHour,
      inputUnitsPerHour: Object.fromEntries(
        (input.ingredients as Array<PricedCount & { price: number }>).map((ing) => [
          ing.itemHrid,
          ingredientUnitsPerHour[ing.itemHrid] ?? 0,
        ]),
      ),
      outputUnitsPerSuccess,
      outputUnitsPerHour: { ...productUnitsPerHour },
      rareAndEssenceUnitsPerHour,
      teaUnitsPerHour,
    },
    economic: {
      inputAskPrices: Object.fromEntries(
        (input.ingredients as Array<PricedCount & { price: number }>).map((ing) => [ing.itemHrid, ing.price]),
      ),
      outputBidPrices: Object.fromEntries(
        (input.products as Array<PricedCount & { price: number }>).map((prod) => [prod.itemHrid, prod.price]),
      ),
      taxFactor: marketTaxFactor('/items/coin', true),
      teaAskPrices: Object.fromEntries(
        (input.teas as Array<PricedCount & { price: number }>).map((tea) => [tea.itemHrid, tea.price]),
      ),
      revenuePerHour: incomePerHour,
      costPerHour,
      profitPerHour,
      profitPerDay: profitPerHour * 24,
    },
  };

  return {
    valid: true,
    efficiency,
    speed,
    actionsPerHour,
    costPerHour,
    incomePerHour,
    profitPerHour,
    profitPerDay: profitPerHour * 24,
    ingredientUnitsPerHour,
    productUnitsPerHour,
    ledger,
  };
}
