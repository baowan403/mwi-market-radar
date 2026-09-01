import type { MarketKey, Snapshot } from '../core/types';
import { isDerivedOpenableLootValue, type NormalizedStrategyGameData } from './game-data';
import { expandStrategyLiquidation, expectedStrategyDrop } from './liquidation';

export interface MarketPriceBook {
  ask(hrid: string, level?: number): number | null;
  bid(hrid: string, level?: number): number | null;
  average(hrid: string, level?: number): number | null;
  volume(hrid: string, level?: number): number | null;
  timestamp: number;
}

function marketValue(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
}

export function createMarketPriceBook(snapshot: Snapshot): MarketPriceBook {
  const quote = (hrid: string, level = 0) => (
    snapshot.quotes[`${hrid}::${level}` as MarketKey]
  );

  return {
    timestamp: snapshot.timestamp,
    ask: (hrid, level = 0) => marketValue(quote(hrid, level)?.a),
    bid: (hrid, level = 0) => marketValue(quote(hrid, level)?.b),
    average: (hrid, level = 0) => marketValue(quote(hrid, level)?.p),
    volume: (hrid, level = 0) => marketValue(quote(hrid, level)?.v),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createStrategyPriceBook(
  snapshot: Snapshot,
  data: NormalizedStrategyGameData,
): MarketPriceBook {
  const raw = createMarketPriceBook(snapshot);
  const shopCoinCosts = new Map<string, number>();
  for (const value of Object.values(data.shopItemDetailMap)) {
    const shop = record(value);
    const itemHrid = typeof shop?.itemHrid === 'string' ? shop.itemHrid : '';
    const costs = Array.isArray(shop?.costs) ? shop.costs : [];
    const coin = costs.map(record).find((cost) => cost?.itemHrid === '/items/coin');
    const count = marketValue(coin?.count);
    if (itemHrid && count !== null) shopCoinCosts.set(itemHrid, count);
  }
  const cache = new Map<string, number | null>();
  const resolve = (
    side: 'ask' | 'bid',
    hrid: string,
    level: number,
    visiting: Set<string>,
  ): number | null => {
    if (hrid === '/items/coin') return 1;
    if (hrid === '/items/cowbell') {
      const bagPrice = side === 'ask'
        ? raw.ask('/items/bag_of_10_cowbells')
        : raw.bid('/items/bag_of_10_cowbells');
      return bagPrice === null || bagPrice <= 0 ? 40_000 : bagPrice / 10;
    }
    const cacheKey = `${side}:${hrid}:${level}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
    if (visiting.has(cacheKey)) return null;
    const nextVisiting = new Set(visiting).add(cacheKey);
    if (
      level === 0
      && isDerivedOpenableLootValue(hrid, data)
    ) {
      if (side === 'bid') {
        const liquidation = expandStrategyLiquidation({
          itemHrid: hrid,
          unitsPerHour: 1,
          data,
          prices: { bid: (childHrid, childLevel = 0) => resolve('bid', childHrid, childLevel, nextVisiting) },
        });
        const value = liquidation.complete
          ? liquidation.flows.reduce((sum, flow) => (
            sum + flow.unitsPerHour * flow.unitPrice! * (flow.market ? 0.95 : 1)
          ), 0)
          : null;
        cache.set(cacheKey, value);
        return value;
      }
      // Ask remains a complete gross replacement-cost estimate; strategy liquidation uses bid only.
      const drops = data.openableLootDropMap[hrid];
      if (Array.isArray(drops) && drops.length > 0) {
        let total = 0;
        for (const drop of drops) {
          const expected = expectedStrategyDrop(drop);
          if (expected === null || !data.itemsByHrid.has(expected.itemHrid)) {
            cache.set(cacheKey, null);
            return null;
          }
          const price = resolve(side, expected.itemHrid, 0, nextVisiting);
          if (price === null) {
            cache.set(cacheKey, null);
            return null;
          }
          total += price * expected.multiplier;
        }
        cache.set(cacheKey, total);
        return total;
      }
    }
    const market = side === 'ask' ? raw.ask(hrid, level) : raw.bid(hrid, level);
    if (side === 'ask' && level === 0) {
      const shop = shopCoinCosts.get(hrid);
      const value = shop === undefined ? market : market === null ? shop : Math.min(market, shop);
      cache.set(cacheKey, value);
      return value;
    }
    cache.set(cacheKey, market);
    return market;
  };
  return {
    timestamp: raw.timestamp,
    ask: (hrid, level = 0) => resolve('ask', hrid, level, new Set()),
    bid: (hrid, level = 0) => resolve('bid', hrid, level, new Set()),
    average: raw.average,
    volume: raw.volume,
  };
}
