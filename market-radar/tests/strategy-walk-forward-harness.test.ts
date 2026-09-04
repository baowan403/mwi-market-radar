import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/core/types';
import type { StrategyMarginPoint } from '../src/strategy/margin-series';
import {
  filterAndValidateSnapshots,
  splitTemporalDataset,
  runWalkForwardBacktest,
} from '../scripts/harness/walk-forward-backtest';

const DAY = 86_400_000;
const BASE_TIME = Date.parse('2026-08-01T00:00:00.000Z');

function createSnapshots(count: number): Snapshot[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: BASE_TIME + i * DAY,
    quotes: {
      '/items/item_a::0': { a: 100 + i, b: 95 + i, p: 98 + i, v: 100 },
      '/items/item_b::0': { a: 200 + i, b: 190 + i, p: 195 + i, v: 100 },
      '/items/item_c::0': { a: 300 + i, b: 285 + i, p: 290 + i, v: 100 },
      '/items/item_d::0': { a: 400 + i, b: 380 + i, p: 390 + i, v: 100 },
      '/items/item_e::0': { a: 500 + i, b: 475 + i, p: 485 + i, v: 100 },
    },
  }));
}

function createMarginSeries(count: number, profitFn: (i: number) => number): StrategyMarginPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: BASE_TIME + i * DAY,
    strategyId: 'test:strategy',
    costPerHour: 1000,
    incomePerHour: 1000 + profitFn(i),
    theoreticalProfitPerHour: profitFn(i) * 1.1,
    realizableProfitPerDay: profitFn(i) * 24,
    bottleneckHrid: '/items/item_a',
    bottleneckSafeUnitsPerHour: 50,
    spreadPct: 2,
    complete: true,
    classification: 'long-run',
  }));
}

describe('Walk-Forward Backtesting Harness & 3-Baseline Comparison', () => {
  it('enforces quality gate: rejects version mismatch and filters invalid snapshots', () => {
    const snaps = createSnapshots(10);
    // 注入一個無效 snapshot（無效 timestamp）
    snaps.push({ timestamp: -1, quotes: {} });
    // 注入一個 quote 數量不足的 snapshot
    snaps.push({ timestamp: BASE_TIME + 20 * DAY, quotes: {} });

    // 1. 版本相符時正確過濾無效切片
    const filtered = filterAndValidateSnapshots({
      snapshots: snaps,
      expectedVersion: '1.2.0',
      gameDataVersion: '1.2.0',
      minQuotesPerSnapshot: 5,
    });
    expect(filtered).toHaveLength(10);

    // 2. 版本不符時觸發安全防護中斷
    expect(() =>
      filterAndValidateSnapshots({
        snapshots: snaps,
        expectedVersion: '1.2.0',
        gameDataVersion: '1.1.0',
      })
    ).toThrow(/GameData version mismatch/);
  });

  it('strictly enforces temporal split (Train 60% / Validation 20% / Holdout 20%) with zero leak', () => {
    const series = createMarginSeries(100, (i) => 100 + i);
    const splits = splitTemporalDataset(series);

    expect(splits.train).toHaveLength(60);
    expect(splits.validation).toHaveLength(20);
    expect(splits.holdout).toHaveLength(20);

    // 驗證時間嚴格單調遞增，完全無重疊與時間倒流
    const maxTrainTime = Math.max(...splits.train.map((s) => s.timestamp));
    const minValTime = Math.min(...splits.validation.map((s) => s.timestamp));
    const maxValTime = Math.max(...splits.validation.map((s) => s.timestamp));
    const minHoldoutTime = Math.min(...splits.holdout.map((s) => s.timestamp));

    expect(maxTrainTime).toBeLessThan(minValTime);
    expect(maxValTime).toBeLessThan(minHoldoutTime);
  });

  it('runs complete 3-baseline walk-forward backtest and produces structured report', () => {
    const snapshots = createSnapshots(50);
    const marginSeries = createMarginSeries(50, (i) => 500 + (i % 5) * 20);

    const report = runWalkForwardBacktest({
      dataset: {
        snapshots,
        gameDataVersion: '1.2.0',
        expectedVersion: '1.2.0',
      },
      marginSeries,
      nonOverlapping: true,
    });

    expect(report.datasetStats.splits.train).toBe(30);
    expect(report.datasetStats.splits.validation).toBe(10);
    expect(report.datasetStats.splits.holdout).toBe(10);

    // 驗證包含三大 Baseline
    expect(report.baselines['A_SafeProfit']).toBeDefined();
    expect(report.baselines['B_SafeProfit_Momentum']).toBeDefined();
    expect(report.baselines['C_TheoreticalProfit']).toBeDefined();

    // 驗證包含 24h, 3d, 7d
    expect(report.baselines['A_SafeProfit']?.holdoutMetrics['24h']).toBeDefined();
    expect(report.baselines['A_SafeProfit']?.holdoutMetrics['3d']).toBeDefined();
    expect(report.baselines['A_SafeProfit']?.holdoutMetrics['7d']).toBeDefined();

    // 驗證 Verdict 結構完整
    expect(typeof report.verdict.momentumHasAlpha).toBe('boolean');
    expect(report.verdict.recommendation).toBeDefined();
    expect(report.verdict.details).toBeDefined();
  });
});
