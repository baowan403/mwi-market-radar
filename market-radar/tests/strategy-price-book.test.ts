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

  it('values loot from contained drops and caps shop asks at fixed coin cost', () => {
    const extended: Snapshot = {
      ...snapshot,
      quotes: {
        ...snapshot.quotes,
        '/items/apple::0': { a: 10, b: 8, p: 9, v: 100 },
        '/items/tool::0': { a: 6_000, b: 5_500, p: 5_750, v: 10 },
      },
    };
    const items = new Map<string, unknown>([
      ['/items/crate', { hrid: '/items/crate', categoryHrid: '/item_categories/loot' }],
      ['/items/apple', { hrid: '/items/apple', categoryHrid: '/item_categories/resource' }],
      ['/items/tool', { hrid: '/items/tool', categoryHrid: '/item_categories/equipment' }],
    ]);
    const data = {
      itemsByHrid: items,
      openableLootDropMap: {
        '/items/crate': [
          { itemHrid: '/items/apple', dropRate: 1, minCount: 1, maxCount: 3 },
          { itemHrid: '/items/unknown_drop', dropRate: 1, minCount: 1, maxCount: 1 },
        ],
      },
      shopItemDetailMap: {
        '/shop_items/tool': { itemHrid: '/items/tool', costs: [{ itemHrid: '/items/coin', count: 5_000 }] },
      },
    } as unknown as NormalizedStrategyGameData;
    const book = createStrategyPriceBook(extended, data);

    expect(book.ask('/items/crate')).toBe(20);
    expect(book.bid('/items/crate')).toBe(16);
    expect(book.ask('/items/tool')).toBe(5_000);
    expect(book.bid('/items/tool')).toBe(5_500);
  });
});
