import { spreadPct as calculateSpreadPct } from '../core/price';
import type { MarketKey, Snapshot } from '../core/types';
import type { StrategyCandidate } from './candidates';
import type { MarketPriceBook } from './price-book';
import { evaluateRealizableStrategy, type LiquidityClassification } from './realizable';
import type { StrategyFlow } from './types';
import { marketTaxFactor } from './tax';

const COIN_HRID = '/items/coin';

export interface StrategyMarginPoint {
  timestamp: number;
  strategyId: string;
  costPerHour: number | null;
  incomePerHour: number | null;
  theoreticalProfitPerHour: number | null;
  realizableProfitPerDay: number | null;
  bottleneckHrid: string | null;
  bottleneckSafeUnitsPerHour: number | null;
  spreadPct: number | null;
  complete: boolean;
  classification: LiquidityClassification;
}

export interface StrategyMarginSeriesOptions {
  strategyId: string;
  snapshots: readonly Snapshot[];
  candidateAtSnapshot(snapshot: Snapshot): StrategyCandidate | null;
}

function flowKey(flow: StrategyFlow): string {
  return `${flow.itemHrid}::${flow.enhancementLevel}`;
}

function aggregate(flows: readonly StrategyFlow[]): Map<string, StrategyFlow> {
  const result = new Map<string, StrategyFlow>();
  for (const flow of flows) {
    const key = flowKey(flow);
    const current = result.get(key);
    if (current) current.unitsPerHour += flow.unitsPerHour;
    else result.set(key, { ...flow });
  }
  return result;
}

function externalFlows(candidate: StrategyCandidate): { inputs: StrategyFlow[]; outputs: StrategyFlow[] } {
  const inputs = aggregate(candidate.steps.flatMap((step) => step.inputs));
  const outputs = aggregate(candidate.steps.flatMap((step) => step.outputs));
  for (const [key, input] of inputs) {
    const output = outputs.get(key);
    if (!output) continue;
    const canceled = Math.min(input.unitsPerHour, output.unitsPerHour);
    input.unitsPerHour -= canceled;
    output.unitsPerHour -= canceled;
  }
  return {
    inputs: [...inputs.values()].filter((flow) => flow.unitsPerHour > 1e-10),
    outputs: [...outputs.values()].filter((flow) => flow.unitsPerHour > 1e-10),
  };
}

function flowPrice(flow: StrategyFlow, side: 'input' | 'output', prices: MarketPriceBook): number | null {
  if (flow.itemHrid === COIN_HRID) return flow.unitPrice;
  return side === 'input'
    ? prices.ask(flow.itemHrid, flow.enhancementLevel)
    : prices.bid(flow.itemHrid, flow.enhancementLevel);
}

function finitePrice(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function repriceFixedCandidate(
  candidate: StrategyCandidate,
  prices: MarketPriceBook,
): StrategyCandidate | null {
  const external = externalFlows(candidate);
  const inputValues = external.inputs.map((flow) => ({ flow, price: flowPrice(flow, 'input', prices) }));
  const outputValues = external.outputs.map((flow) => ({ flow, price: flowPrice(flow, 'output', prices) }));
  if ([...inputValues, ...outputValues].some(({ price }) => !finitePrice(price))) return null;
  const costPerHour = inputValues.reduce((sum, { flow, price }) => sum + flow.unitsPerHour * price!, 0);
  const incomePerHour = outputValues.reduce((sum, { flow, price }) => (
    sum + flow.unitsPerHour * price! * (flow.market ? marketTaxFactor(flow.itemHrid) : 1)
  ), 0);
  const profitPerHour = incomePerHour - costPerHour;
  const steps = candidate.steps.map((step) => ({
    ...step,
    inputs: step.inputs.map((flow) => ({ ...flow, unitPrice: flowPrice(flow, 'input', prices) })),
    outputs: step.outputs.map((flow) => ({ ...flow, unitPrice: flowPrice(flow, 'output', prices) })),
  }));
  return {
    ...candidate,
    steps,
    costPerHour,
    incomePerHour,
    profitPerHour,
    profitPerDay: profitPerHour * 24,
    workingCapital24h: costPerHour * 24,
  };
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
    spreadPct: null,
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
    const bottleneckFlow = liquidity.bottleneckHrid === null
      ? null
      : candidate.steps
        .flatMap((step) => [...step.inputs, ...step.outputs])
        .find((flow) => flow.market && flow.itemHrid === liquidity.bottleneckHrid) ?? null;
    const quote = bottleneckFlow === null
      ? null
      : snapshot.quotes[`${bottleneckFlow.itemHrid}::${bottleneckFlow.enhancementLevel}` as MarketKey] ?? null;
    return {
      timestamp: snapshot.timestamp,
      strategyId: options.strategyId,
      costPerHour: candidate.costPerHour,
      incomePerHour: candidate.incomePerHour,
      theoreticalProfitPerHour: candidate.profitPerHour,
      realizableProfitPerDay: liquidity.realizableProfitPerDay,
      bottleneckHrid: liquidity.bottleneckHrid,
      bottleneckSafeUnitsPerHour: safePerHour,
      spreadPct: quote === null ? null : calculateSpreadPct(quote),
      complete: liquidity.classification !== 'insufficient' && liquidity.realizableProfitPerDay !== null,
      classification: liquidity.classification,
    };
  });
}
