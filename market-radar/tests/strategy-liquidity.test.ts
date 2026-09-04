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
  it('compares 24h strategy demand with median daily traded volume', () => {
    const result = marketCapacity(KEY, history(169, (index) => index >= 97 ? 120 : 100));

    // Last 3 full rolling days trade 120/h => 2,880/day.
    expect(result.median3d).toBe(2_880);
    // Four of seven days remain at 100/h => median 2,400/day.
    expect(result.median7d).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
    expect(result.safeUnitsPerHour).toBe(5);
    expect(result.usableDays3d).toBe(3);
    expect(result.usableDays7d).toBe(7);
    expect(result.sufficient).toBe(true);
  });

  it('does not let one hourly spike inflate the multi-day capacity baseline', () => {
    const result = marketCapacity(KEY, history(169, (index) => index === 168 ? 10_000 : 100));
    expect(result.median3d).toBe(2_400);
    expect(result.median7d).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);

    const insufficient = marketCapacity(KEY, history(20));
    expect(insufficient.sufficient).toBe(false);
    expect(insufficient.safeUnitsPerDay).toBeNull();
  });

  it('separates quote availability from traded-volume evidence', () => {
    const zero = history(169, () => null);
    zero.at(-1)!.quotes[KEY] = { a: 110, b: null, p: null, v: null };
    const result = marketCapacity(KEY, zero);

    expect(result.median3d).toBe(0);
    expect(result.safeUnitsPerDay).toBe(0);
    expect(result.askAvailable).toBe(true);
    expect(result.bidAvailable).toBe(false);
  });
});
