import { describe, expect, it } from 'vitest';
import type { MarketKey, Snapshot } from '../src/core/types';
import type { StrategyCandidate } from '../src/strategy/candidates';
import { buildStrategyMarginSeries } from '../src/strategy/margin-series';

const HOUR = 3_600_000;
const INPUT = '/items/input';
const OUTPUT = '/items/output';

function snapshots(count: number, futureVolume = 1_000): Snapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * HOUR,
    quotes: {
      [`${INPUT}::0` as MarketKey]: { a: 100 + index, b: 95 + index, p: 98 + index, v: index === count - 1 ? futureVolume : 1_000 },
      [`${OUTPUT}::0` as MarketKey]: { a: 220, b: 200, p: 210, v: index === count - 1 ? futureVolume : 1_000 },
    },
  }));
}

function candidateAt(snapshot: Snapshot): StrategyCandidate {
  const input = snapshot.quotes[`${INPUT}::0` as MarketKey]!.a!;
  const output = snapshot.quotes[`${OUTPUT}::0` as MarketKey]!.b!;
  const profit = output - input;
  return {
    id: 'fixed:path', kind: 'manufacture', title: 'fixed', path: [INPUT, OUTPUT],
    profitPerHour: profit, profitPerDay: profit * 24,
    costPerHour: input, incomePerHour: output, workingCapital24h: input * 24,
    steps: [{
      id: 'fixed:path', action: 'crafting', actionHrid: '/actions/crafting/fixed', outputHrid: OUTPUT,
      valid: true, actionsPerHour: 1, costPerHour: input, incomePerHour: output,
      profitPerHour: profit, experiencePerHour: 1,
      inputs: [{ itemHrid: INPUT, enhancementLevel: 0, unitsPerHour: 1, unitPrice: input, market: true }],
      outputs: [{ itemHrid: OUTPUT, enhancementLevel: 0, unitsPerHour: 1, unitPrice: output, market: true }],
    }],
  };
}

describe('historical strategy margin series', () => {
  it('records fixed-path economics and marks early capacity evidence incomplete', () => {
    const values = snapshots(80);
    const series = buildStrategyMarginSeries({
      strategyId: 'fixed:path',
      snapshots: values,
      candidateAtSnapshot: candidateAt,
    });

    expect(series).toHaveLength(80);
    expect(series[0]).toMatchObject({
      timestamp: 0,
      strategyId: 'fixed:path',
      costPerHour: 100,
      incomePerHour: 200,
      theoreticalProfitPerHour: 100,
      realizableProfitPerDay: null,
      complete: false,
      classification: 'insufficient',
    });
    expect(series.at(-1)).toMatchObject({
      costPerHour: 179,
      incomePerHour: 200,
      theoreticalProfitPerHour: 21,
      realizableProfitPerDay: 504,
      bottleneckHrid: INPUT,
      bottleneckSafeUnitsPerHour: 50,
      complete: true,
      classification: 'long-run',
    });
  });

  it('does not let a future volume or price change alter an earlier margin point', () => {
    const ordinary = snapshots(80, 1_000);
    const futureShock = snapshots(80, 1);
    futureShock[79]!.quotes[`${OUTPUT}::0` as MarketKey]!.b = 1;

    const before = buildStrategyMarginSeries({ strategyId: 'fixed:path', snapshots: ordinary, candidateAtSnapshot: candidateAt });
    const after = buildStrategyMarginSeries({ strategyId: 'fixed:path', snapshots: futureShock, candidateAtSnapshot: candidateAt });

    expect(after.slice(0, 79)).toEqual(before.slice(0, 79));
    expect(after[79]).not.toEqual(before[79]);
  });

  it('records an explicit incomplete point when the fixed strategy cannot be priced', () => {
    const values = snapshots(3);
    const series = buildStrategyMarginSeries({
      strategyId: 'fixed:path',
      snapshots: values,
      candidateAtSnapshot: (snapshot) => snapshot.timestamp === HOUR ? null : candidateAt(snapshot),
    });

    expect(series[1]).toEqual({
      timestamp: HOUR,
      strategyId: 'fixed:path',
      costPerHour: null,
      incomePerHour: null,
      theoreticalProfitPerHour: null,
      realizableProfitPerDay: null,
      bottleneckHrid: null,
      bottleneckSafeUnitsPerHour: null,
      complete: false,
      classification: 'insufficient',
    });
  });
});
