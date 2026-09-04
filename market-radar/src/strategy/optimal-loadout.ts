import type { PlayerProfile, ProfileEquipment, SkillingAction } from '../profile/types';
import { actionBuffs } from './buffs';
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
 * 判斷玩家是否實質持有該裝備：
 * 1. 若 profile.equipmentOwnership 存在，以其狀態為最高準則：
 *    - 'owned': 確知持有，可參與自動配裝。
 *    - 'not-owned' / 'unknown': 嚴格排除，不可被 optimizer 自動穿戴。
 * 2. 若 profile.equipmentOwnership 不存在（向後相容舊資料），以 inventoryMap 是否存在且非負為準。
 */
export function isItemOwnedByPlayer(
  hrid: string,
  profile: Pick<PlayerProfile, 'equipmentOwnership' | 'inventoryMap'>,
): boolean {
  if (profile.equipmentOwnership) {
    return profile.equipmentOwnership[hrid] === 'owned';
  }
  return profile.inventoryMap[hrid] !== undefined && profile.inventoryMap[hrid] >= 0;
}

/**
 * 評估一件裝備對特定生活技能的實際生活屬性增益評分（Heuristic Uplift Score）。
 * 若無任何對該技能有效的生活屬性，嚴格回傳 -1（判定為不適格 / 純戰鬥裝）。
 */
export function evaluateEquipmentUpliftForAction(
  eqHrid: string,
  enhanceLevel: number,
  action: SkillingAction,
  data: NormalizedStrategyGameData,
  options?: { isSpeedCapped?: boolean },
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

    // 依生活屬性邊際收益進行評分：
    if (prop.endsWith('Speed') || prop.endsWith('ActionSpeed')) {
      // 若 Speed 已撞 3 秒 floor，額外 Speed 不產生收益，權重降為 0，避免錯選 speed 裝而犧牲效率
      score += options?.isSpeedCapped ? 0 : totalVal * 100;
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
 * 從玩家持有清單中智慧挑選對指定技能實質生活增益最高的裝備。
 * 嚴格受限於 profile.equipmentOwnership 持有池。
 */
export function bestEquipmentForActionSlot(
  profile: PlayerProfile,
  action: SkillingAction,
  slotType: string,
  currentEquipped: ProfileEquipment | null,
  data: NormalizedStrategyGameData,
): ProfileEquipment | null {
  let bestCandidate: ProfileEquipment | null = null;
  let bestScore = -1;

  // 判斷當前技能是否已達 3 秒時間下限（3,000,000,000 ns Floor）
  let baseTimeCost = 12_000_000_000;
  for (const [hrid, act] of data.actionsByHrid) {
    if (hrid.startsWith(`/actions/${action}/`) && typeof act.baseTimeCost === 'number' && act.baseTimeCost > 0) {
      baseTimeCost = act.baseTimeCost;
      break;
    }
  }
  const buffs = actionBuffs(profile, action, data);
  const currentSpeed = 1 + buffs.Speed;
  const isSpeedCapped = (baseTimeCost / currentSpeed) <= 3_000_000_000;

  // 納入目前已穿戴的裝備作為候選比較基準
  if (currentEquipped) {
    const score = evaluateEquipmentUpliftForAction(
      currentEquipped.itemHrid,
      currentEquipped.enhancementLevel,
      action,
      data,
      { isSpeedCapped },
    );
    if (score > 0) {
      bestCandidate = currentEquipped;
      bestScore = score;
    }
  }

  // 遍歷所有背包/倉庫持有物
  for (const [hrid, enhanceLevel] of Object.entries(profile.inventoryMap)) {
    if (!isItemOwnedByPlayer(hrid, profile)) continue;

    const item = data.itemDetailMap[hrid];
    if (!item || !item.equipmentDetail || item.equipmentDetail.type !== slotType) continue;

    const upliftScore = evaluateEquipmentUpliftForAction(hrid, enhanceLevel, action, data, { isSpeedCapped });
    if (upliftScore <= 0) continue;

    if (upliftScore > bestScore || (Math.abs(upliftScore - bestScore) < 1e-6 && enhanceLevel > (bestCandidate?.enhancementLevel ?? -1))) {
      bestScore = upliftScore;
      bestCandidate = { itemHrid: hrid, enhancementLevel: enhanceLevel };
    }
  }

  return bestCandidate;
}

/**
 * 向後相容函式：從 inventoryMap 搜尋（接受純 inventoryMap）
 */
export function bestEquipmentFromInventoryForAction(
  inventoryMap: Record<string, number>,
  action: SkillingAction,
  slotType: string,
  data: NormalizedStrategyGameData,
  ownershipMap?: Record<string, import('../profile/types').OwnershipState>,
): ProfileEquipment | null {
  const dummyProfile: PlayerProfile = {
    inventoryMap,
    equipmentOwnership: ownershipMap,
    specialEquipment: {},
    actions: {
      [action]: { playerLevel: 100, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
    },
    communityBuffs: {},
    shrines: {},
    achievements: {},
    seals: [],
  } as unknown as PlayerProfile;

  return bestEquipmentForActionSlot(dummyProfile, action, slotType, null, data);
}

export const bestSkillingEquipmentFromInventory = bestEquipmentFromInventoryForAction;

export function bestSpecialEquipmentFromInventory(
  inventoryMap: Record<string, number>,
  slotType: string,
  data: NormalizedStrategyGameData,
  ownershipMap?: Record<string, import('../profile/types').OwnershipState>,
  forAction?: SkillingAction,
): ProfileEquipment | null {
  let bestHrid: string | null = null;
  let bestScore = -1;
  let bestEnhance = -1;

  for (const [hrid, enhanceLevel] of Object.entries(inventoryMap)) {
    if (ownershipMap && ownershipMap[hrid] !== 'owned') continue;

    const item = data.itemDetailMap[hrid];
    if (!item) continue;
    const eq = item.equipmentDetail;
    if (!eq || eq.type !== slotType) continue;

    const noncombat = eq.noncombatStats;
    if (!noncombat || Object.keys(noncombat).length === 0) continue;

    if (forAction) {
      const score = evaluateEquipmentUpliftForAction(hrid, enhanceLevel, forAction, data);
      if (score > bestScore) {
        bestScore = score;
        bestEnhance = enhanceLevel;
        bestHrid = hrid;
      }
    } else {
      if (enhanceLevel > bestEnhance) {
        bestEnhance = enhanceLevel;
        bestHrid = hrid;
      }
    }
  }

  return bestHrid !== null ? { itemHrid: bestHrid, enhancementLevel: bestEnhance } : null;
}

/**
 * 判斷指定生活技能之茶飲是否為手動模式（全域手動或單項手動皆視為手動）
 */
export function isTeaManual(profile: PlayerProfile, action: SkillingAction): boolean {
  return profile.teaMode === 'manual' || profile.actions[action]?.teaMode === 'manual';
}

/**
 * 智慧豐富角色快照：
 * 1. 嚴格尊重 Manual 設定：
 *    - 若 profile.loadoutMode === 'manual' 或 action.loadoutMode === 'manual'，
 *      所有生活裝備槽位（tool, body, legs, back, charm）100% 保持原值（包含 null 空槽），絕不覆蓋。
 *    - 若 profile.loadoutMode === 'manual'，特殊生活飾品槽位亦 100% 保持原值，不自動填充。
 *    - 若 isTeaManual(profile, action)，茶飲清單 100% 保持原值，不自動填充。
 * 2. Auto 模式：
 *    - 僅在玩家明確持有（equipmentOwnership === 'owned'）的裝備池中挑選最優生活裝備。
 *    - 若玩家目前穿戴之裝備比持有池中更佳，予以保留；否則換上持有池中收益最高的裝備。
 */
export function enrichProfileWithBestLoadout(
  profile: PlayerProfile,
  data: NormalizedStrategyGameData,
): PlayerProfile {
  const isGlobalManualLoadout = profile.loadoutMode === 'manual';
  const enrichedActions = { ...profile.actions };
  const enrichedSpecial = { ...profile.specialEquipment };

  // 只有在非手動模式時，才自動穿戴特殊生活飾品
  if (!isGlobalManualLoadout) {
    if (!enrichedSpecial.pouch && isItemOwnedByPlayer('/items/guzzling_pouch', profile)) {
      enrichedSpecial.pouch = {
        itemHrid: '/items/guzzling_pouch',
        enhancementLevel: profile.inventoryMap['/items/guzzling_pouch'] ?? 0,
      };
    }

    for (const slot of ['head', 'hands', 'off_hand', 'feet', 'neck', 'ring', 'earrings', 'trinket']) {
      if (!enrichedSpecial[slot]) {
        const best = bestSpecialEquipmentFromInventory(
          profile.inventoryMap,
          `/equipment_types/${slot}`,
          data,
          profile.equipmentOwnership,
        );
        if (best) enrichedSpecial[slot] = best;
      }
    }
  }

  for (const [actionKey, actionProfile] of Object.entries(enrichedActions)) {
    const action = actionKey as SkillingAction;
    const isActionManualLoadout = isGlobalManualLoadout || actionProfile.loadoutMode === 'manual';
    const isActionManualTea = isTeaManual(profile, action);

    // ── 茶飲解析 ──
    let teas = actionProfile.teas ?? [];
    if (!isActionManualTea) {
      if (!teas || teas.length === 0) {
        teas = optimalTeasForAction(action);
      }
    }

    // ── 裝備解析 ──
    if (isActionManualLoadout) {
      // 100% 尊重玩家手動設定，空槽 (null) 絕不被覆蓋為 optimizer 推薦
      enrichedActions[action] = {
        ...actionProfile,
        teas,
        tool: actionProfile.tool ?? null,
        body: actionProfile.body ?? null,
        legs: actionProfile.legs ?? null,
        back: actionProfile.back ?? null,
        charm: actionProfile.charm ?? null,
      };
    } else {
      // Auto 模式：從持有池中挑選最高效益裝備
      const tool = bestEquipmentForActionSlot(
        profile,
        action,
        `/equipment_types/${action}_tool`,
        actionProfile.tool,
        data,
      );
      const body = bestEquipmentForActionSlot(
        profile,
        action,
        '/equipment_types/body',
        actionProfile.body,
        data,
      );
      const legs = bestEquipmentForActionSlot(
        profile,
        action,
        '/equipment_types/legs',
        actionProfile.legs,
        data,
      );
      const back = bestEquipmentForActionSlot(
        profile,
        action,
        '/equipment_types/back',
        actionProfile.back,
        data,
      );
      const charm = bestEquipmentForActionSlot(
        profile,
        action,
        '/equipment_types/charm',
        actionProfile.charm,
        data,
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
  }

  return {
    ...profile,
    actions: enrichedActions,
    specialEquipment: enrichedSpecial,
  };
}
