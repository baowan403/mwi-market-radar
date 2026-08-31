import marketplace from './fixtures/marketplace.json';
import { describe, expect, it } from 'vitest';
import { parseOfficialSnapshot } from '../src/core/market-schema';

describe('parseOfficialSnapshot', () => {
  it('normalizes seconds timestamps to milliseconds and preserves millisecond timestamps', () => {
    const seconds = parseOfficialSnapshot({
      timestamp: 1_787_645_160,
      marketData: { '/items/test': { '7': { p: 100 } } },
    });
    const milliseconds = parseOfficialSnapshot({
      timestamp: 1_787_645_160_000,
      marketData: { '/items/test': { '7': { p: 100 } } },
    });

    expect(seconds.timestamp).toBe(1_787_645_160_000);
    expect(milliseconds.timestamp).toBe(1_787_645_160_000);
  });

  it('builds a market key from an item hrid and enhancement level', () => {
    const result = parseOfficialSnapshot({
      timestamp: 1_787_645_160,
      marketData: { '/items/test': { '7': { p: 100 } } },
    });

    expect(result.quotes['/items/test::7']).toEqual({ a: null, b: null, p: 100, v: null });
  });

  it('normalizes invalid quote fields to null while preserving zero and positive numbers', () => {
    const result = parseOfficialSnapshot({
      timestamp: 1_787_645_160,
      marketData: {
        '/items/test': {
          '0': {
            a: -1,
            b: 0,
            p: Number.NaN,
            v: 42,
            ignored: 'extra',
          },
          '1': { a: Infinity, b: '100', p: null, v: -2 },
        },
      },
    });

    expect(result.quotes['/items/test::0']).toEqual({ a: null, b: 0, p: null, v: 42 });
    expect(result.quotes['/items/test::1']).toEqual({ a: null, b: null, p: null, v: null });
  });

  it('rejects a missing, non-numeric, negative, fractional, or non-finite timestamp', () => {
    const invalidTimestamps: unknown[] = [undefined, '1787645160', -1, 1.5, Number.NaN, Infinity];

    for (const timestamp of invalidTimestamps) {
      expect(() =>
        parseOfficialSnapshot({
          timestamp,
          marketData: { '/items/test': { '0': { p: 1 } } },
        }),
      ).toThrowError('Invalid timestamp');
    }
  });

  it('rejects a missing or non-object marketData value', () => {
    for (const marketData of [undefined, null, [], 'bad', 1]) {
      expect(() => parseOfficialSnapshot({ timestamp: 1_787_645_160, marketData })).toThrowError(
        'Invalid marketData',
      );
    }
  });

  it('rejects snapshots with no valid quote entries', () => {
    expect(() => parseOfficialSnapshot({ timestamp: 1_787_645_160, marketData: {} })).toThrowError(
      'Snapshot contains no quotes',
    );
    expect(() =>
      parseOfficialSnapshot({
        timestamp: 1_787_645_160,
        marketData: {
          '/not-items/test': { '0': { p: 1 } },
          '/items/test': { '-1': { p: 1 }, '1.5': { p: 1 }, bad: { p: 1 } },
        },
      }),
    ).toThrowError('Snapshot contains no quotes');
  });

  it('skips non-item hrids, invalid levels, and non-object quotes while retaining valid entries', () => {
    const result = parseOfficialSnapshot({
      timestamp: 1_787_645_160,
      marketData: {
        '/not-items/test': { '0': { p: 1 } },
        '/items/test': {
          '-1': { p: 1 },
          '1.5': { p: 1 },
          nope: { p: 1 },
          '2': null,
          '3': 'not-a-quote',
          '4': { p: 4 },
        },
      },
    });

    expect(Object.keys(result.quotes)).toEqual(['/items/test::4']);
    expect(result.quotes['/items/test::4']?.p).toBe(4);
  });

  it('ignores unknown fields and parses the public marketplace fixture', () => {
    const result = parseOfficialSnapshot({ ...marketplace, unknown: { private: false } });

    expect(result.timestamp).toBe(1_787_645_160_000);
    expect(Object.keys(result.quotes)).toHaveLength(3);
    expect(result.quotes['/items/cowbell::0']).toEqual({ a: 100, b: 99, p: 99.5, v: 42 });
  });
});
