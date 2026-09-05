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

describe('daily traded-volume market capacity', () => {
  it('exposes the direct rolling 24h traded volume while retaining conservative batch capacity', () => {
    const result = marketCapacity(KEY, history(169, (index) => index >= 97 ? 120 : 100));

    expect(result.volume24h).toBe(2_880);
    expect(result.coverageHours24h).toBe(24);
    expect(result.volume24hSufficient).toBe(true);
    expect(result.median3d).toBe(2_880);
    expect(result.median7d).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
    expect(result.safeUnitsPerHour).toBe(5);
    expect(result.usableDays3d).toBe(3);
    expect(result.usableDays7d).toBe(7);
    expect(result.sufficient).toBe(true);
  });

  it('normalizes 12-23 covered hours instead of declaring all 24h volume unavailable', () => {
    const result = marketCapacity(KEY, history(20));
    expect(result.coverageHours24h).toBe(20);
    expect(result.observedVolume24h).toBe(2_000);
    expect(result.volume24h).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
    expect(result.sufficient).toBe(false);
  });

  it('does not let one hourly spike inflate the conservative multi-day capacity baseline', () => {
    const result = marketCapacity(KEY, history(169, (index) => index === 168 ? 10_000 : 100));
    expect(result.volume24h).toBe(12_300);
    expect(result.median3d).toBe(2_400);
    expect(result.median7d).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
  });

  it('separates quote availability from traded-volume evidence', () => {
    const zero = history(169, () => null);
    zero.at(-1)!.quotes[KEY] = { a: 110, b: null, p: null, v: null };
    const result = marketCapacity(KEY, zero);

    expect(result.volume24h).toBe(0);
    expect(result.median3d).toBe(0);
    expect(result.safeUnitsPerDay).toBe(0);
    expect(result.askAvailable).toBe(true);
    expect(result.bidAvailable).toBe(false);
  });
});
