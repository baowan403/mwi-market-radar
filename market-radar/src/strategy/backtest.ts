import type { StrategyMarginPoint } from './margin-series';
import type { StrategySignal, StrategySignalBacktest } from './signals';

export interface BacktestHorizonResult {
  samples: number;
  hitRate: number | null;
  averageChangePct: number | null;
  maximumAdversePct: number | null;
}

export interface StrategyBacktestResult {
  byHorizon: Record<'3d' | '7d', BacktestHorizonResult>;
  summary: StrategySignalBacktest;
}

export interface StrategyBacktestOptions {
  signalAt(series: readonly StrategyMarginPoint[]): StrategySignal;
}

const EMPTY_HORIZON: BacktestHorizonResult = {
  samples: 0, hitRate: null, averageChangePct: null, maximumAdversePct: null,
};

const DAY_MS = 86_400_000;
const HORIZONS = { '3d': 3 * DAY_MS, '7d': 7 * DAY_MS } as const;

interface Outcome {
  hit: boolean;
  changePct: number;
  adversePct: number;
}

function orderedSeries(series: readonly StrategyMarginPoint[]): StrategyMarginPoint[] {
  const byTimestamp = new Map<number, StrategyMarginPoint>();
  for (const point of series) {
    if (Number.isFinite(point.timestamp)) byTimestamp.set(point.timestamp, point);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function finiteProfit(point: StrategyMarginPoint | undefined): point is StrategyMarginPoint & { realizableProfitPerDay: number } {
  return point !== undefined
    && point.complete
    && typeof point.realizableProfitPerDay === 'number'
    && Number.isFinite(point.realizableProfitPerDay);
}

function changePct(current: number, base: number): number | null {
  if (base === 0) return null;
  const value = (current - base) / Math.abs(base) * 100;
  return Number.isFinite(value) ? value : null;
}

function direction(action: StrategySignal['action']): 1 | -1 | null {
  if (action === 'execute' || action === 'prepare') return 1;
  if (action === 'sell' || action === 'stop') return -1;
  return null;
}

function futureIndex(
  points: readonly StrategyMarginPoint[],
  currentIndex: number,
  horizonMs: number,
): number | null {
  const target = points[currentIndex]!.timestamp + horizonMs;
  for (let index = currentIndex + 1; index < points.length; index += 1) {
    const timestamp = points[index]!.timestamp;
    if (timestamp < target) continue;
    return timestamp <= points[currentIndex]!.timestamp + horizonMs * 1.25 ? index : null;
  }
  return null;
}

function outcomeFor(
  points: readonly StrategyMarginPoint[],
  currentIndex: number,
  targetIndex: number,
  expectedDirection: 1 | -1,
): Outcome | null {
  const current = points[currentIndex];
  const future = points[targetIndex];
  if (!finiteProfit(current) || !finiteProfit(future)) return null;
  const change = changePct(future.realizableProfitPerDay, current.realizableProfitPerDay);
  if (change === null) return null;
  let adverse = 0;
  for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
    const point = points[index];
    if (!finiteProfit(point)) continue;
    const interim = changePct(point.realizableProfitPerDay, current.realizableProfitPerDay);
    if (interim === null) continue;
    adverse = expectedDirection === 1
      ? Math.max(adverse, Math.max(0, -interim))
      : Math.max(adverse, Math.max(0, interim));
  }
  return { hit: change * expectedDirection > 0, changePct: change, adversePct: adverse };
}

function summarize(outcomes: readonly Outcome[]): BacktestHorizonResult {
  if (outcomes.length === 0) return { ...EMPTY_HORIZON };
  const hits = outcomes.filter((outcome) => outcome.hit).length;
  return {
    samples: outcomes.length,
    hitRate: hits / outcomes.length,
    averageChangePct: outcomes.reduce((sum, outcome) => sum + outcome.changePct, 0) / outcomes.length,
    maximumAdversePct: Math.max(...outcomes.map((outcome) => outcome.adversePct)),
  };
}

export function backtestStrategySignals(
  series: readonly StrategyMarginPoint[],
  options: StrategyBacktestOptions,
): StrategyBacktestResult {
  const points = orderedSeries(series);
  const outcomes: Record<'3d' | '7d', Outcome[]> = { '3d': [], '7d': [] };
  for (let index = 0; index < points.length; index += 1) {
    const targets = Object.fromEntries(Object.entries(HORIZONS).map(([key, horizon]) => [
      key, futureIndex(points, index, horizon),
    ])) as Record<'3d' | '7d', number | null>;
    if (targets['3d'] === null && targets['7d'] === null) continue;
    const actionDirection = direction(options.signalAt(points.slice(0, index + 1)).action);
    if (actionDirection === null) continue;
    for (const horizon of ['3d', '7d'] as const) {
      const target = targets[horizon];
      if (target === null) continue;
      const outcome = outcomeFor(points, index, target, actionDirection);
      if (outcome) outcomes[horizon].push(outcome);
    }
  }
  const byHorizon = {
    '3d': summarize(outcomes['3d']),
    '7d': summarize(outcomes['7d']),
  };
  const combined = [...outcomes['3d'], ...outcomes['7d']];
  const hits = combined.filter((outcome) => outcome.hit).length;
  const hitRate = combined.length === 0 ? 0 : hits / combined.length;
  return {
    byHorizon,
    summary: { passed: combined.length >= 10 && hitRate >= 0.55, sampleSize: combined.length, hitRate },
  };
}
