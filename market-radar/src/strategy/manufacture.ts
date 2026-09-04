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
  const successfulActionsPerHour = actionsPerHour;

  // === 階段一：純物理計算 (Physical Calculation - 零價格依賴) ===
  const ingredientUnitsPerHour: Record<string, number> = {};
  const artisanFactor = Math.max(0, 1 - input.buffs.Artisan);
  for (const ingredient of input.ingredients) {
    const units = ingredient.count
      * (ingredient.artisanEligible === false ? 1 : artisanFactor)
      * actionsPerHour;
    addUnit(ingredientUnitsPerHour, ingredient.itemHrid, units);
  }

  const teaUnitsFactor = 12 * (1 + input.buffs.drinkConcentration);
  const teaUnitsPerHour: Record<string, number> = {};
  for (const tea of input.teas) {
    const units = tea.count * teaUnitsFactor;
    teaUnitsPerHour[tea.itemHrid] = units;
  }

  const productUnitsPerHour: Record<string, number> = {};
  const outputUnitsPerSuccess: Record<string, number> = {};
  const gourmetFactor = 1 + input.buffs.Gourmet;
  for (const product of input.products) {
    const perSuccess = product.count * gourmetFactor * (product.rate ?? 1);
    outputUnitsPerSuccess[product.itemHrid] = perSuccess;
    addUnit(productUnitsPerHour, product.itemHrid, perSuccess * actionsPerHour);
  }

  const rareAndEssenceUnitsPerHour: Record<string, number> = {};
  for (const essence of input.essenceDrops) {
    const units = essence.count * (essence.rate ?? 1) * (1 + input.buffs.EssenceFind) * actionsPerHour;
    addUnit(rareAndEssenceUnitsPerHour, essence.itemHrid, units);
    addUnit(productUnitsPerHour, essence.itemHrid, units);
  }
  for (const rare of input.rareDrops) {
    const units = rare.count * (rare.rate ?? 1) * (1 + input.buffs.RareFind) * actionsPerHour;
    addUnit(rareAndEssenceUnitsPerHour, rare.itemHrid, units);
    addUnit(productUnitsPerHour, rare.itemHrid, units);
  }

  const physical = {
    effectiveLevel: input.playerLevel,
    speed,
    efficiency,
    successRate: 1,
    actionTimeSeconds: effectiveTime / 1_000_000_000,
    actionsPerHour,
    successfulActionsPerHour,
    inputUnitsPerHour: { ...ingredientUnitsPerHour },
    outputUnitsPerSuccess,
    outputUnitsPerHour: { ...productUnitsPerHour },
    rareAndEssenceUnitsPerHour,
    teaUnitsPerHour,
  };

  // === 階段二：經濟價值評估 (Economic Valuation) ===
  const inputAskPrices: Record<string, number | null> = {};
  let costPerHour = 0;
  let economicComplete = true;

  for (const ingredient of input.ingredients) {
    inputAskPrices[ingredient.itemHrid] = ingredient.price;
    const units = ingredientUnitsPerHour[ingredient.itemHrid] ?? 0;
    if (typeof ingredient.price === 'number' && Number.isFinite(ingredient.price) && ingredient.price >= 0) {
      costPerHour += units * ingredient.price;
    } else {
      economicComplete = false;
    }
  }

  const teaAskPrices: Record<string, number | null> = {};
  for (const tea of input.teas) {
    teaAskPrices[tea.itemHrid] = tea.price;
    const units = teaUnitsPerHour[tea.itemHrid] ?? 0;
    if (typeof tea.price === 'number' && Number.isFinite(tea.price) && tea.price >= 0) {
      costPerHour += units * tea.price;
    } else {
      economicComplete = false;
    }
  }

  const outputBidPrices: Record<string, number | null> = {};
  const outputValuations: Record<string, import('./types').OutputValuation> = {};
  let incomePerHour = 0;

  for (const product of input.products) {
    outputBidPrices[product.itemHrid] = product.price;
    const units = productUnitsPerHour[product.itemHrid] ?? 0;
    const taxFactor = marketTaxFactor(product.itemHrid, product.taxable !== false);
    const hasPrice = typeof product.price === 'number' && Number.isFinite(product.price) && product.price >= 0;
    const netValue = hasPrice ? units * product.price! * taxFactor : null;
    outputValuations[product.itemHrid] = {
      itemHrid: product.itemHrid,
      unitsPerHour: units,
      unitBidPrice: product.price,
      taxFactor,
      netValuePerHour: netValue,
    };
    if (hasPrice) {
      incomePerHour += netValue!;
    } else {
      economicComplete = false;
    }
  }

  for (const drop of [...input.essenceDrops, ...input.rareDrops]) {
    outputBidPrices[drop.itemHrid] = drop.price;
    const units = rareAndEssenceUnitsPerHour[drop.itemHrid] ?? 0;
    const taxFactor = marketTaxFactor(drop.itemHrid, drop.taxable !== false);
    const hasPrice = typeof drop.price === 'number' && Number.isFinite(drop.price) && drop.price >= 0;
    const netValue = hasPrice ? units * drop.price! * taxFactor : null;
    outputValuations[drop.itemHrid] = {
      itemHrid: drop.itemHrid,
      unitsPerHour: units,
      unitBidPrice: drop.price,
      taxFactor,
      netValuePerHour: netValue,
    };
    if (hasPrice) {
      incomePerHour += netValue!;
    } else {
      economicComplete = false;
    }
  }

  const profitPerHour = economicComplete ? incomePerHour - costPerHour : null;
  const profitPerDay = profitPerHour !== null ? profitPerHour * 24 : null;

  const economic: import('./types').EconomicLedger = {
    complete: economicComplete,
    inputAskPrices,
    outputBidPrices,
    outputValuations,
    teaAskPrices,
    revenuePerHour: economicComplete ? incomePerHour : null,
    costPerHour: economicComplete ? costPerHour : null,
    profitPerHour,
    profitPerDay,
  };

  const ledger: StrategyLedger = {
    physical,
    economic,
  };

  return {
    valid: economicComplete,
    efficiency,
    speed,
    actionsPerHour,
    costPerHour: economic.costPerHour,
    incomePerHour: economic.revenuePerHour,
    profitPerHour,
    profitPerDay,
    ingredientUnitsPerHour,
    productUnitsPerHour,
    ledger,
  };
}
