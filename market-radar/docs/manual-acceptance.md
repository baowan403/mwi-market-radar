# MWI Market Radar 手動驗收清單

這份清單記錄 live/read-only acceptance 與自動化驗證證據。2026-09-01（Asia/Taipei）的真實 MWI 觀察結果記載於 Evidence log；全程禁止買賣、下單、成交、取消訂單或開啟任何交易操作視窗。

Cloud 公開部署的 Owner 輸入、首次 manual bootstrap、第二次排程、data-only branch、rollback 與 60-day recovery 另見 [`cloud-deployment-checklist.md`](cloud-deployment-checklist.md)；目前仍未建立 remote 或 Pages。

## 驗收前置

- [ ] 確認 Node.js/npm 版本符合 README。
- [ ] 執行 `npm install`。
- [ ] 執行 `npm test -- --run` 並保存輸出。
- [ ] 執行 `npm run build`。
- [ ] 確認 `dist/index.html`、`dist/assets/` 與 `dist/mwi-market-radar.user.js` 存在。
- [ ] 以 `npm run preview -- --host 127.0.0.1` 啟動本機頁面；使用 `http://localhost:4173` 驗證 userscript dashboard allowlist。
- [ ] 確認不使用真實帳號私人資料、不建立 remote、不部署。
- [ ] 若驗證 cloud mode，先完成 cloud deployment checklist 的 Owner 審核項目；local fixture acceptance 不連官方、不需要 MWI，且不代表已部署。

## Tampermonkey 與採集器

- [ ] 在 Tampermonkey 匯入並啟用 `dist/mwi-market-radar.user.js`。
- [ ] 開啟既有 MWI 遊戲頁，只做唯讀觀察，不開啟市場交易 dialog。
- [ ] 確認遊戲頁啟動後有立即檢查。
- [ ] 確認預期 `xx:08` 檢查節奏。
- [ ] 記錄 dashboard 顯示的官方 timestamp，與 userscript storage 中本腳本 `mwi-radar:v1:` 對應資料的 timestamp 比對。
- [ ] 模擬或觀察兩個 MWI 分頁同時開啟，確認同一官方 timestamp 不會重複保存；不要用交易 UI 驗證。
- [ ] 確認瀏覽器支援 Web Locks；若不支援，確認 collector 顯示安全 lock unavailable 且不寫入假快照。
- [ ] 確認 network/schema/storage/lock/cancel 狀態只顯示固定安全訊息，不顯示 raw error、stack、body 或 token。

## Dashboard bridge 與狀態

- [ ] 在 `http://localhost:4173` 開啟 dashboard，確認 bridge 存在時可讀取狀態與快照。
- [ ] 確認沒有 userscript/bridge 時顯示安裝提示，rows 為 0，沒有假示範行情。
- [ ] 確認沒有快照時顯示「尚無市場快照，請保持 MWI 分頁開啟」。
- [ ] 確認採集停止超過約 2.5 小時時顯示等待遊戲分頁／資料停止更新。
- [ ] 確認 retrying 狀態顯示下次重試時間。
- [ ] 確認資料缺口顯示數量與 from/to 區間，且圖表／表格沒有插值或補零。
- [ ] 確認時間以 Asia/Taipei 顯示，狀態 live region 只有狀態區。

## 行情資料與操作

- [ ] 以一組已知 fixture／本機 seed 資料驗證 1D 變化。
- [ ] 驗證 3D 變化使用正確比較快照，資料不足顯示樣本不足／缺資料。
- [ ] 驗證 7D 變化與實際樣本間隔。
- [ ] 驗證 `-1/-1` 或缺價顯示 `—`，不產生假漲跌。
- [ ] 驗證單邊 bid/ask 有「單邊」品質標記。
- [ ] 驗證不同 enhancement level（例如 `+7`、`+10`）是獨立 rows、自選項目與排序對象。
- [ ] 逐一檢查十個官方分類可到達，並驗證消耗品／其他等 convenience group。
- [ ] 驗證搜尋、官方分類、強化等級、最低成交量、最大價差可交叉使用。
- [ ] 驗證行情表、漲幅／跌幅／成交量／異常量／波動／大價差／無買無賣模式。
- [ ] 驗證大幅變動且低成交量的 row 同時顯示「異動」與「薄量」，不把它描述為機會或買入建議。
- [ ] 驗證自選加入、取消、相對順序與拖曳／上移下移。
- [ ] 驗證 browser reload 後歷史與自選仍存在。
- [ ] 驗證 mobile viewport 表格可水平滾動，header/name sticky 且不遮住可見 row。
- [ ] 確認全程沒有下單、買入、賣出、成交、取消訂單或其他市場 action。

## Cloud fixture acceptance

- [ ] 在唯一 temporary directory 以公開 `tests/fixtures/marketplace.json` 執行 `cloud:update`、同一目錄再次執行並確認第一次 `updated`、第二次 `unchanged`。
- [ ] 比對兩次 `manifest.json` 與 `snapshots/*.txt` SHA-256 完全相同，再執行 `cloud:validate --validate-only` 得到 exit code 0。
- [ ] 記錄 fixture timestamp、generatedAt、snapshot count、檔名／bytes、manifest／snapshot hash、unit、build、E2E；最後清理該 temporary directory。
- [ ] 不用這項 fixture evidence 宣稱已建立 remote、已完成 Pages deploy 或已完成 live MWI acceptance。

Retention synthetic evidence（2026-09-01，Asia/Taipei）：依序寫入 `1787529599999`（latest - 8d - 1ms）、`1787529600000`（exact latest - 8d）與 `1788220800000`（latest）；validate exit code 0，final manifest 保留 `1787529600000,1788220800000` 共 2 snapshots，`snapshots/1787529599999.txt` 已移除。final manifest SHA-256 為 `FE8FB657301D92B1E23B4666E1FC221B198B064CDDD23D233D3C5861E6A59A1E`；snapshot SHA-256 為 `1787529600000.txt`（159 bytes，`5B2435D51C3182B33AEB5EDDB013EC4CE5C66BE2992E168373180EF3FA5D070E`）、`1788220800000.txt`（159 bytes，`7DD8F3267E1A6787E360BA156B653F97C34FB7CF20E09BF7AE375DA4336A0DF5`）。

Fresh build artifact evidence（`npm run build`）：

| 相對路徑 | bytes | SHA-256 |
| --- | ---: | --- |
| `dist/index.html` | 484 | `59E44C96D5F28BF02418492F58DDB3AA6F63915953DA06DD99DC05A4EE85F3CB` |
| `dist/assets/index-C4MygJl6.js` | 295135 | `A5DF89470917CF52AAA211F44C2860D9F43CA6D15B0FC77354EFC40F397BF5F1` |
| `dist/assets/index-CMPmJcvL.css` | 13159 | `F1F5344BFD050C68401DD29B214165F469C55935991F526545811519A71F6A49` |
| `dist/mwi-market-radar.user.js` | 59403 | `1DAA1C9BF295EAC429D776E4566759FA1484A6EE0766135CDC2E20973459B3CE` |
| `public/catalog.json` | 222753 | `847354A0C867A09E53C3ED9898470897ECDA926600F9B351900368F4E25D3BF0` |

Production evidence（2026-09-01）：公開 repository `baowan403/mwi-market-radar`；Pages `https://baowan403.github.io/mwi-market-radar/`；首次 manual workflow run `33490440289` 的 collector、validate、415 unit tests、build、`market-data` publish 與 deploy 全部 success。公開頁顯示 cloud source，官方快照 `2026-09-01 17:06:00`、generatedAt `17:06:11`、3,084 targets。

## 失敗恢復

- [ ] network failure：保留舊資料，確認下一次 retry／hourly run 可恢復。
- [ ] schema failure：拒絕該快照，不污染既有歷史，查看固定 schema 訊息。
- [ ] storage/quota failure：停止該次寫入並保留舊資料，不刪除自選。
- [ ] Web Locks unavailable/request failure：不採集或顯示 safe lock error；不要改用 GM key 自行互斥。
- [ ] dashboard bridge timeout：重新確認 userscript 啟用、MWI 分頁開啟、網址是 allowlisted localhost。
- [ ] 若腳本被停用：重新啟用或重新安裝 generated userscript，再以唯讀方式確認下一個 timestamp。
- [ ] 清理測試資料時，只在 Tampermonkey 本腳本 storage UI 逐一刪除 `mwi-radar:v1:` keys；不使用全域清空方法。

## Evidence log

| 日期／時間（Asia/Taipei） | 環境／瀏覽器 | MWI 分頁數 | 官方 timestamp | dashboard 狀態 | snapshot count | 結果／缺口 | 證據檔或備註 |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| 2026-09-01 09:08（Asia/Taipei） | 正確 Chrome profile `jotaro99`／Tampermonkey userscript 0.1.4 | 1 | `1788224760`（09:06） | Radar official 09:06；local 09:08；next 10:08；無缺口 | 3055 targets；100/page；31 pages | previous smoke（已由 final 0.1.5 evidence supersede）；marker version 0.1.4：`loaded/mwi/started/dom-event` | 無市場 action、無私人資料讀取 |
| 2026-09-01 09:08（Asia/Taipei） | 正確 Chrome profile `jotaro99`／第二個 MWI 分頁 | 2 | `1788224760`（09:06，未變） | dashboard timestamp/status 未變 | 3055 targets；100/page；31 pages | previous smoke（已由 final 0.1.5 evidence supersede）；第二 MWI marker version 0.1.4：`loaded/mwi/started/dom-event`；相同 timestamp 去重通過 | 無重複保存；無市場 action、無私人資料讀取 |
| 2026-09-01 10:08（Asia/Taipei） | 正確 Chrome profile `jotaro99`／Tampermonkey userscript 0.1.5 | 1 | 10:06 | Radar official 10:06；local 10:08；next 11:08；無缺口 | 3072 targets；100/page；31 pages | final marker version 0.1.5：`loaded/mwi/started/dom-event`；thin badges visible；自動單向 MWI→Radar read-only bridge 通過 | 無市場 action、無私人資料讀取 |
| 2026-09-01 10:08（Asia/Taipei） | 正確 Chrome profile `jotaro99`／第二個 MWI 分頁 | 2 | 10:06（未變） | dashboard timestamp/status 未變 | 3072 targets；100/page；31 pages | 第二 MWI marker version 0.1.5：`loaded/mwi/started/dom-event`；相同 timestamp 去重通過；thin badges visible | 無重複保存；無市場 action、無私人資料讀取 |
| 2026-09-01 14:37（Asia/Taipei） | Node/tsx local public fixture；無 MWI／無官方網路 | — | `1787645160000`（`2026-08-25T08:06:00.000Z`） | fixture cloud history：`generatedAt 2026-09-01T06:37:26.560Z`；1 snapshot；`snapshots/1787645160000.txt`；235 bytes | manifest SHA-256 `96C91D591EAE8AB5ED881A199759607FE282F7B0518EB429DD2DE304BAAA3521`；snapshot SHA-256 `764D4BCB1E64EBE6A1AD978335471C59565DC19FF293503F0745DD672B7D5CD6`；第二次相同 | first `updated`／second `unchanged`／validate 0；只使用公開 fixture、完成後清理 temp；不代表 remote／Pages deploy |

先前 final whole review approved 的 live evidence 與本次 local fixture evidence 分開保存；本次 docs commit 的 automated verification 為 unit 31 files／395 tests、build 雙 artifact、E2E 31 passed／1 skipped。Radar deliverable tab 保留。手動 Milkonomy-style import 暫緩，因目前不需要；若未來 browser bridge 失效，可另做明確的 refresh/import fallback，但不屬於目前 scope。未宣稱 GitHub、Pages 或其他部署已完成。每次最新 unit/build/E2E 數字以對應 commit 的 verification output 為準。

### 安全聲明

驗收只允許公開市場資料的讀取與本機顯示。任何要求登入、讀 cookie/token、讀角色資料或執行市場交易的步驟都不在本專案範圍內，應立即停止並記錄為 out of scope。
