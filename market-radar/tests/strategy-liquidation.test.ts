import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import type { MarketKey, Snapshot } from '../src/core/types';
import { normalizeStrategyGameData, type NormalizedStrategyGameData } from '../src/strategy/game-data';
import { expandStrategyLiquidation } from '../src/strategy/liquidation';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import type { StrategyItemDetail } from '../src/strategy/types';

const data = normalizeStrategyGameData(strategyDataJson);

function snapshot(overrides: Partial<Record<string, number | null>> = {}): Snapshot {
  const bids: Record<string, number | null> = {
    '/items/bag_of_10_cowbells': 1_000,
    '/items/shard_of_protection': 10,
    '/items/pearl': 20,
    '/items/amber': 30,
    '/items/garnet': 40,
    '/items/jade': 50,
    '/items/amethyst': 60,
    '/items/moonstone': 70,
    ...overrides,
  };
  return {
    timestamp: 1,
    quotes: Object.fromEntries(Object.entries(bids).map(([hrid, bid]) => [
      `${hrid}::0` as MarketKey,
      { a: bid, b: bid, p: bid, v: 1_000 },
    ])),
  };
}

function extendData(
  items: StrategyItemDetail[],
  drops: NormalizedStrategyGameData['openableLootDropMap'],
): NormalizedStrategyGameData {
  const itemDetailMap = { ...data.itemDetailMap };
  const itemsByHrid = new Map(data.itemsByHrid);
  for (const item of items) {
    itemDetailMap[item.hrid] = item;
    itemsByHrid.set(item.hrid, item);
  }
  return {
    ...data,
    itemDetailMap,
    itemsByHrid,
    openableLootDropMap: { ...data.openableLootDropMap, ...drops },
  };
}

describe('complete openable-loot liquidation', () => {
  it('expands the real medium crate into exact currency and tradable leaf quantities', () => {
    const prices = createStrategyPriceBook(snapshot(), data);
    const result = expandStrategyLiquidation({
      itemHrid: '/items/medium_artisans_crate', unitsPerHour: 1, data, prices,
    });

    expect(result.complete).toBe(true);
    expect(result.flows).toHaveLength(9);
    expect(result.flows.find((flow) => flow.itemHrid === '/items/coin')).toMatchObject({
      unitsPerHour: 27_000, unitPrice: 1, market: false,
    });
    expect(result.flows.find((flow) => flow.itemHrid === '/items/cowbell')).toMatchObject({
      unitsPerHour: 0.7, unitPrice: 100, market: false,
    });
    expect(result.flows.find((flow) => flow.itemHrid === '/items/shard_of_protection')).toMatchObject({
      unitsPerHour: 4.375, unitPrice: 10, market: true,
    });
    expect(result.flows.find((flow) => flow.itemHrid === '/items/amber')?.unitsPerHour).toBeCloseTo(0.19995);
    expect(prices.bid('/items/medium_artisans_crate')).toBeCloseTo(27_147.661075);
  });

  it('recursively expands nested nontradable loot and aggregates equal leaves', () => {
    const nestedData = extendData([
      { hrid: '/items/nested_outer', name: 'Outer', categoryHrid: '/item_categories/loot', isTradable: false },
      { hrid: '/items/nested_inner', name: 'Inner', categoryHrid: '/item_categories/loot', isTradable: false },
    ], {
      '/items/nested_outer': [
        { itemHrid: '/items/nested_inner', dropRate: 1, minCount: 2, maxCount: 2 },
        { itemHrid: '/items/pearl', dropRate: 1, minCount: 1, maxCount: 1 },
      ],
      '/items/nested_inner': [
        { itemHrid: '/items/pearl', dropRate: 0.5, minCount: 2, maxCount: 4 },
      ],
    });
    const prices = createStrategyPriceBook(snapshot(), nestedData);
    const result = expandStrategyLiquidation({
      itemHrid: '/items/nested_outer', unitsPerHour: 1, data: nestedData, prices,
    });

    expect(result).toEqual({
      complete: true,
      flows: [{
        itemHrid: '/items/pearl', enhancementLevel: 0,
        unitsPerHour: 4, unitPrice: 20, market: true,
      }],
    });
    expect(prices.bid('/items/nested_outer')).toBe(76);
  });

  it('fails closed when any required child quote is missing', () => {
    const prices = createStrategyPriceBook(snapshot({ '/items/moonstone': null }), data);
    const result = expandStrategyLiquidation({
      itemHrid: '/items/medium_artisans_crate', unitsPerHour: 1, data, prices,
    });

    expect(result).toEqual({ complete: false, flows: [] });
    expect(prices.bid('/items/medium_artisans_crate')).toBeNull();
  });

  it('fails closed on recursive loot cycles', () => {
    const cyclicData = extendData([
      { hrid: '/items/cyclic_loot', name: 'Cycle', categoryHrid: '/item_categories/loot', isTradable: false },
    ], {
      '/items/cyclic_loot': [
        { itemHrid: '/items/cyclic_loot', dropRate: 1, minCount: 1, maxCount: 1 },
      ],
    });
    const prices = createStrategyPriceBook(snapshot(), cyclicData);

    expect(expandStrategyLiquidation({
      itemHrid: '/items/cyclic_loot', unitsPerHour: 1, data: cyclicData, prices,
    })).toEqual({ complete: false, flows: [] });
    expect(prices.bid('/items/cyclic_loot')).toBeNull();
  });

  it('fails closed on missing root metadata and invalid drop arithmetic for both sides', () => {
    const missingRootData = {
      ...data,
      openableLootDropMap: {
        ...data.openableLootDropMap,
        '/items/missing_root': [
          { itemHrid: '/items/pearl', dropRate: 1, minCount: 1, maxCount: 1 },
        ],
      },
    };
    const invalidDropData = extendData([
      { hrid: '/items/invalid_drop', name: 'Invalid', categoryHrid: '/item_categories/loot', isTradable: false },
    ], {
      '/items/invalid_drop': [
        { itemHrid: '/items/pearl', dropRate: Number.NaN, minCount: 1, maxCount: 1 },
      ],
    });
    const unknownChildData = extendData([
      { hrid: '/items/unknown_child_crate', name: 'Unknown Child', categoryHrid: '/item_categories/loot', isTradable: false },
    ], {
      '/items/unknown_child_crate': [
        { itemHrid: '/items/quoted_without_metadata', dropRate: 1, minCount: 1, maxCount: 1 },
      ],
    });
    const malformedDropData = extendData([
      { hrid: '/items/malformed_drop', name: 'Malformed', categoryHrid: '/item_categories/loot', isTradable: false },
    ], {
      '/items/malformed_drop': [null] as never,
    });
    const missingRootPrices = createStrategyPriceBook(snapshot(), missingRootData);
    const invalidDropPrices = createStrategyPriceBook(snapshot(), invalidDropData);
    const unknownChildPrices = createStrategyPriceBook(
      snapshot({ '/items/quoted_without_metadata': 100 }),
      unknownChildData,
    );
    const malformedDropPrices = createStrategyPriceBook(snapshot(), malformedDropData);

    expect(missingRootPrices.ask('/items/missing_root')).toBeNull();
    expect(missingRootPrices.bid('/items/missing_root')).toBeNull();
    expect(invalidDropPrices.ask('/items/invalid_drop')).toBeNull();
    expect(invalidDropPrices.bid('/items/invalid_drop')).toBeNull();
    expect(unknownChildPrices.ask('/items/unknown_child_crate')).toBeNull();
    expect(unknownChildPrices.bid('/items/unknown_child_crate')).toBeNull();
    expect(expandStrategyLiquidation({
      itemHrid: '/items/malformed_drop', unitsPerHour: 1,
      data: malformedDropData, prices: malformedDropPrices,
    })).toEqual({ complete: false, flows: [] });
    expect(malformedDropPrices.ask('/items/malformed_drop')).toBeNull();
    expect(malformedDropPrices.bid('/items/malformed_drop')).toBeNull();
  });

  it('keeps any tradable openable item as a market-backed root', () => {
    const tradableData = extendData([
      { hrid: '/items/tradable_openable', name: 'Tradable', categoryHrid: '/item_categories/loot', isTradable: true },
    ], {
      '/items/tradable_openable': [
        { itemHrid: '/items/missing_child', dropRate: 1, minCount: 1, maxCount: 1 },
      ],
    });
    const prices = createStrategyPriceBook(snapshot({ '/items/tradable_openable': 500 }), tradableData);

    expect(expandStrategyLiquidation({
      itemHrid: '/items/tradable_openable', unitsPerHour: 2, data: tradableData, prices,
    })).toEqual({
      complete: true,
      flows: [{
        itemHrid: '/items/tradable_openable', enhancementLevel: 0,
        unitsPerHour: 2, unitPrice: 500, market: true,
      }],
    });
    expect(prices.bid('/items/tradable_openable')).toBe(500);
  });
});
