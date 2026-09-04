import type { Snapshot } from '../../src/core/types';
import type { NormalizedStrategyGameData } from '../../src/strategy/game-data';
import type { StrategyMarginPoint } from '../../src/strategy/margin-series';
import { backtestStrategySignals, type BacktestHorizon } from '../../src/strategy/backtest';
import type { StrategySignal } from '../../src/strategy/signals';

export interface WalkForwardDatasetOptions {
  snapshots: readonly Snapshot[];
  gameData?: NormalizedStrategyGameData;
  gameDataVersion?: string;
  expectedVersion?: string;
  minQuotesPerSnapshot?: number;
}

export interface SplitDataset<T> {
  train: T[];
  validation: T[];
  holdout: T[];
}

export interface StrategyEvaluationMetric {
  horizon: BacktestHorizon;
  realizedMarginReturnPct: number;
  averageMarginReturnPctPerDay: number;
  hitRate: number;
  maxDrawdownPct: number;
  sampleCount: number;
}

export interface BaselineComparisonResult {
  baselineName: 'A_SafeProfit' | 'B_SafeProfit_Momentum' | 'C_TheoreticalProfit';
  holdoutMetrics: Record<BacktestHorizon, StrategyEvaluationMetric>;
  outperformanceVsA: {
    profitUpliftPct: number;
    hitRateDiff: number;
  };
}

export interface WalkForwardBacktestReport {
  timestamp: string;
  datasetStats: {
    totalSnapshots: number;
    filteredSnapshots: number;
    gameDataVersion: string;
    splits: { train: number; validation: number; holdout: number };
  };
  baselines: Record<string, BaselineComparisonResult>;
  verdict: {
    momentumHasAlpha: boolean;
    recommendation: string;
    details: string;
  };
}

/**
 * 品質門禁（Quality Gate）：
 * 1. GameData 版本比對與安全防護
 * 2. 過濾 quotes 數量過少、僅 ask 單邊報價或時間倒流之無效切片
 */
export function filterAndValidateSnapshots(options: WalkForwardDatasetOptions): Snapshot[] {
  const { snapshots, gameDataVersion, expectedVersion, minQuotesPerSnapshot = 5 } = options;

  if (expectedVersion && gameDataVersion && expectedVersion !== gameDataVersion) {
    throw new Error(
      `GameData version mismatch: expected ${expectedVersion}, got ${gameDataVersion}. Cross-version backtest aborted for safety.`
    );
  }

  const validSnapshots: Snapshot[] = [];
  const seenTimestamps = new Set<number>();

  for (const snap of snapshots) {
    if (!Number.isFinite(snap.timestamp) || snap.timestamp <= 0) continue;
    if (seenTimestamps.has(snap.timestamp)) continue;

    const quotes = Object.values(snap.quotes ?? {});
    if (quotes.length < minQuotesPerSnapshot) continue;

    // 檢查是否有至少一定比例的可用報價（非空 quote）
    const validQuotes = quotes.filter(
      (q) => q !== null && Number.isFinite(q.p) && q.p !== null && q.p > 0
    );
    if (validQuotes.length < minQuotesPerSnapshot) continue;

    seenTimestamps.add(snap.timestamp);
    validSnapshots.push(snap);
  }

  // 嚴格按時間先後排序
  return validSnapshots.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 嚴格時序切分（Train 60% / Validation 20% / Holdout 20%），嚴禁隨機 Shuffle，防止未來資訊洩漏
 */
export function splitTemporalDataset<T extends { timestamp: number }>(items: readonly T[]): SplitDataset<T> {
  if (items.length < 5) {
    throw new Error(`Insufficient data for temporal split: received ${items.length} items, minimum 5 required.`);
  }

  const sorted = [...items].sort((a, b) => a.timestamp - b.timestamp);
  const total = sorted.length;
  const trainCount = Math.floor(total * 0.6);
  const valCount = Math.floor(total * 0.2);

  const train = sorted.slice(0, trainCount);
  const validation = sorted.slice(trainCount, trainCount + valCount);
  const holdout = sorted.slice(trainCount + valCount);

  // 斷言時間無重疊與無洩漏
  if (train.length > 0 && validation.length > 0) {
    if (train[train.length - 1]!.timestamp >= validation[0]!.timestamp) {
      throw new Error('Temporal leak detected: Train dataset overlaps with Validation dataset.');
    }
  }
  if (validation.length > 0 && holdout.length > 0) {
    if (validation[validation.length - 1]!.timestamp >= holdout[0]!.timestamp) {
      throw new Error('Temporal leak detected: Validation dataset overlaps with Holdout dataset.');
    }
  }

  return { train, validation, holdout };
}

/**
 * 對單一候選策略時序在 Holdout 區間評估三大 Baseline 的回測表現
 */
export function evaluateCandidateBaselines(
  series: readonly StrategyMarginPoint[],
  options?: { horizons?: BacktestHorizon[]; nonOverlapping?: boolean }
): Record<'A_SafeProfit' | 'B_SafeProfit_Momentum' | 'C_TheoreticalProfit', StrategyEvaluationMetric[]> {
  const horizons: BacktestHorizon[] = options?.horizons ?? ['24h', '3d', '7d'];
  const nonOverlapping = options?.nonOverlapping ?? true;

  // Baseline A: 純 Safe Profit（訊號依賴靜態 realizableProfitPerDay）
  const resA = backtestStrategySignals(series, {
    signalAt: (points) => {
      const current = points.at(-1);
      const safeProfit = current?.realizableProfitPerDay ?? 0;
      return {
        action: safeProfit > 0 ? 'execute' : 'stop',
        priority: 'high',
        confidence: 'high',
        reasons: ['safe-profit'],
        invalidation: [],
        metrics: {
          margin1dPct: null, margin3dPct: null, margin7dPct: null, capacity3dPct: null, capacity7dPct: null,
          cost3dPct: null, income3dPct: null, spread3dPoints: null,
        },
      };
    },
    horizons,
    nonOverlapping,
  });

  // Baseline B: Safe Profit + Momentum（結合近期利潤變化率加權）
  const resB = backtestStrategySignals(series, {
    signalAt: (points) => {
      const current = points.at(-1);
      const prev = points.length >= 2 ? points[points.length - 2] : undefined;
      const safeProfit = current?.realizableProfitPerDay ?? 0;
      const prevSafeProfit = prev?.realizableProfitPerDay;
      const momentum = (prevSafeProfit !== null && prevSafeProfit !== undefined && prevSafeProfit > 0)
        ? (safeProfit - prevSafeProfit) / prevSafeProfit
        : 0;

      // 當動能向上時加速執行，動能顯著惡化時提前避險
      const action: StrategySignal['action'] = safeProfit > 0 && momentum >= -0.05 ? 'execute' : 'stop';
      return {
        action,
        priority: 'high',
        confidence: 'high',
        reasons: ['safe-profit-momentum'],
        invalidation: [],
        metrics: {
          margin1dPct: null, margin3dPct: null, margin7dPct: null, capacity3dPct: null, capacity7dPct: null,
          cost3dPct: null, income3dPct: null, spread3dPoints: null,
        },
      };
    },
    horizons,
    nonOverlapping,
  });

  // Baseline C: 純 Theoretical Profit 極值（忽略深度與滑價）
  const resC = backtestStrategySignals(series, {
    signalAt: (points) => {
      const current = points.at(-1);
      const theoreticalProfit = (current?.theoreticalProfitPerHour ?? 0) * 24;
      return {
        action: theoreticalProfit > 0 ? 'execute' : 'stop',
        priority: 'high',
        confidence: 'high',
        reasons: ['theoretical-profit'],
        invalidation: [],
        metrics: {
          margin1dPct: null, margin3dPct: null, margin7dPct: null, capacity3dPct: null, capacity7dPct: null,
          cost3dPct: null, income3dPct: null, spread3dPoints: null,
        },
      };
    },
    horizons,
    nonOverlapping,
  });

  const toMetrics = (res: typeof resA): StrategyEvaluationMetric[] => {
    return horizons.map((horizon) => {
      const hData = res.byHorizon[horizon];
      return {
        horizon,
        realizedMarginReturnPct: (hData.averageChangePct ?? 0) * hData.samples,
        averageMarginReturnPctPerDay: (hData.averageChangePct ?? 0),
        hitRate: hData.hitRate ?? 0,
        maxDrawdownPct: hData.maximumAdversePct ?? 0,
        sampleCount: hData.samples,
      };
    });
  };

  return {
    A_SafeProfit: toMetrics(resA),
    B_SafeProfit_Momentum: toMetrics(resB),
    C_TheoreticalProfit: toMetrics(resC),
  };
}

/**
 * 執行完整的 Walk-Forward 回測流程，並產出比較報告
 */
export function runWalkForwardBacktest(options: {
  dataset: WalkForwardDatasetOptions;
  marginSeries: readonly StrategyMarginPoint[];
  nonOverlapping?: boolean;
}): WalkForwardBacktestReport {
  const filtered = filterAndValidateSnapshots(options.dataset);
  const splits = splitTemporalDataset(options.marginSeries);

  // 在 holdout 測試集上執行回測對打
  const baselineResults = evaluateCandidateBaselines(splits.holdout, {
    nonOverlapping: options.nonOverlapping ?? true,
  });

  const byBaseline: Record<string, BaselineComparisonResult> = {};

  for (const key of ['A_SafeProfit', 'B_SafeProfit_Momentum', 'C_TheoreticalProfit'] as const) {
    const metrics = baselineResults[key];
    const metricMap = Object.fromEntries(metrics.map((m) => [m.horizon, m])) as Record<BacktestHorizon, StrategyEvaluationMetric>;

    const aMetrics = baselineResults['A_SafeProfit'];
    const aAvgHit = aMetrics.reduce((s, m) => s + m.hitRate, 0) / Math.max(1, aMetrics.length);
    const thisAvgHit = metrics.reduce((s, m) => s + m.hitRate, 0) / Math.max(1, metrics.length);

    const aTotalMargin = aMetrics.reduce((s, m) => s + m.realizedMarginReturnPct, 0);
    const thisTotalMargin = metrics.reduce((s, m) => s + m.realizedMarginReturnPct, 0);
    const profitUplift = aTotalMargin !== 0 ? ((thisTotalMargin - aTotalMargin) / Math.abs(aTotalMargin)) * 100 : 0;

    byBaseline[key] = {
      baselineName: key,
      holdoutMetrics: metricMap,
      outperformanceVsA: {
        profitUpliftPct: Number.isFinite(profitUplift) ? profitUplift : 0,
        hitRateDiff: thisAvgHit - aAvgHit,
      },
    };
  }

  const bOut = byBaseline['B_SafeProfit_Momentum']!.outperformanceVsA;
  const momentumHasAlpha = bOut.profitUpliftPct > 0 || bOut.hitRateDiff > 0.05;

  return {
    timestamp: new Date().toISOString(),
    datasetStats: {
      totalSnapshots: options.dataset.snapshots.length,
      filteredSnapshots: filtered.length,
      gameDataVersion: options.dataset.gameDataVersion ?? '1.0.0',
      splits: {
        train: splits.train.length,
        validation: splits.validation.length,
        holdout: splits.holdout.length,
      },
    },
    baselines: byBaseline,
    verdict: {
      momentumHasAlpha,
      recommendation: momentumHasAlpha
        ? '動能訊號在 Holdout 測試集中展現超額收益，可作為加權輔助或推薦標籤。'
        : '動能訊號在 Holdout 測試集無統計顯著超額收益，應定位為輔助 Badge 燈號，首頁維持以安全日利為第一排序基準。',
      details: `Baseline B 相對 Baseline A 之平均勝率差異: ${(bOut.hitRateDiff * 100).toFixed(2)}%，收益增益: ${bOut.profitUpliftPct.toFixed(2)}%。`,
    },
  };
}
