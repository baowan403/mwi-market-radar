from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one regex match, found {count}: {pattern[:120]!r}")
    write(path, updated)


TRANSMUTE_TS = r'''import type { PlayerProfile } from '../profile/types';
import type { CatalystRank } from './alchemy';
import { actionBuffs, type ActionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import { expandStrategyLiquidation } from './liquidation';
import type { MarketPriceBook } from './price-book';
import { marketTaxFactor } from './tax';
import type {
  PhysicalLedger,
  StrategyFlow,
  StrategyLedger,
  StrategyStepResult,
} from './types';

const HOUR_NS = 3_600_000_000_000;
const MINUTE_NS = 60_000_000_000;
const MIN_ACTION_TIME_NS = 3_000_000_000;
const COIN_HRID = '/items/coin';

interface TransmuteOptions {
  itemHrid: string;
  catalystRank: CatalystRank;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
  buffs?: ActionBuffs;
}

interface TransmuteDrop {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
}

interface TransmuteItem {
  itemLevel: number;
  sellPrice: number;
  bulkMultiplier: number;
  baseSuccessRate: number;
  drops: TransmuteDrop[];
}

export interface TransmuteStepResult extends StrategyStepResult {
  successRate: number;
  catalystRank: CatalystRank;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, fallback = Number.NaN): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function transmuteItem(hrid: string, data: NormalizedStrategyGameData): TransmuteItem {
  const raw = record(data.itemsByHrid.get(hrid));
  const detail = record(raw?.alchemyDetail);
  const itemLevel = finite(raw?.itemLevel);
  const sellPrice = finite(raw?.sellPrice);
  const bulkMultiplier = finite(detail?.bulkMultiplier);
  const baseSuccessRate = finite(detail?.transmuteSuccessRate);
  const rawDrops = Array.isArray(detail?.transmuteDropTable) ? detail.transmuteDropTable : [];
  const drops = rawDrops.map((rawDrop): TransmuteDrop | null => {
    const drop = record(rawDrop);
    const itemHrid = typeof drop?.itemHrid === 'string' ? drop.itemHrid : '';
    const dropRate = finite(drop?.dropRate, 1);
    const minCount = finite(drop?.minCount, 0);
    const maxCount = finite(drop?.maxCount);
    if (
      !itemHrid.startsWith('/items/')
      || dropRate < 0
      || minCount < 0
      || maxCount < minCount
    ) return null;
    return { itemHrid, dropRate, minCount, maxCount };
  }).filter((drop): drop is TransmuteDrop => drop !== null);

  if (
    !raw
    || !detail
    || !Number.isFinite(itemLevel)
    || itemLevel < 0
    || !Number.isFinite(sellPrice)
    || sellPrice < 0
    || !Number.isFinite(bulkMultiplier)
    || bulkMultiplier <= 0
    || !Number.isFinite(baseSuccessRate)
    || baseSuccessRate < 0
    || drops.length === 0
  ) throw new Error('煉金轉化策略無法使用');

  return { itemLevel, sellPrice, bulkMultiplier, baseSuccessRate, drops };
}

function catalystRatio(rank: CatalystRank): number {
  return rank === 0 ? 0 : rank * 0.1 + 0.05;
}

function successRate(
  base: number,
  playerLevel: number,
  itemLevel: number,
  successBuff: number,
  rank: CatalystRank,
): number {
  const levelRatio = playerLevel >= itemLevel ? 0 : -0.9 * (1 - playerLevel / itemLevel);
  return Math.max(0, Math.min(1, base * (1 + levelRatio + successBuff + catalystRatio(rank))));
}

function catalystHrid(rank: CatalystRank): string | null {
  if (rank === 0) return null;
  return rank === 2 ? '/items/prime_catalyst' : '/items/catalyst_of_transmutation';
}

function rareDrop(itemLevel: number, timeCost: number): { itemHrid: string; rate: number } {
  let itemHrid = '/items/small_artisans_crate';
  let scale: number;
  if (itemLevel < 35) {
    scale = (itemLevel + 100) / 100;
  } else if (itemLevel < 70) {
    itemHrid = '/items/medium_artisans_crate';
    scale = (itemLevel - 35 + 100) / 150;
  } else {
    itemHrid = '/items/large_artisans_crate';
    scale = (itemLevel - 70 + 100) / 200;
  }
  return { itemHrid, rate: timeCost / (8 * HOUR_NS) * scale };
}

function essenceRate(itemLevel: number, timeCost: number): number {
  return timeCost / (6 * MINUTE_NS) * ((itemLevel + 100) / 100);
}

function effectiveDropRate(drop: TransmuteDrop): number {
  // Milkonomy treats a missing/zero rate as the default deterministic rate of 1.
  return drop.dropRate || 1;
}

function addUnit(target: Record<string, number>, itemHrid: string, units: number): void {
  target[itemHrid] = (target[itemHrid] ?? 0) + units;
}

function addFlow(target: Map<string, StrategyFlow>, flow: StrategyFlow): void {
  const key = `${flow.itemHrid}::${flow.enhancementLevel}`;
  const current = target.get(key);
  if (!current) {
    target.set(key, { ...flow });
    return;
  }
  if (current.unitPrice !== flow.unitPrice || current.market !== flow.market) {
    throw new Error('煉金轉化策略無法使用');
  }
  current.unitsPerHour += flow.unitsPerHour;
}

export function calculateTransmute(options: TransmuteOptions): TransmuteStepResult {
  const { itemHrid, catalystRank: rank, profile, data, prices } = options;
  if (![0, 1, 2].includes(rank)) throw new Error('煉金轉化策略無法使用');
  const item = transmuteItem(itemHrid, data);
  const actionHrid = '/actions/alchemy/transmute';
  const action = data.actionsByHrid.get(actionHrid);
  if (!action) throw new Error('煉金轉化策略無法使用');

  const buffs = options.buffs ?? actionBuffs(profile, 'alchemy', data);
  const rate = successRate(
    item.baseSuccessRate,
    buffs.Level,
    item.itemLevel,
    buffs.Success,
    rank,
  );
  const efficiency = 1 + Math.max(0, (buffs.Level - item.itemLevel) * 0.01) + buffs.Efficiency;
  const speed = 1 + buffs.Speed;
  const effectiveTime = Math.max(action.baseTimeCost / speed, MIN_ACTION_TIME_NS);
  const actionsPerHour = HOUR_NS / effectiveTime * efficiency;
  const successfulActionsPerHour = actionsPerHour * rate;
  const selfDrop = item.drops.find((drop) => drop.itemHrid === itemHrid);
  const sameItemCounter = selfDrop
    ? Math.min(1, selfDrop.maxCount * effectiveDropRate(selfDrop) * rate)
    : 0;
  const netInputPerAction = item.bulkMultiplier * (1 - sameItemCounter);
  const coinCostPerInput = Math.max(Math.floor(item.sellPrice / 5), 50);
  const coinCostPerAction = item.bulkMultiplier * coinCostPerInput;
  const catalyst = catalystHrid(rank);
  const activeTeas = profile.actions.alchemy?.teas ?? [];

  // Physical production remains price independent. The self-return is netted against
  // the purchased input exactly as Milkonomy's sameItemCounter accounting does.
  const physicalInputs: Record<string, number> = {
    [itemHrid]: netInputPerAction * actionsPerHour,
    [COIN_HRID]: coinCostPerAction * actionsPerHour,
  };
  if (catalyst) physicalInputs[catalyst] = successfulActionsPerHour;

  const teaUnitsPerHour: Record<string, number> = {};
  for (const teaHrid of activeTeas) {
    const units = 12 * (1 + buffs.drinkConcentration);
    teaUnitsPerHour[teaHrid] = units;
    addUnit(physicalInputs, teaHrid, units);
  }

  const outputUnitsPerSuccess: Record<string, number> = {};
  const outputUnitsPerHour: Record<string, number> = {};
  for (const drop of item.drops) {
    if (drop.itemHrid === itemHrid) continue;
    const expectedPerSuccess = drop.maxCount * item.bulkMultiplier * effectiveDropRate(drop);
    addUnit(outputUnitsPerSuccess, drop.itemHrid, expectedPerSuccess);
    addUnit(outputUnitsPerHour, drop.itemHrid, expectedPerSuccess * successfulActionsPerHour);
  }

  const rareAndEssenceUnitsPerHour: Record<string, number> = {};
  const rare = rareDrop(item.itemLevel, action.baseTimeCost);
  rareAndEssenceUnitsPerHour[rare.itemHrid] = actionsPerHour
    * rare.rate
    * (1 + buffs.RareFind);
  rareAndEssenceUnitsPerHour['/items/alchemy_essence'] = actionsPerHour
    * essenceRate(item.itemLevel, action.baseTimeCost)
    * (1 + buffs.EssenceFind);

  const physical: PhysicalLedger = {
    effectiveLevel: buffs.Level,
    speed,
    efficiency,
    successRate: rate,
    actionTimeSeconds: effectiveTime / 1_000_000_000,
    actionsPerHour,
    successfulActionsPerHour,
    inputUnitsPerHour: physicalInputs,
    outputUnitsPerSuccess,
    outputUnitsPerHour,
    rareAndEssenceUnitsPerHour,
    teaUnitsPerHour,
  };

  const inputs = new Map<string, StrategyFlow>();
  const outputs = new Map<string, StrategyFlow>();
  let liquidationComplete = true;
  const addLiquidation = (outputHrid: string, unitsPerHour: number): void => {
    const result = expandStrategyLiquidation({ itemHrid: outputHrid, unitsPerHour, data, prices });
    if (!result.complete) {
      liquidationComplete = false;
      return;
    }
    for (const flow of result.flows) addFlow(outputs, flow);
  };

  addFlow(inputs, {
    itemHrid,
    enhancementLevel: 0,
    unitsPerHour: netInputPerAction * actionsPerHour,
    unitPrice: prices.ask(itemHrid),
    market: data.itemsByHrid.get(itemHrid)?.isTradable === true,
  });
  addFlow(inputs, {
    itemHrid: COIN_HRID,
    enhancementLevel: 0,
    unitsPerHour: coinCostPerAction * actionsPerHour,
    unitPrice: 1,
    market: false,
  });
  if (catalyst) {
    addFlow(inputs, {
      itemHrid: catalyst,
      enhancementLevel: 0,
      unitsPerHour: successfulActionsPerHour,
      unitPrice: prices.ask(catalyst),
      market: true,
    });
  }
  for (const teaHrid of activeTeas) {
    addFlow(inputs, {
      itemHrid: teaHrid,
      enhancementLevel: 0,
      unitsPerHour: 12 * (1 + buffs.drinkConcentration),
      unitPrice: prices.ask(teaHrid),
      market: true,
    });
  }

  for (const [outputHrid, unitsPerHour] of Object.entries(outputUnitsPerHour)) {
    addLiquidation(outputHrid, unitsPerHour);
  }
  addLiquidation(rare.itemHrid, rareAndEssenceUnitsPerHour[rare.itemHrid]!);
  addLiquidation(
    '/items/alchemy_essence',
    rareAndEssenceUnitsPerHour['/items/alchemy_essence']!,
  );

  const inputList = [...inputs.values()];
  const outputList = liquidationComplete ? [...outputs.values()] : [];
  const valid = liquidationComplete && [...inputList, ...outputList].every((flow) => (
    typeof flow.unitPrice === 'number'
    && Number.isFinite(flow.unitPrice)
    && flow.unitPrice >= 0
  ));
  const costPerHour = valid
    ? inputList.reduce((sum, flow) => sum + flow.unitsPerHour * flow.unitPrice!, 0)
    : null;
  const incomePerHour = valid
    ? outputList.reduce((sum, flow) => (
      sum + flow.unitsPerHour
        * flow.unitPrice!
        * (flow.market ? marketTaxFactor(flow.itemHrid) : 1)
    ), 0)
    : null;

  const inputAskPrices: Record<string, number | null> = {};
  for (const flow of inputList) inputAskPrices[flow.itemHrid] = flow.unitPrice;
  const outputBidPrices: Record<string, number | null> = {};
  const outputValuations: Record<string, import('./types').OutputValuation> = {};
  for (const flow of outputList) {
    outputBidPrices[flow.itemHrid] = flow.unitPrice;
    const taxFactor = flow.market ? marketTaxFactor(flow.itemHrid) : 1;
    const hasPrice = typeof flow.unitPrice === 'number' && Number.isFinite(flow.unitPrice);
    outputValuations[flow.itemHrid] = {
      itemHrid: flow.itemHrid,
      unitsPerHour: flow.unitsPerHour,
      unitBidPrice: flow.unitPrice,
      taxFactor,
      netValuePerHour: hasPrice ? flow.unitsPerHour * flow.unitPrice! * taxFactor : null,
    };
  }
  const teaAskPrices: Record<string, number | null> = {};
  for (const teaHrid of activeTeas) teaAskPrices[teaHrid] = prices.ask(teaHrid);

  const profitPerHour = valid ? incomePerHour! - costPerHour! : null;
  const economic: import('./types').EconomicLedger = {
    complete: valid,
    inputAskPrices,
    outputBidPrices,
    outputValuations,
    teaAskPrices,
    revenuePerHour: incomePerHour,
    costPerHour,
    profitPerHour,
    profitPerDay: profitPerHour === null ? null : profitPerHour * 24,
  };
  const ledger: StrategyLedger = { physical, economic };
  const outputHrid = item.drops.find((drop) => drop.itemHrid !== itemHrid)?.itemHrid
    ?? item.drops[0]!.itemHrid;
  const successExperienceFactor = rate + 0.1 * (1 - rate);

  return {
    id: `transmute:${itemHrid}:0:c${rank}`,
    action: 'alchemy',
    actionHrid,
    outputHrid,
    valid,
    actionsPerHour,
    costPerHour,
    incomePerHour,
    profitPerHour,
    experiencePerHour: 1.6
      * (10 + item.itemLevel)
      * (1 + buffs.Experience)
      * successExperienceFactor
      * actionsPerHour,
    inputs: inputList,
    outputs: outputList,
    successRate: rate,
    catalystRank: rank,
    ledger,
  };
}
'''
write('market-radar/src/strategy/transmute.ts', TRANSMUTE_TS)

# Candidate enumeration: add transmutation as a first-class alchemy candidate.
replace_once(
    'market-radar/src/strategy/candidates.ts',
    "import { calculateCoinify, calculateDecompose, type CatalystRank } from './alchemy';\n",
    "import { calculateCoinify, calculateDecompose, type CatalystRank } from './alchemy';\nimport { calculateTransmute } from './transmute';\n",
)
replace_once(
    'market-radar/src/strategy/candidates.ts',
    "kind: 'manufacture' | 'workflow' | 'decompose' | 'coinify' | 'decompose-coinify' | 'gather';",
    "kind: 'manufacture' | 'workflow' | 'transmute' | 'decompose' | 'coinify' | 'decompose-coinify' | 'gather';",
)
replace_once(
    'market-radar/src/strategy/candidates.ts',
    "    const hasDecompose = detail.decomposeItems !== null && detail.decomposeItems !== undefined;\n    const canCoinify = detail.isCoinifiable === true;\n",
    "    const transmuteDrops = Array.isArray(detail.transmuteDropTable)\n      ? detail.transmuteDropTable\n      : [];\n    const hasTransmute = transmuteDrops.length > 0\n      && typeof detail.transmuteSuccessRate === 'number'\n      && Number.isFinite(detail.transmuteSuccessRate);\n    const hasDecompose = detail.decomposeItems !== null && detail.decomposeItems !== undefined;\n    const canCoinify = detail.isCoinifiable === true;\n",
)
replace_once(
    'market-radar/src/strategy/candidates.ts',
    "    const hasCoinifyMarketPrices = canCoinify && prices.ask(itemHrid) !== null;\n\n    if (hasDecompose) {",
    "    const hasCoinifyMarketPrices = canCoinify && prices.ask(itemHrid) !== null;\n    const hasTransmuteMarketPrices = hasTransmute\n      && prices.ask(itemHrid) !== null\n      && transmuteDrops.some((rawDrop) => {\n        const drop = record(rawDrop);\n        return typeof drop?.itemHrid === 'string'\n          && drop.itemHrid !== itemHrid\n          && prices.bid(drop.itemHrid) !== null;\n      });\n\n    if (hasTransmute) {\n      for (const catalystRank of CATALYST_RANKS) {\n        try {\n          let step = calculateTransmute({\n            itemHrid, catalystRank, profile, data, prices, buffs: alchemyBuffs,\n          });\n          if (!isManualTea && hasTransmuteMarketPrices) {\n            const opt = findOptimalTeasForAlchemy({\n              kind: 'transmute', itemHrid, catalystRank, enhancementLevel: 0, profile, data, prices,\n              calculateFn: calculateTransmute,\n            });\n            if (opt.profitPerHour !== null && opt.profitPerHour > (step.profitPerHour ?? -Infinity)) {\n              const stepProfile = {\n                ...profile,\n                actions: { ...profile.actions, alchemy: { ...profile.actions.alchemy, teas: opt.teas } },\n              };\n              step = calculateTransmute({\n                itemHrid, catalystRank, profile: stepProfile, data, prices, buffs: opt.buffs,\n              });\n            }\n          }\n          addCandidate(candidateFromStep(step, 'transmute', data));\n        } catch { diagnostics.push(`transmute:${itemHrid}:c${catalystRank}`); }\n      }\n    }\n\n    if (hasDecompose) {",
)

replace_once(
    'market-radar/src/strategy/tea-optimizer.ts',
    "  kind: 'decompose' | 'coinify';",
    "  kind: 'transmute' | 'decompose' | 'coinify';",
)

replace_once(
    'market-radar/src/strategy/semantic-path.ts',
    "  type: 'buy' | 'gather' | 'craft' | 'decompose' | 'coinify' | 'sell';",
    "  type: 'buy' | 'gather' | 'craft' | 'transmute' | 'decompose' | 'coinify' | 'sell';",
)
replace_once(
    'market-radar/src/strategy/semantic-path.ts',
    "    if (step.actionHrid.includes('/decompose')) {\n      parts.push(`分解成 ${outputName}`);",
    "    if (step.actionHrid.includes('/transmute')) {\n      parts.push(`轉化成 ${outputName}`);\n    } else if (step.actionHrid.includes('/decompose')) {\n      parts.push(`分解成 ${outputName}`);",
)

# Restore the product's primary answer: current profit, with liquidity as metadata.
replace_once(
    'market-radar/src/strategy/view.ts',
    "import type { MarketKey, Snapshot } from '../core/types';",
    "import type { Snapshot } from '../core/types';",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "import { marketCapacity } from './liquidity';\n",
    "",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "  reject: '極高',\n  insufficient: '極高',",
    "  reject: '極高',\n  insufficient: '資料不足',",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "    selectedSkill: 'all', searchQuery: '', sortMode: 'safe',",
    "    selectedSkill: 'all', searchQuery: '', sortMode: 'theoretical',",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "    : '主排名採 3D／7D 成交量容量折算收益；買料用賣一、出售用買一並扣 5% 稅，點金免稅。Exporter v1 不含材料數量，因此目前不以裝備 inventoryMap 抵扣原料成本。';",
    "    : '主排名依當前市場賣一買入、買一出售與稅後日利排序；成交量、日產佔比與風險只作執行參考，不會隱藏或改寫當前日利。Exporter v1 不含材料數量，因此目前不以裝備 inventoryMap 抵扣原料成本。';",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "    estBanner.innerHTML = '<strong>ℹ️ 估算模式（Estimated）</strong>：目前配裝或茶飲包含理論自動推論，日利為理論極值/容量折算估算值。';",
    "    estBanner.innerHTML = '<strong>ℹ️ 估算模式（Estimated）</strong>：目前配裝或茶飲包含自動推論；日利仍按當前市場價格計算，容量與風險另列供參考。';",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "  sortSafeBtn.textContent = '🛡️ 安全日利';\n  sortSafeBtn.title = '依市場容量折算後之安全日利排序（防止過量滯銷）';",
    "  sortSafeBtn.textContent = '📦 容量參考';\n  sortSafeBtn.title = '依市場容量估算值排序；日利欄仍顯示當前市場日利，不會因資料不足而歸零';",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "  sortTheoBtn.textContent = '⚡ 理論極值';\n  sortTheoBtn.title = '依未折算理論最高日利排序（對標 Milkonomy，假定無限買盤）';",
    "  sortTheoBtn.textContent = '💰 當前日利';\n  sortTheoBtn.title = '依當前賣一買入、買一出售及稅後日利排序（主要推薦榜）';",
)

old_profit_block = '''  if (sortMode === 'safe') {
    if (hasRealizable) {
      mainProfit.textContent = money(liquidity.realizableProfitPerDay!);
      profitCell.append(mainProfit);
      if (liquidity.realizableProfitPerDay! < candidate.profitPerDay * 0.98) {
        const subProfit = element('div', 'strategy-profit-sub');
        subProfit.textContent = `理論 ~${money(candidate.profitPerDay)}`;
        subProfit.title = `理論極值為 ${money(candidate.profitPerDay)}，已受市場容量限制折算`;
        profitCell.append(subProfit);
      }
    } else {
      mainProfit.textContent = '—';
      mainProfit.title = '市場成交量樣本不足，無法確認安全容量';
      profitCell.append(mainProfit);
      const subProfit = element('div', 'strategy-profit-sub');
      subProfit.textContent = `理論 ~${money(candidate.profitPerDay)}`;
      subProfit.title = '市場成交量樣本不足，未經安全容量折算';
      profitCell.append(subProfit);
    }
  } else {
    mainProfit.textContent = money(candidate.profitPerDay);
    profitCell.append(mainProfit);
    if (hasRealizable && liquidity.realizableProfitPerDay! < candidate.profitPerDay * 0.98) {
      const subProfit = element('div', 'strategy-profit-sub');
      subProfit.textContent = `安全 ~${money(liquidity.realizableProfitPerDay!)}`;
      subProfit.title = `依市場容量限制，每日安全折算為 ${money(liquidity.realizableProfitPerDay!)}`;
      profitCell.append(subProfit);
    }
  }
'''
new_profit_block = '''  mainProfit.textContent = money(candidate.profitPerDay);
  mainProfit.title = sortMode === 'safe'
    ? '當前市場日利（目前列表依容量參考值排序）'
    : '依當前賣一買入、買一出售與稅率計算的 24 小時日利';
  profitCell.append(mainProfit);
  if (hasRealizable && liquidity.realizableProfitPerDay! < candidate.profitPerDay * 0.98) {
    const subProfit = element('div', 'strategy-profit-sub');
    subProfit.textContent = `容量參考 ~${money(liquidity.realizableProfitPerDay!)}`;
    subProfit.title = `依歷史成交量估算可實現日利約 ${money(liquidity.realizableProfitPerDay!)}；不改寫上方當前日利`;
    profitCell.append(subProfit);
  } else if (!hasRealizable) {
    const subProfit = element('div', 'strategy-profit-sub');
    subProfit.textContent = '容量資料不足';
    subProfit.title = '缺少足夠成交量歷史；當前日利仍可依即時買賣價正常計算';
    profitCell.append(subProfit);
  }
'''
replace_once('market-radar/src/strategy/view.ts', old_profit_block, new_profit_block)

replace_once(
    'market-radar/src/strategy/view.ts',
    "    // 安全日利模式：嚴格依可實現日利（realizableProfitPerDay）排序\n    // 若為 null（資料不足/未經驗證），安全排序價值為 0，不可用未折算的理論日利充數！\n    return item.liquidity.realizableProfitPerDay ?? 0;",
    "    // 容量參考是次要視角；資料不足時退回當前日利，絕不能把 50M 策略當成 0。\n    return item.liquidity.realizableProfitPerDay ?? item.candidate.profitPerDay;",
)

old_filter_block = '''        // 理論日利 <= 0 者不顯示
        if (candidate.profitPerDay <= 0) return false;

        // 理論極值模式：放行所有正收益策略
        if (filterState.sortMode === 'theoretical') return true;

        // 常態模式：排除異常情形
        // 1. reject: 成交量個位數之冷門裝備（如翠綠護手）、價格異常插針
        if (liquidity.classification === 'reject') return false;

        // 2. 市場只有掛買沒有掛賣或相反（單邊無掛單，原料買不到或產品賣不掉）
        const flows = externalStrategyFlows(candidate);
        const hasMissingSide = flows.some((external) => {
          const cap = marketCapacity(`${external.flow.itemHrid}::${external.flow.enhancementLevel}` as MarketKey, snapshots);
          return external.side === 'input' ? !cap.askAvailable : !cap.bidAvailable;
        });
        if (hasMissingSide) return false;

        // 正常的原物料、大宗商品，即使吞吐佔比 > 5% 或歷史樣本未滿 72h，均正常顯示，
        // 由日產佔比顏色示警（黃/橘/紅）與優先級降評，絕不無故隱藏。
        return true;
'''
new_filter_block = '''        // Current-profit discovery is the primary product. A valid positive candidate stays visible;
        // liquidity, history completeness and anomaly flags are metadata, not hidden gates.
        if (candidate.profitPerDay <= 0) return false;
        void liquidity;
        return true;
'''
replace_once('market-radar/src/strategy/view.ts', old_filter_block, new_filter_block)

replace_once(
    'market-radar/src/strategy/view.ts',
    "        : (filterState.sortMode === 'theoretical' ? '⚡ 目前理論極值最佳' : '🛡️ 目前安全推薦最佳');",
    "        : (filterState.sortMode === 'theoretical' ? '💰 目前日利最高' : '📦 容量參考排序第一');",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "          ? '依理論最大日利（無窮大市場消化量）極值排序，對標 Milkonomy'\n          : '依市場容量折算後安全日利、優先級與風險綜合排序');",
    "          ? '依當前 Ask/Bid、角色產能與稅後日利排序；容量與風險僅作附加提示'\n          : '依市場容量參考值排序；日利欄仍保留當前市場完整日利');",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "      meta.textContent = `搜尋「${filterState.searchQuery.trim()}」：顯示前 ${chosen.length} 條（依折算後日利排序）`;",
    "      meta.textContent = `搜尋「${filterState.searchQuery.trim()}」：顯示前 ${chosen.length} 條（依目前選定排序）`;",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "      meta.textContent = `技能「${skillName}」：顯示前 ${chosen.length} 條；依折算後日利、優先級與風險排序`;",
    "      meta.textContent = `技能「${skillName}」：顯示前 ${chosen.length} 條；預設依當前市場日利排序`;",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "      meta.textContent = `顯示前 ${chosen.length} 條；依折算後日利、優先級與風險綜合排序，★ 不影響名次`;",
    "      meta.textContent = `顯示前 ${chosen.length} 條；預設依當前市場日利排序，成交量與風險不隱藏候選，★ 不影響名次`;",
)
replace_once(
    'market-radar/src/strategy/view.ts',
    "  classification.title = liquidity.classification === 'insufficient'\n    ? '缺少足夠的 3D／7D 成交量資料，不列為可執行策略'",
    "  classification.title = liquidity.classification === 'insufficient'\n    ? '缺少足夠的 3D／7D 成交量資料；當前日利仍依即時市場價格正常顯示'",
)

# View regression tests now enforce current-profit-first behavior.
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "  it('ranks actionable strategies by realizable profit and separates reject or insufficient rows', async () => {",
    "  it('defaults to current profit and keeps reject or insufficient rows visible as risk metadata', async () => {",
)
old_view_expectations = '''    // 嚴格排除缺少報價（insufficient）與異常（reject）項目，保留 long 與 limited 供使用者知情與降評評估
    const renderedRowIds = [...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((row) => row.dataset.strategyRow);
    expect(renderedRowIds).toContain('long');
    expect(renderedRowIds).toContain('limited');
    expect(renderedRowIds).not.toContain('insufficient');
    expect(renderedRowIds).not.toContain('reject');
    expect(target.querySelector('[data-strategy-row="long"]')?.textContent).toContain('低');
    expect(target.querySelector('[data-strategy-row="limited"]')?.textContent).toContain('高');
'''
new_view_expectations = '''    // 預設依當前日利排序；流動性不足與異常只標示風險，不再把高利策略隱藏或視為 0。
    const renderedRowIds = [...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((row) => row.dataset.strategyRow);
    expect(renderedRowIds).toEqual(['insufficient', 'reject', 'limited', 'long']);
    expect(target.querySelector('[data-strategy-row="insufficient"]')?.textContent).toContain('96K');
    expect(target.querySelector('[data-strategy-row="insufficient"] .strategy-classification')?.textContent).toBe('資料不足');
    expect(target.querySelector('[data-strategy-row="reject"]')?.textContent).toContain('72K');
    expect(target.querySelector('[data-strategy-row="long"]')?.textContent).toContain('低');
    expect(target.querySelector('[data-strategy-row="limited"]')?.textContent).toContain('高');
'''
replace_once('market-radar/tests/strategy-view.test.ts', old_view_expectations, new_view_expectations)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "  it('searches strategies by item query and includes insufficient items when query is specified', async () => {",
    "  it('keeps insufficient strategies visible by default and still supports item search', async () => {",
)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "    // 預設無搜尋：排除不足項目，只出現普通布匹\n    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([\n      'cloth',\n    ]);\n\n    // 主動搜尋「哥布林」：破例列出被判定資料不足的哥布林火棍",
    "    // 預設無搜尋：所有正收益項目均依當前日利顯示，資料不足只作標記。\n    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual([\n      'cloth', 'goblin_staff',\n    ]);\n\n    // 主動搜尋「哥布林」：只保留符合查詢的候選",
)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "    expect(target.querySelector('[data-strategy-row=\"goblin_staff\"] .strategy-classification')?.textContent).toBe('極高');",
    "    expect(target.querySelector('[data-strategy-row=\"goblin_staff\"] .strategy-classification')?.textContent).toBe('資料不足');",
)
replace_once(
    'market-radar/tests/strategy-view.test.ts',
    "  it('shows all positive profit strategies when switching to theoretical mode without 24h liquidity gating', async () => {",
    "  it('defaults to current-profit ranking and keeps capacity ranking as an optional secondary view', async () => {",
)
old_last_test = '''    await view.render();
    // 預設安全日利模式下：佔比 5000% 之異常 reject 策略被安全過濾，僅顯示安全可實現之 long
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual(['long']);

    // 點擊「⚡ 理論極值」
    const sortButtons = target.querySelectorAll<HTMLButtonElement>('.strategy-sort-group button');
    const theoBtn = Array.from(sortButtons).find((b) => b.textContent?.includes('理論極值'))!;
    expect(theoBtn).not.toBeNull();
    theoBtn.click();

    // 在理論極值模式下：按未折算理論極值排序，limited (120,000) 躍升第一，long (24,000) 退居第二！
    const rowsAfter = [...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow);
    expect(rowsAfter).toEqual(['limited', 'long']);
'''
new_last_test = '''    await view.render();
    // 預設就是當前日利：高日利 limited 即使容量風險高，仍應排在第一並顯示完整 120K。
    expect([...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow)).toEqual(['limited', 'long']);
    expect(target.querySelector('[data-strategy-row="limited"] .strategy-profit-main')?.textContent).toBe('120K');
    const sortButtons = target.querySelectorAll<HTMLButtonElement>('.strategy-sort-group button');
    const currentBtn = Array.from(sortButtons).find((b) => b.textContent?.includes('當前日利'))!;
    expect(currentBtn.classList.contains('active')).toBe(true);

    // 容量參考仍可選用，但不會把資料不足的策略隱藏，日利欄也不會變成破折號。
    const capacityBtn = Array.from(sortButtons).find((b) => b.textContent?.includes('容量參考'))!;
    capacityBtn.click();
    const rowsAfter = [...target.querySelectorAll<HTMLElement>('[data-strategy-row]')].map((r) => r.dataset.strategyRow);
    expect(rowsAfter).toEqual(['long', 'limited']);
    expect(target.querySelector('[data-strategy-row="limited"] .strategy-profit-main')?.textContent).toBe('120K');
'''
replace_once('market-radar/tests/strategy-view.test.ts', old_last_test, new_last_test)

TRANSMUTE_TEST = r'''import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../src/profile/types';
import type { ActionBuffs } from '../src/strategy/buffs';
import type { NormalizedStrategyGameData } from '../src/strategy/game-data';
import type { MarketPriceBook } from '../src/strategy/price-book';
import { calculateTransmute } from '../src/strategy/transmute';

const inputHrid = '/items/transmute_input';
const outputHrid = '/items/transmute_output';

const itemDetailMap = {
  [inputHrid]: {
    hrid: inputHrid,
    name: 'Transmute Input',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
    itemLevel: 10,
    sellPrice: 100,
    alchemyDetail: {
      bulkMultiplier: 2,
      transmuteSuccessRate: 0.5,
      transmuteDropTable: [
        { itemHrid: outputHrid, dropRate: 0.5, minCount: 2, maxCount: 2 },
        { itemHrid: inputHrid, dropRate: 0.25, minCount: 1, maxCount: 1 },
      ],
    },
  },
  [outputHrid]: {
    hrid: outputHrid,
    name: 'Transmute Output',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
  '/items/small_artisans_crate': {
    hrid: '/items/small_artisans_crate',
    name: 'Small Crate',
    categoryHrid: '/item_categories/loot',
    isTradable: true,
  },
  '/items/alchemy_essence': {
    hrid: '/items/alchemy_essence',
    name: 'Alchemy Essence',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
  '/items/catalyst_of_transmutation': {
    hrid: '/items/catalyst_of_transmutation',
    name: 'Transmutation Catalyst',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
  '/items/prime_catalyst': {
    hrid: '/items/prime_catalyst',
    name: 'Prime Catalyst',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
};

const actionDetailMap = {
  '/actions/alchemy/transmute': {
    hrid: '/actions/alchemy/transmute',
    levelRequirement: { level: 1 },
    baseTimeCost: 10_000_000_000,
  },
};

const data = {
  gameVersion: 'test',
  versionTimestamp: 'test',
  enhancementLevelTotalBonusMultiplierTable: [0],
  itemDetailMap,
  actionDetailMap,
  communityBuffTypeDetailMap: {},
  achievementDetailMap: {},
  achievementTierDetailMap: {},
  personalBuffTypeDetailMap: {},
  openableLootDropMap: {},
  shopItemDetailMap: {},
  itemsByHrid: new Map(Object.entries(itemDetailMap)),
  actionsByHrid: new Map(Object.entries(actionDetailMap)),
} as unknown as NormalizedStrategyGameData;

const profile = {
  id: 'test',
  name: 'test',
  actions: { alchemy: { playerLevel: 100, teas: [] } },
} as unknown as PlayerProfile;

const buffs: ActionBuffs = {
  Level: 100,
  Speed: 0,
  Efficiency: 0,
  Experience: 0,
  Gathering: 0,
  Processing: 0,
  Artisan: 0,
  Gourmet: 0,
  Success: 0,
  Blessed: 0,
  EssenceFind: 0,
  RareFind: 0,
  drinkConcentration: 0,
};

const asks: Record<string, number> = {
  [inputHrid]: 1_000,
  '/items/catalyst_of_transmutation': 200,
  '/items/prime_catalyst': 300,
};
const bids: Record<string, number> = {
  [outputHrid]: 5_000,
  '/items/small_artisans_crate': 100,
  '/items/alchemy_essence': 100,
};
const prices: MarketPriceBook = {
  timestamp: 1,
  ask: (hrid) => asks[hrid] ?? null,
  bid: (hrid) => bids[hrid] ?? null,
  average: () => null,
  volume: () => null,
};

describe('Milkonomy-compatible transmutation', () => {
  it('uses Ask/Bid, coin cost, success rate and same-item return accounting', () => {
    const result = calculateTransmute({
      itemHrid: inputHrid,
      catalystRank: 0,
      profile,
      data,
      prices,
      buffs,
    });

    expect(result.valid).toBe(true);
    expect(result.actionHrid).toBe('/actions/alchemy/transmute');
    expect(result.outputHrid).toBe(outputHrid);
    expect(result.successRate).toBeCloseTo(0.5);
    expect(result.actionsPerHour).toBeCloseTo(360);
    // sameItemCounter = 1 * 0.25 * 0.5 = 0.125;
    // net purchased input = 2 * (1 - 0.125) * 360 = 630/h.
    expect(result.inputs.find((flow) => flow.itemHrid === inputHrid)?.unitsPerHour).toBeCloseTo(630);
    // Coin cost = bulk 2 * max(floor(100 / 5), 50) * 360 = 36,000/h.
    expect(result.inputs.find((flow) => flow.itemHrid === '/items/coin')?.unitsPerHour).toBeCloseTo(36_000);
    // Main output = maxCount 2 * bulk 2 * dropRate 0.5 * 180 successes/h = 360/h.
    expect(result.outputs.find((flow) => flow.itemHrid === outputHrid)?.unitsPerHour).toBeCloseTo(360);
    expect(result.costPerHour).toBeCloseTo(666_000);
    expect(result.profitPerHour).not.toBeNull();
  });

  it('uses the transmutation catalyst only on successful actions', () => {
    const result = calculateTransmute({
      itemHrid: inputHrid,
      catalystRank: 1,
      profile,
      data,
      prices,
      buffs,
    });

    // Dedicated catalyst contributes +0.15 inside the base-rate multiplier.
    expect(result.successRate).toBeCloseTo(0.575);
    expect(result.inputs.find((flow) => (
      flow.itemHrid === '/items/catalyst_of_transmutation'
    ))?.unitsPerHour).toBeCloseTo(result.actionsPerHour * result.successRate);
    expect(result.outputs.find((flow) => flow.itemHrid === outputHrid)?.unitsPerHour).toBeCloseTo(414);
  });
});
'''
write('market-radar/tests/strategy-transmute.test.ts', TRANSMUTE_TEST)

print('Strategy restoration patch applied successfully.')
