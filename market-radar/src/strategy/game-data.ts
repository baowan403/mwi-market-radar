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
