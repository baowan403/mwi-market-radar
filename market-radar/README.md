# MWI Market Radar

MWI Market Radar 是 Milky Way Idle 的市場看盤與策略推薦工具：它保存官方公開市場快照，並在獨立 dashboard 顯示價格、買一／賣一、價差、成交量、1D／3D／7D 變化、波動、排行榜、分類與自選名單。玩家可自願貼上 Milkonomy 快照，讓後續策略計算依角色技能與裝備個人化；角色資料只保存在瀏覽器本機。

> 原市場採集 live acceptance 見 `docs/manual-acceptance.md`；角色匯入與策略計算基礎見 `docs/strategy-foundation-acceptance.md`；流動性、趨勢與回測驗收見 `docs/liquidity-trend-acceptance.md`。沒有執行交易操作。

> 最新驗證數字以 GitHub Actions 與本輪交付紀錄為準；正式流程固定執行完整 unit、dashboard/userscript build 與桌面／手機 Chrome E2E。

## 功能與架構

- `dist/index.html` 與 `dist/assets/`：靜態 dashboard。
- `dist/mwi-market-radar.user.js`：同一支 Tampermonkey userscript，依網址在 MWI 遊戲頁採集、在 localhost dashboard 頁提供唯讀 bridge。
- dashboard 只透過 typed bridge 讀取本機資料；bridge request/response 使用 JSON string wire、request id 與分頁快照。
- collector 只讀取官方 `marketplace.json`，每小時約在 `xx:08` 檢查，啟動時立即檢查；失敗的正常檢查依規則在 10 分鐘後重試一次。市場資料是每小時快照，因此 dashboard 每 60 秒 polling 足夠更新狀態；bridge 是單向 MWI→Radar 唯讀資料流，不是雙向交易通道。
- 跨分頁互斥只使用原生 Web Locks。瀏覽器沒有 Web Locks 時會 fail-closed、不採集；不使用 GM storage 假裝互斥。
- dashboard 支援八個 primary view（自選、全市場、資源、消耗品、技能書、迷宮、裝備、其他）、十個官方分類、中文／英文／HRID 搜尋、強化等級、最低成交量、最大價差、排序、排行榜與物品圖表。
- 公開雲端保留最近 10 日逐時資料，並壓縮保存最多 180 日的每日 OHLCV／報價品質摘要；缺口、缺價、單邊報價與低流動性會如實標示，不插值、不補零。

## 個人化策略推薦

目前已完成：

- 957 個市場物品的中文優先目錄；中文、英文與 HRID 均可搜尋。
- 支援 Milkonomy Exporter `version: 1` 與 Milkonomy preset JSON。
- 可在同一瀏覽器保存、切換及刪除多名角色；角色資料使用獨立 IndexedDB。
- Milkonomy 參考來源固定在已審閱的 MIT commit，正式執行不需要連線 Milkonomy。
- 已建立純 TypeScript 的裝備、房屋、茶、社群增益、成就、封印與神龕計算。
- 已建立單步製造 calculator，涵蓋買料賣一、出售買一、5% 市場稅、點金硬幣免稅、工匠／美食與精華／稀有 EV。
- 依角色等級與裝備掃描真實製造、裁縫、鍛造、烹飪及沖泡配方。
- 產生 2–7 步工作流，依產能平衡各步工時並抵消內部中間品。
- 支援分解、點金及分解→點金；包含專用／至高催化劑、硬幣費、茶與掉落 EV。
- 「策略推薦」分頁顯示理論／可實現日利、24h 流動資金、安全批量、可執行時數、出售估計、市場占比、瓶頸與完整假設。
- 所有外部買入／賣出邊均受 3D／7D 成交量中位數與 5% 安全市占限制；超量或資料不足策略移至「觀察／排除」。
- 固定策略會建立無未來洩漏的歷史利潤序列，輸出執行／準備／等待／出售／停止訊號、理由、失效門檻及 3D／7D walk-forward 回測。
- 策略自選使用獨立 IndexedDB，與物品自選及角色快照隔離。

策略頁將「穩健／短線」與 1／4／8／24 小時執行情境分開：穩健模式只排名能覆蓋完整時段的策略，短線模式依時段內安全批次總利潤排名；釘選只作監控，不改變客觀名次。主表以成交量容量折算日利為主、理論日利為參考，並顯示本批量、本批現金、動作、原因與失效條件。Milkonomy Exporter v1 的 `inventoryMap` 是持有裝備的強化等級，不是材料數量，因此不會拿它抵扣原料或茶成本。

釘選策略的裝備升級 CP／優先級優化器已完成計算與 UI 規格，見 [`docs/superpowers/specs/2026-09-03-equipment-profit-optimizer-design.md`](docs/superpowers/specs/2026-09-03-equipment-profit-optimizer-design.md)。第一版將以反事實角色快照完整重算每件裝備及強化等級，不用單一 Buff 百分比粗估。

不足 7 天不宣稱趨勢，7–29 天最多低信心；中／高信心需要至少 30 天與通過回測門檻。強化／轉化的波動及資金回撤模型仍不屬於這批穩定生活策略。

## 環境需求

- Node.js 20 LTS 或更新版本（本專案已用 Node.js 22 驗證）。
- npm 10 或更新版本。
- 執行 E2E 需本機已安裝 Google Chrome；設定使用 system Chrome channel，不會下載 Playwright browser。

## 安裝、測試與本機執行

在 `market-radar/` 目錄執行：

```powershell
npm install
npm test -- --run
npm run build
npm run e2e
npm run preview -- --host 127.0.0.1
```

`npm run build` 會先做 TypeScript 檢查，再產生 dashboard 與 userscript 兩個 artifact。E2E 會自行啟動 build + preview，使用 `http://127.0.0.1:4173`；若要讓 Tampermonkey bridge 配合預設 allowlist，請以 `http://localhost:4173` 開啟 dashboard。

## 安裝本機 userscript

1. 安裝 Tampermonkey。
2. 執行 `npm run build`。
3. 在 Tampermonkey 的「新增腳本」頁面開啟 `dist/mwi-market-radar.user.js`，確認內容後儲存。
4. 保持一個 MWI 遊戲分頁（`https://www.milkywayidle.com/`）開啟，並在 `http://localhost:4173` 開啟 dashboard。
5. 確認 userscript 已啟用、dashboard 顯示採集狀態，再觀察下一個官方 timestamp。這個工具不需要、不應該讀取帳號登入資訊。

MWI 分頁必須保持開啟，因為 v1 不在電腦關機或沒有遊戲分頁時補採集。預設在每小時 `xx:08` 檢查、啟動時立即檢查；正常失敗最多重試一次。缺少 Web Locks 的舊環境寧可不採集，以免多分頁假互斥。

## 公開 cloud mode 與本機 fallback

公開 cloud mode 已部署於 [https://baowan403.github.io/mwi-market-radar/](https://baowan403.github.io/mwi-market-radar/)，不需要 MWI 分頁、Tampermonkey 或本機 server；網站讀取同源 `data/manifest.json`、公開 snapshot files 與可選的 `data/daily-history.txt`。GitHub Actions 每小時 UTC 第 13 分收集官方 `marketplace.json`，資料只提交到 data-only `market-data` branch。

Tampermonkey userscript 保留為可選的本機 fallback：若 cloud data 暫時不可用且 MWI bridge 已 ready，dashboard 會顯示本機備援；若兩者都不可用，顯示安全錯誤與零假資料。cloud 與本機資料以 timestamp 去重，cloud 優先；偏好設定只存於瀏覽器本機 IndexedDB。

首次 `workflow_dispatch` 已於 2026-09-01 成功建立 `market-data` 與 manifest；source `push` 不會以空資料自動 bootstrap。一次性、Owner-confirmed 的 `stockmarket.xin` 七日歷史回填目前僅 prepared/manual：需先部署含預設 `false` 的 workflow，再由 Owner 執行唯一一次 `backfill_stockmarket_7d=true` run；在 Task 8 的實際證據記錄前，不宣稱 7D 歷史已由此回填填滿。部署、rollback 與 local fixture 證據見 [`docs/cloud-deployment-checklist.md`](docs/cloud-deployment-checklist.md) 及 [`docs/manual-acceptance.md`](docs/manual-acceptance.md)。

## 本機資料、停用與移除

市場歷史與偏好只在 Tampermonkey 的 userscript storage 中。資料 key 使用 `mwi-radar:v1:` namespace，概念上包括：

- `mwi-radar:v1:hourly:YYYY-MM-DD`：壓縮逐時市場快照（日分塊，保留最近 8 日）。
- `mwi-radar:v1:watchlist`：自選名單。
- `mwi-radar:v1:settings`：期間、流動性與異常門檻。
- `mwi-radar:v1:collector-status`：採集狀態與安全錯誤代碼。

角色快照另存於 dashboard 的 IndexedDB `mwi-market-radar-profiles`，不使用 Tampermonkey storage。可從「角色快照」介面逐名刪除；不得用清空整個瀏覽器資料的方式代替精確刪除。

策略釘選另存於 IndexedDB `mwi-market-radar-strategies`，不與物品自選或角色資料混用。

停用時可在 Tampermonkey 對本腳本關閉 enabled；移除時在 Tampermonkey 管理頁刪除本腳本。若要清除本工具資料，請只使用 Tampermonkey 管理介面中「本腳本」的 storage 檢視，逐一確認並刪除名稱以 `mwi-radar:v1:` 開頭的 key。不要在其他腳本或頁面 console 執行全域刪除、通配刪除或清空所有 userscript storage，以免誤傷其他資料。

## 隱私與安全邊界

允許的網路資料流只有：

- 唯讀下載官方 `https://www.milkywayidle.com/game_data/marketplace.json`。
- dashboard 載入本專案相對路徑 `./catalog.json`。
- 玩家打開策略推薦時，dashboard 才載入公開唯讀 `./strategy-data.json`；該檔只含遊戲配方與數值資料，不含角色快照。
- 將公開市場欄位與安全狀態保存到本機 Tampermonkey storage，透過 localhost bridge 唯讀提供 dashboard。
- 僅在 Owner 手動觸發一次 `backfill_stockmarket_7d=true` 的 GitHub Actions workflow 時，server-side runner 才會讀取固定 `https://www.stockmarket.xin/api/latest-status` 與 `https://www.stockmarket.xin/api/item/{name}/history?limit=200`，用於七日初始回填；這不是瀏覽器或玩家資料流，dashboard、userscript 與 player profile 永遠不會呼叫這些 endpoint。公開歷史相容性 probe 的每小時 key 數為 min 398／median 508，故歷史 snapshot 門檻為 350 keys；最新官方 ask/bid overlap 仍需至少 1000 個可比較欄位。這不是 actual production backfill 證據。來源的可用性、API 文件、條款或授權不在本專案宣稱範圍內。

玩家可明確貼上 Milkonomy 角色快照；匯入器只保留計算所需的技能、裝備、房屋、茶、增益、成就、神龕與庫存數值，未知欄位、token、cookie 與帳密不會進入正規化 profile。Profile 只寫入本機 IndexedDB，不進 cloud、collector、userscript、GitHub Pages 或任何 request body。

本工具不主動讀取 MWI 角色頁、cookie、token、帳密、聊天、好友或個人市場訂單；不使用 WebSocket；不把角色資料上傳到第三方；不執行買入、賣出、下單、成交、取消訂單或任何交易 DOM 操作；正常採集、查看與固定程式計算不發出 AI request，也不消耗 AI tokens。

## 離線與錯誤狀態

官方網路失敗、schema 異常、storage 失敗、Web Lock 不可用與取消都會顯示固定安全訊息，不顯示 raw error、stack、response body 或 URL 私密細節。舊資料會保留；沒有快照時顯示「尚無市場快照，請保持 MWI 分頁開啟」。快照時間間隔超過門檻會列出資料缺口，不會用零或插值填補。

## 部署限制

Cloud dashboard 不需要 userscript bridge。Userscript 的 dashboard allowlist 仍只包含 localhost 開發 origin，作為 cloud 不可用時的本機 fallback；不得為公開 Pages 擴張角色資料或交易權限。正式 repository 是 [baowan403/mwi-market-radar](https://github.com/baowan403/mwi-market-radar)，Pages 使用預設 HTTPS 網域，尚未設定自訂網域。
