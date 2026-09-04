import type { MarketKey, Snapshot } from '../core/types';
import type { StrategyCandidate } from './candidates';
import { marketCapacity, type MarketCapacity } from './liquidity';
import type { StrategyFlow } from './types';

export type LiquidityClassification = 'long-run' | 'small-test' | 'limited' | 'reject' | 'insufficient';

export interface LiquidityWarning {
  itemHrid: string;
  side: 'input' | 'output';
  code: 'history-incomplete' | 'auxiliary-high-share';
}

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
  warnings: LiquidityWarning[];
}

interface ExternalFlow {
  side: 'input' | 'output';
  flow: StrategyFlow;
}

type AvailableMarketCapacity = MarketCapacity & {
  safeUnitsPerHour: number;
  safeUnitsPerDay: number;
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

function isAuxiliaryTeaInput(external: ExternalFlow): boolean {
  return external.side === 'input' && external.flow.itemHrid.endsWith('_tea');
}

/**
 * Liquidity contract:
 * - A missing current ask/bid is a hard availability failure.
 * - Historical `v` is traded-volume evidence, not visible order-book depth.
 * - Tea is an auxiliary consumable. It must have a current ask for costing, but it
 *   must not dominate the production-share/risk classification of the main trade.
 *   Weak tea-volume evidence is surfaced as a procurement warning instead.
 * - Other market inputs remain capacity-constrained when volume evidence exists.
 * - Missing output history remains a hard stop because sell-through cannot be estimated.
 */
export function evaluateRealizableStrategy(
  candidate: StrategyCandidate,
  snapshots: readonly Snapshot[],
): RealizableStrategy {
  const flows = externalStrategyFlows(candidate);
  const evaluated: EvaluatedExternalFlow[] = [];
  const warnings: LiquidityWarning[] = [];
  let hasAnomaly = false;

  for (const external of flows) {
    const capacity = marketCapacity(key(external.flow) as MarketKey, snapshots);
    const sideAvailable = external.side === 'input' ? capacity.askAvailable : capacity.bidAvailable;

    if (!sideAvailable) {
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
        warnings,
      };
    }

    const auxiliaryTea = isAuxiliaryTeaInput(external);
    if (auxiliaryTea) {
      if (!capacity.sufficient || capacity.median7d === null || capacity.median7d <= 0) {
        warnings.push({ itemHrid: external.flow.itemHrid, side: 'input', code: 'history-incomplete' });
      } else {
        const teaShare = external.flow.unitsPerHour * 24 / capacity.median7d * 100;
        if (teaShare > 25) {
          warnings.push({ itemHrid: external.flow.itemHrid, side: 'input', code: 'auxiliary-high-share' });
        }
      }
      continue;
    }

    if (
      !capacity.sufficient
      || capacity.safeUnitsPerHour === null
      || capacity.safeUnitsPerDay === null
      || capacity.median7d === null
    ) {
      if (external.side === 'input') {
        warnings.push({ itemHrid: external.flow.itemHrid, side: 'input', code: 'history-incomplete' });
        continue;
      }
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
        warnings,
      };
    }

    const isPriceAnomaly = external.side === 'output'
      && capacity.medianPrice7d !== null
      && external.flow.unitPrice !== null
      && capacity.median7d < 50 * 24
      && external.flow.unitPrice > capacity.medianPrice7d * 2.5;

    if (capacity.isGhostLiquidity || isPriceAnomaly) hasAnomaly = true;

    const demandPerDay = external.flow.unitsPerHour * 24;
    const share = capacity.median7d === 0
      ? demandPerDay > 0 ? Number.POSITIVE_INFINITY : 0
      : demandPerDay / capacity.median7d * 100;
    const safeRatio = demandPerDay <= 0 ? 1 : capacity.safeUnitsPerDay / demandPerDay;

    evaluated.push({
      ...external,
      capacity: {
        ...capacity,
        safeUnitsPerHour: capacity.safeUnitsPerHour,
        safeUnitsPerDay: capacity.safeUnitsPerDay,
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
      warnings,
    };
  }

  const bottleneck = evaluated.reduce((current, item) => (
    item.safeRatio < current.safeRatio ? item : current
  ));
  const maximumShare = Math.max(...evaluated.map((item) => item.share));
  const operationRatio = Math.max(0, Math.min(1, bottleneck.safeRatio));
  const finalOutputHrid = candidate.path.at(-1);
  const finalOutput = evaluated.find((item) => item.side === 'output' && item.flow.itemHrid === finalOutputHrid);
  const sellThroughDays = finalOutput && finalOutput.capacity.median7d > 0
    ? (finalOutput.flow.unitsPerHour * 24) / finalOutput.capacity.median7d
    : null;

  return {
    theoreticalProfitPerDay: candidate.profitPerDay,
    realizableProfitPerDay: candidate.profitPerDay * operationRatio,
    safeHoursPerDay: 24 * operationRatio,
    safeBatchUnits: bottleneck.capacity.safeUnitsPerDay,
    sellThroughDays,
    marketSharePct: maximumShare,
    bottleneckHrid: bottleneck.flow.itemHrid,
    bottleneckSide: bottleneck.side,
    classification: (hasAnomaly || maximumShare > 25) ? 'reject' : classification(maximumShare),
    warnings,
  };
}
