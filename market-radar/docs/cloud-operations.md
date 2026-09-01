# MWI Market Radar Cloud Operations

這份文件描述 Owner 確認 repository 與 Pages 設定後的操作方式。它是 workflow/runbook，不代表目前已建立 remote、GitHub repository 或 Pages 網址。

## 手動執行與排程

- 在 GitHub Actions 選擇 `MWI Market Radar Pages`，使用 **Run workflow** 進行手動採集／重新部署。
- 排程為每小時 UTC 第 13 分；`push` 到 `main` 只在建置使用最新 `market-data`，若資料分支不存在才會先建立第一份快照。
- Workflow 會在明確的 runner temporary worktree 操作 `market-data`，只將 `data/**` 的變更提交到該分支；manifest 與每個 snapshot 會在測試、建置前驗證。
- 任一採集、驗證、測試或建置失敗都會在 Pages artifact upload 前停止，上一個可用網站不會被新失敗取代。

## Stale 診斷

網站將官方最新 timestamp 超過 2.5 小時視為 stale，但仍保留可驗證的舊 rows，不補零、不插值。

1. 先在 Actions 檢查最近一次 scheduled 或 manual run 的固定錯誤結果。
2. 查看 `market-data` 的 `data/manifest.json` 是否存在、schema 是否有效，以及最後一筆 snapshot 檔案是否存在。
3. 確認官方公開 marketplace endpoint 可讀取；不要加入 cookie、Authorization header 或任何帳號資料。
4. 若資料分支仍 valid，網站應維持上一份歷史；修復 workflow 後再手動 Run workflow 更新。

GitHub scheduled workflow 可能在 repository 長時間無活動後停用（常見約 60 日）。重新啟用時先由 Owner 在 Actions 手動執行 workflow，確認 manifest、網站 source label、官方 timestamp 與下次排程，再等待後續 hourly run；不能假裝補回停用期間不存在的歷史。

## `market-data` 分支檢查

- `data/manifest.json` 是唯一索引；`data/snapshots/<timestamp>.txt` 必須與 manifest timestamp、bytes 相符。
- 只保留最新 8 日的逐時資料，邊界包含在內。Git 歷史可能保留舊 blob，但目前 tree 不應重新放回已裁剪檔案。
- 不手動編輯 snapshot payload；若要修復，使用 workflow/CLI 重新驗證公開來源，再讓 updater 產生 deterministic manifest。

## 安全 rollback

- 若某次 build/deploy 內容有問題，先在 Actions 選擇上一個成功的 Pages deployment 重新部署；不要 force-push 或刪除整個 repository。
- 若只有 `market-data` commit 有問題，保留 workflow log 與 manifest 證據，經 Owner 審核後以正常 revert commit 還原 `data/**`，再手動執行驗證與建置。
- rollback 後確認網站 source、latest timestamp、snapshot count 與 8 日 retention，再重新啟用排程。

## 資料成長預估

每小時最多新增一個 gzip/base64 snapshot，tree 只保留約 8 × 24 小時的檔案與一份 manifest；實際大小取決於公開 quote 數量。若 repository 成長超出預估，先停用新增排程並由 Owner 設計 archive/compaction；不要以第一版 workflow force-push 改寫 Git 歷史。

## 隱私與安全邊界

- Cloud data 只含官方公開 marketplace timestamp、item/enhancement key 與公開報價欄位。
- Workflow 不讀 cookie、token、角色、背包、聊天、好友、訂單或交易資料，也不執行買入、賣出、下單、成交、取消或任何 MWI DOM action。
- log 只輸出 timestamp、quote count、檔案大小、snapshot count 與固定 error code，不輸出完整 payload。
- Pages 公開前必須由 Owner 確認 GitHub owner、repository、visibility、Pages URL／網域；確認前不新增 remote、不 push、不啟用 Pages。
