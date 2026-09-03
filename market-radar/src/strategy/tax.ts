/**
 * MWI 市場稅率集中規則引擎
 * 官方現行改版後市場交易稅率為 5% (0.05)。
 * 點金與特定免稅物品手續費為 0% (factor = 1.0)。
 */

export const STANDARD_MARKET_TAX_RATE = 0.05;
export const STANDARD_SELL_TAX_FACTOR = 1 - STANDARD_MARKET_TAX_RATE; // 0.95

export function marketTaxFactor(itemHrid: string, taxable = true): number {
  if (!taxable) return 1;
  if (itemHrid === '/items/coin') return 1;
  return STANDARD_SELL_TAX_FACTOR;
}
