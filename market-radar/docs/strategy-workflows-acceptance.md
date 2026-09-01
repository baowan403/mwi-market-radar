# Personalized Strategy Workflows Acceptance

日期：2026-09-01（Asia/Taipei）

## Fresh automated evidence

- Unit：44 files、433 passed、0 failed。
- Build：TypeScript、dashboard、userscript 全部 exit 0；`dist/strategy-data.json` 存在且只在策略頁使用。
- Chrome E2E：34 passed、2 個 desktop-only expected skips、0 failed。

## Covered behavior

- Milkonomy Exporter v1／preset 角色匯入與多角色隔離。
- 真實 MWI 製造、裁縫、鍛造、烹飪與沖泡配方。
- 2–7 步工作流工時平衡、中間品抵消、循環阻擋。
- 海盜精煉碎片分解、海盜精華點金及組合路徑。
- 無催化、專用催化、至高催化成功率與成本。
- 角色裝備、房屋、茶、社群、成就、封印、神龕。
- 理論日利、每小時利潤、24h 資金與步驟明細。
- 策略釘選跨 reload 保存。
- 角色名稱、character id、裝備 HRID 不出現在 request body。

## Player-facing limitation

本階段只發布理論收益，UI 明確顯示「尚未套用市場承接量」。流動性調整、安全批量、售完天數、3D／7D 策略趨勢與回測仍是後續必要工作，不能以本文件宣稱完整目標已完成。
