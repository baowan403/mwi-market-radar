import type { StrategyMarginPoint } from './margin-series';

export type StrategySignalAction = 'execute' | 'prepare' | 'wait' | 'sell' | 'stop';
export type StrategySignalConfidence = 'none' | 'low' | 'medium' | 'high';
export type StrategyPriority = 'top' | 'high' | 'medium' | 'low';

export interface StrategySignalBacktest {
  passed: boolean;
  sampleSize: number;
  hitRate: number;
}

export interface StrategySignal {
  action: StrategySignalAction;
  priority: StrategyPriority;
  confidence: StrategySignalConfidence;
  reasons: string[];
  invalidation: string[];
  metrics: {
    margin1dPct: number | null;
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
    margin1dPct: null,
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
      action: 'wait', priority: 'low', confidence: 'none', reasons: ['尚無策略歷史資料'],
      invalidation: ['累積至少 7 天有效資料後重新判斷'], metrics: emptyMetrics,
    };
  }
  const spanDays = (latest.timestamp - earliest.timestamp) / DAY_MS;
  const confidence = confidenceFor(spanDays, options.backtest);
  if (spanDays < 7) {
    return {
      action: 'wait', priority: 'low', confidence, reasons: ['有效歷史不足 7 天，不宣稱趨勢'],
      invalidation: ['累積滿 7 天有效資料後重新判斷'], metrics: emptyMetrics,
    };
  }

  const base1d = nearestPoint(ordered, latest.timestamp - 1 * DAY_MS);
  const base3d = nearestPoint(ordered, latest.timestamp - 3 * DAY_MS);
  const base7d = nearestPoint(ordered, latest.timestamp - 7 * DAY_MS);
  const metrics: StrategySignal['metrics'] = {
    margin1dPct: percentage(latest.realizableProfitPerDay, base1d?.realizableProfitPerDay ?? null),
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
      action: 'wait', priority: 'low', confidence, reasons: ['最新市場承接資料仍不完整'],
      invalidation: ['補齊 3D／7D 成交量樣本後重新判斷'], metrics,
    };
  }

  const recentPeak = ordered
    .filter((point) => point.timestamp >= latest.timestamp - 7 * DAY_MS && finite(point.realizableProfitPerDay))
    .reduce((peak, point) => Math.max(peak, point.realizableProfitPerDay!), latest.realizableProfitPerDay);

  // ── 紅燈：利潤歸零或暴跌 → 停止 ──
  if (
    latest.realizableProfitPerDay <= 0
    || (metrics.margin3dPct !== null && metrics.margin3dPct <= -30 && recentPeak > latest.realizableProfitPerDay * 1.5)
  ) {
    return {
      action: 'stop', priority: 'low', confidence,
      reasons: [latest.realizableProfitPerDay <= 0 ? '可實現利潤已轉為零或負值' : `3D 利潤暴跌 ${formatted(metrics.margin3dPct)}`],
      invalidation: ['利潤恢復為正，且 3D 改善至少 10% 才重新評估'], metrics,
    };
  }

  // ── 黃燈：售價飆升但承接崩塌 → 出售獲利 ──
  if (
    metrics.income3dPct !== null && metrics.income3dPct >= 10
    && metrics.capacity3dPct !== null && metrics.capacity3dPct <= -10
  ) {
    return {
      action: 'sell', priority: 'medium', confidence,
      reasons: [`3D 售價上升 ${formatted(metrics.income3dPct)}，但承接容量下降 ${formatted(metrics.capacity3dPct)}`],
      invalidation: ['若承接容量 3D 回升至 -5% 以上，改回生產評估'], metrics,
    };
  }

  // ── 以下為「利潤為正」的分級推薦邏輯 ──
  const m1 = metrics.margin1dPct;
  const m3 = metrics.margin3dPct;
  const m7 = metrics.margin7dPct;

  // 綠燈：3D 利潤穩定或上升 → 立即製造
  if (m3 === null || m3 >= -2) {
    // 趨勢動能判定優先級：
    // 最高：1D 短線爆發（>= +1.5% 且 3D >= 0%）或長短線共振（3D >= +3% 且 7D >= 0%）
    const isSurging = (m1 !== null && m1 >= 1.5 && (m3 === null || m3 >= 0))
      || (m3 !== null && m3 >= 3 && (m7 === null || m7 >= 0));
    const priority: StrategyPriority = isSurging ? 'top' : 'high';

    const trendNote = isSurging
      ? (m1 !== null && m1 >= 1.5 ? `1D 利潤爆發（+${m1.toFixed(1)}%），處於擴張期` : `3D 利潤強勁（+${m3!.toFixed(1)}%）`)
      : m7 !== null && m7 >= 0
        ? `7D 利潤平穩，收益健康`
        : `3D 利潤穩定（${formatted(m3)}）`;
    return {
      action: 'execute', priority, confidence,
      reasons: [trendNote, '日利為正且近期無顯著下滑'],
      invalidation: ['3D 利潤下降超過 10% 時重新評估'], metrics,
    };
  }

  // 橙燈：3D 小幅下滑（-2%～-8%），但還沒崩 → 囤原料觀察
  if (m3 > -8) {
    const riskNote = m7 !== null && m7 >= 0
      ? `7D 仍為正向（${formatted(m7)}），但 3D 開始回調（${formatted(m3)}）`
      : `3D 下滑 ${formatted(m3)}，注意趨勢反轉風險`;
    return {
      action: 'prepare', priority: 'medium', confidence,
      reasons: [riskNote],
      invalidation: ['3D 改善至 -2% 以上則升級為推薦；惡化至 -10% 以下則降級為觀望'], metrics,
    };
  }

  // 灰燈：3D 下滑明顯（-8% 以上）→ 暫停觀望
  return {
    action: 'wait', priority: 'low', confidence,
    reasons: [`3D 利潤下滑 ${formatted(m3)}，建議暫時觀望`],
    invalidation: ['3D 利潤止跌回升至 -3% 以上再重新評估'], metrics,
  };
}
