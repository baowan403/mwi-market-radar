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
  it('recommends execute when margin is stable or rising (3D >= -2%)', () => {
    const signal = strategyTrendSignal(series(31, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 100 + 50 * ratio,
      spread: 1,
    })), { backtest: { passed: true, sampleSize: 10, hitRate: 0.6 } });

    expect(signal.action).toBe('execute');
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

  it('refuses to claim a trend before seven full days of evidence', () => {
    const signal = strategyTrendSignal(series(6, (ratio) => ({
      cost: 100,
      income: 200 + 100 * ratio,
      capacity: 100 + 50 * ratio,
      spread: 1,
    })));

    expect(signal.action).toBe('wait');
    expect(signal.confidence).toBe('none');
    expect(signal.reasons.join(' ')).toContain('不足 7 天');
  });
});
