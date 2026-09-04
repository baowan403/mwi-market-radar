import { SKILLING_ACTIONS, type PlayerProfile, type ProfileEquipment, type SkillingAction } from '../profile/types';
import type { NormalizedStrategyGameData } from './game-data';

export interface ActionBuffs {
  Level: number;
  Speed: number;
  Efficiency: number;
  Experience: number;
  Gathering: number;
  Processing: number;
  Artisan: number;
  Gourmet: number;
  Success: number;
  Blessed: number;
  EssenceFind: number;
  RareFind: number;
  drinkConcentration: number;
}

type BuffKey = Exclude<keyof ActionBuffs, 'drinkConcentration'>;
type NumberRecord = Record<string, number>;

const DEFAULT_HOUSE = { Efficiency: 0.015, Experience: 0.0005, RareFind: 0.002 } as const;
const ENHANCING_HOUSE = { Speed: 0.01, Success: 0.0005, Experience: 0.0005, RareFind: 0.002 } as const;
const SHRINES: Record<string, { key: BuffKey; perLevel: number }> = {
  power: { key: 'Efficiency', perLevel: 0.005 },
  rhythm: { key: 'Speed', perLevel: 0.005 },
  spirit: { key: 'EssenceFind', perLevel: 0.03 },
  rare: { key: 'RareFind', perLevel: 0.015 },
  scholar: { key: 'Experience', perLevel: 0.005 },
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function add(values: NumberRecord, key: string, value: number): void {
  if (!Number.isFinite(value) || value === 0) return;
  values[key] = (values[key] ?? 0) + value;
}

function isRelevantSkillingProperty(property: string, action: SkillingAction): boolean {
  if (property.startsWith(action)) return true;
  if (property.startsWith('skilling')) return true;
  if (property === 'drinkConcentration') return true;
  // 若屬於其他生活技能之專屬屬性，嚴格排除，防止跨技能污染
  if (SKILLING_ACTIONS.some((otherAction) => property.startsWith(otherAction))) return false;
  return true;
}

function equipmentStats(
  values: NumberRecord,
  equipment: ProfileEquipment | null | undefined,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
  includeEveryProperty: boolean,
): void {
  if (!equipment) return;
  const item = record(data.itemsByHrid.get(equipment.itemHrid));
  const detail = record(item?.equipmentDetail);
  const stats = record(detail?.noncombatStats);
  const bonuses = record(detail?.noncombatEnhancementBonuses) ?? {};
  if (!stats) return;
  const multiplier = data.enhancementLevelTotalBonusMultiplierTable[equipment.enhancementLevel] ?? 0;
  for (const [property, base] of Object.entries(stats)) {
    if (!includeEveryProperty && !isRelevantSkillingProperty(property, action)) continue;
    add(values, property, finite(base) + finite(bonuses[property]) * multiplier);
  }
}

function keyForBuffType(typeHrid: string): BuffKey | null {
  switch (typeHrid) {
    case '/buff_types/action_speed': return 'Speed';
    case '/buff_types/wisdom': return 'Experience';
    case '/buff_types/gathering': return 'Gathering';
    case '/buff_types/efficiency': return 'Efficiency';
    case '/buff_types/processing': return 'Processing';
    case '/buff_types/artisan': return 'Artisan';
    case '/buff_types/gourmet': return 'Gourmet';
    case '/buff_types/blessed': return 'Blessed';
    case '/buff_types/rare_find': return 'RareFind';
    case '/buff_types/essence_find': return 'EssenceFind';
    case '/buff_types/enhancing_success': return 'Success';
    default: return null;
  }
}

function completedTier(
  profile: PlayerProfile,
  tier: string,
  data: NormalizedStrategyGameData,
): boolean {
  const achievements = profile.achievements ?? {};
  if (achievements[tier] === true || achievements[`/achievement_tiers/${tier}`] === true) {
    return true;
  }
  const members = Object.entries(data.achievementDetailMap).filter(([, raw]) => (
    record(raw)?.tierHrid === `/achievement_tiers/${tier}`
  ));
  return members.length > 0 && members.every(([hrid]) => achievements[hrid] === true);
}

function applyCommunityBuffs(
  values: NumberRecord,
  profile: PlayerProfile,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
): void {
  for (const [type, level] of Object.entries(profile.communityBuffs ?? {})) {
    if (level <= 0) continue;
    const detail = record(data.communityBuffTypeDetailMap[type])
      ?? record(data.communityBuffTypeDetailMap[`/community_buff_types/${type}`]);
    const usable = record(detail?.usableInActionTypeMap);
    if (usable?.[`/action_types/${action}`] !== true) continue;
    const buff = record(detail?.buff);
    const typeHrid = typeof buff?.typeHrid === 'string' ? buff.typeHrid : '';
    if (typeHrid === '/buff_types/moo_card') {
      add(values, `${action}Experience`, 0.05);
      continue;
    }
    const key = keyForBuffType(typeHrid);
    if (!key) continue;
    add(values, `${action}${key}`, finite(buff?.flatBoost) + finite(buff?.flatBoostLevelBonus) * (level - 1));
  }
}

function applyAchievementBuffs(
  values: NumberRecord,
  profile: PlayerProfile,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
): void {
  for (const [tierHrid, raw] of Object.entries(data.achievementTierDetailMap)) {
    const tier = tierHrid.split('/').at(-1) ?? '';
    if (!tier || tier === 'elite' || !completedTier(profile, tier, data)) continue;
    const buff = record(record(raw)?.buff);
    const key = keyForBuffType(typeof buff?.typeHrid === 'string' ? buff.typeHrid : '');
    if (key) add(values, `${action}${key}`, finite(buff?.flatBoost) + finite(buff?.ratioBoost));
  }
}

function applyTeaBuffs(
  values: NumberRecord,
  profile: PlayerProfile,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
): void {
  const concentration = values.drinkConcentration ?? 0;
  for (const teaHrid of profile.actions[action].teas) {
    const item = record(data.itemsByHrid.get(teaHrid));
    const consumable = record(item?.consumableDetail);
    const buffs = Array.isArray(consumable?.buffs) ? consumable.buffs : [];
    for (const raw of buffs) {
      const buff = record(raw);
      const typeHrid = typeof buff?.typeHrid === 'string' ? buff.typeHrid : '';
      const factor = 1 + concentration;
      if (typeHrid === `/buff_types/${action}_level`) {
        add(values, `${action}Level`, finite(buff?.flatBoost) * factor);
      } else if (typeHrid === '/buff_types/action_level') {
        add(values, `${action}Level`, -finite(buff?.flatBoost) * factor);
      } else if (typeHrid === `/buff_types/${action}_success`) {
        add(values, `${action}Success`, finite(buff?.ratioBoost) * factor);
      } else {
        const key = keyForBuffType(typeHrid);
        if (key) add(values, `${action}${key}`, (finite(buff?.flatBoost) + finite(buff?.ratioBoost)) * factor);
      }
    }
  }
}

function applySeals(
  values: NumberRecord,
  profile: PlayerProfile,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
): void {
  for (const sealHrid of profile.seals) {
    const item = record(data.itemsByHrid.get(sealHrid));
    const scroll = record(item?.scrollDetail);
    const typeHrid = typeof scroll?.personalBuffTypeHrid === 'string' ? scroll.personalBuffTypeHrid : '';
    const buff = record(record(data.personalBuffTypeDetailMap[typeHrid])?.buff);
    const key = keyForBuffType(typeof buff?.typeHrid === 'string' ? buff.typeHrid : '');
    if (key) add(values, `${action}${key}`, finite(buff?.flatBoost) + finite(buff?.ratioBoost));
  }
}

function combined(values: NumberRecord, action: SkillingAction, key: BuffKey): number {
  return (values[`${action}${key}`] ?? 0) + (values[`skilling${key}`] ?? 0);
}

export function actionBuffs(
  profile: PlayerProfile,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
): ActionBuffs {
  const values: NumberRecord = {};

  for (const equipment of Object.values(profile.specialEquipment ?? {})) {
    // 嚴格傳入 false：禁止將單一技能專屬特殊裝備的屬性無條件全域套用到其他無關技能！
    equipmentStats(values, equipment, action, data, false);
  }
  applyCommunityBuffs(values, profile, action, data);
  applyAchievementBuffs(values, profile, action, data);

  const actionProfile = profile.actions?.[action];
  if (actionProfile) {
    for (const equipment of [
      actionProfile.tool,
      actionProfile.body,
      actionProfile.legs,
      actionProfile.back,
      actionProfile.charm,
    ]) {
      equipmentStats(values, equipment, action, data, false);
    }
  }

  const house = action === 'enhancing' ? ENHANCING_HOUSE : DEFAULT_HOUSE;
  for (const [key, perLevel] of Object.entries(house)) {
    const target = key === 'Experience' || key === 'RareFind' ? 'skilling' : action;
    add(values, `${target}${key}`, perLevel * actionProfile.houseLevel);
  }

  applyTeaBuffs(values, profile, action, data);
  applySeals(values, profile, action, data);

  for (const [type, level] of Object.entries(profile.shrines)) {
    const shrine = SHRINES[type];
    if (shrine && level > 0) add(values, `${action}${shrine.key}`, shrine.perLevel * level);
  }

  return {
    Level: actionProfile.playerLevel + combined(values, action, 'Level'),
    Speed: combined(values, action, 'Speed'),
    Efficiency: combined(values, action, 'Efficiency'),
    Experience: combined(values, action, 'Experience'),
    Gathering: combined(values, action, 'Gathering'),
    Processing: combined(values, action, 'Processing'),
    Artisan: combined(values, action, 'Artisan'),
    Gourmet: combined(values, action, 'Gourmet'),
    Success: combined(values, action, 'Success'),
    Blessed: combined(values, action, 'Blessed'),
    EssenceFind: combined(values, action, 'EssenceFind'),
    RareFind: combined(values, action, 'RareFind'),
    drinkConcentration: values.drinkConcentration ?? 0,
  };
}
