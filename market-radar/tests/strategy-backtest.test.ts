import { describe, expect, it, vi } from 'vitest';
import type { StrategyMarginPoint } from '../src/strategy/margin-series';
import { backtestStrategySignals } from '../src/strategy/backtest';
import type { StrategySignal } from '../src/strategy/signals';

const DAY = 86_400_000;

function series(days: number, profit: (day: number) => number): StrategyMarginPoint[] {
  return Array.from({ length: days + 1 }, (_, day) => ({
    timestamp: day * DAY,
    strategyId: 'fixed:path',
    costPerHour: 100,
    incomePerHour: 100 + profit(day),
    theoreticalProfitPerHour: profit(day),
    realizableProfitPerDay: profit(day) * 24,
    bottleneckHrid: '/items/output',
    bottleneckSafeUnitsPerHour: 100 + day,
    spreadPct: 1,
    complete: true,
    classification: 'long-run',
  }));
}

function signal(action: StrategySignal['action']): StrategySignal {
  return {
    action,
    confidence: 'low',
    reasons: [action],
    invalidation: ['test'],
    metrics: {
      margin1dPct: null, margin3dPct: null, margin7dPct: null, capacity3dPct: null, capacity7dPct: null,
      cost3dPct: null, income3dPct: null, spread3dPoints: null,
    },
  };
}

describe('walk-forward strategy signal backtest', () => {
  it('measures 3D and 7D hit rate, average move, and maximum adverse move', () => {
    const result = backtestStrategySignals(series(40, (day) => 100 + day), {
      signalAt: () => signal('execute'),
    });

    expect(result.byHorizon['3d'].samples).toBe(38);
    expect(result.byHorizon['3d'].hitRate).toBe(1);
    expect(result.byHorizon['3d'].averageChangePct).toBeGreaterThan(0);
    expect(result.byHorizon['3d'].maximumAdversePct).toBe(0);
    expect(result.byHorizon['7d'].samples).toBe(34);
    expect(result.summary).toMatchObject({ passed: true, sampleSize: 72, hitRate: 1 });
  });

  it('treats sell and stop as correct only when future margins fall', () => {
    const falling = backtestStrategySignals(series(20, (day) => 200 - day * 2), {
      signalAt: () => signal('sell'),
    });
    const rising = backtestStrategySignals(series(20, (day) => 100 + day), {
      signalAt: () => signal('stop'),
    });

    expect(falling.byHorizon['3d'].hitRate).toBe(1);
    expect(rising.byHorizon['3d'].hitRate).toBe(0);
    expect(rising.byHorizon['3d'].maximumAdversePct).toBeGreaterThan(0);
  });

  it('excludes wait signals rather than inflating the denominator', () => {
    const result = backtestStrategySignals(series(20, (day) => 100 + day), {
      signalAt: () => signal('wait'),
    });
    expect(result.byHorizon['3d'].samples).toBe(0);
    expect(result.byHorizon['3d'].hitRate).toBeNull();
    expect(result.summary).toEqual({ passed: false, sampleSize: 0, hitRate: 0 });
  });

  it('calls the signal with history prefixes only and never exposes a future point', () => {
    const values = series(12, (day) => 100 + day);
    const seen: number[][] = [];
    const signalAt = vi.fn((prefix: readonly StrategyMarginPoint[]) => {
      seen.push(prefix.map((point) => point.timestamp));
      return signal('execute');
    });

    backtestStrategySignals(values, { signalAt });

    expect(seen).not.toHaveLength(0);
    for (const timestamps of seen) {
      expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
      expect(new Set(timestamps).size).toBe(timestamps.length);
    }
    expect(seen.some((timestamps) => timestamps.at(-1) === 12 * DAY)).toBe(false);
  });

  it('does not pass confidence gates with too few directional outcomes', () => {
    const result = backtestStrategySignals(series(4, (day) => 100 + day), {
      signalAt: () => signal('execute'),
    });
    expect(result.summary.passed).toBe(false);
    expect(result.summary.sampleSize).toBeLessThan(10);
  });
});
