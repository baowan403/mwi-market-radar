import type { PlayerProfile } from '../profile/types';
import type { StrategyCandidate } from './candidates';
import { calculateStrategyFunding, strategyDataFreshness, type StrategyDecision } from './decision';
import { assessDurationRisk, type RealizableStrategy } from './realizable';

export interface StrategySession extends StrategyDecision {
  outputSharePct: number | null;
  inputSharePct: number | null;
  excessOutputUnits: number | null;
  risk: ReturnType<typeof assessDurationRisk>;
}

export function estimateStrategySession(options: {
  candidate: StrategyCandidate; liquidity: RealizableStrategy; profile: PlayerProfile;
  plannedHours: number; latestSnapshotAgeMs: number;
}): StrategySession {
  const { candidate, liquidity, profile } = options;
  const plannedHours = Number.isFinite(options.plannedHours) ? Math.min(24, Math.max(0.5, options.plannedHours)) : 24;
  const safeHours = liquidity.safeHoursPerDay;
  const executionHours = safeHours === null ? 0 : Math.min(plannedHours, Math.max(0, safeHours));
  const batchProfit = safeHours === null ? null : candidate.profitPerHour * executionHours;
  const risk = assessDurationRisk(liquidity, plannedHours);
  const freshness = strategyDataFreshness(options.latestSnapshotAgeMs);
  const actionable = batchProfit !== null && batchProfit > 0 && Number.isFinite(batchProfit)
    && freshness !== 'stale' && !['no-bid', 'no-ask', 'market-unavailable', 'price-anomaly',
      'insufficient-primary-data', 'insufficient-input-data'].includes(risk.riskCode);
  const funding = calculateStrategyFunding({ candidate, inventoryMap: profile.materialInventoryMap ?? {}, executionHours });
  // costPerHour also contains action coins. Inventory reduces cash, never economic cost/profit.
  funding.grossInputValue = candidate.costPerHour * executionHours;
  funding.inventoryReplacementValue = Math.min(funding.inventoryReplacementValue, funding.grossInputValue);
  funding.cashRequired = Math.max(0, funding.grossInputValue - funding.inventoryReplacementValue);
  const outputPH = liquidity.outputUnitsPerDay === null ? null : liquidity.outputUnitsPerDay / 24;
  return {
    mode: 'short', plannedHours, executionHours, batchProfit, rankValue: actionable ? batchProfit : null,
    recommendedBatchUnits: outputPH === null ? null : outputPH * executionHours,
    durationCovered: safeHours !== null && safeHours + 1e-9 >= plannedHours,
    actionable, freshness, funding, risk,
    outputSharePct: liquidity.outputShare24hPct === null ? null : liquidity.outputShare24hPct * plannedHours / 24,
    inputSharePct: liquidity.maxInputShare24hPct === null ? null : liquidity.maxInputShare24hPct * plannedHours / 24,
    excessOutputUnits: outputPH === null || safeHours === null ? null : outputPH * (plannedHours - executionHours),
  };
}

interface SessionRank { profit: number | null; priority: number; risk: number; cash: number; id: string }
export function compareSessionRanking(a: SessionRank, b: SessionRank, bucketSize = 100000): number {
  const knownA = a.profit !== null && Number.isFinite(a.profit);
  const knownB = b.profit !== null && Number.isFinite(b.profit);
  if (knownA !== knownB) return knownA ? -1 : 1;
  // Stable buckets, not a pairwise tolerance (which would produce non-transitive sorts).
  const bucket = (value: number) => value < bucketSize ? value / bucketSize : Math.floor(value / bucketSize);
  if (knownA && knownB) {
    const delta = bucket(b.profit!) - bucket(a.profit!);
    if (delta !== 0) return delta;
  }
  return b.priority - a.priority || a.risk - b.risk || a.cash - b.cash || a.id.localeCompare(b.id);
}
