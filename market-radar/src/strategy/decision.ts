import type { PlayerProfile } from '../profile/types';
import type { StrategyCandidate } from './candidates';
import { externalStrategyFlows, type RealizableStrategy } from './realizable';

export type StrategyDecisionMode = 'steady' | 'short';
export type StrategyDataFreshness = 'fresh' | 'delayed' | 'stale';

export interface StrategyFundingPlan {
  executionHours: number;
  grossInputValue: number;
  inventoryReplacementValue: number;
  cashRequired: number;
  inventoryCoverageHours: number | null;
}

export interface StrategyDecision {
  mode: StrategyDecisionMode;
  plannedHours: number;
  executionHours: number;
  recommendedBatchUnits: number | null;
  batchProfit: number | null;
  rankValue: number | null;
  durationCovered: boolean;
  actionable: boolean;
  freshness: StrategyDataFreshness;
  funding: StrategyFundingPlan;
}

const MINUTE_MS = 60_000;

export function strategyDataFreshness(ageMs: number): StrategyDataFreshness {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'stale';
  if (ageMs <= 20 * MINUTE_MS) return 'fresh';
  if (ageMs <= 180 * MINUTE_MS) return 'delayed';
  return 'stale';
}

export function calculateStrategyFunding(options: {
  candidate: StrategyCandidate;
  inventoryMap: Readonly<Record<string, number>>;
  executionHours: number;
}): StrategyFundingPlan {
  const executionHours = Number.isFinite(options.executionHours)
    ? Math.max(0, options.executionHours)
    : 0;
  let grossInputValue = 0;
  let inventoryReplacementValue = 0;
  let inventoryCoverageHours: number | null = null;

  for (const { side, flow } of externalStrategyFlows(options.candidate)) {
    if (side !== 'input' || flow.unitsPerHour <= 0 || flow.unitPrice === null) continue;
    const requiredUnits = flow.unitsPerHour * executionHours;
    const inventoryUnits = Math.max(0, options.inventoryMap[flow.itemHrid] ?? 0);
    const usedInventory = Math.min(requiredUnits, inventoryUnits);
    grossInputValue += requiredUnits * flow.unitPrice;
    inventoryReplacementValue += usedInventory * flow.unitPrice;
    const coverage = inventoryUnits / flow.unitsPerHour;
    inventoryCoverageHours = inventoryCoverageHours === null
      ? coverage
      : Math.min(inventoryCoverageHours, coverage);
  }

  return {
    executionHours,
    grossInputValue,
    inventoryReplacementValue,
    cashRequired: Math.max(0, grossInputValue - inventoryReplacementValue),
    inventoryCoverageHours,
  };
}

export function assessStrategyDecision(options: {
  candidate: StrategyCandidate;
  liquidity: RealizableStrategy;
  profile: PlayerProfile;
  plannedHours: number;
  mode: StrategyDecisionMode;
  latestSnapshotAgeMs: number;
}): StrategyDecision {
  const plannedHours = Number.isFinite(options.plannedHours)
    ? Math.max(1, Math.min(24, options.plannedHours))
    : 8;
  const safeHours = options.liquidity.safeHoursPerDay;
  const executionHours = safeHours === null ? 0 : Math.max(0, Math.min(plannedHours, safeHours));
  const batchProfit = options.liquidity.realizableProfitPerDay === null
    ? null
    : options.candidate.profitPerHour * executionHours;
  const durationCovered = safeHours !== null && safeHours + 1e-9 >= plannedHours;
  const freshness = strategyDataFreshness(options.latestSnapshotAgeMs);
  const recommendedBatchUnits = safeHours !== null
    && safeHours > 0
    && options.liquidity.safeBatchUnits !== null
      ? options.liquidity.safeBatchUnits * executionHours / safeHours
      : null;
  const baseActionable = options.liquidity.classification !== 'reject'
    && options.liquidity.classification !== 'insufficient'
    && batchProfit !== null
    && batchProfit > 0
    && freshness !== 'stale';
  const actionable = baseActionable && (options.mode === 'short' || durationCovered);
  const rankValue = actionable ? batchProfit : null;

  return {
    mode: options.mode,
    plannedHours,
    executionHours,
    recommendedBatchUnits,
    batchProfit,
    rankValue,
    durationCovered,
    actionable,
    freshness,
    funding: calculateStrategyFunding({
      candidate: options.candidate,
      inventoryMap: options.profile.materialInventoryMap ?? {},
      executionHours,
    }),
  };
}
