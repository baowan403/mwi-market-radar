from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:140]!r}")
    write(path, text.replace(old, new, 1))


LIQUIDITY_TS = r'''import type { MarketKey, Snapshot } from '../core/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SAFE_SHARE = 0.05;
const MIN_DAILY_COVERAGE_HOURS = 12;
const MIN_ROLLING_24H_COVERAGE_HOURS = 12;
export const MIN_VOLUME_FLOOR = 5;
export const MAX_PRICE_DEVIATION_RATIO = 2.5;

export interface MarketCapacity {
  key: MarketKey;
  /** Estimated traded units during a normalized rolling 24-hour window. */
  volume24h: number | null;
  /** Raw sum of observed hourly `v` values in the rolling window. */
  observedVolume24h: number | null;
  /** Distinct quote-covered hours in the rolling 24-hour window. */
  coverageHours24h: number;
  volume24hSufficient: boolean;
  /** Median traded units per day across usable days in the last 3 days. */
  median3d: number | null;
  /** Median traded units per day across usable days in the last 7 days. */
  median7d: number | null;
  medianPrice7d: number | null;
  /** Quote-covered hourly samples, independent of whether v is null. */
  samples3d: number;
  samples7d: number;
  usableDays3d: number;
  usableDays7d: number;
  latestHourlyVolume: number | null;
  safeUnitsPerHour: number | null;
  safeUnitsPerDay: number | null;
  sufficient: boolean;
  isGhostLiquidity: boolean;
  askAvailable: boolean;
  bidAvailable: boolean;
}

interface DailyVolumeBucket {
  volume: number;
  coverageHours: number;
}

interface RollingVolume24h {
  volume24h: number | null;
  observedVolume24h: number | null;
  coverageHours24h: number;
  sufficient: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * marketplace.json `v` is hourly traded volume, not visible order-book depth.
 * Quotes with v=null are covered hours with zero observed trades. Missing quotes
 * remain uncovered rather than being silently treated as zero.
 */
function dailyVolumes(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
  days: number,
): { totals: number[]; coverageHours: number } {
  const buckets = Array.from({ length: days }, (): DailyVolumeBucket => ({ volume: 0, coverageHours: 0 }));
  let coverageHours = 0;
  for (const snapshot of snapshots) {
    if (snapshot.timestamp > latestTimestamp) continue;
    const ageMs = latestTimestamp - snapshot.timestamp;
    if (ageMs < 0 || ageMs >= days * DAY_MS) continue;
    const quote = snapshot.quotes[key];
    if (!quote) continue;
    const bucketIndex = Math.floor(ageMs / DAY_MS);
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    bucket.coverageHours += 1;
    coverageHours += 1;
    if (typeof quote.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0) {
      bucket.volume += quote.v;
    }
  }
  return {
    totals: buckets
      .filter((bucket) => bucket.coverageHours >= MIN_DAILY_COVERAGE_HOURS)
      .map((bucket) => bucket.volume),
    coverageHours,
  };
}

/**
 * Directly answers the product question: how many units traded in the latest 24h?
 * If 12-23 hourly samples are present, normalize the observed sum to 24h instead
 * of declaring the entire strategy unusable. Duplicate samples in the same hour
 * are collapsed to the newest snapshot.
 */
function rollingVolume24h(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
): RollingVolume24h {
  const latestByHour = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.timestamp > latestTimestamp) continue;
    const ageMs = latestTimestamp - snapshot.timestamp;
    if (ageMs < 0 || ageMs >= DAY_MS) continue;
    const hourBucket = Math.floor(snapshot.timestamp / HOUR_MS);
    const current = latestByHour.get(hourBucket);
    if (!current || snapshot.timestamp > current.timestamp) latestByHour.set(hourBucket, snapshot);
  }

  let observedVolume = 0;
  let coverageHours = 0;
  for (const snapshot of latestByHour.values()) {
    const quote = snapshot.quotes[key];
    if (!quote) continue;
    coverageHours += 1;
    if (typeof quote.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0) {
      observedVolume += quote.v;
    }
  }

  const sufficient = coverageHours >= MIN_ROLLING_24H_COVERAGE_HOURS;
  return {
    observedVolume24h: coverageHours > 0 ? observedVolume : null,
    volume24h: sufficient ? observedVolume * 24 / coverageHours : null,
    coverageHours24h: coverageHours,
    sufficient,
  };
}

function pricesInWindow(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
  hours: number,
): number[] {
  const cutoff = latestTimestamp - (hours - 1) * HOUR_MS;
  return snapshots
    .filter((snapshot) => snapshot.timestamp >= cutoff && snapshot.timestamp <= latestTimestamp)
    .map((snapshot) => {
      const quote = snapshot.quotes[key];
      return quote?.p ?? quote?.b ?? quote?.a;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

export function marketCapacity(key: MarketKey, snapshots: readonly Snapshot[]): MarketCapacity {
  const latest = snapshots.reduce<Snapshot | null>((current, snapshot) => (
    current === null || snapshot.timestamp > current.timestamp ? snapshot : current
  ), null);
  if (!latest) {
    return {
      key,
      volume24h: null,
      observedVolume24h: null,
      coverageHours24h: 0,
      volume24hSufficient: false,
      median3d: null,
      median7d: null,
      medianPrice7d: null,
      samples3d: 0,
      samples7d: 0,
      usableDays3d: 0,
      usableDays7d: 0,
      latestHourlyVolume: null,
      safeUnitsPerHour: null,
      safeUnitsPerDay: null,
      sufficient: false,
      isGhostLiquidity: false,
      askAvailable: false,
      bidAvailable: false,
    };
  }

  const rolling24h = rollingVolume24h(key, snapshots, latest.timestamp);
  const daily3d = dailyVolumes(key, snapshots, latest.timestamp, 3);
  const daily7d = dailyVolumes(key, snapshots, latest.timestamp, 7);
  const prices7d = pricesInWindow(key, snapshots, latest.timestamp, 168);
  const median3d = median(daily3d.totals);
  const median7d = median(daily7d.totals);
  const medianPrice7d = median(prices7d);
  const sufficient = daily3d.totals.length >= 2
    && daily7d.totals.length >= 3
    && median3d !== null
    && median7d !== null;

  // Capacity mode remains conservative, but the visible 24h share always uses
  // the direct rolling-24h volume above. This avoids one spike inflating a batch.
  const capacityBaselines: number[] = [];
  if (rolling24h.volume24h !== null) capacityBaselines.push(rolling24h.volume24h);
  if (sufficient && median3d !== null && median7d !== null) {
    capacityBaselines.push(median3d, median7d);
  }
  const safeUnitsPerDay = capacityBaselines.length > 0
    ? SAFE_SHARE * Math.min(...capacityBaselines)
    : null;
  const quote = latest.quotes[key];
  const latestHourlyVolume = typeof quote?.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0
    ? quote.v
    : null;
  const referenceVolume = rolling24h.volume24h ?? median7d;

  return {
    key,
    volume24h: rolling24h.volume24h,
    observedVolume24h: rolling24h.observedVolume24h,
    coverageHours24h: rolling24h.coverageHours24h,
    volume24hSufficient: rolling24h.sufficient,
    median3d,
    median7d,
    medianPrice7d,
    samples3d: daily3d.coverageHours,
    samples7d: daily7d.coverageHours,
    usableDays3d: daily3d.totals.length,
    usableDays7d: daily7d.totals.length,
    latestHourlyVolume,
    safeUnitsPerHour: safeUnitsPerDay === null ? null : safeUnitsPerDay / 24,
    safeUnitsPerDay,
    sufficient,
    isGhostLiquidity: referenceVolume !== null && referenceVolume < MIN_VOLUME_FLOOR * 24,
    askAvailable: typeof quote?.a === 'number' && Number.isFinite(quote.a) && quote.a >= 0,
    bidAvailable: typeof quote?.b === 'number' && Number.isFinite(quote.b) && quote.b >= 0,
  };
}
'''
write('market-radar/src/strategy/liquidity.ts', LIQUIDITY_TS)

REALIZABLE_TS = r'''import type { MarketKey, Snapshot } from '../core/types';
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
'''
write('market-radar/src/strategy/realizable.ts', REALIZABLE_TS)

# Trend priority uses theoretical/current profit first and no longer lets a
# capacity-null value force every row to low priority.
replace_once(
    'market-radar/src/strategy/signals.ts',
    "function profitOf(point: StrategyMarginPoint | null | undefined): number | null {\n  if (!point) return null;\n  if (finite(point.realizableProfitPerDay)) return point.realizableProfitPerDay;\n  if (finite(point.theoreticalProfitPerHour)) return point.theoreticalProfitPerHour * 24;\n  return null;\n}",
    "function profitOf(point: StrategyMarginPoint | null | undefined): number | null {\n  if (!point) return null;\n  // Trend columns describe the current Ask/Bid strategy margin. Capacity is a\n  // separate risk signal and must not rewrite the profit history itself.\n  if (finite(point.theoreticalProfitPerHour)) return point.theoreticalProfitPerHour * 24;\n  if (finite(point.realizableProfitPerDay)) return point.realizableProfitPerDay;\n  return null;\n}",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "  if (spanDays < 7) {\n    return {\n      action: 'wait', priority: 'low', confidence, reasons: ['有效歷史不足 7 天，不宣稱趨勢'],\n      invalidation: ['累積滿 7 天有效資料後重新判斷'], metrics: emptyMetrics,\n    };\n  }",
    "  if (spanDays < 7) {\n    return {\n      action: 'wait', priority: 'medium', confidence, reasons: ['有效歷史不足 7 天，暫以中性優先級呈現'],\n      invalidation: ['累積滿 7 天有效資料後重新判斷'], metrics: emptyMetrics,\n    };\n  }",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "  if (!latest.complete || !finite(latest.realizableProfitPerDay)) {\n    return {\n      action: 'wait', priority: 'low', confidence, reasons: ['最新市場承接資料仍不完整'],\n      invalidation: ['補齊 3D／7D 成交量樣本後重新判斷'], metrics,\n    };\n  }",
    "  if (!latest.complete || !finite(latest.realizableProfitPerDay)) {\n    // Keep the trend/priority usable. Missing capacity evidence lowers confidence\n    // but no longer acts as a one-vote veto that forces every strategy to low.\n    confidence = confidence === 'none' ? 'none' : 'low';\n  }",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "  if (options.latestSnapshotAgeMs !== undefined && options.latestSnapshotAgeMs > 60 * 60_000) {\n    return {\n      action: 'wait', priority: 'low', confidence: 'none',\n      reasons: ['市場快照已超過 60 分鐘，暫停產生可執行建議'],\n      invalidation: ['取得 60 分鐘內的新市場快照後重新判斷'], metrics,\n    };\n  }\n  if (options.latestSnapshotAgeMs !== undefined && options.latestSnapshotAgeMs > 15 * 60_000) {\n    confidence = confidence === 'none' ? 'none' : 'low';\n  }",
    "  if (options.latestSnapshotAgeMs !== undefined && options.latestSnapshotAgeMs > 180 * 60_000) {\n    return {\n      action: 'wait', priority: 'low', confidence: 'none',\n      reasons: ['市場快照已超過 180 分鐘，暫停產生可執行建議'],\n      invalidation: ['取得 180 分鐘內的新市場快照後重新判斷'], metrics,\n    };\n  }\n  if (options.latestSnapshotAgeMs !== undefined && options.latestSnapshotAgeMs > 60 * 60_000) {\n    confidence = confidence === 'none' ? 'none' : 'low';\n  }",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "  const recentPeak = ordered\n    .filter((point) => point.timestamp >= latest.timestamp - 7 * DAY_MS && finite(point.realizableProfitPerDay))\n    .reduce((peak, point) => Math.max(peak, point.realizableProfitPerDay!), latest.realizableProfitPerDay);\n\n  // ── 紅燈：利潤歸零或暴跌 → 停止 ──\n  if (\n    latest.realizableProfitPerDay <= 0\n    || (metrics.margin3dPct !== null && metrics.margin3dPct <= -30 && recentPeak > latest.realizableProfitPerDay * 1.5)\n  ) {\n    const reason = latest.realizableProfitPerDay <= 0\n      ? '目前可實現利潤歸零或為負'",
    "  const currentProfit = latestProfit ?? 0;\n  const recentPeak = ordered\n    .filter((point) => point.timestamp >= latest.timestamp - 7 * DAY_MS && finite(profitOf(point)))\n    .reduce((peak, point) => Math.max(peak, profitOf(point)!), currentProfit);\n\n  // ── 紅燈：當前利潤歸零或暴跌 → 停止 ──\n  if (\n    currentProfit <= 0\n    || (metrics.margin3dPct !== null && metrics.margin3dPct <= -30 && recentPeak > currentProfit * 1.5)\n  ) {\n    const reason = currentProfit <= 0\n      ? '目前日利歸零或為負'",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "    if (risk === 'limited') {\n      if (priority === 'top' || priority === 'high') {\n        priority = 'medium';\n        trendNote += '；市場深度受限（高風險），降為中等優先';\n      }\n    } else if (risk === 'reject' || risk === 'insufficient') {\n      priority = 'low';\n      trendNote += '；市場深度嚴重不足或缺資料，降為低優先';\n    }",
    "    if (risk === 'small-test') {\n      if (priority === 'top') priority = 'high';\n      trendNote += '；市場占比需留意，優先級小幅降一級';\n    } else if (risk === 'limited') {\n      if (priority === 'top' || priority === 'high') priority = 'medium';\n      trendNote += '；成品承接或原料供給偏緊，降為中等優先';\n    } else if (risk === 'reject') {\n      priority = 'low';\n      trendNote += '；存在明顯滯銷、進貨或報價風險，降為低優先';\n    } else if (risk === 'insufficient') {\n      if (priority === 'top' || priority === 'high') priority = 'medium';\n      confidence = confidence === 'none' ? 'none' : 'low';\n      trendNote += '；主要市場量資料不完整，保留中性優先而非直接判低';\n    }",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "    const isAlpha = isHealthy && (isSurge1d || isSurgeIncome) && (latest.realizableProfitPerDay ?? 0) > 0;",
    "    const isAlpha = isHealthy && (isSurge1d || isSurgeIncome) && currentProfit > 0;",
)
replace_once(
    'market-radar/src/strategy/signals.ts',
    "      const profitWeight = Math.min(50, (latest.realizableProfitPerDay ?? 0) / 1_000_000);",
    "      const profitWeight = Math.min(50, currentProfit / 1_000_000);",
)

# View: display direct final-output 24h share, explicit risk reasons, and keep
# priority useful even when a secondary drop lacks history.
replace_once(
    'market-radar/src/strategy/view.ts',
    "function trendPct(value: number | null): string {\n  if (value === null || !Number.isFinite(value)) return '—';\n  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;\n}",
    "function trendPct(value: number | null): string {\n  if (value === null || !Number.isFinite(value)) return '—';\n  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;\n}\n\nfunction sharePct(value: number | null): string {\n  if (value === null) return '—';\n  if (!Number.isFinite(value)) return '∞';\n  return `${value.toFixed(1)}%`;\n}",
)
old_share = '''  const shareCell = element('td', 'strategy-market-share');
  if (liquidity.marketSharePct !== null && Number.isFinite(liquidity.marketSharePct)) {
    const pct = liquidity.marketSharePct;
    shareCell.textContent = `${pct.toFixed(1)}%`;
    if (pct <= 5) shareCell.classList.add('share-safe');
    else if (pct <= 10) shareCell.classList.add('share-warning');
    else if (pct <= 25) shareCell.classList.add('share-danger');
    else shareCell.classList.add('share-critical');
    shareCell.title = `做滿 24 小時產量占市場日成交量約 ${pct.toFixed(1)}%`;
  } else {
    shareCell.textContent = '—';
  }
  row.append(shareCell);
'''
new_share = '''  const shareCell = element('td', 'strategy-market-share');
  const outputShare = liquidity.outputShare24hPct;
  if (liquidity.primaryOutputMode === 'non-market') {
    shareCell.textContent = '免出售';
    shareCell.classList.add('share-safe');
    shareCell.title = '主要產物不需要經市場出售，因此沒有成品滯銷占比';
  } else if (liquidity.primaryOutputMode === 'derived') {
    shareCell.textContent = '衍生清算';
    shareCell.title = '主要產物以展開後的衍生清算流估值，沒有可直接比較的單一成品成交量';
  } else if (outputShare !== null) {
    shareCell.textContent = sharePct(outputShare);
    if (outputShare <= 3) shareCell.classList.add('share-safe');
    else if (outputShare <= 5) shareCell.classList.add('share-warning');
    else if (outputShare <= 10) shareCell.classList.add('share-danger');
    else shareCell.classList.add('share-critical');
    const outputName = liquidity.primaryOutputHrid
      ? options.itemName(liquidity.primaryOutputHrid)
      : '主要成品';
    shareCell.title = `${outputName}：24H 產量 ${metric(liquidity.outputUnitsPerDay)} ÷ 24H 成交量 ${metric(liquidity.outputVolume24h)} = ${sharePct(outputShare)}（覆蓋 ${liquidity.outputVolumeCoverageHours ?? 0} 小時）`;
  } else if (liquidity.riskCode === 'no-bid' || liquidity.riskCode === 'market-unavailable') {
    shareCell.textContent = '無買單';
    shareCell.classList.add('share-critical');
    shareCell.title = '主要成品目前沒有可用買一價';
  } else {
    shareCell.textContent = '資料不足';
    shareCell.title = `主要成品最近 24H 僅覆蓋 ${liquidity.outputVolumeCoverageHours ?? 0} 小時，尚不足以估算日產占比`;
  }
  row.append(shareCell);
'''
replace_once('market-radar/src/strategy/view.ts', old_share, new_share)
old_risk = '''  const classificationCell = element('td', 'strategy-classification-cell');
  const classification = element('span', 'strategy-classification');
  classification.dataset.classification = liquidity.classification;
  classification.textContent = CLASSIFICATION_LABELS[liquidity.classification];
  classification.title = liquidity.classification === 'insufficient'
    ? '缺少足夠的 3D／7D 成交量資料；當前日利仍依即時市場價格正常顯示'
    : liquidity.bottleneckHrid
      ? `瓶頸：${options.itemName(liquidity.bottleneckHrid)}（${liquidity.bottleneckSide === 'input' ? '買入' : '賣出'}端）`
      : '未發現外部市場瓶頸';
  classificationCell.append(classification);
  row.append(classificationCell);
'''
new_risk = '''  const classificationCell = element('td', 'strategy-classification-cell');
  const classification = element('span', 'strategy-classification');
  classification.dataset.classification = liquidity.classification;
  classification.dataset.riskCode = liquidity.riskCode;
  classification.dataset.riskSeverity = liquidity.riskSeverity;
  classification.textContent = liquidity.riskLabel;
  const riskDetails = [liquidity.riskLabel];
  if (liquidity.outputShare24hPct !== null) {
    riskDetails.push(`成品日產占比 ${sharePct(liquidity.outputShare24hPct)}`);
  }
  if (liquidity.maxInputShare24hPct !== null) {
    const inputName = liquidity.inputBottleneckHrid
      ? options.itemName(liquidity.inputBottleneckHrid)
      : '主要原料';
    riskDetails.push(`${inputName} 24H 需求占成交量 ${sharePct(liquidity.maxInputShare24hPct)}`);
  }
  if (liquidity.bottleneckHrid) {
    riskDetails.push(`瓶頸：${options.itemName(liquidity.bottleneckHrid)}（${liquidity.bottleneckSide === 'input' ? '買入' : '賣出'}端）`);
  }
  classification.title = riskDetails.join('｜');
  classificationCell.append(classification);
  row.append(classificationCell);
'''
replace_once('market-radar/src/strategy/view.ts', old_risk, new_risk)
replace_once(
    'market-radar/src/strategy/view.ts',
    "  const details = [\n    `安全執行 ${metric(liquidity.safeHoursPerDay, '小時')}`,\n    bottleneck,\n    `所需啟動現金 ${money(decision.funding.cashRequired)}`,\n    `訊號 ${SIGNAL_LABELS[assessedSignal.signal.action]}｜${MOMENTUM_LABELS[assessedSignal.signal.priority]}動能`,\n  ];",
    "  const outputShareDetail = liquidity.primaryOutputMode === 'non-market'\n    ? '成品日產占比 免出售'\n    : liquidity.primaryOutputMode === 'derived'\n      ? '成品日產占比 衍生清算'\n      : `成品日產占比 ${sharePct(liquidity.outputShare24hPct)}`;\n  const inputShareDetail = `最大原料需求占比 ${sharePct(liquidity.maxInputShare24hPct)}`;\n  const details = [\n    outputShareDetail,\n    inputShareDetail,\n    `市場風險 ${liquidity.riskLabel}`,\n    `容量參考 ${metric(liquidity.safeHoursPerDay, '小時')}`,\n    bottleneck,\n    `所需啟動現金 ${money(decision.funding.cashRequired)}`,\n    `訊號 ${SIGNAL_LABELS[assessedSignal.signal.action]}｜${MOMENTUM_LABELS[assessedSignal.signal.priority]}動能`,\n  ];",
)

# Explicit colors for new share and risk severity boundaries.
styles = read('market-radar/src/styles.css')
marker = '/* simplified-market-assessment */'
if marker not in styles:
    styles += r'''

/* simplified-market-assessment */
.strategy-classification[data-risk-severity='low'] {
  color: #34d399;
}

.strategy-classification[data-risk-severity='medium'] {
  color: #facc15;
}

.strategy-classification[data-risk-severity='high'] {
  color: #fb923c;
}

.strategy-classification[data-risk-severity='critical'] {
  color: #fb7185;
}

.strategy-classification[data-risk-severity='unknown'] {
  color: var(--color-muted);
}
'''
    write('market-radar/src/styles.css', styles)

# Unit tests: direct 24h output share, separate input pressure, secondary drops
# no longer vetoing the entire strategy.
LIQUIDITY_TEST = r'''import { describe, expect, it } from 'vitest';
import { marketCapacity } from '../src/strategy/liquidity';
import type { MarketKey, Snapshot } from '../src/core/types';

const HOUR = 3_600_000;
const KEY = '/items/output::0' as MarketKey;

function history(hours: number, volume: (index: number) => number | null = () => 100): Snapshot[] {
  return Array.from({ length: hours }, (_, index) => ({
    timestamp: index * HOUR,
    quotes: {
      [KEY]: { a: 110, b: 100, p: 105, v: volume(index) },
    },
  }));
}

describe('daily traded-volume market capacity', () => {
  it('exposes the direct rolling 24h traded volume while retaining conservative batch capacity', () => {
    const result = marketCapacity(KEY, history(169, (index) => index >= 97 ? 120 : 100));

    expect(result.volume24h).toBe(2_880);
    expect(result.coverageHours24h).toBe(24);
    expect(result.volume24hSufficient).toBe(true);
    expect(result.median3d).toBe(2_880);
    expect(result.median7d).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
    expect(result.safeUnitsPerHour).toBe(5);
    expect(result.usableDays3d).toBe(3);
    expect(result.usableDays7d).toBe(7);
    expect(result.sufficient).toBe(true);
  });

  it('normalizes 12-23 covered hours instead of declaring all 24h volume unavailable', () => {
    const result = marketCapacity(KEY, history(20));
    expect(result.coverageHours24h).toBe(20);
    expect(result.observedVolume24h).toBe(2_000);
    expect(result.volume24h).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
    expect(result.sufficient).toBe(false);
  });

  it('does not let one hourly spike inflate the conservative multi-day capacity baseline', () => {
    const result = marketCapacity(KEY, history(169, (index) => index === 168 ? 10_000 : 100));
    expect(result.volume24h).toBe(12_300);
    expect(result.median3d).toBe(2_400);
    expect(result.median7d).toBe(2_400);
    expect(result.safeUnitsPerDay).toBe(120);
  });

  it('separates quote availability from traded-volume evidence', () => {
    const zero = history(169, () => null);
    zero.at(-1)!.quotes[KEY] = { a: 110, b: null, p: null, v: null };
    const result = marketCapacity(KEY, zero);

    expect(result.volume24h).toBe(0);
    expect(result.median3d).toBe(0);
    expect(result.safeUnitsPerDay).toBe(0);
    expect(result.askAvailable).toBe(true);
    expect(result.bidAvailable).toBe(false);
  });
});
'''
write('market-radar/tests/strategy-liquidity.test.ts', LIQUIDITY_TEST)

REALIZABLE_TEST = r'''import { describe, expect, it } from 'vitest';
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
'''
write('market-radar/tests/strategy-realizable.test.ts', REALIZABLE_TEST)

replace_once(
    'market-radar/tests/strategy-realizable-tea.test.ts',
    "    expect(result.classification).toBe('insufficient');\n    expect(result.realizableProfitPerDay).toBeNull();\n    expect(result.bottleneckHrid).toBe('/items/alchemy_tea');",
    "    expect(result.classification).toBe('reject');\n    expect(result.riskCode).toBe('no-ask');\n    expect(result.riskLabel).toBe('原料無賣單');\n    expect(result.realizableProfitPerDay).toBe(0);\n    expect(result.bottleneckHrid).toBe('/items/alchemy_tea');",
)
replace_once(
    'market-radar/tests/strategy-signals.test.ts',
    "    expect(signal.action).toBe('wait');\n    expect(signal.confidence).toBe('none');\n    expect(signal.reasons.join(' ')).toContain('不足 7 天');",
    "    expect(signal.action).toBe('wait');\n    expect(signal.priority).toBe('medium');\n    expect(signal.confidence).toBe('none');\n    expect(signal.reasons.join(' ')).toContain('不足 7 天');",
)
# Add regression for capacity-null not forcing low.
replace_once(
    'market-radar/tests/strategy-signals.test.ts',
    "  it('blocks executable language when the latest market snapshot is stale', () => {",
    "  it('does not force priority to low only because capacity evidence is incomplete', () => {\n    const points = series(8, (ratio) => ({\n      cost: 100,\n      income: 200 + 30 * ratio,\n      capacity: 100,\n      spread: 1,\n    }));\n    const latest = points.at(-1)!;\n    latest.realizableProfitPerDay = null;\n    latest.complete = false;\n    latest.classification = 'insufficient';\n\n    const signal = strategyTrendSignal(points, { classification: 'insufficient' });\n    expect(signal.priority).toBe('medium');\n    expect(signal.reasons.join(' ')).toContain('保留中性優先');\n  });\n\n  it('blocks executable language when the latest market snapshot is stale', () => {",
)
replace_once(
    'market-radar/tests/strategy-signals.test.ts',
    "    })), { latestSnapshotAgeMs: 60 * 60_000 + 1 });\n\n    expect(signal.action).toBe('wait');\n    expect(signal.confidence).toBe('none');\n    expect(signal.reasons.join(' ')).toContain('超過 60 分鐘');",
    "    })), { latestSnapshotAgeMs: 180 * 60_000 + 1 });\n\n    expect(signal.action).toBe('wait');\n    expect(signal.confidence).toBe('none');\n    expect(signal.reasons.join(' ')).toContain('超過 180 分鐘');",
)

# View expectations now use explicit risk diagnoses.
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "    expect(target.querySelector('[data-strategy-row=\"insufficient\"] .strategy-classification')?.textContent).toBe('資料不足');",
    "    expect(target.querySelector('[data-strategy-row=\"insufficient\"] .strategy-classification')?.textContent).toBe('市場無報價');",
)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "    expect(target.querySelector('[data-strategy-row=\"limited\"]')?.textContent).toContain('高');",
    "    expect(target.querySelector('[data-strategy-row=\"limited\"]')?.textContent).toContain('雙向壓力');",
)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "    expect(detail.textContent).toContain('安全執行');",
    "    expect(detail.textContent).toContain('成品日產占比');\n    expect(detail.textContent).toContain('最大原料需求占比');\n    expect(detail.textContent).toContain('容量參考');",
)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "    expect(target.querySelector('[data-strategy-row=\"goblin_staff\"] .strategy-classification')?.textContent).toBe('資料不足');",
    "    expect(target.querySelector('[data-strategy-row=\"goblin_staff\"] .strategy-classification')?.textContent).toBe('市場無報價');",
)

print('Simple 24h market assessment patch applied.')
