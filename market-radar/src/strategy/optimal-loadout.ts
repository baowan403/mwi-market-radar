
import type { PlayerProfile, ProfileEquipment, SkillingAction } from '../profile/types';
import type { NormalizedStrategyGameData } from './game-data';

const OPTIMAL_TEAS_BY_ACTION: Record<SkillingAction, string[]> = {
  alchemy: ['/items/ultra_alchemy_tea', '/items/catalytic_tea', '/items/efficiency_tea'],
  woodcutting: ['/items/ultra_woodcutting_tea', '/items/gathering_tea', '/items/processing_tea'],
  milking: ['/items/ultra_milking_tea', '/items/gathering_tea', '/items/processing_tea'],
  foraging: ['/items/ultra_foraging_tea', '/items/gathering_tea', '/items/processing_tea'],
  cheesesmithing: ['/items/ultra_cheesesmithing_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  crafting: ['/items/ultra_crafting_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  tailoring: ['/items/ultra_tailoring_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  cooking: ['/items/gourmet_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  brewing: ['/items/gourmet_tea', '/items/artisan_tea', '/items/efficiency_tea'],
  enhancing: ['/items/ultra_enhancing_tea', '/items/efficiency_tea', '/items/blessed_tea'],
};

export function optimalTeasForAction(action: SkillingAction): string[] {
  return OPTIMAL_TEAS_BY_ACTION[action] ?? [];
}

/**
 * 評估一件裝備對特定生活技能的實際生活屬性增益評分。
 * 若無任何對該技能有效的生活屬性，嚴格回傳 -1（判定為不適格 / 純戰鬥裝）。
 */
export function evaluateEquipmentUpliftForAction(
  eqHrid: string,
  enhanceLevel: number,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
): number {
  const item = data.itemDetailMap[eqHrid];
  if (!item || !item.equipmentDetail) return -1;
  const noncombat = item.equipmentDetail.noncombatStats as Record<string, number> | undefined;
  if (!noncombat) return -1;
  const bonuses = (item.equipmentDetail as Record<string, unknown>).noncombatEnhancementBonuses as Record<string, number> | undefined ?? {};
  const multiplier = data.enhancementLevelTotalBonusMultiplierTable[enhanceLevel] ?? 0;

  let score = 0;
  let hasRelevant = false;

  for (const [prop, baseVal] of Object.entries(noncombat)) {
    const isRelevant = prop.startsWith(action) || prop.startsWith('skilling') || prop === 'drinkConcentration';
    if (!isRelevant) continue;

    hasRelevant = true;
    const base = Number(baseVal) || 0;
    const bonus = Number(bonuses[prop]) || 0;
    const totalVal = base + bonus * multiplier;

    // 依屬性對產出與週轉的邊際增益給予加權評分
    if (prop.endsWith('Speed') || prop.endsWith('ActionSpeed')) {
      score += totalVal * 100;
    } else if (prop.endsWith('Efficiency')) {
      score += totalVal * 80;
    } else if (prop.endsWith('Artisan') || prop.endsWith('Gourmet') || prop.endsWith('Processing')) {
      score += totalVal * 90;
    } else if (prop.endsWith('Success')) {
      score += totalVal * 85;
    } else if (prop === 'drinkConcentration') {
      score += totalVal * 50;
    } else {
      score += totalVal * 30;
    }
  }

  return hasRelevant ? score : -1;
}

/**
 * 從 inventoryMap 中智慧挑選對指定技能實質生活增益（Profit Uplift）最高的裝備。
 * 採用 Pareto 支配剪枝與生活加成評分，杜絕「強化高等級但生活無效」之謬誤。
 */
export function bestEquipmentFromInventoryForAction(
  inventoryMap: Record<string, number>,
  action: SkillingAction,
  slotType: string,
  data: NormalizedStrategyGameData,
): ProfileEquipment | null {
  let bestHrid: string | null = null;
  let bestScore = -1;
  let bestEnhance = -1;

  for (const [hrid, enhanceLevel] of Object.entries(inventoryMap)) {
    const item = data.itemDetailMap[hrid];
    if (!item) continue;
    const eq = item.equipmentDetail;
    if (!eq || eq.type !== slotType) continue;

    const upliftScore = evaluateEquipmentUpliftForAction(hrid, enhanceLevel, action, data);
    if (upliftScore <= 0) continue; // 不具備有效生活加成，直接剪枝剔除

    if (upliftScore > bestScore || (Math.abs(upliftScore - bestScore) < 1e-6 && enhanceLevel > bestEnhance)) {
      bestScore = upliftScore;
      bestEnhance = enhanceLevel;
      bestHrid = hrid;
    }
  }

  return bestHrid !== null ? { itemHrid: bestHrid, enhancementLevel: bestEnhance } : null;
}

export const bestSkillingEquipmentFromInventory = bestEquipmentFromInventoryForAction;

export function bestSpecialEquipmentFromInventory(
  inventoryMap: Record<string, number>,
  slotType: string,
  data: NormalizedStrategyGameData,
): ProfileEquipment | null {
  // 向後相容通用函式：使用全生活 skilling 評估
  let bestHrid: string | null = null;
  let bestEnhance = -1;

  for (const [hrid, enhanceLevel] of Object.entries(inventoryMap)) {
    const item = data.itemDetailMap[hrid];
    if (!item) continue;
    const eq = item.equipmentDetail;
    if (!eq || eq.type !== slotType) continue;

    const noncombat = eq.noncombatStats;
    if (!noncombat || Object.keys(noncombat).length === 0) continue;

    if (enhanceLevel > bestEnhance) {
      bestEnhance = enhanceLevel;
      bestHrid = hrid;
    }
  }

  return bestHrid !== null ? { itemHrid: bestHrid, enhancementLevel: bestEnhance } : null;
}

/**
 * 智慧豐富角色快照：
 * 1. 若該技能未手動鎖定茶飲（teaMode !== 'manual'），自動套用最佳 3 茶飲；
 * 2. 若生活裝備槽位未手動鎖定（loadoutMode !== 'manual'），自動從背包倉庫挑選真正對該技能效益最高的生活裝備穿上。
 */
export function enrichProfileWithBestLoadout(
  profile: PlayerProfile,
  data: NormalizedStrategyGameData,
): PlayerProfile {
  const enrichedActions = { ...profile.actions };
  const enrichedSpecial = { ...profile.specialEquipment };

  // 若尚未配置 pouch，且倉庫/背包中有暴飲之囊 (Guzzling Pouch)，自動穿上
  if (!enrichedSpecial.pouch && profile.inventoryMap['/items/guzzling_pouch'] !== undefined) {
    enrichedSpecial.pouch = {
      itemHrid: '/items/guzzling_pouch',
      enhancementLevel: profile.inventoryMap['/items/guzzling_pouch'],
    };
  }

  // 自動穿戴通用生活配件
  for (const slot of ['head', 'hands', 'off_hand', 'feet', 'neck', 'ring', 'earrings', 'trinket']) {
    if (!enrichedSpecial[slot]) {
      const best = bestSpecialEquipmentFromInventory(
        profile.inventoryMap, `/equipment_types/${slot}`, data,
      );
      if (best) enrichedSpecial[slot] = best;
    }
  }

  for (const [actionKey, actionProfile] of Object.entries(enrichedActions)) {
    const action = actionKey as SkillingAction;
    const isManualLoadout = actionProfile.loadoutMode === 'manual';
    const isManualTea = actionProfile.teaMode === 'manual';

    const teas = (isManualTea && actionProfile.teas)
      ? actionProfile.teas
      : (actionProfile.teas && actionProfile.teas.length > 0 ? actionProfile.teas : optimalTeasForAction(action));

    const tool = (isManualLoadout && actionProfile.tool)
      ? actionProfile.tool
      : (actionProfile.tool ?? bestEquipmentFromInventoryForAction(profile.inventoryMap, action, `/equipment_types/${action}_tool`, data));

    const body = (isManualLoadout && actionProfile.body)
      ? actionProfile.body
      : (actionProfile.body ?? bestEquipmentFromInventoryForAction(profile.inventoryMap, action, '/equipment_types/body', data));

    const legs = (isManualLoadout && actionProfile.legs)
      ? actionProfile.legs
      : (actionProfile.legs ?? bestEquipmentFromInventoryForAction(profile.inventoryMap, action, '/equipment_types/legs', data));

    const back = (isManualLoadout && actionProfile.back)
      ? actionProfile.back
      : (actionProfile.back ?? bestEquipmentFromInventoryForAction(profile.inventoryMap, action, '/equipment_types/back', data));

    const charm = (isManualLoadout && actionProfile.charm)
      ? actionProfile.charm
      : (actionProfile.charm ?? bestEquipmentFromInventoryForAction(profile.inventoryMap, action, '/equipment_types/charm', data));

    enrichedActions[action] = {
      ...actionProfile,
      teas,
      tool,
      body,
      legs,
      back,
      charm,
    };
  }

  return {
    ...profile,
    actions: enrichedActions,
    specialEquipment: enrichedSpecial,
  };
}
