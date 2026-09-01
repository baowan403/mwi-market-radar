# MWI Market Radar Cloud 部署清單

這是 Owner 審核用的 local-to-Pages runbook與部署紀錄。2026-09-01 已由 Owner 核准建立公開 `baowan403/mwi-market-radar`、push `main`、建立 `market-data` 並發布 GitHub Pages。

> Current retention authority：10 日逐時資料＋`daily-history.txt` 最多 180 日每日摘要。下方 8 日 hash 是早期 v1 部署的歷史證據，不再代表目前 retention gate。

公開網址：[https://baowan403.github.io/mwi-market-radar/](https://baowan403.github.io/mwi-market-radar/)

## Owner 必須先提供／確認的輸入

- [x] GitHub owner 是 `baowan403`。
- [x] repository `mwi-market-radar` 是 public；Pages 使用預設 HTTPS 網域，沒有自訂網域。
- [x] Owner 明確批准建立 remote、push `main` 與 `market-data`。
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

## 一次性授權七日回填的實際證據（Task 8 執行後填寫）

> 此區只記錄已觀測的 production 證據。Run #25 在入口列上限、Run #27 在真實歷史密度 gate 安全失敗，兩次都未發布 data/provenance；依實測修正後，Run #29 是唯一成功寫入的 authorized backfill。queued/running 時沒有重複觸發。

> 公開歷史 compatibility probe（不是 production 回填證據）：872 item names、169 eligible timestamps、每小時 key 數 min 398／median 508／max 3101／latest 3085；因此歷史快照 gate 是 350 keys，而最新官方 overlap 仍需至少 1000 個 ask/bid comparisons。

- [x] Asia/Taipei 執行時間：2026-09-02 06:01:38（fetch/provenance）；Run #29 06:01 開始、5m00s success。
- [x] imported UTC range／snapshot count：`2026-08-25T22:06:00.000Z` → `2026-09-01T21:06:00.000Z`／168；逐時連續、non-hourly gaps 0。
- [x] required historical keys／observed minimum keys：`350`／`399`（median 510／max 3101／latest 3083）。
- [x] latest official overlap comparisons／mismatch：`27937`／`0`。
- [x] `history-provenance.json` validation：HTTP 200，strict schema v1；source `stockmarket-xin`／permission `owner-confirmed`／live source `mwi-official`。
- [x] `market-data` commit SHA：`7c601dfc132b204cfffb35ece02a5d6e48b78bef`。
- [x] workflow run URL：`https://github.com/baowan403/mwi-market-radar/actions/runs/33564151428`（Run #29；build/deploy success；rollback skipped）。
- [x] 公開頁 1D／3D／7D 與 source label：紅杉木板 `▼ 1.14%`／`▼ 1.32%`／`▼ 2.56%`；`歷史回填：牛牛股市；最新行情：MWI 官方`；168 snapshots；無觀測缺口。
- [x] 下一個 scheduled official-only run 的 URL／證明：`https://github.com/baowan403/mwi-market-radar/actions/runs/33570289157`（Run #31；`on: schedule`；官方採集 2s；牛牛回填步驟 0s／未執行；build/deploy success）。公開 manifest 推進至 `2026-09-02 07:06:00`，provenance `fetchedAt/range/count/overlap` 完全不變。

## Deploy failure 與 data rollback

- [ ] 既有 `market-data` branch 發生 deploy failure 且本次有 data change 時，確認 `rollback-data` job 以 `always()` 條件啟動。
- [ ] rollback 先確認 remote head 仍等於本次 `data_commit_sha`，再設定 workflow bot identity、`git revert --no-edit`，並確認 revert 後 tree 等於 `previous_data_sha` 的 tree；禁止 force-push。
- [ ] 初次建立 branch 沒有 previous SHA；若初次 deploy 失敗，branch 可保留已驗證資料但沒有公開部署，下一步是查看 failure 後再次 **Run workflow**。
- [ ] 若 rollback 因 head guard、權限或 revert conflict 失敗，保留 run log，經 Owner 審核目前 branch head 後以正常 revert／驗證流程處理；不要刪 branch 或重寫歷史。

## Local acceptance evidence

### Task 8：本機 7D provenance／bootstrap acceptance（尚未部署）

- 2026-09-02 03:45（Asia/Taipei）；本機 deterministic fixture、無網路。acceptance commits：`1ae98d17596861f1db9c537f722adc83220eb7a2`、guard：`deef3543e2cde97bb6fa381a7722ea75916ee2b7`。
- fixture 提供同源 `data/history-provenance.json` 的完整 valid schema，固定 latest timestamp／provenance 時間，並提供 168 份逐時 snapshots（167 小時跨度）；`redwood_lumber` 的 1D／3D／7D 分別為 `▲ 5.3%`／`▲ 17.78%`／`▲ 53.87%`。
- focused cloud desktop：1 passed；cloud desktop＋mobile：14 passed。
- `npm test`：55 test files／587 tests passed；`npm run build`：TypeScript `--noEmit`、dashboard（48 modules）與 userscript（12 modules）均成功。
- `npm run e2e`：37 passed／2 skipped（39 total）。這些為 local acceptance，未宣稱公開頁已有 7D 或完成 history backfill。

- [ ] 在唯一 OS temporary directory 執行 fixture `cloud:update --fixture tests/fixtures/marketplace.json --min-quotes 1`：第一次輸出 `Cloud history updated`。
- [ ] 對同一 temporary data directory 再執行一次：輸出 `Cloud history unchanged`，manifest 與 snapshot SHA-256 均不變。
- [ ] 執行 `cloud:validate --validate-only` 並記錄 exit code 0；完成後刪除且只刪除該 temporary directory。
- [ ] 證據欄位至少包含：Asia/Taipei 日期時間、fixture／official timestamp、generatedAt、snapshot count、每個 file／bytes、manifest SHA-256、snapshot SHA-256、第一次／第二次結果、validate、unit、build、E2E。
- [ ] 不需要 MWI 分頁、不連官方 endpoint、不讀私人資料；此 acceptance 不代表已建立 remote 或 Pages。

### Synthetic retention evidence

2026-09-01（Asia/Taipei）以 local `tsx` import `updateCloudHistory` 依序寫入三份 synthetic snapshots：older `1787529599999`（latest - 8 日 - 1 ms）、exact boundary `1787529600000`（latest - 8 日）與 latest `1788220800000`（`2026-09-01T00:00:00.000Z`）。最後 `cloud:validate --validate-only` exit code 0；manifest 僅保留 `1787529600000,1788220800000`（2 snapshots），`snapshots/1787529599999.txt` 已移除，證明 exact boundary inclusive、older exclusive。

- final manifest SHA-256：`FE8FB657301D92B1E23B4666E1FC221B198B064CDDD23D233D3C5861E6A59A1E`。
- final snapshot files/hashes：`snapshots/1787529600000.txt` 159 bytes／`5B2435D51C3182B33AEB5EDDB013EC4CE5C66BE2992E168373180EF3FA5D070E`；`snapshots/1788220800000.txt` 159 bytes／`7DD8F3267E1A6787E360BA156B653F97C34FB7CF20E09BF7AE375DA4336A0DF5`。

### Build artifact evidence

Fresh `npm run build`（TypeScript check、dashboard build、userscript build）產出：

| 相對路徑 | bytes | SHA-256 |
| --- | ---: | --- |
| `dist/index.html` | 484 | `B68509AA1D094E081AEC96BF11B903D3E7E8CF4FC4CFE7984F9B1400698E982E` |
| `dist/assets/index--QrfMmo3.js` | 351856 | `A4238F6B164491B989AC680C139EB8E1FD0D41DFE48E67E589769364282867B6` |
| `dist/assets/index-N-TwkADt.css` | 22566 | `3782B9CCF5739000B6E64F065681AD4D585CD6D7B7FA256CC6C3216A58D1E645` |
| `dist/mwi-market-radar.user.js` | 59684 | `FF2651E685691A8636079D7922A5B37A090DFE0762699EDDCF8C8D201E0605AB` |
| `public/catalog.json` | 222753 | `847354A0C867A09E53C3ED9898470897ECDA926600F9B351900368F4E25D3BF0` |

## Evidence log

| 日期／時間（Asia/Taipei） | 模式 | latest timestamp | generatedAt | snapshot/files | hashes | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-01 14:37 | local public fixture，無 MWI／無網路 | `1787645160000`（`2026-08-25T08:06:00.000Z`） | `2026-09-01T06:37:26.560Z` | 1；`snapshots/1787645160000.txt`；235 bytes | manifest `96C91D591EAE8AB5ED881A199759607FE282F7B0518EB429DD2DE304BAAA3521`；snapshot `764D4BCB1E64EBE6A1AD978335471C59565DC19FF293503F0745DD672B7D5CD6`；第二次完全相同 | first updated／second unchanged／validate 0；unit 31 files／395 tests；build 雙 artifact；final E2E 31 passed／1 skipped |
| 2026-09-01 | local synthetic retention，無 MWI／無網路 | `1788220800000`；boundary `1787529600000`；older `1787529599999` | fixed synthetic generatedAt per update | final 2；`snapshots/1787529600000.txt`、`snapshots/1788220800000.txt`；older removed | manifest `FE8FB657301D92B1E23B4666E1FC221B198B064CDDD23D233D3C5861E6A59A1E`；snapshot hashes 見上方 | validate 0；exact 8-day boundary retained、older by 1 ms removed；只使用 synthetic data |
| 2026-09-01 17:06 | GitHub workflow_dispatch run `33490440289` | official `2026-09-01 17:06:00` | `2026-09-01 17:06:11` | `market-data` branch `6bdfc3e`；公開 3,084 targets | GitHub build、data validation、Pages artifact、deploy 全部 success | Pages source GitHub Actions；415 unit tests；公開 cloud source 實頁驗證成功 |
| 2026-09-02 06:01 | authorized stockmarket.xin 7D backfill；GitHub Run #29 | official/latest `2026-09-02 05:06:00` | `2026-09-02 06:01:38` | 168 hourly snapshots；range `2026-08-26 06:06` → `2026-09-02 05:06` Asia/Taipei；min/median/max keys `399/510/3101` | provenance overlap `27937`／mismatch `0`；market-data `7c601dfc132b204cfffb35ece02a5d6e48b78bef` | build/deploy success；source label、紅杉 1D/3D/7D、0 gaps verified；後續 Run #31 official-only verified |
| 2026-09-02 07:16 | scheduled official-only Run #31 | official/latest `2026-09-02 07:06:00` | `2026-09-02 07:17:04` | manifest 169 snapshots；authorized provenance still 168-snapshot bootstrap range | provenance unchanged；backfill step 0s／not executed | build/deploy success；證明後續排程只採集 MWI 官方資料 |

## 完成條件

- [ ] Owner input、repository settings、首次 manual bootstrap、第二次 schedule、source/timestamp/stale、branch data-only、rollback、60-day recovery 全部有證據。
- [x] README、manual acceptance 與 cloud operations 已記錄實際 remote、Pages URL 與首次成功 deployment。
- [ ] 全程只做公開市場資料讀取與唯讀顯示；禁止下單、買入、賣出、成交、取消或其他市場 action。
