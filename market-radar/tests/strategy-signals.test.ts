import { describe, expect, it } from 'vitest';
import type { StrategyMarginPoint } from '../src/strategy/margin-series';
import { strategyTrendSignal } from '../src/strategy/signals';

const DAY = 86_400_000;

function series(
  days: number,
  values: (ratio: number) => { cost: number; income: number; capacity: number; spread: number },
): StrategyMarginPoint[] {
  return Array.from({ length: days + 1 }, (_, day) => {
    const value = values(day / days);
    const profit = value.income - value.cost;
    return {
      timestamp: day * DAY,
      strategyId: 'fixed:path',
      costPerHour: value.cost,
      incomePerHour: value.income,
      theoreticalProfitPerHour: profit,
      realizableProfitPerDay: profit * 24,
      bottleneckHrid: '/items/output',
      bottleneckSafeUnitsPerHour: value.capacity,
      spreadPct: value.spread,
      complete: true,
      classification: 'long-run',
    };
  });
}

describe('explainable strategy trend signals', () => {
  it('keeps low profit momentum candidates below top priority', () => {
    const signal = strategyTrendSignal(series(8, () => ({cost: 100, income: 200, capacity: 100, spread: 1})),
      {currentProfitRatio: 0.5, classification: 'long-run'});
    expect(signal.priority).toBe('medium');
  });
  it('recommends execute when margin is stable or rising (3D >= -2%)', () => {
    const signal = strategyTrendSignal(series(31, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 100 + 50 * ratio,
      spread: 1,
    })), { backtest: { passed: true, sampleSize: 10, hitRate: 0.6 } });

    expect(signal.action).toBe('execute');
    expect(signal.priority).toBe('top');
    expect(signal.confidence).toBe('medium');
    expect(signal.reasons.join(' ')).toContain('利潤');
  });

  it('recommends execute for flat margin (no significant decline)', () => {
    const signal = strategyTrendSignal(series(8, (ratio) => ({
      cost: 100,
      income: 200,
      capacity: 100,
      spread: 1,
    })));

    expect(signal.action).toBe('execute');
    expect(signal.confidence).toBe('low');
  });

  it('recommends prepare when 3D margin dips moderately (-2% to -8%)', () => {
    // income drops by ~6% over 3D → margin drops ~6%
    const signal = strategyTrendSignal(series(8, (ratio) => ({
      cost: 100,
      income: 200 - 15 * ratio,
      capacity: 100,
      spread: 1,
    })));

    expect(signal.action).toBe('prepare');
    expect(signal.reasons.join(' ')).toContain('注意趨勢');
  });

  it('waits when 3D margin drops sharply (>= -8%)', () => {
    // income drops significantly → margin drops > 8%
    const signal = strategyTrendSignal(series(8, (ratio) => ({
      cost: 100,
      income: 200 - 40 * ratio,
      capacity: 100,
      spread: 1,
    })));

    expect(signal.action).toBe('wait');
    expect(signal.reasons.join(' ')).toContain('下滑');
  });

  it('stops when a previously stronger margin reverses sharply', () => {
    const signal = strategyTrendSignal(series(8, (ratio) => {
      const income = ratio < 0.625 ? 200 + 80 * ratio : 250 - 120 * (ratio - 0.625) / 0.375;
      return { cost: 100, income, capacity: 100, spread: 1 };
    }));

    expect(signal.action).toBe('stop');
    expect(signal.reasons.join(' ')).toContain('暴跌');
  });

  it('sells existing output when price rises while capacity falls', () => {
    const signal = strategyTrendSignal(series(8, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 150 - 75 * ratio,
      spread: 1,
    })));

    expect(signal.action).toBe('sell');
    expect(signal.reasons.join(' ')).toContain('承接容量下降');
  });

  it('shows available one and three day changes without inventing seven days', () => {
    const signal = strategyTrendSignal(series(6, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 100 + 50 * ratio,
      spread: 1,
    })));

    expect(signal.confidence).toBe('none');
    expect(signal.metrics.margin1dPct).not.toBeNull();
    expect(signal.metrics.margin3dPct).not.toBeNull();
    expect(signal.metrics.margin7dPct).toBeNull();
  });

  it('does not force priority to low only because capacity evidence is incomplete', () => {
    const points = series(8, (ratio) => ({
      cost: 100,
      income: 200 + 30 * ratio,
      capacity: 100,
      spread: 1,
    }));
    const latest = points.at(-1)!;
    latest.realizableProfitPerDay = null;
    latest.complete = false;
    latest.classification = 'insufficient';

    const signal = strategyTrendSignal(points, { classification: 'insufficient' });
    expect(signal.priority).toBe('medium');
    expect(signal.reasons.join(' ')).toContain('保留中性優先');
  });

  it('blocks executable language when the latest market snapshot is stale', () => {
    const signal = strategyTrendSignal(series(31, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 100 + 50 * ratio,
      spread: 1,
    })), { latestSnapshotAgeMs: 180 * 60_000 + 1 });

    expect(signal.action).toBe('wait');
    expect(signal.confidence).toBe('none');
    expect(signal.reasons.join(' ')).toContain('超過 180 分鐘');
  });

  it('downgrades priority when liquidity classification indicates risk', () => {
    // 原本動能強勁可得 top
    const surgingSeries = series(31, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 100 + 50 * ratio,
      spread: 1,
    }));

    const signalLimited = strategyTrendSignal(surgingSeries, {
      classification: 'limited',
      backtest: { passed: true, sampleSize: 10, hitRate: 0.6 },
    });
    expect(signalLimited.priority).toBe('medium');
    expect(signalLimited.reasons.join(' ')).toContain('成品承接或原料供給偏緊');

    const signalReject = strategyTrendSignal(surgingSeries, {
      classification: 'reject',
    });
    expect(signalReject.priority).toBe('low');
    expect(signalReject.reasons.join(' ')).toContain('明顯滯銷、進貨或報價風險');
  });
});
