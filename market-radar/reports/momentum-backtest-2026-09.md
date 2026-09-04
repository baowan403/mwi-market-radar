# MWI Market Radar: Walk-Forward 實證回測與三大 Baseline 對打報告 (2026-09)

- **生成時間**：2026-09-04T01:51:36.064Z
- **GameData 版本約束**：1.2.0
- **樣本視窗**：共 60 個日快照（有效樣本 60 個）
- **時序切分機制**：Train 60% (36 天) / Validation 20% (12 天) / Holdout Test 20% (12 天)（嚴禁隨機 Shuffle，時間無洩漏）

---

## 1. 三大 Baseline 核心定義

| Baseline | 代號 | 核心排序準則 | 考量維度 |
| :--- | :--- | :--- | :--- |
| **Baseline A** | `A_SafeProfit` | 純安全日利 (`realizableProfitPerDay`) | 扣除買賣價差、稅率、訂單簿消耗深度後的實質日利 |
| **Baseline B** | `B_SafeProfit_Momentum` | 安全日利 + 短期動能 (`Safe + Momentum`) | 安全日利基礎上，結合 72H 邊際利潤動能與短期短缺訊號進行動態加權 |
| **Baseline C** | `C_TheoreticalProfit` | 純理論日利極值 (`Theoretical Profit`) | 忽視市場買賣價差與流動性上限的理論極大值 |

---

## 2. Holdout 測試集實測對打表現 (嚴格非重疊視窗)

### 2.1 各視窗指標對照表

| Baseline | 視窗 (Horizon) | 樣本數 | 勝率 (Hit Rate) | 每日平均收益變動率 | 最大不利回撤 (Max Drawdown) |
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
  - 收益增益 (Profit Uplift): **0.00%**
  - 平均勝率差異 (Hit Rate Diff): **0.00%**
- **Baseline C (Theoretical)**:
  - 收益增益 (Profit Uplift): **0.00%**
  - 平均勝率差異 (Hit Rate Diff): **0.00%**

---

## 4. 統計審核裁決與產品定位建議 (Verdict & Architectural Action)

1. **實證結論**：
   - 動能訊號在 Holdout 測試集無統計顯著超額收益，應定位為輔助 Badge 燈號，首頁維持以安全日利為第一排序基準。
   - Baseline B 相對 Baseline A 之平均勝率差異: 0.00%，收益增益: 0.00%。
2. **UI 定位規則**：
   - **首頁默認主排序**：必須 100% 以 **安全日利 (Safe Profit)** 為第一基準，確保玩家不會被紙面數字誤導。
   - **動能訊號定位**：動能訊號與短缺提示保留為卡片及表格上的 **「暴利 Alpha / 短缺動能」輔助 Badge 燈號**，文案明確標註為短線突發機遇，不擅自取代安全日利做為主推薦權重。
   - **CI 隔離防護**：本回測為市場機制研究實證報告，**嚴格禁止作為 CI 強制阻擋門禁**，避免因正常市場 regime 波動造成 CI 假警報。
