import type { Snapshot } from '../core/types';
import type { StrategyCandidate } from './candidates';
import { evaluateRealizableStrategy, type LiquidityClassification } from './realizable';

export interface StrategyMarginPoint {
  timestamp: number;
  strategyId: string;
  costPerHour: number | null;
  incomePerHour: number | null;
  theoreticalProfitPerHour: number | null;
  realizableProfitPerDay: number | null;
  bottleneckHrid: string | null;
  bottleneckSafeUnitsPerHour: number | null;
  complete: boolean;
  classification: LiquidityClassification;
}

export interface StrategyMarginSeriesOptions {
  strategyId: string;
  snapshots: readonly Snapshot[];
  candidateAtSnapshot(snapshot: Snapshot): StrategyCandidate | null;
}

function emptyPoint(timestamp: number, strategyId: string): StrategyMarginPoint {
  return {
    timestamp,
    strategyId,
    costPerHour: null,
    incomePerHour: null,
    theoreticalProfitPerHour: null,
    realizableProfitPerDay: null,
    bottleneckHrid: null,
    bottleneckSafeUnitsPerHour: null,
    complete: false,
    classification: 'insufficient',
  };
}

function orderedSnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (Number.isFinite(snapshot.timestamp)) byTimestamp.set(snapshot.timestamp, snapshot);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function buildStrategyMarginSeries(options: StrategyMarginSeriesOptions): StrategyMarginPoint[] {
  const ordered = orderedSnapshots(options.snapshots);
  return ordered.map((snapshot, index) => {
    const candidate = options.candidateAtSnapshot(snapshot);
    if (!candidate || candidate.id !== options.strategyId) {
      return emptyPoint(snapshot.timestamp, options.strategyId);
    }
    const liquidity = evaluateRealizableStrategy(candidate, ordered.slice(0, index + 1));
    const safePerHour = liquidity.safeBatchUnits === null
      ? null
      : liquidity.safeBatchUnits / 24;
    return {
      timestamp: snapshot.timestamp,
      strategyId: options.strategyId,
      costPerHour: candidate.costPerHour,
      incomePerHour: candidate.incomePerHour,
      theoreticalProfitPerHour: candidate.profitPerHour,
      realizableProfitPerDay: liquidity.realizableProfitPerDay,
      bottleneckHrid: liquidity.bottleneckHrid,
      bottleneckSafeUnitsPerHour: safePerHour,
      complete: liquidity.classification !== 'insufficient' && liquidity.realizableProfitPerDay !== null,
      classification: liquidity.classification,
    };
  });
}
