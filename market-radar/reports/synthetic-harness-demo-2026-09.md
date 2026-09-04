# MWI Market Radar: Synthetic Harness Walk-Forward 示範報告 (2026-09)

> [!WARNING]
> **本報告為合成資料測試架構示範（Synthetic Demo）**：
> 本文數據由隨機生成之 Synthetic Test Harness 產出，僅供驗證 Walk-Forward 回測運算框架程式邏輯之正確性（包含非重疊視窗切分、時間無洩漏、24h/3d/7d 多週期指標統計等）。
> **本報告絕非基於真實生產歷史資料庫之實證統計，嚴禁引申為「Momentum 無 Alpha」之產品定論。**

- **生成時間**：2026-09-04
- **資料性質**：Synthetic Walk-Forward Test Harness (合成數據)
- **GameData 版本約束**：1.2.0
- **樣本視窗**：共 60 個合成日快照
- **時序切分機制**：Train 60% (36 天) / Validation 20% (12 天) / Holdout Test 20% (12 天)（嚴禁隨機 Shuffle，時間無洩漏）

---

## 1. 三大 Baseline 核心定義

| Baseline | 代號 | 核心排序準則 | 考量維度 |
| :--- | :--- | :--- | :--- |
| **Baseline A** | `A_SafeProfit` | 純安全日利 (`realizableProfitPerDay`) | 扣除買賣價差、稅率、訂單簿消耗深度後的實質日利 |
| **Baseline B** | `B_SafeProfit_Momentum` | 安全日利 + 短期動能 (`Safe + Momentum`) | 安全日利基礎上，結合 72H 邊際利潤動能與短期短缺訊號進行動態加權 |
| **Baseline C** | `C_TheoreticalProfit` | 純理論日利極值 (`Theoretical Profit`) | 忽視市場買賣價差與流動性上限的理論極大值 |

---

## 2. Holdout 合成測試集運算指標 (非重疊視窗)

### 2.1 各視窗指標對照表 (百分比變動率)

> [!NOTE]
> 指標單位說明：
> - **勝率 (Hit Rate)**：持有該策略在該視窗期獲利大於 0 之機率。
> - **利潤變動率 (Margin Return %)**：該視窗期間利潤率之百分比變動（注意：此非實際已變現金幣，禁止混同為 Realized Net Profit）。
> - **最大不利回撤 (Max Drawdown %)**：走勢過程中最深回檔百分比。

| Baseline | 視窗 (Horizon) | 樣本數 | 勝率 (Hit Rate) | 平均利潤變動率 (%) | 最大不利回撤 (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline A (Safe Profit)** | 24h | 11 | 54.5% | +0.52% | 3.59% |
| | 3d | 3 | 66.7% | +1.65% | 4.57% |
| | 7d | 1 | 0.0% | -0.91% | 0.91% |
| **Baseline B (Safe + Momentum)** | 24h | 11 | 54.5% | +0.52% | 3.59% |
| | 3d | 3 | 66.7% | +1.65% | 4.57% |
| | 7d | 1 | 0.0% | -0.91% | 0.91% |
| **Baseline C (Theoretical)** | 24h | 11 | 54.5% | +0.52% | 3.59% |
| | 3d | 3 | 66.7% | +1.65% | 4.57% |
| | 7d | 1 | 0.0% | -0.91% | 0.91% |

---

## 3. UI 現狀與排序權重維護

1. **排序權重不變原則**：
   在累積足夠天數的真實生產歷史市場快照並產出正式實證報告之前，**維持既有產品定位不變**：
   - 默認排序：以 **安全日利 (Safe Profit)** 為主導。
   - 專區保留：**「⚡ 突發短缺 / 暴利 Alpha」** 獨立標籤頁與 Badge 保留，由玩家依短線風險偏好自由選取。
2. **CI 隔離原則**：
   本回測框架為合成驗證工具，**嚴禁掛入 CI 阻擋門禁**。
