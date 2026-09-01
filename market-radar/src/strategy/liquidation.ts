import type { NormalizedStrategyGameData } from './game-data';
import type { StrategyFlow } from './types';

const COIN_HRID = '/items/coin';
const CURRENCY_CATEGORY_HRID = '/item_categories/currency';

export interface StrategyLiquidationPrices {
  bid(itemHrid: string, enhancementLevel?: number): number | null;
}

export interface StrategyLiquidationResult {
  complete: boolean;
  flows: StrategyFlow[];
}

interface LiquidationOptions {
  itemHrid: string;
  unitsPerHour: number;
  data: NormalizedStrategyGameData;
  prices: StrategyLiquidationPrices;
}

function finiteNonnegative(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function incomplete(): StrategyLiquidationResult {
  return { complete: false, flows: [] };
}

export function expectedStrategyDrop(drop: unknown): { itemHrid: string; multiplier: number } | null {
  if (drop === null || typeof drop !== 'object' || Array.isArray(drop)) return null;
  const value = drop as Record<string, unknown>;
  if (
    typeof value.itemHrid !== 'string'
    || !value.itemHrid.startsWith('/items/')
    || !finiteNonnegative(value.dropRate as number)
    || !finiteNonnegative(value.minCount as number)
    || !finiteNonnegative(value.maxCount as number)
    || (value.maxCount as number) < (value.minCount as number)
  ) return null;
  return {
    itemHrid: value.itemHrid,
    multiplier: (value.dropRate as number) * (((value.minCount as number) + (value.maxCount as number)) / 2),
  };
}

function expand(
  options: LiquidationOptions,
  visiting: ReadonlySet<string>,
): StrategyLiquidationResult {
  const { itemHrid, unitsPerHour, data, prices } = options;
  if (!finiteNonnegative(unitsPerHour) || visiting.has(itemHrid)) return incomplete();
  if (itemHrid === COIN_HRID) {
    return {
      complete: true,
      flows: [{ itemHrid, enhancementLevel: 0, unitsPerHour, unitPrice: 1, market: false }],
    };
  }
  const item = data.itemsByHrid.get(itemHrid);
  if (!item) return incomplete();
  if (item.isTradable === true) {
    const unitPrice = prices.bid(itemHrid);
    return finiteNonnegative(unitPrice)
      ? { complete: true, flows: [{ itemHrid, enhancementLevel: 0, unitsPerHour, unitPrice, market: true }] }
      : incomplete();
  }
  if (item.categoryHrid === CURRENCY_CATEGORY_HRID) {
    const unitPrice = prices.bid(itemHrid);
    return finiteNonnegative(unitPrice)
      ? { complete: true, flows: [{ itemHrid, enhancementLevel: 0, unitsPerHour, unitPrice, market: false }] }
      : incomplete();
  }
  const drops = data.openableLootDropMap[itemHrid];
  if (!Array.isArray(drops) || drops.length === 0) return incomplete();
  const nextVisiting = new Set(visiting).add(itemHrid);
  const flows: StrategyFlow[] = [];
  for (const drop of drops) {
    const expected = expectedStrategyDrop(drop);
    if (expected === null) return incomplete();
    const expanded = expand({
      itemHrid: expected.itemHrid,
      unitsPerHour: unitsPerHour * expected.multiplier,
      data,
      prices,
    }, nextVisiting);
    if (!expanded.complete) return incomplete();
    flows.push(...expanded.flows);
  }
  const aggregated = new Map<string, StrategyFlow>();
  for (const flow of flows) {
    const key = `${flow.itemHrid}::${flow.enhancementLevel}::${flow.market}`;
    const current = aggregated.get(key);
    if (!current) aggregated.set(key, { ...flow });
    else if (current.unitPrice === flow.unitPrice) current.unitsPerHour += flow.unitsPerHour;
    else return incomplete();
  }
  return {
    complete: true,
    flows: [...aggregated.values()]
      .filter((flow) => flow.unitsPerHour > 1e-10)
      .sort((left, right) => left.itemHrid.localeCompare(right.itemHrid)),
  };
}

export function expandStrategyLiquidation(options: LiquidationOptions): StrategyLiquidationResult {
  return expand(options, new Set());
}
