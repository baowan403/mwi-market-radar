import { describe, expect, it } from 'vitest';
import { createMarketPriceBook } from '../src/strategy/price-book';
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
});
