# MWI Market Radar Cloud 部署清單

這是 Owner 審核用的 local-to-Pages runbook，不是已完成的部署紀錄。開始前確認目前 repository 仍沒有 remote；本清單不代替 Owner 核准 remote 建立、push 或公開網站。

## Owner 必須先提供／確認的輸入

- [ ] GitHub owner／organization 名稱已由 Owner 記錄在受控的 release evidence 中。
- [ ] repository 名稱、visibility（public／private）與 Pages 網址／自訂網域已由 Owner 確認；未確認的值不得寫入 workflow、allowlist 或文件中的假 URL。
- [ ] Owner 明確批准建立 remote、push `main` 與 `market-data`；本次 local acceptance 不執行這些動作。
- [ ] repository Settings → Actions → General 的 workflow permissions 允許本 workflow 所需的 `contents: write`；未批准前不得以個人 token 或秘密繞過。
- [ ] Pages 的 source 設為 **GitHub Actions**，`github-pages` environment 與 deployment permission 可用。
- [ ] workflow file 的 Actions 版本與 immutable SHA 已審核；不加入 cookies、Authorization、帳號、角色或交易 secrets。

## 首次初始化與手動部署

- [ ] source `main` 已由 Owner 以批准的方式準備好；不要用 source `push` 當 cloud history bootstrap。
- [ ] 在 Actions 對 `MWI Market Radar Pages` 執行第一次 **Run workflow**（`workflow_dispatch`）。只有 manual／schedule 會呼叫官方 collector；`push` 缺資料時會固定 fail-safe 並提示再次手動執行。
- [ ] 初次 run 成功建立 `market-data` branch，branch tree 只包含 `data/**`，且 `data/manifest.json` 與 snapshot files 通過 `cloud:validate`。
- [ ] build、unit test、雙 artifact build 與 Pages artifact upload 成功後，才允許 data commit/push；deploy 成功後才把網站視為可用。
- [ ] 網站以同源相對路徑 `./data/manifest.json` 載入 manifest；確認 UI source label 為 cloud、latest timestamp、generatedAt 與 snapshot count 與 manifest 一致。

## 第二次排程與資料健康

- [ ] 等待下一個每小時 UTC 第 13 分的 scheduled run；確認新 snapshot timestamp（若官方資料沒有變更，允許 no-op）與 manifest schema 通過驗證。
- [ ] 確認 `market-data` 新 commit 的 changed paths 僅為 `data/**`，commit identity 為 workflow bot；網站資料不可包含 payload 以外的私人欄位。
- [ ] 確認 dashboard 仍顯示 cloud source、官方 latest timestamp 與 snapshot count；generatedAt 是 manifest metadata，不可當成官方市場 timestamp。
- [ ] 官方 timestamp 超過約 2.5 小時時，確認 stale warning 與既有 rows 保留；缺口需顯示，不可插值或補零。
- [ ] repository 約 60 日沒有 activity 時，確認 scheduled workflow 是否被停用；由 Owner 重新啟用後先 manual dispatch，再確認下一個 schedule，不假裝補回停用期間。

## Deploy failure 與 data rollback

- [ ] 既有 `market-data` branch 發生 deploy failure 且本次有 data change 時，確認 `rollback-data` job 以 `always()` 條件啟動。
- [ ] rollback 先確認 remote head 仍等於本次 `data_commit_sha`，再設定 workflow bot identity、`git revert --no-edit`，並確認 revert 後 tree 等於 `previous_data_sha` 的 tree；禁止 force-push。
- [ ] 初次建立 branch 沒有 previous SHA；若初次 deploy 失敗，branch 可保留已驗證資料但沒有公開部署，下一步是查看 failure 後再次 **Run workflow**。
- [ ] 若 rollback 因 head guard、權限或 revert conflict 失敗，保留 run log，經 Owner 審核目前 branch head 後以正常 revert／驗證流程處理；不要刪 branch 或重寫歷史。

## Local acceptance evidence

- [ ] 在唯一 OS temporary directory 執行 fixture `cloud:update --fixture tests/fixtures/marketplace.json --min-quotes 1`：第一次輸出 `Cloud history updated`。
- [ ] 對同一 temporary data directory 再執行一次：輸出 `Cloud history unchanged`，manifest 與 snapshot SHA-256 均不變。
- [ ] 執行 `cloud:validate --validate-only` 並記錄 exit code 0；完成後刪除且只刪除該 temporary directory。
- [ ] 證據欄位至少包含：Asia/Taipei 日期時間、fixture／official timestamp、generatedAt、snapshot count、每個 file／bytes、manifest SHA-256、snapshot SHA-256、第一次／第二次結果、validate、unit、build、E2E。
- [ ] 不需要 MWI 分頁、不連官方 endpoint、不讀私人資料；此 acceptance 不代表已建立 remote 或 Pages。

## Evidence log

| 日期／時間（Asia/Taipei） | 模式 | latest timestamp | generatedAt | snapshot/files | hashes | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-01 14:37 | local public fixture，無 MWI／無網路 | `1787645160000`（`2026-08-25T08:06:00.000Z`） | `2026-09-01T06:37:26.560Z` | 1；`snapshots/1787645160000.txt`；235 bytes | manifest `96C91D591EAE8AB5ED881A199759607FE282F7B0518EB429DD2DE304BAAA3521`；snapshot `764D4BCB1E64EBE6A1AD978335471C59565DC19FF293503F0745DD672B7D5CD6`；第二次完全相同 | first updated／second unchanged／validate 0；unit 31 files／395 tests；build 雙 artifact；final E2E 31 passed／1 skipped |

## 完成條件

- [ ] Owner input、repository settings、首次 manual bootstrap、第二次 schedule、source/timestamp/stale、branch data-only、rollback、60-day recovery 全部有證據。
- [ ] README、manual acceptance 與 cloud operations 的限制一致；若仍沒有 Owner 核准或 remote，狀態保持「未部署」。
- [ ] 全程只做公開市場資料讀取與唯讀顯示；禁止下單、買入、賣出、成交、取消或其他市場 action。
