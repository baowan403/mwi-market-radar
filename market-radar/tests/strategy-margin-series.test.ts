import { describe, expect, it } from 'vitest';
import type { MarketKey, Snapshot } from '../src/core/types';
import type { StrategyCandidate } from '../src/strategy/candidates';
import { buildStrategyMarginSeries, repriceFixedCandidate } from '../src/strategy/margin-series';
import { createMarketPriceBook } from '../src/strategy/price-book';

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
    expect(series.at(-1)?.spreadPct).toBeCloseTo(5 / 176.5 * 100);
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
      spreadPct: null,
      complete: false,
      classification: 'insufficient',
    });
  });

  it('reprices only external workflow edges and cancels an unquoted internal intermediate', () => {
    const snapshot: Snapshot = {
      timestamp: 1,
      quotes: {
        ['/items/raw::0' as MarketKey]: { a: 100, b: 90, p: 95, v: 1_000 },
        ['/items/final::0' as MarketKey]: { a: 310, b: 300, p: 305, v: 1_000 },
      },
    };
    const fixed: StrategyCandidate = {
      id: 'workflow:fixed', kind: 'workflow', title: 'fixed',
      path: ['/items/raw', '/items/intermediate', '/items/final'],
      costPerHour: 1, incomePerHour: 2, profitPerHour: 1, profitPerDay: 24, workingCapital24h: 24,
      steps: [
        {
          id: 'one', action: 'crafting', actionHrid: '/actions/crafting/one', outputHrid: '/items/intermediate',
          valid: true, actionsPerHour: 1, costPerHour: 1, incomePerHour: 1, profitPerHour: 0, experiencePerHour: 1,
          inputs: [{ itemHrid: '/items/raw', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 1, market: true }],
          outputs: [{ itemHrid: '/items/intermediate', enhancementLevel: 0, unitsPerHour: 2, unitPrice: 1, market: true }],
        },
        {
          id: 'two', action: 'crafting', actionHrid: '/actions/crafting/two', outputHrid: '/items/final',
          valid: true, actionsPerHour: 1, costPerHour: 1, incomePerHour: 2, profitPerHour: 1, experiencePerHour: 1,
          inputs: [{ itemHrid: '/items/intermediate', enhancementLevel: 0, unitsPerHour: 2, unitPrice: 1, market: true }],
          outputs: [{ itemHrid: '/items/final', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 2, market: true }],
        },
      ],
    };

    const repriced = repriceFixedCandidate(fixed, createMarketPriceBook(snapshot));
    expect(repriced).toMatchObject({
      id: 'workflow:fixed',
      costPerHour: 100,
      incomePerHour: 285,
      profitPerHour: 185,
      profitPerDay: 4_440,
      workingCapital24h: 2_400,
    });
  });
});
