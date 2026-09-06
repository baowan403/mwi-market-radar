# MK 更新核對（2026-09-06）

來源固定於 MK commit `1d1ccd0c24cf791d0ce3e4c42e2dc8e26b4604cf`。
已完整閱讀網站頁面來源的 11 版日誌（v2.0.0–v2.7.0），以及根目錄兩份 CHANGELOG；根目錄日誌只到 v2.1，不能代表現況。

- [完整網站日誌](https://github.com/Polokikiki/Milkonomy/blob/1d1ccd0c24cf791d0ce3e4c42e2dc8e26b4604cf/src/pages/changelog/index.vue)
- [煉金計算](https://github.com/Polokikiki/Milkonomy/blob/1d1ccd0c24cf791d0ce3e4c42e2dc8e26b4604cf/src/calculator/alchemy.ts)
- [共用計算](https://github.com/Polokikiki/Milkonomy/blob/1d1ccd0c24cf791d0ce3e4c42e2dc8e26b4604cf/src/calculator/index.ts)
- [價格及遊戲 API](https://github.com/Polokikiki/Milkonomy/blob/1d1ccd0c24cf791d0ce3e4c42e2dc8e26b4604cf/src/common/apis/game/index.ts)

## 結論

1. 修復 Radar 分解、點金的 XP：原先按每次完整經驗，現乘 `successRate + 0.1 * (1-successRate)`，與 MK 共用煉金 exp 一致。轉化原本已正確。不改成功率、產量、費用或日利。本輪是 MK source 核對，不是新的遊戲 UI 機制取證。
2. 賣出稅已是 5%，Coin 不課出售稅，點金產出已為 sellPrice×5×bulk×成功次數；無須修改。
3. MK 的最新無掛單「自製成本回退」不能當作 Radar 的 Ask。否則會把買不到的原料當可買，且漏自製工時。維持無報價；需要自產時必須走明列時間及材料的 workflow。
4. MK 新增通用煉金鏈和賢者路徑是功能擴張。Radar 現有單步與分解→點金不等於完整通用煉金鏈覆盖；此輪未聲稱做過新版 Top20 runtime coverage。後續應單獨審計通用鏈候選，不為 UI 調整順帶增加未驗證鏈。

## 遊戲資料核對

對 MK 最新 `public/data/data.json`、本機 vendored `strategy-data.json`、正式站 `/strategy-data.json` 的共通 11 個欄位做結構深度比對，全部一致：
`achievementDetailMap`, `achievementTierDetailMap`, `actionDetailMap`, `communityBuffTypeDetailMap`, `enhancementLevelTotalBonusMultiplierTable`, `gameVersion`, `itemDetailMap`, `openableLootDropMap`, `personalBuffTypeDetailMap`, `shopItemDetailMap`, `versionTimestamp`。

MK 本身仍標 `v1.20260309.0`；日期不能單独作為 Radar 資料過期的證據。未更動 vendored metadata 假裝更新。

## 各版判讀

| 版本 | 相關變更 | Radar 處理 |
|---|---|---|
| 2.7.0 | 報價除0.95、指導價重複課稅、賢者路徑、無賣單自製回退、欄位及排序 | Radar 沒有該強化工時報價功能；現行賣出只扣一次稅。自製回退不照搬，理由見上。 |
| 2.6.0 | 通用煉金鏈、失敗10%經驗、點金收益、稀有開關、催化劑價格 | 修正兩項XP；Coin收入已免稅。Radar固定計入額外掉落和Ask催化劑，不與MK不同選項混比。通用鏈是尚未全覆蓋功能。 |
| 2.5.0 | 配裝比較、煉金路徑、預設及行動端 | 不表示核心公式變更；本次改善升級表呈現。 |
| 2.4.0 | 2%→5%出售稅 | `strategy/tax.ts` 已0.95，Coin為1。 |
| 2.3.0 / 2.2.3 | 哞卡、导出、經驗排序 | `buffs.ts` 已有 moo_card 經驗加成；不是收入倍率。 |
| 2.2.2 | 材質鏈篩選、快取、導入 | Radar依配方而非材質名稱硬編；最新效能修正已使用計算範圍快取，不跨行情沿用。 |
| 2.2.1 | 價格模式快取、材料檔位、商店、個人神龕及房屋0級 | Radar固定Ask/Bid、價格簿按快照建立；神龕讀匯入個人值，缺房屋不補4。不能將公會建築等級代入個人神龕。 |
| 2.2.0 | 導入映射、神龕、工作鏈、預設對比 | 已支援主要欄位；此次另修正掌上監工歷史錯槽。不能聲稱與MK所有篩選器或所有鏈相同。 |
| 2.1.0 | 取高合併、神龕、導出 | 不採取歷史最高等級自動覆蓋現況；持有與實際啟用必須分開。 |
| 2.0.0 | 生活導入、預設比較、商店來源 | 已支援角色輸入和商店價格來源；不涉及額外收益公式。 |

## 新欄位口徑

存錢天數 = 目標完整購入價 / 全技能最高的當前24H預估收益；不扣錢包、不含複利、不把換裝後收益當目前收入。每日使用時數只調整升級增益及回本，存錢基準仍固定24H。未知價格或無正基準收入時顯示未知。已持有不當作新採購。
