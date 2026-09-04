# ADR-001: 市場行情 UI Surface 退役與市場資料引擎核心地位確立

- **狀態**：Accepted
- **日期**：2026-09-04
- **決策者**：MWI Market Radar 架構委員會 / 使用者指令

---

## 背景與脈絡 (Context)

MWI Market Radar 在初期版本中同時提供了「市場行情」（純現貨價格列表）與「策略推薦」（端到端套利與製造收益計算）兩大分頁。

經過產品定位與架構審視：
1. **「市場行情」UI 分頁缺乏產品差異化**：純報價展示與 MWI 官方市場、Milkonomy 等現有工具完全重疊，無法提供不可替代價值，且分散了使用者注意力與首頁視覺焦點。
2. **市場資料引擎為不可或缺的核心基礎設施**：策略推薦（Strategy Recommendation）的所有計算（現貨買賣價、1D/3D/7D 變化率、72H 價格時間序列、市場承接容量折算、安全日利、短期動能與 Alpha 暴利短缺偵測）完全依賴於即時快照（Snapshots）、官方市場輪詢（Polling）、雲端歷史歸檔（Cloud History）與混合客戶端（Hybrid Client）。

---

## 決策 (Decision)

1. **市場行情 UI Surface 正式退役**：
   - 移除應用程式頂部導航之「市場行情」切換按鈕，首頁預設且唯一呈現「策略推薦」。
   - 退役市場行情專屬之純表格渲染器（Market Table）、行情分類導航（Category Nav）與行情工具列（Toolbar）。
   - **禁止恢復原則**：市場行情 UI Surface 於 2026-09-04 正式退役，在未經使用者明確書面要求前，任何維護或 AI 代理人不得擅自恢復該 UI 入口。

2. **市場資料管線（Market Data Infrastructure）地位確立**：
   - 建立獨立的資料控制器（`MarketDataController`），負責管理：
     - `snapshots`（記憶體快照串流）
     - `hybridClient` / `cloudClient` / `officialClient`
     - `polling` / `refresh`（背景定期輪詢與即時更新）
     - `collectorStatus`（採集健康度回報）
   - 策略推薦視圖（`StrategyView`）直接依賴並消費 `MarketDataController`。
   - **核心依賴宣告**：所有市場快照（Snapshots）、採集器（Collector）、雲端歷史（Cloud History）與即時價格管線均屬策略推薦引擎之第一級核心主動依賴（Active Core Dependencies），**嚴格禁止標記為 `@deprecated` 或停止資料輪詢**。

---

## 後續影響 (Consequences)

### 正向效益
- 介面聚焦於核心競爭力（真實持有最適配裝、動態最優茶、安全日利與市場動能）。
- 市場資料管線與純 UI 徹底解耦，職責分明，大幅降低未來的架構維護複雜度。
- 避免因误刪行情資料輪詢而導致策略推薦無數據可用（斷水斷電）的嚴重事故。

### 合規與防護
- 本決策記錄作為專案根基架構契約（Architecture Contract），後續任何程式碼重構均須嚴格遵循此解耦契約。
