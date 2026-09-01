import type { StrategyMarginPoint } from './margin-series';

export type StrategySignalAction = 'execute' | 'prepare' | 'wait' | 'sell' | 'stop';
export type StrategySignalConfidence = 'none' | 'low' | 'medium' | 'high';

export interface StrategySignalBacktest {
  passed: boolean;
  sampleSize: number;
  hitRate: number;
}

export interface StrategySignal {
  action: StrategySignalAction;
  confidence: StrategySignalConfidence;
  reasons: string[];
  invalidation: string[];
  metrics: {
    margin3dPct: number | null;
    margin7dPct: number | null;
    capacity3dPct: number | null;
    capacity7dPct: number | null;
    cost3dPct: number | null;
    income3dPct: number | null;
    spread3dPoints: number | null;
  };
}

const DAY_MS = 86_400_000;

function finite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function percentage(current: number | null, base: number | null): number | null {
  if (!finite(current) || !finite(base) || base === 0) return null;
  const value = (current - base) / Math.abs(base) * 100;
  return Number.isFinite(value) ? value : null;
}

function nearestPoint(
  points: readonly StrategyMarginPoint[],
  targetTimestamp: number,
): StrategyMarginPoint | null {
  return points.reduce<StrategyMarginPoint | null>((nearest, point) => {
    if (point.timestamp > targetTimestamp || !point.complete) return nearest;
    if (nearest === null) return point;
    return targetTimestamp - point.timestamp < targetTimestamp - nearest.timestamp ? point : nearest;
  }, null);
}

function confidenceFor(
  spanDays: number,
  backtest: StrategySignalBacktest | undefined,
): StrategySignalConfidence {
  if (spanDays < 7) return 'none';
  if (spanDays < 30 || backtest?.passed !== true) return 'low';
  if (backtest.sampleSize >= 20 && backtest.hitRate >= 0.65) return 'high';
  return 'medium';
}

function formatted(value: number | null): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function strategyTrendSignal(
  series: readonly StrategyMarginPoint[],
  options: { backtest?: StrategySignalBacktest } = {},
): StrategySignal {
  const ordered = [...series]
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  const latest = ordered.at(-1);
  const earliest = ordered[0];
  const emptyMetrics: StrategySignal['metrics'] = {
    margin3dPct: null,
    margin7dPct: null,
    capacity3dPct: null,
    capacity7dPct: null,
    cost3dPct: null,
    income3dPct: null,
    spread3dPoints: null,
  };
  if (!latest || !earliest) {
    return {
      action: 'wait', confidence: 'none', reasons: ['尚無策略歷史資料'],
      invalidation: ['累積至少 7 天有效資料後重新判斷'], metrics: emptyMetrics,
    };
  }
  const spanDays = (latest.timestamp - earliest.timestamp) / DAY_MS;
  const confidence = confidenceFor(spanDays, options.backtest);
  if (spanDays < 7) {
    return {
      action: 'wait', confidence, reasons: ['有效歷史不足 7 天，不宣稱趨勢'],
      invalidation: ['累積滿 7 天有效資料後重新判斷'], metrics: emptyMetrics,
    };
  }

  const base3d = nearestPoint(ordered, latest.timestamp - 3 * DAY_MS);
  const base7d = nearestPoint(ordered, latest.timestamp - 7 * DAY_MS);
  const metrics: StrategySignal['metrics'] = {
    margin3dPct: percentage(latest.realizableProfitPerDay, base3d?.realizableProfitPerDay ?? null),
    margin7dPct: percentage(latest.realizableProfitPerDay, base7d?.realizableProfitPerDay ?? null),
    capacity3dPct: percentage(latest.bottleneckSafeUnitsPerHour, base3d?.bottleneckSafeUnitsPerHour ?? null),
    capacity7dPct: percentage(latest.bottleneckSafeUnitsPerHour, base7d?.bottleneckSafeUnitsPerHour ?? null),
    cost3dPct: percentage(latest.costPerHour, base3d?.costPerHour ?? null),
    income3dPct: percentage(latest.incomePerHour, base3d?.incomePerHour ?? null),
    spread3dPoints: finite(latest.spreadPct) && finite(base3d?.spreadPct ?? null)
      ? latest.spreadPct - base3d!.spreadPct!
      : null,
  };
  if (!latest.complete || !finite(latest.realizableProfitPerDay)) {
    return {
      action: 'wait', confidence, reasons: ['最新市場承接資料仍不完整'],
      invalidation: ['補齊 3D／7D 成交量樣本後重新判斷'], metrics,
    };
  }

  const recentPeak = ordered
    .filter((point) => point.timestamp >= latest.timestamp - 7 * DAY_MS && finite(point.realizableProfitPerDay))
    .reduce((peak, point) => Math.max(peak, point.realizableProfitPerDay!), latest.realizableProfitPerDay);
  if (
    latest.realizableProfitPerDay <= 0
    || (metrics.margin3dPct !== null && metrics.margin3dPct <= -30 && recentPeak > latest.realizableProfitPerDay * 1.5)
  ) {
    return {
      action: 'stop', confidence,
      reasons: [latest.realizableProfitPerDay <= 0 ? '可實現利潤已轉為零或負值' : `3D 利潤反轉 ${formatted(metrics.margin3dPct)}`],
      invalidation: ['只有可實現利潤恢復為正，且 3D 改善至少 10% 才重新評估'], metrics,
    };
  }

  if (metrics.spread3dPoints !== null && metrics.spread3dPoints >= 3) {
    return {
      action: 'wait', confidence,
      reasons: [`3D 買賣價差擴大 ${metrics.spread3dPoints.toFixed(1)} 個百分點`],
      invalidation: ['價差需回落至少 3 個百分點，且成交容量不再下降'], metrics,
    };
  }

  if (
    metrics.cost3dPct !== null && metrics.cost3dPct >= 8
    && metrics.margin3dPct !== null && metrics.margin3dPct <= -5
  ) {
    return {
      action: 'wait', confidence,
      reasons: [`3D 投入成本上升 ${formatted(metrics.cost3dPct)}，正在壓縮利潤`],
      invalidation: ['投入成本 3D 漲幅降至 3% 以下，且利潤重新成長'], metrics,
    };
  }

  if (
    metrics.income3dPct !== null && metrics.income3dPct >= 10
    && metrics.capacity3dPct !== null && metrics.capacity3dPct <= -10
  ) {
    return {
      action: 'sell', confidence,
      reasons: [`3D 售價收入上升 ${formatted(metrics.income3dPct)}，但承接容量下降 ${formatted(metrics.capacity3dPct)}`],
      invalidation: ['若承接容量 3D 回升至 -5% 以上，改回生產評估'], metrics,
    };
  }

  const marginExpanding = (metrics.margin3dPct ?? Number.NEGATIVE_INFINITY) >= 3
    && (metrics.margin7dPct ?? Number.NEGATIVE_INFINITY) >= 5;
  const capacityConfirmed = (metrics.capacity3dPct ?? Number.NEGATIVE_INFINITY) >= 2
    && (metrics.capacity7dPct ?? Number.NEGATIVE_INFINITY) >= 5;
  if (marginExpanding && capacityConfirmed) {
    return {
      action: 'execute', confidence,
      reasons: [`3D／7D 利潤同步擴張（${formatted(metrics.margin3dPct)}／${formatted(metrics.margin7dPct)}）`, `3D／7D 容量同步增加（${formatted(metrics.capacity3dPct)}／${formatted(metrics.capacity7dPct)}）`],
      invalidation: ['3D 可實現日利下降超過 10%，或市場容量下降超過 20% 時停止加量'], metrics,
    };
  }
  if (marginExpanding) {
    return {
      action: 'prepare', confidence,
      reasons: [`利潤正在擴張，但市場容量尚未同步增加（3D ${formatted(metrics.capacity3dPct)}）`],
      invalidation: ['3D 利潤下降超過 10% 則取消準備；容量提升至少 5% 才升級為執行'], metrics,
    };
  }
  return {
    action: 'wait', confidence,
    reasons: [`3D／7D 利潤尚未形成一致擴張（${formatted(metrics.margin3dPct)}／${formatted(metrics.margin7dPct)}）`],
    invalidation: ['3D 利潤成長至少 3%、7D 至少 5%，再檢查成交容量'], metrics,
  };
}
