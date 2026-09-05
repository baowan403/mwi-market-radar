import { describe, expect, it } from 'vitest';
import { evaluateRealizableStrategy } from '../src/strategy/realizable';
import type { StrategyCandidate } from '../src/strategy/candidates';
import type { MarketKey, Snapshot } from '../src/core/types';

const HOUR = 3_600_000;

function candidate(): StrategyCandidate {
  return {
    id: 'decompose:tea-liquidity-regression',
    kind: 'decompose',
    title: 'tea liquidity regression',
    path: ['/items/main_input', '/items/main_output'],
    profitPerHour: 2_000,
    profitPerDay: 48_000,
    costPerHour: 3_000,
    incomePerHour: 5_000,
    workingCapital24h: 72_000,
    verificationStatus: 'unverified',
    steps: [{
      id: 'decompose:test',
      action: 'alchemy',
      actionHrid: '/actions/alchemy/decompose',
      outputHrid: '/items/main_output',
      valid: true,
      actionsPerHour: 100,
      costPerHour: 3_000,
      incomePerHour: 5_000,
      profitPerHour: 2_000,
      experiencePerHour: 0,
      inputs: [
        { itemHrid: '/items/main_input', enhancementLevel: 0, unitsPerHour: 1, unitPrice: 100, market: true },
        { itemHrid: '/items/alchemy_tea', enhancementLevel: 0, unitsPerHour: 12, unitPrice: 1_000, market: true },
      ],
      outputs: [
        { itemHrid: '/items/main_output', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 200, market: true },
      ],
    }],
  };
}

function history(teaAsk: number | null): Snapshot[] {
  return Array.from({ length: 169 }, (_, index) => ({
    timestamp: index * HOUR,
    quotes: {
      ['/items/main_input::0' as MarketKey]: { a: 100, b: 99, p: 99.5, v: 1_000 },
      ['/items/main_output::0' as MarketKey]: { a: 201, b: 200, p: 200.5, v: 1_000 },
      ['/items/alchemy_tea::0' as MarketKey]: { a: teaAsk, b: 990, p: 995, v: null },
    },
  }));
}

describe('auxiliary tea procurement liquidity', () => {
  it('does not turn an available tea with weak volume history into the production bottleneck', () => {
    const result = evaluateRealizableStrategy(candidate(), history(1_000));

    expect(result.classification).toBe('long-run');
    expect(result.realizableProfitPerDay).not.toBeNull();
    expect(result.marketSharePct).toBeCloseTo(1, 4);
    expect(result.bottleneckHrid).not.toBe('/items/alchemy_tea');
    expect(result.warnings).toContainEqual({
      itemHrid: '/items/alchemy_tea',
      side: 'input',
      code: 'auxiliary-high-share',
    });
  });

  it('still fails when the tea has no current ask at all', () => {
    const result = evaluateRealizableStrategy(candidate(), history(null));

    expect(result.classification).toBe('reject');
    expect(result.riskCode).toBe('no-ask');
    expect(result.riskLabel).toBe('原料無賣單');
    expect(result.realizableProfitPerDay).toBe(0);
    expect(result.bottleneckHrid).toBe('/items/alchemy_tea');
    expect(result.bottleneckSide).toBe('input');
  });
});
