import { describe, expect, it } from 'vitest';
import type { MarketKey, Snapshot } from '../src/core/types';
import {
  aggregateDailySummary,
  dailySummaryToSnapshot,
  mergeDailySummary,
} from '../src/cloud/daily-summary';

const DAY = Date.parse('2026-09-01T00:00:00.000Z');
const HOUR = 3_600_000;
const KEY = '/items/test::0' as MarketKey;

function snapshot(timestamp: number, quote: Snapshot['quotes'][MarketKey]): Snapshot {
  return { timestamp, quotes: { [KEY]: quote } };
}

describe('cloud daily OHLCV summaries', () => {
  it('aggregates sorted OHLC, close sides, volume, samples, and quote quality', () => {
    const summary = aggregateDailySummary([
      snapshot(DAY + 2 * HOUR, { a: 130, b: 110, p: 120, v: 30 }),
      snapshot(DAY, { a: 110, b: 90, p: 100, v: 10 }),
      snapshot(DAY + HOUR, { a: 120, b: 100, p: 110, v: 20 }),
    ]);

    expect(summary).toEqual({
      schemaVersion: 1,
      date: '2026-09-01',
      timestamp: DAY + 2 * HOUR,
      quotes: {
        [KEY]: {
          o: 100, h: 120, l: 100, c: 120, a: 130, b: 110,
          v: 60, samples: 3, priceSamples: 3, askSamples: 3, bidSamples: 3,
          quality: { official: 3, midpoint: 0, 'ask-only': 0, 'bid-only': 0, missing: 0 },
        },
      },
    });
  });

  it('counts one-sided and missing quality without inventing close sides', () => {
    const summary = aggregateDailySummary([
      snapshot(DAY, { a: 100, b: null, p: null, v: 4 }),
      snapshot(DAY + HOUR, { a: null, b: null, p: null, v: null }),
    ]);
    expect(summary.quotes[KEY]).toMatchObject({
      o: 100, h: 100, l: 100, c: 100, a: null, b: null,
      v: 4, samples: 2, priceSamples: 1, askSamples: 1, bidSamples: 0,
      quality: { official: 0, midpoint: 0, 'ask-only': 1, 'bid-only': 0, missing: 1 },
    });
  });

  it('merges an incremental snapshot to the same result as full aggregation', () => {
    const first = snapshot(DAY, { a: 110, b: 90, p: 100, v: 10 });
    const second = snapshot(DAY + HOUR, { a: 120, b: 100, p: 110, v: 20 });
    expect(mergeDailySummary(aggregateDailySummary([first]), second)).toEqual(
      aggregateDailySummary([first, second]),
    );
  });

  it('converts the daily close to a strategy snapshot with hourly average volume', () => {
    const summary = aggregateDailySummary([
      snapshot(DAY, { a: 110, b: 90, p: 100, v: 10 }),
      snapshot(DAY + HOUR, { a: 120, b: 100, p: 110, v: 20 }),
    ]);
    expect(dailySummaryToSnapshot(summary)).toEqual({
      timestamp: DAY + HOUR,
      quotes: { [KEY]: { a: 120, b: 100, p: 110, v: 15 } },
    });
  });

  it('rejects snapshots from different UTC dates', () => {
    expect(() => aggregateDailySummary([
      snapshot(DAY, { a: 1, b: 1, p: 1, v: 1 }),
      snapshot(DAY + 24 * HOUR, { a: 2, b: 2, p: 2, v: 2 }),
    ])).toThrow(/date|day/i);
  });
});
