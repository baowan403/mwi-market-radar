# 牛牛股市七日逐時歷史回填設計

日期：2026-09-01（Asia/Taipei）

## 目標

以 Owner 已取得作者同意的牛牛股市公開歷史資料，一次性補齊 Market Radar 最近七日的逐時市場快照，讓 1D／3D／7D 價格趨勢、成交量承接、策略回測與資料品質判定立即有最低可用樣本。回填完成後，最新資料仍只由 MWI 官方 `marketplace.json` 每小時接續，不建立對牛牛股市的長期依賴。

本切片不修改策略公式、不新增隱藏收益路線，也不把七日樣本包裝成中高信心預測。策略信心與可售量規則沿用現有門檻。

## 選定方案

採一次性全市場逐時回填，不直接匯入牛牛的日 K。

牛牛日 K 以 Asia/Taipei 日界切分，而 Market Radar 的每日封包以 UTC 日界封存。直接混入日 K 會讓日期、成交量與 OHLC 邊界錯位。逐時資料保留原始 Unix timestamp，可由 Market Radar 依既有 UTC 規則自行聚合，避免雙重計算或錯置一天。

牛牛目前沒有公開的全市場歷史批次端點。回填流程先讀取 `/api/latest-status` 取得唯一物品名稱，再對每個物品呼叫 `/api/item/{item_name}/history?limit=200`；單一回應包含該物品所有強化等級。預估約 864 個唯讀請求，只執行一次。

## 執行入口與節流

新增獨立 CLI，並由 `workflow_dispatch` 的明確布林輸入啟用。排程與一般 source push 永遠不執行牛牛回填。

CLI 規則：

- 固定 HTTPS 來源 `https://www.stockmarket.xin`，不可由未受信任參數改寫主機。
- 並行上限 4；每批之間至少間隔 100 ms。
- 單一請求逾時 10 秒；僅對逾時、429、502、503、504 重試，最多 3 次，採遞增退避。
- 設定清楚的唯讀 User-Agent，不送角色資料、cookie、token 或 localStorage。
- 回填標記存在時預設冪等退出；只有新的明確 `--force` 才能重新驗證，但不得擴大七日範圍。

## 資料轉換

每筆牛牛歷史資料轉成現有 `Snapshot`：

- `timestamp`：秒轉毫秒，原樣保留，不做時區平移。
- market key：`/items/{item_name}::{level}`。
- `price_a／price_b／price_p／volume`：分別映射為 `a／b／p／v`。
- 負數、`-1` 及缺失價格正規化為 `null`；無價格時的 `volume: 0` 不得冒充真實成交。
- 只保留以最新官方 timestamp 為上界、向前七日內的資料。
- 同 timestamp 的所有物品與強化等級合併成一份完整快照。

目標為最多 168 個逐時 timestamp。允許官方或牛牛本身存在少量缺時，但發布前至少需要 150 個有效 timestamp，且每個歷史快照至少 350 個 market keys；不足時整次回填失敗，不發布半套資料。350 是後續公開歷史 compatibility probe（min 398／median 508 keys per hour）得出的實作門檻，不是 production run 證據；最新官方 overlap 另維持至少 1,000 個可比較 ask/bid 欄位。

## 官方重疊驗證與合併優先級

既有 MWI 官方快照是最高權威。

- 對所有重疊 timestamp 與 market key 比較 `a／b`；雙方皆有值時必須完全一致。
- `null` 與牛牛的 `-1` 視為同一種缺值；`p／v` 的缺值差異只可在正規化後接受。
- 任一實際買一／賣一不一致即停止，不提交 data branch，也不部署新網站。
- 重複 timestamp 永遠保留官方快照；牛牛只補不存在的舊 timestamp。
- 合併完成後仍受現有十日逐時 retention、manifest 嚴格驗證、daily-history 180 日上限與部署 rollback 保護。

資料應先在 runner temporary data tree 完成重建與完整驗證，再由既有 data-only worktree 提交；不可逐檔邊下載邊發布。

## 來源標示

新增 `data/history-provenance.json`，只記錄公開資料來源，不含玩家資料：

- schema version；
- `stockmarket.xin` 來源名稱與公開端點；
- Owner 已確認取得作者同意；
- fetch 時間、實際起訖 timestamp、回填快照數；
- 官方重疊比較數與結果；
- 最新行情仍由 MWI 官方提供的聲明。

Cloud client 僅接受同源、符合 schema 的 provenance。頁面資料來源顯示為「歷史回填：牛牛股市；最新行情：MWI 官方」。provenance 缺失時維持原本官方來源文字，不猜測來源。

## 錯誤處理

以下任一情況都必須 fail closed，保留目前網站與 data branch：

- OpenAPI 回應或歷史 row schema 不符；
- 物品名稱或強化等級無法正規化；
- timestamp 超出七日窗口、位於最新官方資料之後，或非安全整數；
- 有效 timestamp 少於 150；
- 任一歷史快照 market keys 少於 350；
- 官方重疊的實際買一／賣一不同；
- manifest、snapshot、daily-history 或 provenance 驗證失敗；
- 下載只完成一部分。

日誌只記錄請求進度、成功／失敗數、timestamp 範圍、quote count 與固定錯誤碼，不輸出完整市場 payload。

## 驗收

### 自動測試

- fixture 證明一個物品的多強化等級能合併至正確 market keys。
- fixture 證明 `-1／0` 缺值不會生成假價格或假成交量。
- 168 小時資料依 timestamp 聚合，不受 Asia/Taipei 日界影響。
- 官方重疊完全一致時官方優先；買一或賣一不同時整批拒絕。
- 少於 150 小時、少於 350 歷史 keys、未來 timestamp、錯誤 schema 與部分下載皆拒絕；最新官方 overlap 少於 1,000 個可比較 ask/bid 欄位亦拒絕。
- 第二次對同一來源執行不改 manifest、snapshot hash 或 provenance。
- cloud manifest、daily pack、dashboard、策略流動性與來源標示既有測試全部通過。

### 玩家可見驗收

- 網站載入後顯示至少 150 個、目標 168 個最近七日逐時樣本。
- 1D、3D、7D 不再全部顯示破折號；有真實缺值的個別物品仍可顯示破折號。
- 策略頁可計算 3D／7D 成交量中位數、5% 安全市占與回測，但七日資料仍只能產生低信心或等待，不得升為中／高信心。
- 來源文字清楚區分牛牛歷史與 MWI 官方即時資料。
- 新一筆官方排程資料到達後，可正常追加且不再次呼叫牛牛 API。

## 與多步收益的邊界

現有多步引擎會依角色快照計入每個步驟的技能、工具、裝備、房屋、社區 Buff、神龕、成就、卷軸、三種茶與茶成本；暴飲之囊的 `drinkConcentration` 同時放大茶效果與茶消耗。工作流再依每步實際產能分配時間、抵銷中間產物，僅對外部市場產出扣 5% 稅，點金金幣不課市場稅。

本回填切片不宣稱這些輸入已對所有真實角色完整。Milkonomy Exporter 若只提供當下穿著而未提供 action-specific loadout，Market Radar 可能不知道倉庫中的暴飲之囊、上下衣或對應茶。七日回填完成後，下一個獨立驗證切片必須用一份明確含暴飲、三茶與跨技能裝備的 Milkonomy preset，逐步對帳一條兩步製造與一條分解→點金；在此之前多步結果仍標示為待驗證候選。
