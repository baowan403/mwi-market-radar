import { describe, expect, it } from 'vitest';
import { marketCapacity } from '../src/strategy/liquidity';
import type { MarketKey, Snapshot } from '../src/core/types';

const HOUR = 3_600_000;
const KEY = '/items/output::0' as MarketKey;

function history(hours: number, volume: (index: number) => number | null = () => 100): Snapshot[] {
  return Array.from({ length: hours }, (_, index) => ({
    timestamp: index * HOUR,
    quotes: {
      [KEY]: { a: 110, b: 100, p: 105, v: volume(index) },
    },
  }));
}

describe('robust hourly market capacity', () => {
  it('uses five percent of the smaller 3d/7d hourly median', () => {
    const result = marketCapacity(KEY, history(169, (index) => index >= 97 ? 120 : 100));

    expect(result.samples3d).toBe(72);
    expect(result.samples7d).toBe(168);
    expect(result.median3d).toBe(120);
    expect(result.median7d).toBe(100);
    expect(result.safeUnitsPerHour).toBe(5);
    expect(result.sufficient).toBe(true);
  });

  it('does not let one hourly spike or missing samples inflate capacity', () => {
    const result = marketCapacity(KEY, history(169, (index) => index === 168 ? 10_000 : 100));
    expect(result.median3d).toBe(100);
    expect(result.median7d).toBe(100);
    expect(result.safeUnitsPerHour).toBe(5);

    const insufficient = marketCapacity(KEY, history(20));
    expect(insufficient.sufficient).toBe(false);
    expect(insufficient.safeUnitsPerHour).toBeNull();
  });

  it('keeps zero volume and reports current quote sides separately', () => {
    const zero = history(169, () => 0);
    zero.at(-1)!.quotes[KEY] = { a: 110, b: null, p: null, v: 0 };
    const result = marketCapacity(KEY, zero);

    expect(result.median3d).toBe(0);
    expect(result.safeUnitsPerHour).toBe(0);
    expect(result.askAvailable).toBe(true);
    expect(result.bidAvailable).toBe(false);
  });
});
