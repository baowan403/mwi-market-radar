import { describe, expect, it } from 'vitest';
import { priceBasis } from '../src/core/price';
import {
  calculateChange,
  calculateVolatilityPct,
  periodHours,
  volumeMultiple,
} from '../src/core/trends';
import type { Snapshot } from '../src/core/types';

const HOUR = 3_600_000;
const key = '/items/test::0' as const;

function snapshot(timestamp: number, quote: Partial<Snapshot['quotes'][typeof key]> = {}): Snapshot {
  return {
    timestamp,
    quotes: {
      [key]: { a: null, b: null, p: null, v: null, ...quote },
    },
  };
}

describe('period windows', () => {
  it('maps 1d, 3d, and 7d to exact hour counts', () => {
    expect(periodHours('1d')).toBe(24);
    expect(periodHours('3d')).toBe(72);
    expect(periodHours('7d')).toBe(168);
  });
});

describe('calculateChange', () => {
  it('sorts shuffled snapshots, chooses the nearest old sample, and reports quality metadata', () => {
    const result = calculateChange(key, 24, [
      snapshot(25 * HOUR, { p: 110 }),
      snapshot(0, { a: 100, b: 100 }),
    ]);

    expect(result).toEqual({
      pct: 10,
      elapsedHours: 25,
      samples: 2,
      latestTimestamp: 25 * HOUR,
      baseTimestamp: 0,
      latestQuality: 'official',
      baseQuality: 'midpoint',
    });
  });

  it('does not use the latest value as its own baseline', () => {
    const result = calculateChange(key, 24, [snapshot(25 * HOUR, { p: 110 })]);

    expect(result.pct).toBeNull();
    expect(result.elapsedHours).toBeNull();
    expect(result.samples).toBe(1);
    expect(result.latestTimestamp).toBe(25 * HOUR);
    expect(result.baseTimestamp).toBeNull();
    expect(result.latestQuality).toBe('official');
    expect(result.baseQuality).toBeNull();
  });

  it('accepts an actual 25-hour interval but rejects 10-hour and 40-hour intervals for 1d', () => {
    const accepted = calculateChange(key, periodHours('1d'), [
      snapshot(0, { p: 100 }),
      snapshot(25 * HOUR, { p: 110 }),
    ]);
    const tooShort = calculateChange(key, periodHours('1d'), [
      snapshot(0, { p: 100 }),
      snapshot(10 * HOUR, { p: 110 }),
    ]);
    const tooFar = calculateChange(key, periodHours('1d'), [
      snapshot(0, { p: 100 }),
      snapshot(40 * HOUR, { p: 110 }),
    ]);

    expect(accepted.pct).toBe(10);
    expect(accepted.elapsedHours).toBe(25);
    expect(tooShort).toMatchObject({ pct: null, elapsedHours: 10, samples: 2 });
    expect(tooFar).toMatchObject({ pct: null, elapsedHours: 40, samples: 2 });
  });

  it('skips missing snapshots instead of treating a gap as a zero price', () => {
    const result = calculateChange(key, 24, [
      snapshot(0, { p: 100 }),
      snapshot(12 * HOUR),
      snapshot(25 * HOUR, { p: 110 }),
    ]);

    expect(result).toMatchObject({ pct: 10, elapsedHours: 25, samples: 2 });
  });

  it('returns null percentage for a zero baseline while retaining timing data', () => {
    const result = calculateChange(key, 24, [
      snapshot(0, { p: 0 }),
      snapshot(25 * HOUR, { p: 110 }),
    ]);

    expect(result).toMatchObject({
      pct: null,
      elapsedHours: 25,
      samples: 2,
      latestTimestamp: 25 * HOUR,
      baseTimestamp: 0,
      latestQuality: 'official',
      baseQuality: 'official',
    });
  });

  it('deduplicates equal timestamps deterministically and counts one sample', () => {
    const firstOrder = calculateChange(key, 24, [
      snapshot(0, { p: 100 }),
      snapshot(0, { p: 90 }),
      snapshot(24 * HOUR, { p: 110 }),
    ]);
    const shuffledOrder = calculateChange(key, 24, [
      snapshot(24 * HOUR, { p: 110 }),
      snapshot(0, { p: 90 }),
      snapshot(0, { p: 100 }),
    ]);

    expect(firstOrder.samples).toBe(2);
    expect(shuffledOrder).toEqual(firstOrder);
  });
});

describe('calculateVolatilityPct', () => {
  it('calculates sample standard deviation of adjacent log returns', () => {
    const volatility = calculateVolatilityPct(key, [
      snapshot(2 * HOUR, { p: 121 }),
      snapshot(0, { p: 100 }),
      snapshot(HOUR, { p: 110 }),
    ]);
    const first = Math.log(110 / 100);
    const second = Math.log(121 / 110);
    const mean = (first + second) / 2;
    const expected = Math.sqrt(((first - mean) ** 2 + (second - mean) ** 2) / 1) * 100;

    expect(volatility).toBeCloseTo(expected);
  });

  it('requires at least three positive prices and ignores missing or zero values', () => {
    expect(
      calculateVolatilityPct(key, [snapshot(0, { p: 100 }), snapshot(HOUR, { p: 110 })]),
    ).toBeNull();
    expect(
      calculateVolatilityPct(key, [
        snapshot(0, { p: 0 }),
        snapshot(HOUR, { p: 100 }),
        snapshot(2 * HOUR, { p: 110 }),
      ]),
    ).toBeNull();
  });
});

describe('volumeMultiple', () => {
  it('divides current volume by the median positive baseline', () => {
    expect(volumeMultiple(30, [10, 20, 30, 40, 100])).toBe(1);
    expect(volumeMultiple(0, [10, 20, 30])).toBe(0);
  });

  it('ignores null and zero baselines and rejects invalid or empty data', () => {
    expect(volumeMultiple(10, [null, 0, 5, 15])).toBe(1);
    expect(volumeMultiple(null, [10])).toBeNull();
    expect(volumeMultiple(-1, [10])).toBeNull();
    expect(volumeMultiple(10, [null, 0])).toBeNull();
  });
});

describe('price basis contract used by trends', () => {
  it('preserves zero as a basis value even though zero cannot be a change baseline', () => {
    expect(priceBasis({ a: null, b: null, p: 0, v: null })).toEqual({
      value: 0,
      quality: 'official',
    });
  });
});
