import { describe, expect, it } from 'vitest';
import { parseStockmarketHistory, parseStockmarketItemNames } from '../src/backfill/stockmarket-schema';

describe('stockmarket.xin schema', () => {
  it('deduplicates and sorts item names from latest-status', () => {
    expect(parseStockmarketItemNames({
      item: null,
      data: [
        { item_name: 'redwood_lumber' },
        { item_name: 'arcane_log' },
        { item_name: 'redwood_lumber' },
      ],
    })).toEqual(['arcane_log', 'redwood_lumber']);
  });

  it('normalizes seconds, levels, and negative sentinels without inventing volume', () => {
    expect(parseStockmarketHistory({
      item: 'redwood_lumber',
      level: 0,
      history: [{
        item_name: 'redwood_lumber',
        level: 7,
        price_a: -1,
        price_b: 3820,
        price_p: -1,
        volume: 0,
        timestamp: 1788271560,
        timestamp_str: '2026-09-01T22:06:00+08:00',
      }],
    }, 'redwood_lumber')).toEqual([{
      itemName: 'redwood_lumber',
      level: 7,
      timestamp: 1788271560000,
      a: null,
      b: 3820,
      p: null,
      v: null,
    }]);
  });

  it('preserves legitimate zero volume when a price is present', () => {
    expect(parseStockmarketHistory({
      item: 'arcane_log',
      level: 0,
      history: [{
        item_name: 'arcane_log',
        level: 0,
        price_a: 1,
        price_b: null,
        price_p: null,
        volume: 0,
        timestamp: 1788271560,
      }],
    }, 'arcane_log')[0]?.v).toBe(0);
  });

  it('accepts only nullish, non-negative finite, or negative sentinel quote values', () => {
    const row = {
      item_name: 'arcane_log', level: 0, timestamp: 1788271560,
      price_a: 1, price_b: 2, price_p: 3, volume: 4,
    };
    const parse = (overrides: Record<string, unknown>) => parseStockmarketHistory({
      item: 'arcane_log', history: [{ ...row, ...overrides }],
    }, 'arcane_log')[0]!;

    for (const field of ['price_a', 'price_b', 'price_p', 'volume'] as const) {
      const absent = { ...row } as Record<string, unknown>;
      delete absent[field];
      expect(parseStockmarketHistory({ item: 'arcane_log', history: [absent] }, 'arcane_log')[0]).toMatchObject({
        a: field === 'price_a' ? null : 1,
        b: field === 'price_b' ? null : 2,
        p: field === 'price_p' ? null : 3,
        v: field === 'volume' ? null : 4,
      });
      expect(parse({ [field]: null })).toMatchObject({
        a: field === 'price_a' ? null : 1,
        b: field === 'price_b' ? null : 2,
        p: field === 'price_p' ? null : 3,
        v: field === 'volume' ? null : 4,
      });
      expect(parse({ [field]: -1 })).toMatchObject({
        a: field === 'price_a' ? null : 1,
        b: field === 'price_b' ? null : 2,
        p: field === 'price_p' ? null : 3,
        v: field === 'volume' ? null : 4,
      });
      for (const malformed of [Number.NaN, Number.POSITIVE_INFINITY, '1', {}]) {
        expect(() => parse({ [field]: malformed })).toThrow('Invalid stockmarket quote value');
      }
    }
  });

  it('caps latest-status and per-item history response rows', () => {
    expect(parseStockmarketItemNames({ data: Array.from({ length: 5000 }, (_, index) => ({ item_name: `item_${index}` })) })).toHaveLength(5000);
    expect(() => parseStockmarketItemNames({ data: Array.from({ length: 5001 }, (_, index) => ({ item_name: `item_${index}` })) })).toThrow('Invalid stockmarket item list');

    const history = Array.from({ length: 500 }, (_, timestamp) => ({
      item_name: 'arcane_log', level: 0, timestamp, price_a: 1, price_b: 2, price_p: 3, volume: 4,
    }));
    expect(parseStockmarketHistory({ item: 'arcane_log', history }, 'arcane_log')).toHaveLength(500);
    expect(() => parseStockmarketHistory({ item: 'arcane_log', history: [...history, history[0]] }, 'arcane_log')).toThrow('Invalid stockmarket history');
  });

  it('rejects unsafe names, mismatched items, and invalid timestamps', () => {
    expect(() => parseStockmarketItemNames({ data: [{ item_name: '../secret' }] })).toThrow();
    expect(() => parseStockmarketHistory({ history: [{
      item_name: 'arcane_log', level: 0, price_a: 1, price_b: 1,
      price_p: 1, volume: 1, timestamp: 1788271560,
    }] }, 'redwood_lumber')).toThrow();
    expect(() => parseStockmarketHistory({ history: [{
      item_name: 'redwood_lumber', level: 0, price_a: 1, price_b: 1,
      price_p: 1, volume: 1, timestamp: -1,
    }] }, 'redwood_lumber')).toThrow();
  });

  it('rejects malformed shapes, invalid levels, and unsafe timestamp multiplication', () => {
    expect(() => parseStockmarketItemNames(null)).toThrow();
    expect(() => parseStockmarketItemNames({ data: {} })).toThrow();
    expect(() => parseStockmarketHistory({ history: [] }, '../secret')).toThrow();
    expect(() => parseStockmarketHistory({ history: [{
      item_name: 'redwood_lumber', level: 1.5, timestamp: 1788271560,
    }] }, 'redwood_lumber')).toThrow();
    expect(() => parseStockmarketHistory({ history: [{
      item_name: 'redwood_lumber', level: 0, timestamp: Number.MAX_SAFE_INTEGER,
    }] }, 'redwood_lumber')).toThrow();
  });
});
