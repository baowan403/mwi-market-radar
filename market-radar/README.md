# MWI Market Radar

MWI Market Radar 是 Milky Way Idle 的本機市場看盤工具：它保存官方公開市場快照，並在獨立 dashboard 顯示價格、買一／賣一、價差、成交量、1D／3D／7D 變化、波動、排行榜、分類與自選名單。

> 目前只完成自動化 unit/build/E2E 驗證；本文不表示已完成真實 MWI live acceptance，也沒有建立 remote、發布網站或執行交易操作。

## 功能與架構

- `dist/index.html` 與 `dist/assets/`：靜態 dashboard。
- `dist/mwi-market-radar.user.js`：同一支 Tampermonkey userscript，依網址在 MWI 遊戲頁採集、在 localhost dashboard 頁提供唯讀 bridge。
- dashboard 只透過 typed bridge 讀取本機資料；bridge request/response 使用 JSON string wire、request id 與分頁快照。
- collector 只讀取官方 `marketplace.json`，每小時約在 `xx:08` 檢查，啟動時立即檢查；失敗的正常檢查依規則在 10 分鐘後重試一次。
- 跨分頁互斥只使用原生 Web Locks。瀏覽器沒有 Web Locks 時會 fail-closed、不採集；不使用 GM storage 假裝互斥。
- dashboard 支援八個 primary view（自選、全市場、資源、消耗品、技能書、迷宮、裝備、其他）、十個官方分類、搜尋、強化等級、最低成交量、最大價差、排序、排行榜與物品圖表。
- 歷史保留最近 8 日的逐時資料；缺口、缺價、單邊報價與低流動性會如實標示，不插值、不補零。

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

## 本機資料、停用與移除

市場歷史與偏好只在 Tampermonkey 的 userscript storage 中。資料 key 使用 `mwi-radar:v1:` namespace，概念上包括：

- `mwi-radar:v1:hourly:YYYY-MM-DD`：壓縮逐時市場快照（日分塊，保留最近 8 日）。
- `mwi-radar:v1:watchlist`：自選名單。
- `mwi-radar:v1:settings`：期間、流動性與異常門檻。
- `mwi-radar:v1:collector-status`：採集狀態與安全錯誤代碼。

停用時可在 Tampermonkey 對本腳本關閉 enabled；移除時在 Tampermonkey 管理頁刪除本腳本。若要清除本工具資料，請只使用 Tampermonkey 管理介面中「本腳本」的 storage 檢視，逐一確認並刪除名稱以 `mwi-radar:v1:` 開頭的 key。不要在其他腳本或頁面 console 執行全域刪除、通配刪除或清空所有 userscript storage，以免誤傷其他資料。

## 隱私與安全邊界

允許的資料流只有：

- 唯讀下載官方 `https://www.milkywayidle.com/game_data/marketplace.json`。
- dashboard 載入本專案相對路徑 `./catalog.json`。
- 將公開市場欄位與安全狀態保存到本機 Tampermonkey storage，透過 localhost bridge 唯讀提供 dashboard。

本工具不讀取或保存 cookie、token、帳密、角色、背包、聊天、好友、訂單或其他私人狀態；不使用 WebSocket；不把資料上傳到第三方；不執行買入、賣出、下單、成交、取消訂單或任何交易 DOM 操作；正常採集與查看不發出 AI request，也不消耗 AI tokens。

## 離線與錯誤狀態

官方網路失敗、schema 異常、storage 失敗、Web Lock 不可用與取消都會顯示固定安全訊息，不顯示 raw error、stack、response body 或 URL 私密細節。舊資料會保留；沒有快照時顯示「尚無市場快照，請保持 MWI 分頁開啟」。快照時間間隔超過門檻會列出資料缺口，不會用零或插值填補。

## 部署限制

目前 userscript dashboard allowlist 只有 localhost 開發 origin（預設 `http://localhost:4173`）。尚未選定 production URL，也沒有建立 remote repository 或發布 GitHub Pages。任何部署前都必須先由 Owner 確認 GitHub 帳號／組織、repository 名稱、Pages URL／自訂網域及公開／私人設定；確認後才可設定 `MWI_RADAR_DASHBOARD_ORIGINS` 並重新 build。
