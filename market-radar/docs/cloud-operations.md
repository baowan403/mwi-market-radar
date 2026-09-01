# MWI Market Radar Cloud Operations

這份文件描述 Owner 確認 repository 與 Pages 設定後的操作方式。它是 workflow/runbook，不代表目前已建立 remote、GitHub repository 或 Pages 網址。完整的 Owner input 與逐項部署證據欄位見 [`cloud-deployment-checklist.md`](cloud-deployment-checklist.md)。

## 手動執行與排程

- 在 GitHub Actions 選擇 `MWI Market Radar Pages`，使用 **Run workflow** 進行手動採集／重新部署；第一次啟用 cloud mode 也必須先這樣執行，讓 workflow 建立 `market-data` 與第一份 manifest，再完成部署。
- 排程為每小時 UTC 第 13 分；只有排程與 **Run workflow** 會執行官方採集。`push` 到 `main` 僅建置／部署既有 `market-data`，不會因為資料分支或 manifest 缺失而自動採集。
- 若首次只有 source push 而尚未初始化資料，push run 會在 validate、copy、artifact upload 前以固定訊息 `market-data is not initialized; run workflow_dispatch to bootstrap cloud history.` 失敗並停止部署；請改用 **Run workflow**，不要把失敗期間當成已有歷史。
- Workflow 會在明確的 runner temporary worktree 操作 `market-data`，只將 `data/**` 的變更提交到該分支；manifest 與每個 snapshot 會在測試、建置前驗證。資料 commit/push 會等 cloud validate、unit test、雙 artifact build 與 Pages artifact upload 全部成功後才執行，並且仍在 deploy 前。
- 任一採集、驗證、測試、建置或 artifact upload 失敗都會在資料 commit/push 前停止，上一個可用網站不會被新失敗取代；資料 push 失敗也會阻止 deploy。

## 一次性授權的七日歷史回填（Task 8 前僅為 prepared/manual）

- Owner 已確認可以在唯一一次手動 GitHub Actions run 中，於 server-side runner 使用可公開讀取的牛牛股市 endpoint 做初始 bootstrap；此專案不主張擁有該歷史資料，且只為初始七日歷史使用。固定 origin 是 `https://www.stockmarket.xin`，只讀 `/api/latest-status` 與 `/api/item/<item>/history?limit=200`，不接受可改寫 origin 的參數，也不傳 profile、cookie 或 token。dashboard、userscript 與 player profile 永遠不會呼叫這些 endpoint；本文件不主張其 API 文件、服務條款或授權狀態。
- 回填 client 最多 4 個並行 request；每個 worker 的 request 後固定等待 100ms。每次 request timeout 為 10 秒；只有 HTTP 429、502、503、504 或 timeout 會重試，最多共 4 次，retry delay 依序為 500ms、1000ms、1500ms；其他 HTTP/schema/validation 失敗立即拒絕。
- 資料 gate 是最多最近 168 個 UTC-hour sample、至少 150 個不同 UTC-hour sample、每個 snapshot 至少 1000 個 key。與最新官方 snapshot 重疊時，至少需 1000 個非 null ask/bid 比對；任何一個 ask 或 bid 不一致都會拒絕回填。
- 成功後 `data/history-provenance.json` 記錄 `stockmarket-xin`、來源 label「牛牛股市」、固定來源 URL、Owner-confirmed permission 與回填範圍；頁面以「歷史回填：牛牛股市；最新行情：MWI 官方」揭露來源。無有效 provenance 時不猜測歷史來源。
- 有效 provenance 已存在時，預設永久 idempotent skip，不做 network request。`--force` 僅重新驗證同一個固定七日 window，不能擴大範圍；正常每小時官方 collector 不依賴、也不會例行呼叫回填。

安全操作順序：先以 input 保持 `false`（default）push/deploy 程式碼；接著只在 Actions 手動執行一次 `MWI Market Radar Pages`，將 `backfill_stockmarket_7d` 設為 `true`。不要在該 run queued/running 時再觸發另一個 run；確認完成後，等待下一個 scheduled run，證明它只採集 MWI 官方資料、沒有呼叫回填。

回復與失敗處理：pre-merge gate failure 不會寫 provenance，manifest 會保持原狀。若 provenance 的原子寫入/驗證失敗，已合併的有效 snapshots 可能仍存在；下一次 manual rerun 會 reconciliation，並可得到 `inserted=0`，不可手動改檔。deploy failure 的 branch rollback 依既有 `rollback-data` 正常 revert 規則處理，從不 force-push。一次性回填約最多 864 次 public item requests（`limit=200`），受上述並行與 pacing 限制；不使用 profile、cookie 或 token。

## Local fixture acceptance

不連官方 endpoint、不需要 MWI 分頁的可重現 smoke 使用 `tests/fixtures/marketplace.json`，先將 `$TEMP_DATA_DIR` 設為唯一 temporary data directory，再執行 repository 的 local `tsx` entry（例如 `node_modules/.bin/tsx scripts/update-cloud-history.ts --data-dir "$TEMP_DATA_DIR" --fixture tests/fixtures/marketplace.json --min-quotes 1`）：

1. `cloud:update --fixture tests/fixtures/marketplace.json --min-quotes 1` 第一次輸出 `Cloud history updated`。
2. 對同一 data directory 再執行一次，輸出 `Cloud history unchanged`；manifest 與 snapshot SHA-256 必須與第一次完全相同。
3. `cloud:validate --validate-only` 回傳 exit code 0，然後只清理該 temporary directory。

2026-09-01 14:37（Asia/Taipei）的 evidence 是舊版 8 日 retention 實驗紀錄；目前權威保留規格已改為 10 日逐時＋180 日每日摘要。該紀錄只證明當時版本，不得用來驗收目前 retention。

目前 retention 由 `cloud-manifest`、`cloud-history-store`、`cloud-daily-summary`、`cloud-daily-history` 與 `cloud-client` 測試共同驗證；舊版 8 日 smoke hash 保留在 deployment checklist 作歷史證據。

Fresh artifact hash evidence（本機 `npm run build`）：`dist/index.html` 484 bytes `FC90A899BDE7F011330FE13881FD8026CA3AA4D08CF920FAB2269987AC519A5A`；`dist/assets/index-DMILNqTp.js` 349345 bytes `A4CCB2B1B355E088A58EF0EE6B061BBEB453B4DAAFBCB438A43AC89DD9D098A2`；`dist/assets/index-N-TwkADt.css` 22566 bytes `3782B9CCF5739000B6E64F065681AD4D585CD6D7B7FA256CC6C3216A58D1E645`；`dist/mwi-market-radar.user.js` 59684 bytes `FF2651E685691A8636079D7922A5B37A090DFE0762699EDDCF8C8D201E0605AB`；`public/catalog.json` 222753 bytes `847354A0C867A09E53C3ED9898470897ECDA926600F9B351900368F4E25D3BF0`。

## Production deployment

- Repository：[baowan403/mwi-market-radar](https://github.com/baowan403/mwi-market-radar)
- Pages：[https://baowan403.github.io/mwi-market-radar/](https://baowan403.github.io/mwi-market-radar/)
- First manual deployment：workflow run `33490440289`，build／data publish／deploy 全部 success。
- Data branch：`market-data`，首次成功 commit `6bdfc3e`；source `main` 不承載市場快照。

## Stale 診斷

網站將官方最新 timestamp 超過 2.5 小時視為 stale，但仍保留可驗證的舊 rows，不補零、不插值。

1. 先在 Actions 檢查最近一次 scheduled 或 manual run 的固定錯誤結果。
2. 查看 `market-data` 的 `data/manifest.json` 是否存在、schema 是否有效，以及最後一筆 snapshot 檔案是否存在。
3. 確認官方公開 marketplace endpoint 可讀取；不要加入 cookie、Authorization header 或任何帳號資料。
4. 若資料分支仍 valid，網站應維持上一份歷史；修復 workflow 後再手動 Run workflow 更新。

GitHub scheduled workflow 可能在 repository 長時間無活動後停用（常見約 60 日）。重新啟用時先由 Owner 在 Actions 手動執行 workflow，確認 manifest、網站 source label、官方 timestamp 與下次排程，再等待後續 hourly run；不能假裝補回停用期間不存在的歷史。

## `market-data` 分支檢查

- `data/manifest.json` 索引逐時檔；`data/snapshots/<timestamp>.txt` 必須與 manifest timestamp、bytes 相符。`data/daily-history.txt` 是獨立、可選但一旦存在就必須可驗證的壓縮每日封包。
- `manifest.json` 只保留最新 10 日逐時資料，邊界包含在內；`daily-history.txt` 保存最多 180 日壓縮每日 OHLCV／報價品質摘要。
- 當日由逐時資料提供；`daily-history.txt` 只在跨 UTC 日後封存已完成日期，避免每小時重寫整個壓縮 blob。
- 不手動編輯 snapshot payload；若要修復，使用 workflow/CLI 重新驗證公開來源，再讓 updater 產生 deterministic manifest。

## 安全 rollback

- 若某次 build/deploy 內容有問題，先在 Actions 選擇上一個成功的 Pages deployment 重新部署；不要 force-push 或刪除整個 repository。
- 若既有 `market-data` branch 的新資料已 push 但 deploy 失敗，`rollback-data` 會在 deploy failure 後執行：先確認遠端 branch head 仍等於本次 data commit，再以 `git revert --no-edit` 建立反向 commit 並正常 push，還原前一個資料樹；不接受 force-push。
- 初次建立 branch 沒有 `previous_data_sha` 可還原；若該次 deploy 失敗，`market-data` 會保留已驗證的資料但不會有公開部署。先查看 Actions failure，再用 **Run workflow** 重新執行；不要把 branch 存在誤認成網站已上線。
- 若自動 rollback 因 head guard、權限或 revert conflict 失敗，保留 workflow log 與 manifest 證據，經 Owner 審核後確認目前 branch head，再以正常 revert commit 還原 `data/**`，手動執行驗證與建置；不要 force-push 或刪除整個 repository。
- rollback 後確認網站 source、latest timestamp、snapshot count、10 日逐時 retention 與每日封包可解碼，再重新啟用排程。

## 資料成長預估

每小時最多新增一個 gzip/base64 snapshot，tree 保留約 10 × 24 小時檔案、manifest 與一份最多 180 日的壓縮每日封包；實際大小取決於公開 quote 數量。若 repository 成長超出預估，先停用新增排程並由 Owner 設計 archive/compaction；不要 force-push 改寫 Git 歷史。

## 隱私與安全邊界

- Cloud data 只含官方公開 marketplace timestamp、item/enhancement key 與公開報價欄位。
- Workflow 不讀 cookie、token、角色、背包、聊天、好友、訂單或交易資料，也不執行買入、賣出、下單、成交、取消或任何 MWI DOM action。
- log 只輸出 timestamp、quote count、檔案大小、snapshot count 與固定 error code，不輸出完整 payload。
- Pages 公開前必須由 Owner 確認 GitHub owner、repository、visibility、Pages URL／網域；確認前不新增 remote、不 push、不啟用 Pages。
