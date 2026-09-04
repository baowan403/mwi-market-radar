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
 * 從 inventoryMap 中智慧挑選對指定技能有實質生活屬性加成的最高強化裝備。
 * 100% 排除純戰鬥裝備（如火袍、法杖、純戰鬥首飾）。
 */
export function bestSkillingEquipmentFromInventory(
  inventoryMap: Record<string, number>,
  action: SkillingAction,
  slotType: string,
  data: NormalizedStrategyGameData,
): ProfileEquipment | null {
  let bestHrid: string | null = null;
  let bestEnhance = -1;

  for (const [hrid, enhanceLevel] of Object.entries(inventoryMap)) {
    const item = data.itemDetailMap[hrid];
    if (!item) continue;
    const eq = item.equipmentDetail;
    if (!eq || eq.type !== slotType) continue;

    const noncombat = eq.noncombatStats;
    if (!noncombat || Object.keys(noncombat).length === 0) {
      // 純戰鬥裝備或無生活加成，嚴格排除！
      continue;
    }

    // 檢查是否對該生活技能有效（專屬加成、全生活 skilling 加成、或藥水濃度）
    const relevant = Object.keys(noncombat).some((prop) => (
      prop.startsWith(action) || prop.startsWith('skilling') || prop === 'drinkConcentration'
    ));
    if (!relevant) continue;

    if (enhanceLevel > bestEnhance) {
      bestEnhance = enhanceLevel;
      bestHrid = hrid;
    }
  }

  return bestHrid !== null ? { itemHrid: bestHrid, enhancementLevel: bestEnhance } : null;
}

/**
 * 從 inventoryMap 中智慧挑選具備生活屬性加成的最佳特殊裝備（手套、項鍊、副手、戒指、耳環等）。
 */
export function bestSpecialEquipmentFromInventory(
  inventoryMap: Record<string, number>,
  slotType: string,
  data: NormalizedStrategyGameData,
): ProfileEquipment | null {
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
 * 1. 若該技能未手動配置茶飲，自動套用最佳 3 茶飲；
 * 2. 若生活裝備槽位為空，自動從背包倉庫挑選最高強化等級的生活裝備穿上（杜絕戰鬥裝）。
 */
export function enrichProfileWithBestLoadout(
  profile: PlayerProfile,
  data: NormalizedStrategyGameData,
): PlayerProfile {
  const enrichedActions = { ...profile.actions };
  const enrichedSpecial = { ...profile.specialEquipment };

  // 若尚未配置 pouch，且倉庫/背包中有暴飲之囊 (Guzzling Pouch)，自動穿上最高強化者
  if (!enrichedSpecial.pouch && profile.inventoryMap['/items/guzzling_pouch'] !== undefined) {
    enrichedSpecial.pouch = {
      itemHrid: '/items/guzzling_pouch',
      enhancementLevel: profile.inventoryMap['/items/guzzling_pouch'],
    };
  }

  // 自動穿戴背包/倉庫中最高強化的特殊生活裝備（如紅色廚師帽、附魔手套、速度項鍊、副手眼錶、採集靴等）
  for (const slot of ['head', 'hands', 'off_hand', 'feet', 'neck', 'ring', 'earrings', 'trinket']) {
    if (!enrichedSpecial[slot]) {
      const best = bestSpecialEquipmentFromInventory(
        profile.inventoryMap, `/equipment_types/${slot}`, data
      );
      if (best) enrichedSpecial[slot] = best;
    }
  }

  for (const [actionKey, actionProfile] of Object.entries(enrichedActions)) {
    const action = actionKey as SkillingAction;
    const teas = (actionProfile.teas && actionProfile.teas.length > 0)
      ? actionProfile.teas
      : optimalTeasForAction(action);

    const tool = actionProfile.tool ?? bestSkillingEquipmentFromInventory(
      profile.inventoryMap, action, `/equipment_types/${action}_tool`, data
    );
    const body = actionProfile.body ?? bestSkillingEquipmentFromInventory(
      profile.inventoryMap, action, '/equipment_types/body', data
    );
    const legs = actionProfile.legs ?? bestSkillingEquipmentFromInventory(
      profile.inventoryMap, action, '/equipment_types/legs', data
    );
    const back = actionProfile.back ?? bestSkillingEquipmentFromInventory(
      profile.inventoryMap, action, '/equipment_types/back', data
    );
    const charm = actionProfile.charm ?? bestSkillingEquipmentFromInventory(
      profile.inventoryMap, action, '/equipment_types/charm', data
    );

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
