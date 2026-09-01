# Market Strategy Foundation Acceptance

日期：2026-09-01（Asia/Taipei）

## 自動驗收

2026-09-01 fresh evidence：

- unit：37 files、415 passed、0 failed；
- build：TypeScript、dashboard、userscript 全部 exit 0；
- Chrome E2E：32 passed、1 個既有 desktop expected skip、0 failed。

執行：

```powershell
npm test -- --run
npm run build
npx playwright test
git diff --check
```

通過條件：

- unit tests 零失敗；
- TypeScript、dashboard 與 userscript build 皆為 exit 0；
- Playwright E2E 除既有明確 expected skip 外零失敗；
- `git diff --check` 無 whitespace error。

## 玩家旅程驗收

1. 不開 MWI，直接開啟 cloud dashboard，確認行情仍可使用。
2. 分別以中文名稱、英文名稱與 HRID 搜尋同一物品。
3. 點「角色快照」，貼上 `tests/fixtures/profile-export-v1.json`。
4. 點「導入並使用」，確認顯示「測試牛一號｜煉金 103」。
5. 重新整理頁面，確認 active profile 仍存在。
6. 匯入 `tests/fixtures/profile-preset.json`，確認標示「部分資料」。
7. 切回測試牛一號，確認煉金 103；切回測試預設，確認資料沒有互相覆蓋。
8. 刪除目前測試角色，確認另一名角色仍存在。
9. 在匯入期間檢查 network requests，確認角色名稱、character id 與裝備 HRID 未出現在 request body。

## 數值驗收

- `tests/fixtures/milkonomy-manufacture-golden.json` 固定 Milkonomy 參考 commit 與單步製造期望值。
- 原料用賣一、成品用買一、出售乘以 0.95。
- `/items/coin` 產物不課市場稅。
- 茶每小時消耗、工匠／美食、精華與稀有 EV 都有獨立測試。
- 必要買價或賣價缺失時，calculator 回傳 `valid=false`，不補零。

## 誠實範圍

本切片只證明角色匯入、隔離、中文目錄、固定遊戲資料、玩家增益與單步製造數值基礎。策略推薦分頁、多步工作流、分解＋點金、流動性調整與趨勢訊號仍屬後續切片，不能用本文件宣稱已完成。
