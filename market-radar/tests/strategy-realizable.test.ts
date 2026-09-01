import { describe, expect, it } from 'vitest';
import { evaluateRealizableStrategy } from '../src/strategy/realizable';
import type { StrategyCandidate } from '../src/strategy/candidates';
import type { MarketKey, Snapshot } from '../src/core/types';

const HOUR = 3_600_000;

function snapshots(volumes: Record<string, number>, count = 169): Snapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * HOUR,
    quotes: Object.fromEntries(Object.entries(volumes).map(([hrid, volume]) => [
      `${hrid}::0` as MarketKey,
      { a: 110, b: 100, p: 105, v: volume },
    ])),
  }));
}

function candidate(inputUnits: number, outputUnits: number): StrategyCandidate {
  return {
    id: 'workflow:test', kind: 'workflow', title: 'test',
    path: ['/items/input', '/items/intermediate', '/items/output'],
    profitPerHour: 1_000, profitPerDay: 24_000,
    costPerHour: 2_000, incomePerHour: 3_000, workingCapital24h: 48_000,
    steps: [
      {
        id: 'one', action: 'crafting', actionHrid: '/actions/crafting/one', outputHrid: '/items/intermediate',
        valid: true, actionsPerHour: 1, costPerHour: 2_000, incomePerHour: 2_500,
        profitPerHour: 500, experiencePerHour: 1,
        inputs: [{ itemHrid: '/items/input', enhancementLevel: 0, unitsPerHour: inputUnits, unitPrice: 110, market: true }],
        outputs: [{ itemHrid: '/items/intermediate', enhancementLevel: 0, unitsPerHour: 10, unitPrice: null, market: true }],
      },
      {
        id: 'two', action: 'crafting', actionHrid: '/actions/crafting/two', outputHrid: '/items/output',
        valid: true, actionsPerHour: 1, costPerHour: 2_500, incomePerHour: 3_000,
        profitPerHour: 500, experiencePerHour: 1,
        inputs: [{ itemHrid: '/items/intermediate', enhancementLevel: 0, unitsPerHour: 10, unitPrice: null, market: true }],
        outputs: [
          { itemHrid: '/items/output', enhancementLevel: 0, unitsPerHour: outputUnits, unitPrice: 100, market: true },
          { itemHrid: '/items/coin', enhancementLevel: 0, unitsPerHour: 500, unitPrice: 1, market: false },
        ],
      },
    ],
  };
}

describe('liquidity-adjusted realizable strategy', () => {
  it('uses the output bottleneck to reduce daily profit and classify a small test', () => {
    const result = evaluateRealizableStrategy(candidate(1, 10), snapshots({
      '/items/input': 100,
      '/items/output': 100,
    }));

    expect(result.classification).toBe('small-test');
    expect(result.marketSharePct).toBe(10);
    expect(result.safeHoursPerDay).toBe(12);
    expect(result.realizableProfitPerDay).toBe(12_000);
    expect(result.bottleneckHrid).toBe('/items/output');
    expect(result.safeBatchUnits).toBe(120);
    expect(result.sellThroughDays).toBe(0.1);
  });

  it('checks input bottlenecks and ignores internal/coin flows', () => {
    const result = evaluateRealizableStrategy(candidate(20, 1), snapshots({
      '/items/input': 100,
      '/items/output': 100,
    }));
    expect(result.classification).toBe('limited');
    expect(result.marketSharePct).toBe(20);
    expect(result.safeHoursPerDay).toBe(6);
    expect(result.realizableProfitPerDay).toBe(6_000);
    expect(result.bottleneckHrid).toBe('/items/input');
  });

  it('returns insufficient instead of inventing capacity from short history', () => {
    const result = evaluateRealizableStrategy(candidate(1, 1), snapshots({
      '/items/input': 100,
      '/items/output': 100,
    }, 20));
    expect(result.classification).toBe('insufficient');
    expect(result.realizableProfitPerDay).toBeNull();
  });

  it('ignores a derived loot output with no market history and keeps theoretical profit', () => {
    const value = candidate(1, 10);
    value.steps[1]!.outputs.push({
      itemHrid: '/items/medium_artisans_crate', enhancementLevel: 0,
      unitsPerHour: 0.1, unitPrice: 500_000, market: false,
    });
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/input': 1_000,
      '/items/output': 1_000,
    }));

    expect(result.classification).toBe('long-run');
    expect(result.bottleneckHrid).not.toBe('/items/medium_artisans_crate');
    expect(result.theoreticalProfitPerDay).toBe(value.profitPerDay);
  });

  it('still reports insufficient for a market output with no volume history', () => {
    const result = evaluateRealizableStrategy(candidate(1, 1), snapshots({
      '/items/input': 1_000,
    }));

    expect(result.classification).toBe('insufficient');
    expect(result.bottleneckHrid).toBe('/items/output');
    expect(result.bottleneckSide).toBe('output');
  });

  it('uses the narrowest of multiple market inputs instead of checking only the final output', () => {
    const value = candidate(1, 1);
    value.steps[0]!.inputs.push({
      itemHrid: '/items/rare_input', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 110, market: true,
    });
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/input': 1_000,
      '/items/rare_input': 100,
      '/items/output': 1_000,
    }));

    expect(result.classification).toBe('small-test');
    expect(result.marketSharePct).toBe(10);
    expect(result.bottleneckHrid).toBe('/items/rare_input');
    expect(result.bottleneckSide).toBe('input');
    expect(result.safeHoursPerDay).toBe(12);
  });

  it('rejects a profitable equipment output whose observed market cannot absorb one-per-hour production', () => {
    const value = candidate(0.01, 1);
    value.path[value.path.length - 1] = '/items/slow_equipment';
    value.steps[1]!.outputs[0] = {
      itemHrid: '/items/slow_equipment', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 100, market: true,
    };
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/input': 1_000,
      '/items/slow_equipment': 2,
    }));

    expect(result.classification).toBe('reject');
    expect(result.marketSharePct).toBe(50);
    expect(result.safeHoursPerDay).toBeCloseTo(2.4);
    expect(result.sellThroughDays).toBe(0.5);
  });
});
