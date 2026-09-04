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
    priority: 'high',
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

  it('supports 24h horizon and non-overlapping time windows without sample inflation', () => {
    // 30 天數據，若滑動重疊取樣 24h 有 29 個樣本
    const overlapping = backtestStrategySignals(series(30, (day) => 100 + day), {
      signalAt: () => signal('execute'),
      horizons: ['24h'],
      nonOverlapping: false,
    });
    expect(overlapping.byHorizon['24h'].samples).toBe(30);

    // 若非重疊取樣，30 天中 24h (1天) 視窗取樣，相鄰點不重疊
    const nonOverlapping = backtestStrategySignals(series(30, (day) => 100 + day), {
      signalAt: () => signal('execute'),
      horizons: ['24h'],
      nonOverlapping: true,
    });
    // 30 天中嚴格非重疊取樣約為 30 個單日切片（每個切片 targetIndex 為 index+1，下次從 index+1 開始）
    expect(nonOverlapping.byHorizon['24h'].samples).toBeGreaterThan(0);
    expect(nonOverlapping.byHorizon['24h'].hitRate).toBe(1);

    // 測試 7d 視窗非重疊取樣
    const nonOverlapping7d = backtestStrategySignals(series(35, (day) => 100 + day), {
      signalAt: () => signal('execute'),
      horizons: ['7d'],
      nonOverlapping: true,
    });
    // 35 天中 7d 視窗非重疊最多取樣 5 個視窗 (35 / 7 = 5)
    expect(nonOverlapping7d.byHorizon['7d'].samples).toBeLessThanOrEqual(5);
    expect(nonOverlapping7d.byHorizon['7d'].samples).toBeGreaterThan(0);
  });
});
