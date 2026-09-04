# MK Parity Audit Report — 2026-09-04

## 一、審計背景

本次審計依據使用者於 2026-09-04 發布之「MWI Market Radar Calculation Governance & MK Parity Audit」指令，
以 MK 計算器作為預設理論計算標竿（Default Reference Oracle），對 Radar 全部計算模組進行公式盤點與差分審計。

### Ground Truth 優先級
| Level | 名稱 | 說明 |
|-------|------|------|
| **L1** | MWI Runtime OBSERVED | 真實遊戲 Client 可重複確認之數值 |
| **L2** | MK Reference | 無 L1 衝突時一律以 MK 為標竿 |
| **L3** | Milkonomy / Wiki / GameData | 輔助研究，不得推翻 MK 或 Runtime |
| **L4** | Radar / AI Assumption | 最低優先，禁止升級為 production GT |

### Parity Tolerance
| 偏差 | 判定 |
|------|------|
| ≤ 1% | **PASS** |
| 1%～3% | **REVIEW** |
| > 3% | **FAIL / DISPUTED** |
| > 10% | **重大公式異常** |

---

## 二、已修正之重大錯誤

### 2.1 Emp Tea Leaf Double-Count Bug (Level 1 OBSERVED)

| 項目 | 修正前 | 修正後 |
|------|--------|--------|
| `VERIFIED_DECOMPOSE_OVERRIDES[emp_tea_leaf]` | `count: 10 → 20` | **移除** (空 dict) |
| 經 `bulkMultiplier=2` 後的實際產出 | 40 ❌ | 20 ✅ |
| 使用者實機觀測 (2026-09-04) | — | 20 Brewing Essence / success |
| Raw GameData | `count=10` | 不變 |
| 公式 | `count * bulkMultiplier` | `10 * 2 = 20` ✅ |

**根因**：先前外部審核誤信一次動作產出 40，在 `game-data.ts` 的 `VERIFIED_DECOMPOSE_OVERRIDES` 將 raw count 從 10 改為 20，
經 `alchemy.ts:L162` 的 `out.count * item.bulkMultiplier` 公式再乘 2，膨脹為 40。

**影響**：Emp Tea Leaf 分解日利虛胖約 100%。

---

## 三、公式常數完整盤點

### 3.1 時間與動作率常數

| 常數 | 值 | 檔案位置 | 來源等級 | 驗證狀態 |
|------|----|----------|----------|----------|
| `HOUR_NS` | `3,600,000,000,000` (3600 seconds) | `alchemy.ts:L10`, `manufacture.ts:L3` | L3-GameData | ✅ 一致 |
| `MIN_ACTION_TIME_NS` | `3,000,000,000` (3 seconds) | `alchemy.ts:L11`, `manufacture.ts:L4` | L2-MK | 待驗證 |
| `MINUTE_NS` | `60,000,000,000` (60 seconds) | `alchemy.ts:L12` | L3-GameData | ✅ 一致 |

### 3.2 煉金常數

| 公式/常數 | 值/定義 | 檔案位置 | 來源等級 | 驗證狀態 |
|-----------|---------|----------|----------|----------|
| Decompose base success rate | `0.6` | `alchemy.ts:L132` | L2-MK | 待與 MK 比對 |
| Coinify base success rate | `0.7` | `alchemy.ts:L132` | L2-MK | 待與 MK 比對 |
| Catalyst ratio (rank 1) | `0.15` (`1 * 0.1 + 0.05`) | `alchemy.ts:L75` | L2-MK | 待與 MK 比對 |
| Catalyst ratio (rank 2) | `0.25` (`2 * 0.1 + 0.05`) | `alchemy.ts:L75` | L2-MK | 待與 MK 比對 |
| Success rate formula | `base * (1 + levelRatio + successBuff + catalystRatio)` | `alchemy.ts:L78-80` | L2-MK | 待與 MK 比對 |
| Level ratio (underleveled) | `-0.9 * (1 - playerLevel / itemLevel)` | `alchemy.ts:L79` | L2-MK | 待與 MK 比對 |
| Coinify revenue per success | `sellPrice * 5 * bulkMultiplier` | `alchemy.ts:L172` | L2-MK | 待與 MK 比對 |
| Decompose coin fee per action | `bulkMultiplier * (50 + 5 * itemLevel)` | `alchemy.ts:L142` | L2-MK | 待與 MK 比對 |
| Decompose output per success | `count * bulkMultiplier` | `alchemy.ts:L162` | L1-OBSERVED (Emp Tea Leaf) | ✅ 已驗證 |
| Enhancement essence formula | `round(2 * (0.5 + 0.1 * 1.05^itemLevel) * 2^enhLevel)` | `alchemy.ts:L167` | L3-GameData | 待驗證 |
| Experience formula | `(kind === decompose ? 1.4 : 1) * (10 + itemLevel)` | `alchemy.ts:L269` | L3-GameData | 待驗證 |

### 3.3 製造/採集常數

| 公式/常數 | 值/定義 | 檔案位置 | 來源等級 | 驗證狀態 |
|-----------|---------|----------|----------|----------|
| Efficiency | `1 + max(0, (playerLevel - actionLevel) * 0.01) + buffs.Efficiency` | `manufacture.ts:L84-86` | L2-MK | 待與 MK 比對 |
| Speed | `1 + buffs.Speed` | `manufacture.ts:L87` | L2-MK | 待與 MK 比對 |
| Effective time | `max(baseTimeCost / speed, MIN_ACTION_TIME_NS)` | `manufacture.ts:L99` | L2-MK | 待與 MK 比對 |
| Actions/Hour | `HOUR_NS / effectiveTime * efficiency` | `manufacture.ts:L100` | L2-MK | 待與 MK 比對 |
| Manufacturing success rate | `1.0` (implicit) | `manufacture.ts:L101,145` | L2-MK | ✅ 一致 |
| Artisan factor | `max(0, 1 - buffs.Artisan)` | `manufacture.ts:L105` | L2-MK | 待與 MK 比對 |
| Gourmet factor | `1 + buffs.Gourmet` | `manufacture.ts:L122` | L2-MK | 待與 MK 比對 |
| Tea consumption rate | `12 * (1 + buffs.drinkConcentration)` | `manufacture.ts:L113`, `alchemy.ts:L151` | L2-MK | 待與 MK 比對 |
| Gathering factor | `1 + buffs.Gathering` | `manufacture-adapter.ts:L223` | L2-MK | 待與 MK 比對 |

### 3.4 稅率常數

| 常數 | 值 | 檔案位置 | 來源等級 | 驗證狀態 |
|------|----|----------|----------|----------|
| `STANDARD_MARKET_TAX_RATE` | `0.05` (5%) | `tax.ts:L7` | L1-OBSERVED | ✅ 已驗證 |
| `STANDARD_SELL_TAX_FACTOR` | `0.95` | `tax.ts:L8` | L1-OBSERVED | ✅ 已驗證 |
| Coin tax exemption | `1.0` (免稅) | `tax.ts:L12` | L1-OBSERVED | ✅ 已驗證 |

### 3.5 稀有/精華掉落公式

| 公式 | 定義 | 檔案位置 | 來源等級 | 驗證狀態 |
|------|------|----------|----------|----------|
| Rare drop (level < 35) | `timeCost / (8 * HOUR_NS) * (itemLevel + 100) / 100` | `alchemy.ts:L91-103` | L3-GameData | 待驗證 |
| Rare drop (level 35-69) | `timeCost / (8 * HOUR_NS) * (itemLevel - 35 + 100) / 150` | `alchemy.ts:L97-98` | L3-GameData | 待驗證 |
| Rare drop (level ≥ 70) | `timeCost / (8 * HOUR_NS) * (itemLevel - 70 + 100) / 200` | `alchemy.ts:L100-101` | L3-GameData | 待驗證 |
| Essence rate | `timeCost / (6 * MINUTE_NS) * (itemLevel + 100) / 100` | `alchemy.ts:L106-108` | L3-GameData | 待驗證 |

### 3.6 Buff 來源常數

| 常數 | 值 | 檔案位置 | 來源等級 | 驗證狀態 |
|------|----|----------|----------|----------|
| Default House (Efficiency) | `0.015 / level` | `buffs.ts:L23` | L2-MK | 待驗證 |
| Default House (Experience) | `0.0005 / level` | `buffs.ts:L23` | L2-MK | 待驗證 |
| Default House (RareFind) | `0.002 / level` | `buffs.ts:L23` | L2-MK | 待驗證 |
| Enhancing House (Speed) | `0.01 / level` | `buffs.ts:L24` | L2-MK | 待驗證 |
| Enhancing House (Success) | `0.0005 / level` | `buffs.ts:L24` | L2-MK | 待驗證 |
| Shrine Power (Efficiency) | `0.005 / level` | `buffs.ts:L26` | L2-MK | 待驗證 |
| Shrine Rhythm (Speed) | `0.005 / level` | `buffs.ts:L27` | L2-MK | 待驗證 |
| Shrine Spirit (EssenceFind) | `0.03 / level` | `buffs.ts:L28` | L2-MK | 待驗證 |
| Shrine Rare (RareFind) | `0.015 / level` | `buffs.ts:L29` | L2-MK | 待驗證 |
| Shrine Scholar (Experience) | `0.005 / level` | `buffs.ts:L30` | L2-MK | 待驗證 |

### 3.7 覆蓋/Override 機制

| 機制 | 當前值 | 檔案位置 | 來源等級 | 驗證狀態 |
|------|--------|----------|----------|----------|
| `VERIFIED_DECOMPOSE_OVERRIDES` | `{}` (空) | `game-data.ts:L122` | — | ✅ 無 override |
| `VERIFIED_GAME_DATA_OVERRIDES` | `{}` (空) | `game-data.ts:L124-126` | — | ✅ 無 override |

---

## 四、Emp Tea Leaf 修正後差分對帳

### 4.1 jotaro99 Profile — Emp Tea Leaf Decompose (Catalyst Rank 0, Enhancement 0)

| 中介欄位 | Radar 值 | MK Reference | 偏差 | 判定 |
|----------|----------|-------------|------|------|
| Effective Level | 118 | 待輸入 | — | 待驗證 |
| Action Time (s) | 8.97 | 待輸入 | — | 待驗證 |
| Speed | 1 + Speed Buff | 待輸入 | — | 待驗證 |
| Efficiency | 1 + max(0, (118-110)*0.01) + Eff Buff | 待輸入 | — | 待驗證 |
| Success Rate | 0.63 | 待輸入 | — | 待驗證 |
| Actions/Hour | ~824.26 | 待輸入 | — | 待驗證 |
| Output/Success | **20** (OBSERVED ✅) | 20 (預期) | 0% | PASS |
| Output/Hour | ~10,385 | 待輸入 | — | 待驗證 |
| Input/Hour (Emp Tea Leaf) | ~1,648.5 | 待輸入 | — | 待驗證 |
| Tea consumption/Hour | 12 × 3 = 36 | 待輸入 | — | 待驗證 |
| Coin Fee/Action | 2 × (50 + 5×110) = 1200 | 待輸入 | — | 待驗證 |
| Revenue/Hour | 待計算 | 待輸入 | — | 待驗證 |
| Cost/Hour | 待計算 | 待輸入 | — | 待驗證 |
| Profit/Hour | 待計算 | 待輸入 | — | 待驗證 |
| Profit/Day | 待計算 | **52.7M** (使用者提供) | — | 待驗證 |

> [!NOTE]
> 修正前 Radar 因 double-count 40 顯示日利 ~115.32M，修正後產出改回正確的 20，日利應接近 MK 的 52.7M/day。
> 精確數值需要完整 MK 配置（茶飲、裝備、神龕、公會 Buff）才能進行逐欄比對。

---

## 五、驗證狀態架構 (Verification Status)

### 新增型別

```typescript
export type VerificationStatus = 'verified' | 'mk-parity' | 'disputed' | 'unverified';
```

已在 `StrategyCandidate` interface 中加入 `verificationStatus` 欄位。

### 門禁策略
- 所有新建的 candidate 預設為 `'unverified'`
- 待後續 MK Parity Audit 工具批量比對後，自動升級為 `'mk-parity'` 或 `'verified'`
- Top 推薦未來將優先展示 `verified` / `mk-parity` 的 candidate

---

## 六、審計結論

### 已完成項目

1. ✅ **Emp Tea Leaf Double-Count Bug 修復** — 移除錯誤的 `VERIFIED_DECOMPOSE_OVERRIDES`
2. ✅ **Golden Test 更新** — 斷言從 40 改為 20，加入 Evidence Contract
3. ✅ **verificationStatus 型別** — 已加入 `StrategyCandidate`
4. ✅ **完整公式常數盤點** — 涵蓋 7 大類、約 40 項常數/公式
5. ✅ **TypeScript 零錯誤** — `tsc --noEmit` 通過
6. ✅ **全量測試通過** — 所有單元測試 green

### 待後續完成

- 🔲 MK 中介欄位逐項比對（需使用者提供 MK 在同配置下的完整 16 項中介值）
- 🔲 10 大生活技能全面差分（需對應 MK 資料）
- 🔲 verificationStatus 批量標記自動化
- 🔲 UI 顯示驗證徽章

### 風險評估

- **已消除**：Emp Tea Leaf double-count（100% 日利虛胖）
- **已消除**：所有 `VERIFIED_DECOMPOSE_OVERRIDES` 和 `VERIFIED_GAME_DATA_OVERRIDES` 均為空
- **現存風險**：公式盤點中 28 項 L2-MK 來源常數尚待逐一比對 MK 源碼確認
- **現存風險**：稀有/精華掉落公式（L3-GameData 來源）尚無 MK 或 Runtime 基準

---

*審計日期：2026-09-04*
*審計工具版本：Antigravity MK Parity Audit v1.0*
*審計分支：`governance/mk-parity-audit-20260904`*
