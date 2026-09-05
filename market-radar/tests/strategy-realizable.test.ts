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
    verificationStatus: 'unverified',
  };
}

describe('simple 24h market assessment', () => {
  it('counts a tea used as alchemy feedstock as a primary procurement risk', () => {
    const value = candidate(100, 1);
    value.steps[0]!.action = 'alchemy';
    value.steps[0]!.inputs[0]!.itemHrid = '/items/ultra_cooking_tea';
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/ultra_cooking_tea': 100,
      '/items/output': 100,
    }));
    expect(result.inputBottleneckHrid).toBe('/items/ultra_cooking_tea');
    expect(result.riskCode).toBe('procurement-critical');
  });
  it('uses only the final output for the visible daily production share', () => {
    const result = evaluateRealizableStrategy(candidate(1, 10), snapshots({
      '/items/input': 100,
      '/items/output': 100,
    }));

    expect(result.outputShare24hPct).toBe(10);
    expect(result.marketSharePct).toBe(10);
    expect(result.maxInputShare24hPct).toBe(1);
    expect(result.riskLabel).toBe('滯銷注意');
    expect(result.classification).toBe('limited');
    expect(result.safeHoursPerDay).toBe(12);
    expect(result.realizableProfitPerDay).toBe(12_000);
    expect(result.bottleneckHrid).toBe('/items/output');
    expect(result.sellThroughDays).toBe(0.1);
  });

  it('separates procurement pressure from the displayed output share', () => {
    const result = evaluateRealizableStrategy(candidate(20, 1), snapshots({
      '/items/input': 100,
      '/items/output': 100,
    }));

    expect(result.outputShare24hPct).toBe(1);
    expect(result.maxInputShare24hPct).toBe(20);
    expect(result.inputBottleneckHrid).toBe('/items/input');
    expect(result.riskLabel).toBe('原料難買');
    expect(result.classification).toBe('reject');
    expect(result.safeHoursPerDay).toBe(6);
    expect(result.realizableProfitPerDay).toBe(6_000);
  });

  it('uses a normalized rolling 24h estimate with only 20 covered hours', () => {
    const result = evaluateRealizableStrategy(candidate(1, 1), snapshots({
      '/items/input': 100,
      '/items/output': 100,
    }, 20));

    expect(result.classification).toBe('long-run');
    expect(result.outputShare24hPct).toBe(1);
    expect(result.outputVolumeCoverageHours).toBe(20);
    expect(result.realizableProfitPerDay).toBe(24_000);
  });

  it('does not let a sparse secondary rare drop erase the main product assessment', () => {
    const value = candidate(1, 10);
    value.steps[1]!.outputs.push(
      { itemHrid: '/items/cowbell', enhancementLevel: 0, unitsPerHour: 0.1, unitPrice: 100, market: false },
      { itemHrid: '/items/moonstone', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 70, market: true },
    );
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/input': 1_000,
      '/items/output': 1_000,
    }));

    expect(result.classification).toBe('long-run');
    expect(result.outputShare24hPct).toBeCloseTo(1, 4);
    expect(result.riskLabel).toBe('低');
    expect(result.warnings).toContainEqual({
      itemHrid: '/items/moonstone',
      side: 'output',
      code: 'secondary-history-incomplete',
    });
  });

  it('reports a missing current primary bid as an explicit sell risk', () => {
    const result = evaluateRealizableStrategy(candidate(1, 1), snapshots({
      '/items/input': 1_000,
    }));

    expect(result.classification).toBe('reject');
    expect(result.riskCode).toBe('no-bid');
    expect(result.riskLabel).toBe('成品無買單');
    expect(result.bottleneckHrid).toBe('/items/output');
    expect(result.bottleneckSide).toBe('output');
  });

  it('uses the largest real input demand share as the procurement bottleneck', () => {
    const value = candidate(1, 1);
    value.steps[0]!.inputs.push({
      itemHrid: '/items/rare_input', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 110, market: true,
    });
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/input': 1_000,
      '/items/rare_input': 100,
      '/items/output': 1_000,
    }));

    expect(result.outputShare24hPct).toBeCloseTo(0.1, 4);
    expect(result.maxInputShare24hPct).toBe(10);
    expect(result.riskLabel).toBe('原料偏緊');
    expect(result.bottleneckHrid).toBe('/items/rare_input');
    expect(result.bottleneckSide).toBe('input');
    expect(result.safeHoursPerDay).toBe(12);
  });

  it('flags a final equipment output whose 24h production overwhelms market volume', () => {
    const value = candidate(0.01, 1);
    value.path[value.path.length - 1] = '/items/slow_equipment';
    value.steps[1]!.outputHrid = '/items/slow_equipment';
    value.steps[1]!.outputs[0] = {
      itemHrid: '/items/slow_equipment', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 100, market: true,
    };
    const result = evaluateRealizableStrategy(value, snapshots({
      '/items/input': 1_000,
      '/items/slow_equipment': 2,
    }));

    expect(result.classification).toBe('reject');
    expect(result.outputShare24hPct).toBe(50);
    expect(result.riskLabel).toBe('滯銷風險');
    expect(result.safeHoursPerDay).toBeCloseTo(2.4);
    expect(result.sellThroughDays).toBe(0.5);
  });

  it('flags an equipment output whose current price is abnormally above history', () => {
    const value = candidate(1, 1);
    value.path[value.path.length - 1] = '/items/spiked_gloves';
    value.steps[1]!.outputHrid = '/items/spiked_gloves';
    value.steps[1]!.outputs[0] = {
      itemHrid: '/items/spiked_gloves', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 500, market: true,
    };
    const history = snapshots({
      '/items/input': 1_000,
      '/items/spiked_gloves': 20,
    });
    for (const snapshot of history) {
      snapshot.quotes['/items/spiked_gloves::0' as MarketKey] = {
        a: 110, b: 100, p: 100, v: 20,
      };
    }
    history.at(-1)!.quotes['/items/spiked_gloves::0' as MarketKey] = {
      a: 510, b: 500, p: 500, v: 20,
    };
    const result = evaluateRealizableStrategy(value, history);

    expect(result.classification).toBe('reject');
    expect(result.riskCode).toBe('price-anomaly');
    expect(result.riskLabel).toBe('價格異常');
  });
});
