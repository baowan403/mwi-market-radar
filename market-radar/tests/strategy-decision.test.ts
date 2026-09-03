import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../src/profile/types';
import type { StrategyCandidate } from '../src/strategy/candidates';
import {
  assessStrategyDecision,
  calculateStrategyFunding,
  strategyDataFreshness,
} from '../src/strategy/decision';
import type { RealizableStrategy } from '../src/strategy/realizable';

const candidate: StrategyCandidate = {
  id: 'workflow:test', kind: 'workflow', title: 'test',
  path: ['/items/log', '/items/plank'],
  profitPerHour: 1_000, profitPerDay: 24_000,
  costPerHour: 2_000, incomePerHour: 3_000, workingCapital24h: 48_000,
  steps: [{
    id: 'one', action: 'crafting', actionHrid: '/actions/crafting/one', outputHrid: '/items/plank',
    valid: true, actionsPerHour: 1, costPerHour: 2_000, incomePerHour: 3_000,
    profitPerHour: 1_000, experiencePerHour: 1,
    inputs: [
      { itemHrid: '/items/log', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 100, market: true },
      { itemHrid: '/items/tea', enhancementLevel: 0, unitsPerHour: 12, unitPrice: 50, market: true },
    ],
    outputs: [{ itemHrid: '/items/plank', enhancementLevel: 0, unitsPerHour: 5, unitPrice: 600, market: true }],
  }],
};

const profile = {
  inventoryMap: { '/items/tool': 8 },
  materialInventoryMap: { '/items/log': 30, '/items/tea': 12 },
} as unknown as PlayerProfile;

function liquidity(safeHoursPerDay: number): RealizableStrategy {
  return {
    theoreticalProfitPerDay: 24_000,
    realizableProfitPerDay: 1_000 * safeHoursPerDay,
    safeHoursPerDay,
    safeBatchUnits: 100,
    sellThroughDays: 0.1,
    marketSharePct: 10,
    bottleneckHrid: '/items/plank',
    bottleneckSide: 'output',
    classification: 'small-test',
  };
}

describe('strategy decision and inventory-aware funding', () => {
  it('uses inventory only to reduce cash needed, never to inflate economic profit', () => {
    const funding = calculateStrategyFunding({ candidate, inventoryMap: profile.materialInventoryMap, executionHours: 4 });

    expect(funding.grossInputValue).toBe(6_400);
    expect(funding.inventoryReplacementValue).toBe(3_600);
    expect(funding.cashRequired).toBe(2_800);
    expect(funding.inventoryCoverageHours).toBe(1);
    expect(candidate.profitPerHour).toBe(1_000);
  });

  it('requires full duration coverage in steady mode but keeps capped batches in short mode', () => {
    const steady = assessStrategyDecision({
      candidate, liquidity: liquidity(4), profile, plannedHours: 8, mode: 'steady', latestSnapshotAgeMs: 10_000,
    });
    const short = assessStrategyDecision({
      candidate, liquidity: liquidity(4), profile, plannedHours: 8, mode: 'short', latestSnapshotAgeMs: 10_000,
    });

    expect(steady.actionable).toBe(false);
    expect(steady.rankValue).toBeNull();
    expect(short.actionable).toBe(true);
    expect(short.executionHours).toBe(4);
    expect(short.recommendedBatchUnits).toBeCloseTo(100);
    expect(short.batchProfit).toBe(4_000);
    expect(short.rankValue).toBe(4_000);
  });

  it('fails closed when the latest market snapshot is older than 60 minutes', () => {
    expect(strategyDataFreshness(15 * 60_000)).toBe('fresh');
    expect(strategyDataFreshness(60 * 60_000)).toBe('delayed');
    expect(strategyDataFreshness(60 * 60_000 + 1)).toBe('stale');
    expect(assessStrategyDecision({
      candidate, liquidity: liquidity(24), profile, plannedHours: 8, mode: 'steady',
      latestSnapshotAgeMs: 61 * 60_000,
    }).actionable).toBe(false);
  });
});
