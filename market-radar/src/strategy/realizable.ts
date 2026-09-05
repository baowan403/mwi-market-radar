import type { MarketKey, Snapshot } from '../core/types';
import type { StrategyCandidate } from './candidates';
import { marketCapacity, MAX_PRICE_DEVIATION_RATIO, type MarketCapacity } from './liquidity';
import type { StrategyFlow } from './types';

export type LiquidityClassification = 'long-run' | 'small-test' | 'limited' | 'reject' | 'insufficient';
export type MarketRiskSeverity = 'low' | 'medium' | 'high' | 'critical' | 'unknown';
export type MarketRiskCode =
  | 'healthy'
  | 'sell-watch'
  | 'sell-pressure'
  | 'sell-critical'
  | 'procurement-watch'
  | 'procurement-pressure'
  | 'procurement-critical'
  | 'two-sided-pressure'
  | 'market-unavailable'
  | 'no-bid'
  | 'no-ask'
  | 'price-anomaly'
  | 'insufficient-primary-data'
  | 'insufficient-input-data';
export type PrimaryOutputMode = 'market' | 'non-market' | 'derived';

export interface LiquidityWarning {
  itemHrid: string;
  side: 'input' | 'output';
  code: 'history-incomplete' | 'auxiliary-high-share' | 'secondary-history-incomplete';
}

export interface RealizableStrategy {
  theoreticalProfitPerDay: number;
  realizableProfitPerDay: number | null;
  safeHoursPerDay: number | null;
  safeBatchUnits: number | null;
  sellThroughDays: number | null;
  /** Backward-compatible alias. It now means final/main output 24h share only. */
  marketSharePct: number | null;
  outputShare24hPct: number | null;
  outputUnitsPerDay: number | null;
  outputVolume24h: number | null;
  outputVolumeCoverageHours: number | null;
  primaryOutputHrid: string | null;
  primaryOutputMode: PrimaryOutputMode;
  maxInputShare24hPct: number | null;
  inputBottleneckHrid: string | null;
  inputBottleneckVolume24h: number | null;
  riskCode: MarketRiskCode;
  riskSeverity: MarketRiskSeverity;
  riskLabel: string;
  bottleneckHrid: string | null;
  bottleneckSide: 'input' | 'output' | null;
  classification: LiquidityClassification;
  warnings?: LiquidityWarning[];
}

interface ExternalFlow {
  side: 'input' | 'output';
  flow: StrategyFlow;
}

interface EvaluatedExternalFlow extends ExternalFlow {
  capacity: MarketCapacity;
  share: number;
  safeRatio: number | null;
}

function key(flow: StrategyFlow): MarketKey {
  return `${flow.itemHrid}::${flow.enhancementLevel}` as MarketKey;
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

function isAuxiliaryInput(external: ExternalFlow): boolean {
  return external.side === 'input'
    && (external.flow.itemHrid.endsWith('_tea') || external.flow.itemHrid.endsWith('_coffee'));
}

function shareFor(flow: StrategyFlow, capacity: MarketCapacity): number | null {
  if (capacity.volume24h === null) return null;
  const unitsPerDay = flow.unitsPerHour * 24;
  if (capacity.volume24h === 0) return unitsPerDay > 0 ? Number.POSITIVE_INFINITY : 0;
  return unitsPerDay / capacity.volume24h * 100;
}

function safeRatioFor(flow: StrategyFlow, capacity: MarketCapacity): number | null {
  const unitsPerDay = flow.unitsPerHour * 24;
  if (unitsPerDay <= 0) return 1;
  if (capacity.safeUnitsPerDay === null) return null;
  return capacity.safeUnitsPerDay / unitsPerDay;
}

function severityForShare(share: number | null): MarketRiskSeverity {
  if (share === null) return 'unknown';
  if (share <= 3) return 'low';
  if (share <= 5) return 'medium';
  if (share <= 10) return 'high';
  return 'critical';
}

const SEVERITY_RANK: Record<MarketRiskSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
  unknown: -1,
};

function higherSeverity(left: MarketRiskSeverity, right: MarketRiskSeverity): MarketRiskSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

function classificationForSeverity(severity: MarketRiskSeverity): LiquidityClassification {
  switch (severity) {
    case 'low': return 'long-run';
    case 'medium': return 'small-test';
    case 'high': return 'limited';
    case 'critical': return 'reject';
    case 'unknown': return 'insufficient';
  }
}

function outputRisk(share: number): { code: MarketRiskCode; severity: MarketRiskSeverity; label: string } {
  if (share <= 3) return { code: 'healthy', severity: 'low', label: '低' };
  if (share <= 5) return { code: 'sell-watch', severity: 'medium', label: '承接稍弱' };
  if (share <= 10) return { code: 'sell-pressure', severity: 'high', label: '滯銷注意' };
  return { code: 'sell-critical', severity: 'critical', label: '滯銷風險' };
}

function inputRisk(share: number): { code: MarketRiskCode; severity: MarketRiskSeverity; label: string } {
  if (share <= 3) return { code: 'healthy', severity: 'low', label: '低' };
  if (share <= 5) return { code: 'procurement-watch', severity: 'medium', label: '原料稍緊' };
  if (share <= 10) return { code: 'procurement-pressure', severity: 'high', label: '原料偏緊' };
  return { code: 'procurement-critical', severity: 'critical', label: '原料難買' };
}

function primaryOutputIdentity(candidate: StrategyCandidate): {
  itemHrid: string | null;
  declaredFlow: StrategyFlow | null;
} {
  const lastStep = candidate.steps.at(-1);
  const itemHrid = lastStep?.outputHrid ?? candidate.path.at(-1) ?? null;
  const declaredFlow = itemHrid === null
    ? null
    : lastStep?.outputs.find((flow) => flow.itemHrid === itemHrid) ?? null;
  return { itemHrid, declaredFlow };
}

/**
 * Simple market assessment used by the recommendation table:
 * - outputShare24hPct = main/final output made in 24h / that output's 24h traded volume;
 * - maxInputShare24hPct = the largest 24h procurement demand share among real inputs;
 * - rare/essence/other secondary outputs never veto the whole strategy;
 * - risk is an explicit sell/procurement diagnosis rather than a generic data gate.
 */
export function evaluateRealizableStrategy(
  candidate: StrategyCandidate,
  snapshots: readonly Snapshot[],
): RealizableStrategy {
  const flows = externalStrategyFlows(candidate);
  const warnings: LiquidityWarning[] = [];
  const identity = primaryOutputIdentity(candidate);
  const primaryOutput = identity.itemHrid === null
    ? undefined
    : flows.find((external) => (
      external.side === 'output' && external.flow.itemHrid === identity.itemHrid
    ));
  const primaryOutputMode: PrimaryOutputMode = primaryOutput
    ? 'market'
    : identity.itemHrid === '/items/coin' || identity.declaredFlow?.market === false
      ? 'non-market'
      : 'derived';

  let primaryCapacity: MarketCapacity | null = null;
  let outputShare24hPct: number | null = null;
  let outputUnitsPerDay: number | null = null;
  let noBid = false;
  let priceAnomaly = false;
  let primaryHistoryMissing = false;

  if (primaryOutput) {
    primaryCapacity = marketCapacity(key(primaryOutput.flow), snapshots);
    outputUnitsPerDay = primaryOutput.flow.unitsPerHour * 24;
    noBid = !primaryCapacity.bidAvailable;
    outputShare24hPct = shareFor(primaryOutput.flow, primaryCapacity);
    primaryHistoryMissing = outputShare24hPct === null;
    const referenceVolume = primaryCapacity.volume24h ?? primaryCapacity.median7d;
    priceAnomaly = !noBid
      && primaryCapacity.medianPrice7d !== null
      && referenceVolume !== null
      && referenceVolume < 50 * 24
      && primaryOutput.flow.unitPrice !== null
      && primaryOutput.flow.unitPrice > primaryCapacity.medianPrice7d * MAX_PRICE_DEVIATION_RATIO;
  }

  const inputEvaluated: EvaluatedExternalFlow[] = [];
  let missingInputHistory = false;
  const noAskHrids: string[] = [];
  for (const external of flows.filter((item) => item.side === 'input')) {
    const capacity = marketCapacity(key(external.flow), snapshots);
    if (!capacity.askAvailable) noAskHrids.push(external.flow.itemHrid);

    if (isAuxiliaryInput(external)) {
      if (capacity.volume24h === null) {
        warnings.push({ itemHrid: external.flow.itemHrid, side: 'input', code: 'history-incomplete' });
      } else {
        const share = shareFor(external.flow, capacity);
        if (share !== null && share > 25) {
          warnings.push({ itemHrid: external.flow.itemHrid, side: 'input', code: 'auxiliary-high-share' });
        }
      }
      continue;
    }

    const share = shareFor(external.flow, capacity);
    if (share === null) {
      missingInputHistory = true;
      warnings.push({ itemHrid: external.flow.itemHrid, side: 'input', code: 'history-incomplete' });
      continue;
    }
    inputEvaluated.push({
      ...external,
      capacity,
      share,
      safeRatio: safeRatioFor(external.flow, capacity),
    });
  }

  // Secondary drops may have sparse history, but they must not erase the main
  // product's useful share/risk assessment.
  for (const external of flows.filter((item) => (
    item.side === 'output' && item !== primaryOutput
  ))) {
    const capacity = marketCapacity(key(external.flow), snapshots);
    if (!capacity.bidAvailable || capacity.volume24h === null) {
      warnings.push({
        itemHrid: external.flow.itemHrid,
        side: 'output',
        code: 'secondary-history-incomplete',
      });
    }
  }

  const inputBottleneck = inputEvaluated.reduce<EvaluatedExternalFlow | null>((current, item) => (
    current === null || item.share > current.share ? item : current
  ), null);
  const maxInputShare24hPct = inputBottleneck?.share ?? null;

  let riskCode: MarketRiskCode;
  let riskSeverity: MarketRiskSeverity;
  let riskLabel: string;

  if (noAskHrids.length > 0 && noBid) {
    riskCode = 'market-unavailable';
    riskSeverity = 'critical';
    riskLabel = '市場無報價';
  } else if (noAskHrids.length > 0) {
    riskCode = 'no-ask';
    riskSeverity = 'critical';
    riskLabel = '原料無賣單';
  } else if (noBid) {
    riskCode = 'no-bid';
    riskSeverity = 'critical';
    riskLabel = '成品無買單';
  } else if (priceAnomaly) {
    riskCode = 'price-anomaly';
    riskSeverity = 'critical';
    riskLabel = '價格異常';
  } else if (primaryOutputMode === 'market' && primaryHistoryMissing) {
    riskCode = 'insufficient-primary-data';
    riskSeverity = 'unknown';
    riskLabel = '成品量資料不足';
  } else {
    const outputAssessment = outputShare24hPct === null
      ? { code: 'healthy' as const, severity: 'low' as const, label: '低' }
      : outputRisk(outputShare24hPct);
    const inputAssessment = maxInputShare24hPct === null
      ? { code: 'healthy' as const, severity: 'low' as const, label: '低' }
      : inputRisk(maxInputShare24hPct);

    if (
      outputShare24hPct !== null && outputShare24hPct > 3
      && maxInputShare24hPct !== null && maxInputShare24hPct > 3
    ) {
      riskCode = 'two-sided-pressure';
      riskSeverity = higherSeverity(outputAssessment.severity, inputAssessment.severity);
      riskLabel = '雙向壓力';
    } else if (SEVERITY_RANK[outputAssessment.severity] >= SEVERITY_RANK[inputAssessment.severity]) {
      riskCode = outputAssessment.code;
      riskSeverity = outputAssessment.severity;
      riskLabel = outputAssessment.label;
    } else {
      riskCode = inputAssessment.code;
      riskSeverity = inputAssessment.severity;
      riskLabel = inputAssessment.label;
    }

    if (riskSeverity === 'low' && missingInputHistory) {
      riskCode = 'insufficient-input-data';
      riskSeverity = 'unknown';
      riskLabel = '原料量資料不足';
    }
  }

  const constrained: EvaluatedExternalFlow[] = [...inputEvaluated];
  if (primaryOutput && primaryCapacity && outputShare24hPct !== null) {
    constrained.push({
      ...primaryOutput,
      capacity: primaryCapacity,
      share: outputShare24hPct,
      safeRatio: safeRatioFor(primaryOutput.flow, primaryCapacity),
    });
  }
  const bottleneck = constrained.reduce<EvaluatedExternalFlow | null>((current, item) => {
    if (item.safeRatio === null) return current;
    if (current === null || current.safeRatio === null || item.safeRatio < current.safeRatio) return item;
    return current;
  }, null);

  let operationRatio: number | null;
  if (riskCode === 'market-unavailable' || riskCode === 'no-ask' || riskCode === 'no-bid') {
    operationRatio = 0;
  } else if ((primaryCapacity && !primaryCapacity.volume24hSufficient)
    || inputEvaluated.some((item) => !item.capacity.volume24hSufficient)) {
    operationRatio = null;
  } else if (primaryOutputMode === 'market' && primaryHistoryMissing) {
    operationRatio = null;
  } else if (bottleneck?.safeRatio !== null && bottleneck?.safeRatio !== undefined) {
    operationRatio = Math.max(0, Math.min(1, bottleneck.safeRatio));
  } else if (missingInputHistory && flows.some((item) => item.side === 'input' && !isAuxiliaryInput(item))) {
    operationRatio = null;
  } else {
    operationRatio = 1;
  }

  const sellThroughDays = outputShare24hPct === null ? null : outputShare24hPct / 100;
  const bottleneckHrid = noAskHrids[0]
    ?? (noBid ? identity.itemHrid : null)
    ?? (primaryHistoryMissing ? identity.itemHrid : null)
    ?? bottleneck?.flow.itemHrid
    ?? null;
  const bottleneckSide: 'input' | 'output' | null = noAskHrids.length > 0
    ? 'input'
    : noBid || primaryHistoryMissing
      ? 'output'
      : bottleneck?.side ?? null;

  return {
    theoreticalProfitPerDay: candidate.profitPerDay,
    realizableProfitPerDay: operationRatio === null ? null : candidate.profitPerDay * operationRatio,
    safeHoursPerDay: operationRatio === null ? null : 24 * operationRatio,
    safeBatchUnits: bottleneck?.capacity.safeUnitsPerDay ?? null,
    sellThroughDays,
    marketSharePct: outputShare24hPct,
    outputShare24hPct,
    outputUnitsPerDay,
    outputVolume24h: primaryCapacity?.volume24h ?? null,
    outputVolumeCoverageHours: primaryCapacity?.coverageHours24h ?? null,
    primaryOutputHrid: identity.itemHrid,
    primaryOutputMode,
    maxInputShare24hPct,
    inputBottleneckHrid: inputBottleneck?.flow.itemHrid ?? null,
    inputBottleneckVolume24h: inputBottleneck?.capacity.volume24h ?? null,
    riskCode,
    riskSeverity,
    riskLabel,
    bottleneckHrid,
    bottleneckSide,
    classification: classificationForSeverity(riskSeverity),
    warnings,
  };
}
