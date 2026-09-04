import fs from 'node:fs';
import path from 'node:path';
import { runWalkForwardBacktest } from './walk-forward-backtest';
import type { StrategyMarginPoint } from '../../src/strategy/margin-series';
import type { Snapshot } from '../../src/core/types';

const DAY = 86_400_000;
const START_TIME = Date.parse('2026-07-01T00:00:00.000Z');
const TOTAL_DAYS = 60;

// 生成具備真實市場特徵（上漲、短缺尖峰、均值回歸、修正）的 60 天時序
function generateMarketDataset(): { snapshots: Snapshot[]; marginSeries: StrategyMarginPoint[] } {
  const snapshots: Snapshot[] = [];
  const marginSeries: StrategyMarginPoint[] = [];

  for (let d = 0; d < TOTAL_DAYS; d++) {
    const timestamp = START_TIME + d * DAY;

    // 模擬基礎安全日利週期：
    // 前 25 天穩健上升（+1%~2%/day）
    // 26~35 天突發短缺尖峰（+15%/day）
    // 36~45 天均值回歸回落（-8%/day）
    // 46~60 天震盪整理（Holdout 區間）
    let trendFactor = 1.0;
    if (d <= 25) {
      trendFactor = 1.0 + d * 0.015;
    } else if (d <= 35) {
      trendFactor = 1.0 + 25 * 0.015 + (d - 25) * 0.08;
    } else if (d <= 45) {
      const peak = 1.0 + 25 * 0.015 + 10 * 0.08;
      trendFactor = peak - (d - 35) * 0.06;
    } else {
      const baseline = 1.0 + 25 * 0.015 + 10 * 0.08 - 10 * 0.06;
      trendFactor = baseline + Math.sin(d) * 0.04;
    }

    const baseCostPerHour = 2_000_000;
    const baseRevenuePerHour = 3_800_000 * trendFactor;
    const safeProfitPerHour = Math.max(0, baseRevenuePerHour - baseCostPerHour);
    const theoreticalProfitPerHour = safeProfitPerHour * 1.15; // 理論極值高約 15%（無滑價與滿載）

    snapshots.push({
      timestamp,
      quotes: {
        '/items/holy_milk::0': { a: 45000 * trendFactor, b: 43000 * trendFactor, p: 44000 * trendFactor, v: 1000 },
        '/items/milking_essence::0': { a: 52000 * trendFactor, b: 50000 * trendFactor, p: 51000 * trendFactor, v: 1000 },
        '/items/coin::0': { a: 1, b: 1, p: 1, v: 1000000 },
        '/items/catalytic_tea::0': { a: 12000, b: 11000, p: 11500, v: 5000 },
        '/items/efficiency_tea::0': { a: 8000, b: 7500, p: 7800, v: 5000 },
      },
    });

    marginSeries.push({
      timestamp,
      strategyId: 'alchemy:decompose:holy_milk',
      costPerHour: baseCostPerHour,
      incomePerHour: baseRevenuePerHour,
      theoreticalProfitPerHour,
      realizableProfitPerDay: safeProfitPerHour * 24,
      bottleneckHrid: '/items/holy_milk',
      bottleneckSafeUnitsPerHour: 120,
      spreadPct: 4.5,
      complete: true,
      classification: 'long-run',
    });
  }

  return { snapshots, marginSeries };
}

export function generateAndSaveReport() {
  const { snapshots, marginSeries } = generateMarketDataset();

  const report = runWalkForwardBacktest({
    dataset: {
      snapshots,
      gameDataVersion: '1.2.0',
      expectedVersion: '1.2.0',
    },
    marginSeries,
    nonOverlapping: true,
  });

  const jsonReportPath = path.resolve('reports/synthetic-harness-demo-2026-09.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('JSON report written to:', jsonReportPath);

  const bOut = report.baselines['B_SafeProfit_Momentum']?.outperformanceVsA;
  const cOut = report.baselines['C_TheoreticalProfit']?.outperformanceVsA;

  const aMetrics = report.baselines['A_SafeProfit']?.holdoutMetrics;
  const bMetrics = report.baselines['B_SafeProfit_Momentum']?.holdoutMetrics;
  const cMetrics = report.baselines['C_TheoreticalProfit']?.holdoutMetrics;

  const mdReport = `# MWI Market Radar: Synthetic Walk-Forward Harness Demo 報告 (2026-09)

> **重要聲明**：本報告由合成資料集（Synthetic Dataset）生成，僅展示 Walk-Forward 測試框架的管線連通性與數值完整性，**絕非真實市場實證結論**。不可據此斷言動能無 Alpha。

- **生成時間**：${report.timestamp}
- **GameData 版本約束**：${report.datasetStats.gameDataVersion}
- **樣本視窗**：共 ${report.datasetStats.totalSnapshots} 個日快照（有效樣本 ${report.datasetStats.filteredSnapshots} 個）
- **時序切分機制**：Train 60% (${report.datasetStats.splits.train} 天) / Validation 20% (${report.datasetStats.splits.validation} 天) / Holdout Test 20% (${report.datasetStats.splits.holdout} 天)（時間無洩漏，嚴格非重疊視窗）

---

## 1. 三大 Baseline 核心定義

| Baseline | 代號 | 核心排序準則 | 考量維度 |
| :--- | :--- | :--- | :--- |
| **Baseline A** | \`A_SafeProfit\` | 純安全日利 (\`realizableProfitPerDay\`) | 扣除買賣價差、稅率、訂單簿消耗深度後的實質日利 |
| **Baseline B** | \`B_SafeProfit_Momentum\` | 安全日利 + 短期動能 (\`Safe + Momentum\`) | 安全日利基礎上，結合 72H 邊際利潤動能與短期短缺訊號進行動態加權 |
| **Baseline C** | \`C_TheoreticalProfit\` | 純理論日利極值 (\`Theoretical Profit\`) | 忽視市場買賣價差與流動性上限的理論極大值 |

---

## 2. Holdout 測試集對打表現 (Synthetic Demo)

### 2.1 各視窗指標對照表

| Baseline | 視窗 (Horizon) | 樣本數 | 勝率 (Hit Rate) | 每日平均收益變動率 (Margin Return %) | 最大不利回撤 (Max Drawdown) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline A (Safe Profit)** | 24h | ${aMetrics?.['24h']?.sampleCount} | ${((aMetrics?.['24h']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(aMetrics?.['24h']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(aMetrics?.['24h']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| | 3d | ${aMetrics?.['3d']?.sampleCount} | ${((aMetrics?.['3d']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(aMetrics?.['3d']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(aMetrics?.['3d']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| | 7d | ${aMetrics?.['7d']?.sampleCount} | ${((aMetrics?.['7d']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(aMetrics?.['7d']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(aMetrics?.['7d']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| **Baseline B (Safe + Momentum)** | 24h | ${bMetrics?.['24h']?.sampleCount} | ${((bMetrics?.['24h']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(bMetrics?.['24h']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(bMetrics?.['24h']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| | 3d | ${bMetrics?.['3d']?.sampleCount} | ${((bMetrics?.['3d']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(bMetrics?.['3d']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(bMetrics?.['3d']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| | 7d | ${bMetrics?.['7d']?.sampleCount} | ${((bMetrics?.['7d']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(bMetrics?.['7d']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(bMetrics?.['7d']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| **Baseline C (Theoretical)** | 24h | ${cMetrics?.['24h']?.sampleCount} | ${((cMetrics?.['24h']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(cMetrics?.['24h']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(cMetrics?.['24h']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| | 3d | ${cMetrics?.['3d']?.sampleCount} | ${((cMetrics?.['3d']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(cMetrics?.['3d']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(cMetrics?.['3d']?.maxDrawdownPct ?? 0).toFixed(2)}% |
| | 7d | ${cMetrics?.['7d']?.sampleCount} | ${((cMetrics?.['7d']?.hitRate ?? 0) * 100).toFixed(1)}% | ${(cMetrics?.['7d']?.averageMarginReturnPctPerDay ?? 0).toFixed(2)}% | ${(cMetrics?.['7d']?.maxDrawdownPct ?? 0).toFixed(2)}% |

---

## 3. 相對 Baseline A 之超額表現 (Outperformance vs Baseline A)

- **Baseline B (Safe + Momentum)**:
  - 邊際收益率相對增益 (Margin Uplift): **${(bOut?.profitUpliftPct ?? 0).toFixed(2)}%**
  - 平均勝率差異 (Hit Rate Diff): **${((bOut?.hitRateDiff ?? 0) * 100).toFixed(2)}%**
- **Baseline C (Theoretical)**:
  - 邊際收益率相對增益 (Margin Uplift): **${(cOut?.profitUpliftPct ?? 0).toFixed(2)}%**
  - 平均勝率差異 (Hit Rate Diff): **${((cOut?.hitRateDiff ?? 0) * 100).toFixed(2)}%**

---

## 4. 架構與定位建議

1. **框架驗證**：
   - 驗證 Walk-Forward 時序切分、滾動非重疊評估、品質門禁（版本比對與最低 quotes 門檻）在合成時序下運作正常。
2. **UI 定位原則**：
   - **安全日利 (Safe Profit)** 始終作為主要排序基準。
   - **動能訊號** 僅作為輔助標籤提示，不擅自取代安全日利權重。
`;

  const mdReportPath = path.resolve('reports/synthetic-harness-demo-2026-09.md');
  fs.writeFileSync(mdReportPath, mdReport, 'utf-8');
  console.log('Markdown report written to:', mdReportPath);
}

if (process.argv[1] && (process.argv[1].endsWith('run-synthetic-harness.ts') || process.argv[1].endsWith('run-synthetic-harness.js'))) {
  generateAndSaveReport();
}

