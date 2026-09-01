# MWI Market Radar Cloud History 設計規格

日期：2026-09-01  
狀態：Owner 已批准轉向共同雲端行情；等待書面規格審閱  
範圍：GitHub Pages 公開網站、GitHub Actions 每小時採集、8 日共同市場歷史、本機資料備援

## 1. 目標

Market Radar 改為任何人開啟固定網址即可使用的共同市場看盤網站。市場資料由雲端排程唯讀抓取 MWI 官方 `marketplace.json`，不再要求每位使用者開著 MWI、安裝 Tampermonkey 或啟動本機 server。

資料流保持單向：

```text
MWI 公開 marketplace.json
          ↓ 每小時一次
GitHub Actions 採集／驗證／壓縮
          ↓
market-data 分支最近 8 日快照
          ↓
GitHub Pages Market Radar
```

Radar 永遠不向 MWI 回寫，不建立下單、成交、取消訂單或角色操作能力。

## 2. 選定方案

採用「GitHub Pages + GitHub Actions + market-data branch」。

- `main`：網站、userscript、測試、workflow 與文件。
- `market-data`：公開市場快照、manifest 與資料版本，不混入產品 source commits。
- GitHub Pages：由 Actions artifact 部署，不依賴本機 server。
- GitHub Actions：預設每小時第 13 分執行，避開整點高峰及 MWI 常見約第 6 分更新。
- Tampermonkey：由必要依賴改為可選本機備援。

不選 GitHub Pages 純靜態＋每位使用者本機採集，因為歷史不共享且需要插件。不選 Cloudflare Worker／R2，因為初期需要額外帳號與雲端資源管理；若 GitHub 排程的延遲或停用成為實際問題，再只遷移 collector／storage，網站可繼續使用 Pages。

## 3. 雲端資料格式

每個官方 timestamp 建立一個 immutable snapshot file：

```text
data/snapshots/1788224760000.txt
```

檔案內容沿用現有 `mwi-radar:gzip-json:v1:` codec：gzip JSON 再轉 base64 text。每個檔案只含一個 normalized `Snapshot`，欄位仍是公開的 timestamp 與 `itemHrid::enhancementLevel → a/b/p/v`。

`data/manifest.json`：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-01T02:13:00.000Z",
  "latestTimestamp": 1788224760000,
  "snapshots": [
    { "timestamp": 1788224760000, "file": "snapshots/1788224760000.txt", "bytes": 42000 }
  ]
}
```

規則：

- timestamp 一律 Unix milliseconds。
- manifest 的 snapshot 按時間升序且 timestamp 唯一。
- 保存 `latestTimestamp - 8 × 24h` 以後的快照；邊界採 `>=`。
- 每次只新增新 timestamp；相同或較舊 timestamp 不建立重複檔案。
- 超過 8 日的檔案從目前 branch tree 移除。
- Git 歷史仍會保留舊 blob；v1 預估一年數百 MB 內可接受。若實際增長超出預估，再設計 archive／branch compaction，不在第一片自動 force-push。

## 4. 雲端採集 workflow

觸發：

- `schedule`: 每小時 `13 * * * *`（UTC；分鐘固定，時區不影響每小時節奏）。
- `workflow_dispatch`: 手動補跑與除錯。
- `push` 到 `main`: 建置／部署網站，使用最新 data branch。

排程 job：

1. checkout `main`。
2. setup Node，使用 lockfile 安裝依賴。
3. 唯讀 GET `https://www.milkywayidle.com/game_data/marketplace.json`，不送 cookie 或 Authorization。
4. 以既有 parser 驗證 timestamp、marketData、quote 數量與 `-1` normalization。
5. 讀取或建立 `market-data` branch。
6. 若 timestamp 更新，寫 immutable snapshot、更新 manifest、裁剪 8 日 tree。
7. commit／push `market-data`；commit 只含公開市場資料。
8. checkout／複製最新 data tree 到網站 `dist/data`。
9. Vite build、unit tests、cloud-data validation。
10. upload Pages artifact 並 deploy。

workflow 使用 concurrency group；新的排程不與前一個採集／部署同時執行。任何 fetch、validation、test 或 deploy 失敗都不得覆寫上一個可用 Pages artifact 或 manifest。

## 5. Dashboard 資料來源策略

網站載入時：

1. 先讀同源 `./data/manifest.json`。
2. 只下載 manifest 列出的最近 8 日 snapshot files。
3. 解碼、驗證、timestamp 去重後交給現有 dashboard domain。
4. 如果安裝 Tampermonkey 且 bridge ready，可讀本機快照作備援。
5. 合併時以 timestamp 去重；相同 timestamp 優先雲端 normalized snapshot。
6. 雲端失敗但本機可用：顯示「本機備援」。
7. 雲端與本機皆不可用：顯示真實錯誤與零假資料。

Dashboard 不需要雙向同步。唯一的本機寫入仍是使用者自己的自選與顯示設定；雲端市場歷史為唯讀。

## 6. 重新整理與 stale 行為

- 頁面載入立即抓 manifest。
- 頁面保持開啟時，每 60 秒 HEAD／GET manifest；`latestTimestamp` 未變不重下載 snapshot files。
- 提供「立即重新整理」按鈕，使用同一 cloud refresh path；不要求貼匯入碼。
- 最新官方 timestamp 距目前超過 2.5 小時：顯示雲端行情 stale。
- GitHub Actions workflow 失敗：網站保留上一份可用歷史並顯示最後成功時間。
- 1D／3D／7D 不插值；缺少實際快照就顯示樣本不足。

## 7. 網站與 userscript 關係

雲端版網站的核心看盤功能不需要 userscript。

現有 userscript 0.1.x：

- 可以保留為本機備援與開發驗收工具。
- 公開網站不應要求使用者安裝。
- 未來若加入角色／裝備等私人功能，必須另作明確 opt-in 設計；本規格不含。

公開網站載入後不掃描 cookie、localStorage、角色、背包、聊天、好友或訂單。

## 8. GitHub Pages 與 repository 邊界

- GitHub Free 採公開 repository，source code 與公開市場快照皆可被任何人閱讀。
- 不提交 cookie、token、帳密、角色匯入碼、私有 log 或本機 GM storage。
- Pages 預設網址：`https://<owner>.github.io/<repository>/`。
- Vite base path 與 Pages workflow 由 `GITHUB_REPOSITORY` 推導，不在 source 中硬編未知帳號。
- userscript 若日後要支援公開 Pages bridge，只有在 Owner 確認網址後才新增精確 `@match`；雲端市場本身不依賴 bridge。
- 未經 Owner 確認，不建立 GitHub remote、repository 或 Pages 網址。

## 9. GitHub 排程限制

- scheduled workflow 可能延遲，尤其整點高峰；因此使用第 13 分。
- public repository 若長期無活動，GitHub 可能停用 scheduled workflow；頁面須以 stale 狀態暴露，而非顯示正常。
- workflow 支援手動執行，方便重新啟用後補抓當前快照；無法補回關機期間不存在的歷史。
- 若排程延遲／停用頻繁到影響使用，再評估 Cloudflare Worker + R2/D1；不在 v1 同時維護兩套雲端 collector。

## 10. 安全與失敗原則

- 只讀官方公開 URL，`credentials: omit` 或 server-side 無 cookie request。
- schema 不符、quote 數過少、timestamp 倒退或下載不完整時整輪失敗，不發布半份資料。
- manifest 先在暫存目錄完成，再隨 snapshot files 一次 commit／deploy。
- workflow log 不輸出完整市場 payload，只輸出 timestamp、quote count、檔案大小與固定 error code。
- 不建立交易、通知、付款或帳號連結。

## 11. 驗收標準

1. 新訪客無 userscript、無 MWI 登入即可開啟網站並看到共同市場。
2. 手動 workflow 可建立第一份 valid manifest／snapshot。
3. 下一個新 timestamp 只增加一份 snapshot；重跑相同 timestamp 不重複。
4. 8 日邊界保留正確，舊 tree files 被裁剪。
5. Pages 部署包含網站、catalog、manifest 與 snapshot files。
6. Dashboard cloud-only 可顯示分類、自選、排序、排行、圖表與 100-row pagination。
7. Cloud＋local 同 timestamp 去重且結果一致。
8. Cloud stale／fetch fail 保留舊資料並清楚警告。
9. 「立即重新整理」不觸發 MWI 操作，只重新讀 cloud manifest。
10. repository、Pages artifact、workflow logs 不含私人資料。
11. unit、build、cloud collector tests、Playwright cloud-only E2E 全部通過。
12. 正常運作不需要 AI 或本機常駐 server。

## 12. 部署前 Owner 裁決

實作可先在本機 branch 完成，但建立遠端前必須確認：

1. GitHub 帳號／組織名稱。
2. repository 名稱。
3. repository 為公開或所用方案支援 private Pages。
4. 接受預設 `github.io` 網址或另用自訂網域。

未確認前不新增 remote、不 push、不啟用 Pages。
