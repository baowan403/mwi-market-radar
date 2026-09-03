# MWI Chrome CDP (Port 9330) 實機校驗與分頁探測 SOP

## 1. 核心環境與連接資訊
- 使用者桌面捷徑: C:\Users\neptu\Desktop\Start Agent-CDP 9330.lnk
- CDP HTTP 端點: http://127.0.0.1:9330
- 分頁探測 API: http://127.0.0.1:9330/json/list

## 2. 探測與交互方法 (原生 Node.js WebSocket)
無須額外安裝 npm 依賴，直接使用 Node 22 原生 WebSocket 連接目標分頁的 webSocketDebuggerUrl：
- 截圖命令: Page.captureScreenshot (params: { format: 'png' })
- DOM/狀態評估: Runtime.evaluate (params: { expression: '...', returnByValue: true })

## 3. 常駐關鍵分頁
1. **Milky Way Idle 遊戲本體** (milkywayidle.com/game)
2. **Milkonomy 計算器** (polokikiki.github.io/Milkonomy)
3. **MWI Market Radar** (aowan403.github.io/mwi-market-radar)

## 4. 收益核算與對齊鐵律 (Decompose 實測查核)
- **Milkonomy 與 Radar 公式本質 100% 相同**：
  - 分解基礎工時: 20 秒
  - 成功率: 基礎 60% * (1 + 催化茶 5%) = 63%
  - bulkMultiplier = 2, 分解金幣費用 = 900 coin/attempt
  - 每小時消耗三茶各 12 杯
  - 產物均扣除 5% 市場交易稅
- **先前 Radar 算出 46.14M vs Milkonomy 51.5M 的根因**：
  - **房屋等級遺漏**：遊戲與 Milkonomy 中角色為【實驗室 4 級】（單次耗時壓到 8.97s，總速度 122.92%，總效率 105.42%）；而先前 Radar 快照裡實驗室誤記為 0 級。
  - **神龕等級遺漏**：遊戲中啟動了力量神龕與節奏神龕，先前快照未設定。
  - 只要將實驗室設為 4 級、神龕對齊，Radar 算出的日利即為 **51.75M**，與 Milkonomy 的 **51.8M** 完美貼合。
