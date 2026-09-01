import { describe, expect, it } from 'vitest';
import { createMarketPriceBook, createStrategyPriceBook } from '../src/strategy/price-book';
import type { NormalizedStrategyGameData } from '../src/strategy/game-data';
import type { Snapshot } from '../src/core/types';

const snapshot: Snapshot = {
  timestamp: 1_788_220_800_000,
  quotes: {
    '/items/log::0': { a: 100, b: 90, p: 95, v: 1_000 },
    '/items/plank::0': { a: 270, b: 250, p: 260, v: 500 },
    '/items/gloves::7': { a: 55_000_000, b: 50_000_000, p: 52_000_000, v: 2 },
    '/items/gloves::10': { a: 150_000_000, b: 140_000_000, p: 145_000_000, v: 1 },
    '/items/missing::0': { a: null, b: null, p: null, v: null },
  },
};

describe('strategy market price book', () => {
  it('uses conservative sides and preserves enhancement identity', () => {
    const book = createMarketPriceBook(snapshot);

    expect(book.timestamp).toBe(snapshot.timestamp);
    expect(book.ask('/items/log')).toBe(100);
    expect(book.bid('/items/plank')).toBe(250);
    expect(book.bid('/items/gloves', 7)).toBe(50_000_000);
    expect(book.bid('/items/gloves', 10)).toBe(140_000_000);
  });

  it('preserves missing and invalid values as null', () => {
    const book = createMarketPriceBook(snapshot);

    expect(book.ask('/items/missing')).toBeNull();
    expect(book.bid('/items/unknown')).toBeNull();
    expect(book.average('/items/missing')).toBeNull();
    expect(book.volume('/items/missing')).toBeNull();
  });

  it('uses complete gross loot asks, net liquidation bids, and capped shop asks', () => {
    const extended: Snapshot = {
      ...snapshot,
      quotes: {
        ...snapshot.quotes,
        '/items/apple::0': { a: 10, b: 8, p: 9, v: 100 },
        '/items/tool::0': { a: 6_000, b: 5_500, p: 5_750, v: 10 },
      },
    };
    const items = new Map<string, unknown>([
      ['/items/crate', { hrid: '/items/crate', name: 'Crate', categoryHrid: '/item_categories/loot' }],
      ['/items/apple', { hrid: '/items/apple', name: 'Apple', categoryHrid: '/item_categories/resource', isTradable: true }],
      ['/items/tool', { hrid: '/items/tool', name: 'Tool', categoryHrid: '/item_categories/equipment', isTradable: true }],
    ]);
    const data = {
      itemsByHrid: items,
      openableLootDropMap: {
        '/items/crate': [
          { itemHrid: '/items/apple', dropRate: 1, minCount: 1, maxCount: 3 },
        ],
      },
      shopItemDetailMap: {
        '/shop_items/tool': { itemHrid: '/items/tool', costs: [{ itemHrid: '/items/coin', count: 5_000 }] },
      },
    } as unknown as NormalizedStrategyGameData;
    const book = createStrategyPriceBook(extended, data);

    expect(book.ask('/items/crate')).toBe(20);
    expect(book.bid('/items/crate')).toBe(15.2);
    expect(book.ask('/items/tool')).toBe(5_000);
    expect(book.bid('/items/tool')).toBe(5_500);
  });

  it('values cowbells from the tradable bag of ten like Milkonomy', () => {
    const extended: Snapshot = {
      ...snapshot,
      quotes: {
        ...snapshot.quotes,
        '/items/bag_of_10_cowbells::0': { a: 1_125_000, b: 1_115_000, p: 1_124_269, v: 0 },
      },
    };
    const items = new Map<string, unknown>([
      ['/items/medium_artisans_crate', {
        hrid: '/items/medium_artisans_crate',
        name: 'Medium Crate',
        categoryHrid: '/item_categories/loot',
      }],
      ['/items/cowbell', { hrid: '/items/cowbell', name: 'Cowbell', categoryHrid: '/item_categories/currency' }],
      ['/items/bag_of_10_cowbells', {
        hrid: '/items/bag_of_10_cowbells',
        name: 'Cowbell Bag',
        categoryHrid: '/item_categories/loot',
        isTradable: true,
      }],
    ]);
    const data = {
      itemsByHrid: items,
      openableLootDropMap: {
        '/items/medium_artisans_crate': [
          { itemHrid: '/items/cowbell', dropRate: 0.1, minCount: 3, maxCount: 5 },
          { itemHrid: '/items/cowbell', dropRate: 0.01, minCount: 20, maxCount: 40 },
        ],
      },
      shopItemDetailMap: {},
    } as unknown as NormalizedStrategyGameData;
    const book = createStrategyPriceBook(extended, data);

    expect(book.ask('/items/cowbell')).toBe(112_500);
    expect(book.bid('/items/cowbell')).toBe(111_500);
    expect(book.bid('/items/medium_artisans_crate')).toBe(78_050);
  });

  it('uses Milkonomy cowbell fallback when the bag has no quote', () => {
    const items = new Map<string, unknown>([
      ['/items/cowbell', { hrid: '/items/cowbell', categoryHrid: '/item_categories/currency' }],
    ]);
    const data = {
      itemsByHrid: items,
      openableLootDropMap: {},
      shopItemDetailMap: {},
    } as unknown as NormalizedStrategyGameData;
    const book = createStrategyPriceBook(snapshot, data);

    expect(book.ask('/items/cowbell')).toBe(40_000);
    expect(book.bid('/items/cowbell')).toBe(40_000);
  });
});
