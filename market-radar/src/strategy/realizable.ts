import type { MarketKey, Snapshot } from '../core/types';
import type { StrategyCandidate } from './candidates';
import { marketCapacity, type MarketCapacity } from './liquidity';
import type { StrategyFlow } from './types';

export type LiquidityClassification = 'long-run' | 'small-test' | 'limited' | 'reject' | 'insufficient';

export interface RealizableStrategy {
  theoreticalProfitPerDay: number;
  realizableProfitPerDay: number | null;
  safeHoursPerDay: number | null;
  safeBatchUnits: number | null;
  sellThroughDays: number | null;
  marketSharePct: number | null;
  bottleneckHrid: string | null;
  bottleneckSide: 'input' | 'output' | null;
  classification: LiquidityClassification;
}

interface ExternalFlow {
  side: 'input' | 'output';
  flow: StrategyFlow;
}

type AvailableMarketCapacity = MarketCapacity & {
  safeUnitsPerHour: number;
  median7d: number;
};

interface EvaluatedExternalFlow extends ExternalFlow {
  capacity: AvailableMarketCapacity;
  share: number;
  safeRatio: number;
}

function key(flow: StrategyFlow): string {
  return `${flow.itemHrid}::${flow.enhancementLevel}`;
}

function aggregate(flows: readonly StrategyFlow[]): Map<string, StrategyFlow> {
  const result = new Map<string, StrategyFlow>();
  for (const flow of flows.filter((item) => item.market)) {
    const id = key(flow);
    const current = result.get(id);
    if (current) current.unitsPerHour += flow.unitsPerHour;
    else result.set(id, { ...flow });
  }
  return result;
}

export function externalStrategyFlows(candidate: StrategyCandidate): ExternalFlow[] {
  const inputs = aggregate(candidate.steps.flatMap((step) => step.inputs));
  const outputs = aggregate(candidate.steps.flatMap((step) => step.outputs));
  for (const [id, input] of inputs) {
    const output = outputs.get(id);
    if (!output) continue;
    const canceled = Math.min(input.unitsPerHour, output.unitsPerHour);
    input.unitsPerHour -= canceled;
    output.unitsPerHour -= canceled;
  }
  return [
    ...[...inputs.values()].filter((flow) => flow.unitsPerHour > 1e-10).map((flow) => ({ side: 'input' as const, flow })),
    ...[...outputs.values()].filter((flow) => flow.unitsPerHour > 1e-10).map((flow) => ({ side: 'output' as const, flow })),
  ];
}

function classification(share: number): LiquidityClassification {
  if (share <= 5) return 'long-run';
  if (share <= 10) return 'small-test';
  if (share <= 25) return 'limited';
  return 'reject';
}

export function evaluateRealizableStrategy(
  candidate: StrategyCandidate,
  snapshots: readonly Snapshot[],
): RealizableStrategy {
  const flows = externalStrategyFlows(candidate);
  const evaluated: EvaluatedExternalFlow[] = [];
  let hasAnomaly = false;
  for (const external of flows) {
    const capacity = marketCapacity(key(external.flow) as MarketKey, snapshots);
    const sideAvailable = external.side === 'input' ? capacity.askAvailable : capacity.bidAvailable;
    const isPriceAnomaly = external.side === 'output'
      && capacity.medianPrice7d !== null
      && external.flow.unitPrice !== null
      && capacity.median7d !== null
      && capacity.median7d < 50
      && external.flow.unitPrice > capacity.medianPrice7d * 2.5;

    if (
      !capacity.sufficient
      || !sideAvailable
      || capacity.safeUnitsPerHour === null
      || capacity.median7d === null
    ) {
      return {
        theoreticalProfitPerDay: candidate.profitPerDay,
        realizableProfitPerDay: null,
        safeHoursPerDay: null,
        safeBatchUnits: null,
        sellThroughDays: null,
        marketSharePct: null,
        bottleneckHrid: external.flow.itemHrid,
        bottleneckSide: external.side,
        classification: 'insufficient',
      };
    }
    if (capacity.isGhostLiquidity || isPriceAnomaly) {
      hasAnomaly = true;
    }
    const share = capacity.median7d === 0
      ? external.flow.unitsPerHour > 0 ? Number.POSITIVE_INFINITY : 0
      : external.flow.unitsPerHour / capacity.median7d * 100;
    const safeRatio = external.flow.unitsPerHour <= 0
      ? 1
      : capacity.safeUnitsPerHour / external.flow.unitsPerHour;
    evaluated.push({
      ...external,
      capacity: {
        ...capacity,
        safeUnitsPerHour: capacity.safeUnitsPerHour,
        median7d: capacity.median7d,
      },
      share,
      safeRatio,
    });
  }
  if (evaluated.length === 0) {
    return {
      theoreticalProfitPerDay: candidate.profitPerDay,
      realizableProfitPerDay: candidate.profitPerDay,
      safeHoursPerDay: 24,
      safeBatchUnits: null,
      sellThroughDays: null,
      marketSharePct: 0,
      bottleneckHrid: null,
      bottleneckSide: null,
      classification: 'long-run',
    };
  }
  const bottleneck = evaluated.reduce((current, item) => (
    item.safeRatio < current.safeRatio ? item : current
  ));
  const maximumShare = Math.max(...evaluated.map((item) => item.share));
  const operationRatio = Math.max(0, Math.min(1, bottleneck.safeRatio));
  const finalOutputHrid = candidate.path.at(-1);
  const finalOutput = evaluated.find((item) => item.side === 'output' && item.flow.itemHrid === finalOutputHrid);
  const sellThroughDays = finalOutput && finalOutput.capacity.median7d !== null && finalOutput.capacity.median7d > 0
    ? finalOutput.flow.unitsPerHour / finalOutput.capacity.median7d
    : null;

  return {
    theoreticalProfitPerDay: candidate.profitPerDay,
    realizableProfitPerDay: candidate.profitPerDay * operationRatio,
    safeHoursPerDay: 24 * operationRatio,
    safeBatchUnits: bottleneck.capacity.safeUnitsPerHour * 24,
    sellThroughDays,
    marketSharePct: maximumShare,
    bottleneckHrid: bottleneck.flow.itemHrid,
    bottleneckSide: bottleneck.side,
    classification: (hasAnomaly || maximumShare > 25) ? 'reject' : classification(maximumShare),
  };
}
