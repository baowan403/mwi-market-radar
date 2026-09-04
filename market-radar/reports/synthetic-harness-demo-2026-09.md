# MWI Market Radar: Synthetic Walk-Forward Harness Demo 報告 (2026-09)

> **重要聲明**：本報告由合成資料集（Synthetic Dataset）生成，僅展示 Walk-Forward 測試框架的管線連通性與數值完整性，**絕非真實市場實證結論**。不可據此斷言動能無 Alpha。

- **生成時間**：2026-09-04T03:18:07.533Z
- **GameData 版本約束**：1.2.0
- **樣本視窗**：共 60 個日快照（有效樣本 60 個）
- **時序切分機制**：Train 60% (36 天) / Validation 20% (12 天) / Holdout Test 20% (12 天)（時間無洩漏，嚴格非重疊視窗）

---

## 1. 三大 Baseline 核心定義

| Baseline | 代號 | 核心排序準則 | 考量維度 |
| :--- | :--- | :--- | :--- |
| **Baseline A** | `A_SafeProfit` | 純安全日利 (`realizableProfitPerDay`) | 扣除買賣價差、稅率、訂單簿消耗深度後的實質日利 |
| **Baseline B** | `B_SafeProfit_Momentum` | 安全日利 + 短期動能 (`Safe + Momentum`) | 安全日利基礎上，結合 72H 邊際利潤動能與短期短缺訊號進行動態加權 |
| **Baseline C** | `C_TheoreticalProfit` | 純理論日利極值 (`Theoretical Profit`) | 忽視市場買賣價差與流動性上限的理論極大值 |

---

## 2. Holdout 測試集對打表現 (Synthetic Demo)

### 2.1 各視窗指標對照表

| Baseline | 視窗 (Horizon) | 樣本數 | 勝率 (Hit Rate) | 每日平均收益變動率 (Margin Return %) | 最大不利回撤 (Max Drawdown) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline A (Safe Profit)** | 24h | 11 | 54.5% | 0.52% | 3.59% |
| | 3d | 3 | 66.7% | 1.65% | 4.57% |
| | 7d | 1 | 0.0% | -0.91% | 0.91% |
| **Baseline B (Safe + Momentum)** | 24h | 11 | 54.5% | 0.52% | 3.59% |
| | 3d | 3 | 66.7% | 1.65% | 4.57% |
| | 7d | 1 | 0.0% | -0.91% | 0.91% |
| **Baseline C (Theoretical)** | 24h | 11 | 54.5% | 0.52% | 3.59% |
| | 3d | 3 | 66.7% | 1.65% | 4.57% |
| | 7d | 1 | 0.0% | -0.91% | 0.91% |

---

## 3. 相對 Baseline A 之超額表現 (Outperformance vs Baseline A)

- **Baseline B (Safe + Momentum)**:
  - 邊際收益率相對增益 (Margin Uplift): **0.00%**
  - 平均勝率差異 (Hit Rate Diff): **0.00%**
- **Baseline C (Theoretical)**:
  - 邊際收益率相對增益 (Margin Uplift): **0.00%**
  - 平均勝率差異 (Hit Rate Diff): **0.00%**

---

## 4. 架構與定位建議

1. **框架驗證**：
   - 驗證 Walk-Forward 時序切分、滾動非重疊評估、品質門禁（版本比對與最低 quotes 門檻）在合成時序下運作正常。
2. **UI 定位原則**：
   - **安全日利 (Safe Profit)** 始終作為主要排序基準。
   - **動能訊號** 僅作為輔助標籤提示，不擅自取代安全日利權重。
