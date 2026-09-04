import type {
  StrategyActionDetail,
  StrategyGameDataInput,
  StrategyItemDetail,
} from './types';

export interface NormalizedStrategyGameData extends StrategyGameDataInput {
  itemsByHrid: ReadonlyMap<string, StrategyItemDetail>;
  actionsByHrid: ReadonlyMap<string, StrategyActionDetail>;
}

export class StrategyDataError extends Error {
  readonly code = 'strategy_data';

  constructor() {
    super('策略遊戲資料無法使用');
    this.name = 'StrategyDataError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isDerivedOpenableLootValue(
  itemHrid: string,
  data: NormalizedStrategyGameData,
): boolean {
  const item = data.itemsByHrid.get(itemHrid);
  return item !== undefined
    && item.isTradable !== true
    && Array.isArray(data.openableLootDropMap[itemHrid])
    && data.openableLootDropMap[itemHrid].length > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNonnegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validCountedItems(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return Array.isArray(value) && value.every((raw) => {
    const item = record(raw);
    return typeof item?.itemHrid === 'string'
      && item.itemHrid.startsWith('/items/')
      && finiteNonnegative(item.count);
  });
}

function validateItems(value: Record<string, unknown>): Record<string, StrategyItemDetail> {
  const result: Record<string, StrategyItemDetail> = {};
  for (const [key, raw] of Object.entries(value)) {
    const item = record(raw);
    if (
      !item
      || key !== item.hrid
      || !key.startsWith('/items/')
      || typeof item.name !== 'string'
      || typeof item.categoryHrid !== 'string'
      || (item.isTradable !== undefined && typeof item.isTradable !== 'boolean')
      || (item.itemLevel !== undefined && !finiteNonnegative(item.itemLevel))
    ) {
      throw new StrategyDataError();
    }
    result[key] = raw as StrategyItemDetail;
  }
  if (Object.keys(result).length === 0) throw new StrategyDataError();
  return result;
}

function validateActions(value: Record<string, unknown>): Record<string, StrategyActionDetail> {
  const result: Record<string, StrategyActionDetail> = {};
  for (const [key, raw] of Object.entries(value)) {
    const action = record(raw);
    const levelRequirement = record(action?.levelRequirement);
    if (
      !action
      || key !== action.hrid
      || !key.startsWith('/actions/')
      || !finiteNonnegative(action.baseTimeCost)
      || action.baseTimeCost === 0
      || !finiteNonnegative(levelRequirement?.level)
      || !validCountedItems(action.inputItems)
      || !validCountedItems(action.outputItems)
    ) {
      throw new StrategyDataError();
    }
    result[key] = raw as StrategyActionDetail;
  }
  if (Object.keys(result).length === 0) throw new StrategyDataError();
  return result;
}

export class GameDataFreshnessError extends Error {
  readonly code = 'game_data_freshness_error';
  constructor(message: string) {
    super(message);
    this.name = 'GameDataFreshnessError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface VerifiedDecomposeOverride {
  verifiedAt: string;
  itemHrid: string;
  outputHrid: string;
  expectedStaleCount: number;
  verifiedCount: number;
  notes?: string;
}

/**
 * 經由真實 MWI Client Runtime 驗證之分解產出覆蓋（Verified Decompose Overrides）。
 * 嚴格遵循 Level 1 MWI Runtime OBSERVED 優先原則。
 * 註：Emp Tea Leaf 經使用者於 2026-09-04 在 MWI Client 實機確認，
 * 每成功一次產出 exactly 20 Brewing Essence。原始 GameData 中 count=10、bulkMultiplier=2，
 * 10 * 2 = 20 完全同構於實機，不得任意覆蓋為 20 導致 double-count 膨脹成 40。
 */
export const VERIFIED_DECOMPOSE_OVERRIDES: Record<string, VerifiedDecomposeOverride> = {};

export const VERIFIED_GAME_DATA_OVERRIDES: {
  items?: Record<string, Partial<StrategyItemDetail>>;
} = {};

export function normalizeStrategyGameData(input: unknown): NormalizedStrategyGameData {
  const data = record(input);
  const itemDetailMap = record(data?.itemDetailMap);
  const actionDetailMap = record(data?.actionDetailMap);
  const communityBuffTypeDetailMap = record(data?.communityBuffTypeDetailMap);
  const achievementDetailMap = record(data?.achievementDetailMap);
  const achievementTierDetailMap = record(data?.achievementTierDetailMap);
  const personalBuffTypeDetailMap = record(data?.personalBuffTypeDetailMap);
  const openableLootDropMap = record(data?.openableLootDropMap);
  const shopItemDetailMap = record(data?.shopItemDetailMap);
  if (
    !data
    || typeof data.gameVersion !== 'string'
    || typeof data.versionTimestamp !== 'string'
    || !Array.isArray(data.enhancementLevelTotalBonusMultiplierTable)
    || !data.enhancementLevelTotalBonusMultiplierTable.every(finiteNonnegative)
    || !itemDetailMap
    || !actionDetailMap
    || !communityBuffTypeDetailMap
    || !achievementDetailMap
    || !achievementTierDetailMap
    || !personalBuffTypeDetailMap
    || !openableLootDropMap
    || !shopItemDetailMap
  ) {
    throw new StrategyDataError();
  }

  const items = validateItems(itemDetailMap);

  // 套用實機驗證的分解產出覆寫（最小化覆寫 + Freshness Guard）
  for (const [hrid, rule] of Object.entries(VERIFIED_DECOMPOSE_OVERRIDES)) {
    const item = items[hrid];
    if (!item || !item.alchemyDetail) continue;
    const decomposeItems = (item.alchemyDetail as Record<string, unknown>).decomposeItems as Array<{ itemHrid: string; count: number }> | undefined;
    if (!Array.isArray(decomposeItems)) continue;

    const target = decomposeItems.find((out) => out.itemHrid === rule.outputHrid);
    if (!target) continue;

    if (target.count === rule.expectedStaleCount) {
      target.count = rule.verifiedCount;
    } else if (target.count === rule.verifiedCount) {
      // no-op (已是最新值)
    } else {
      throw new GameDataFreshnessError(
        `[Freshness Guard] Stale conflict for ${hrid}: expected raw count ${rule.expectedStaleCount} or verified ${rule.verifiedCount}, but got ${target.count}. Please re-verify game data.`,
      );
    }
  }

  // 套用其他通用覆寫（若有）
  if (VERIFIED_GAME_DATA_OVERRIDES.items) {
    for (const [hrid, override] of Object.entries(VERIFIED_GAME_DATA_OVERRIDES.items)) {
      if (items[hrid]) {
        items[hrid] = {
          ...items[hrid],
          ...override,
          alchemyDetail: override.alchemyDetail
            ? { ...(items[hrid].alchemyDetail as Record<string, unknown> ?? {}), ...override.alchemyDetail }
            : items[hrid].alchemyDetail,
        };
      }
    }
  }

  const actions = validateActions(actionDetailMap);
  return {
    gameVersion: data.gameVersion,
    versionTimestamp: data.versionTimestamp,
    enhancementLevelTotalBonusMultiplierTable: [...data.enhancementLevelTotalBonusMultiplierTable] as number[],
    itemDetailMap: items,
    actionDetailMap: actions,
    communityBuffTypeDetailMap: { ...communityBuffTypeDetailMap },
    achievementDetailMap: { ...achievementDetailMap },
    achievementTierDetailMap: { ...achievementTierDetailMap },
    personalBuffTypeDetailMap: { ...personalBuffTypeDetailMap },
    openableLootDropMap: { ...openableLootDropMap } as StrategyGameDataInput['openableLootDropMap'],
    shopItemDetailMap: { ...shopItemDetailMap },
    itemsByHrid: new Map(Object.entries(items)),
    actionsByHrid: new Map(Object.entries(actions)),
  };
}

