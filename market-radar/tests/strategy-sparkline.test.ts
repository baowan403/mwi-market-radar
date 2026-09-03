import { describe, expect, it } from 'vitest';
import { generateSparklineSvg } from '../src/strategy/sparkline';
import type { StrategyMarginPoint } from '../src/strategy/margin-series';

describe('strategy sparkline svg generator', () => {
  it('returns a dashed placeholder line for insufficient points', () => {
    const emptySvg = generateSparklineSvg([]);
    expect(emptySvg).toContain('<line');
    expect(emptySvg).toContain('stroke-dasharray');

    const singleSvg = generateSparklineSvg([{ timestamp: 1, theoreticalProfitPerHour: 100, realizableProfitPerDay: 100 } as StrategyMarginPoint]);
    expect(singleSvg).toContain('<line');
  });

  it('renders green upward path when latest profit is greater than or equal to initial profit', () => {
    const points = [
      { timestamp: 100, theoreticalProfitPerHour: 100, realizableProfitPerDay: 2400 },
      { timestamp: 200, theoreticalProfitPerHour: 150, realizableProfitPerDay: 3000 },
      { timestamp: 300, theoreticalProfitPerHour: 200, realizableProfitPerDay: 4800 },
    ] as StrategyMarginPoint[];
    const svg = generateSparklineSvg(points);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(svg).toContain('stroke="#34d399"'); // 綠色
    expect(svg).toContain('<circle');
  });

  it('renders red downward path when latest profit is lower than initial profit', () => {
    const points = [
      { timestamp: 100, theoreticalProfitPerHour: 200, realizableProfitPerDay: 4800 },
      { timestamp: 200, theoreticalProfitPerHour: 150, realizableProfitPerDay: 3000 },
      { timestamp: 300, theoreticalProfitPerHour: 100, realizableProfitPerDay: 2400 },
    ] as StrategyMarginPoint[];
    const svg = generateSparklineSvg(points);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(svg).toContain('stroke="#f87171"'); // 紅色
  });
});
