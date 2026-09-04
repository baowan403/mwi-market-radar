import {
  SKILLING_ACTIONS,
  type ActionProfile,
  type PlayerProfile,
  type ProfileEquipment,
  type SkillingAction,
} from './types';

const MAX_PROFILE_BYTES = 1_000_000;
const SKILL_HRIDS = Object.fromEntries(
  SKILLING_ACTIONS.map((action) => [`/skills/${action}`, action]),
) as Record<string, SkillingAction>;
const HOUSE_ROOMS: Record<string, SkillingAction> = {
  dairy_barn: 'milking',
  garden: 'foraging',
  log_shed: 'woodcutting',
  forge: 'cheesesmithing',
  workshop: 'crafting',
  sewing_parlor: 'tailoring',
  kitchen: 'cooking',
  brewery: 'brewing',
  laboratory: 'alchemy',
  observatory: 'enhancing',
};
const ACTION_EQUIPMENT_SLOTS = new Set([
  ...SKILLING_ACTIONS.map((action) => `${action}_tool`),
  'body',
  'legs',
  'back',
  'charm',
  'amulet',
]);

export class ProfileImportError extends Error {
  readonly code = 'profile_import';

  constructor() {
    super('角色快照格式無法辨識');
    this.name = 'ProfileImportError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function equipment(value: unknown): ProfileEquipment | null {
  const item = record(value);
  const itemHrid = typeof item?.itemHrid === 'string'
    ? item.itemHrid
    : typeof item?.hrid === 'string'
      ? item.hrid
      : '';
  if (!itemHrid.startsWith('/items/')) return null;
  return {
    itemHrid,
    enhancementLevel: integer(item?.enhancementLevel ?? item?.enhanceLevel),
  };
}

function emptyAction(): ActionProfile {
  return {
    playerLevel: 1,
    tool: null,
    body: null,
    legs: null,
    back: null,
    charm: null,
    houseLevel: 0,
    teas: [],
  };
}

function actionRecord(): Record<SkillingAction, ActionProfile> {
  return Object.fromEntries(
    SKILLING_ACTIONS.map((action) => [action, emptyAction()]),
  ) as Record<SkillingAction, ActionProfile>;
}

function nameOf(data: Record<string, unknown>): string {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 80) throw new ProfileImportError();
  return name;
}

function teaList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.startsWith('/items/')
  )))].slice(0, 3);
}

function sealList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.startsWith('/items/seal_of_')
  )))];
}

function numericRecord(value: unknown, stripPrefix = false): Record<string, number> {
  const source = record(value) ?? {};
  return Object.fromEntries(Object.entries(source).flatMap(([key, item]) => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) return [];
    const normalizedKey = stripPrefix ? key.split('/').at(-1) ?? '' : key;
    return normalizedKey ? [[normalizedKey, item]] : [];
  }));
}

/** Exporter v1 calls this inventoryMap, but each value is the owned equipment's enhancement level. */
function equipmentInventoryRecord(value: unknown): Record<string, number> {
  const source = record(value) ?? {};
  return Object.fromEntries(Object.entries(source).filter(([key, item]) => (
    key.startsWith('/items/')
      && typeof item === 'number'
      && Number.isFinite(item)
      && item >= 0
  )) as Array<[string, number]>);
}

function achievementRecord(value: unknown): {
  characterId: number | null;
  completed: Record<string, boolean>;
} {
  if (!Array.isArray(value)) return { characterId: null, completed: {} };
  let characterId: number | null = null;
  const completed: Record<string, boolean> = {};
  for (const raw of value) {
    const item = record(raw);
    const hrid = typeof item?.achievementHrid === 'string' ? item.achievementHrid : '';
    if (
      characterId === null
      && typeof item?.characterID === 'number'
      && Number.isSafeInteger(item.characterID)
    ) {
      characterId = item.characterID;
    }
    if (hrid.startsWith('/achievements/')) completed[hrid] = item?.isCompleted === true;
  }
  return { characterId, completed };
}

function equipmentSlots(value: unknown): Record<string, ProfileEquipment> {
  const result: Record<string, ProfileEquipment> = {};
  for (const [locationHrid, raw] of Object.entries(record(value) ?? {})) {
    const normalized = equipment(raw);
    const slot = locationHrid.split('/').at(-1);
    if (normalized && slot) result[slot] = normalized;
  }
  return result;
}

function houseLevels(value: unknown): Partial<Record<SkillingAction, number>> {
  const result: Partial<Record<SkillingAction, number>> = {};
  for (const [roomHrid, level] of Object.entries(record(value) ?? {})) {
    const room = roomHrid.split('/').at(-1) ?? '';
    const action = HOUSE_ROOMS[room];
    if (action) result[action] = integer(level);
  }
  return result;
}

function importExporter(data: Record<string, unknown>, importedAt: number): PlayerProfile {
  const name = nameOf(data);
  const actions = actionRecord();
  const slots = equipmentSlots(data.equipment);
  const houses = houseLevels(data.houses);
  const actionTeas = record(data.actionTeas) ?? {};

  for (const [skillHrid, rawLevel] of Object.entries(record(data.skills) ?? {})) {
    const action = SKILL_HRIDS[skillHrid];
    if (action) actions[action].playerLevel = integer(rawLevel, 1);
  }
  for (const action of SKILLING_ACTIONS) {
    actions[action].tool = slots[`${action}_tool`] ?? null;
    actions[action].body = slots.body ?? null;
    actions[action].legs = slots.legs ?? null;
    actions[action].back = slots.back ?? null;
    actions[action].charm = slots.charm ?? slots.amulet ?? null;
    actions[action].houseLevel = houses[action] ?? 0;
    actions[action].teas = teaList(actionTeas[action]);
  }

  const achievements = achievementRecord(data.achievements);
  const inventoryMap = equipmentInventoryRecord(data.inventoryMap);
  const specialEquipment = Object.fromEntries(
    Object.entries(slots).filter(([slot]) => !ACTION_EQUIPMENT_SLOTS.has(slot)),
  );
  const missingFields = [
    ...(achievements.characterId === null ? ['characterId'] : []),
    ...(Object.keys(inventoryMap).length === 0 ? ['inventoryMap'] : []),
  ];

  const hasShrines = record(data.shrines) !== null;
  const hasCommunityBuffs = record(data.communityBuffs) !== null;
  const hasHouses = record(data.houses) !== null;
  const hasInventory = Object.keys(inventoryMap).length > 0;

  const provenanceMap: Record<string, 'unknown' | 'imported' | 'user-confirmed'> = {
    skills: 'imported',
    equipment: 'imported',
    inventoryMap: hasInventory ? 'imported' : 'unknown',
    shrines: hasShrines ? 'imported' : 'unknown',
    communityBuffs: hasCommunityBuffs ? 'imported' : 'unknown',
    houses: hasHouses ? 'imported' : 'unknown',
  };

  const equipmentOwnership: Record<string, 'unknown' | 'owned' | 'not-owned'> = {};
  for (const hrid of Object.keys(inventoryMap)) {
    equipmentOwnership[hrid] = 'owned';
  }

  let mechanicsCompleteness: 'complete' | 'estimated' | 'incomplete' = 'complete';
  if (!hasInventory || !hasShrines || !hasCommunityBuffs) {
    mechanicsCompleteness = hasInventory ? 'estimated' : 'incomplete';
  }

  return {
    id: achievements.characterId === null
      ? `milkonomy-v1:${name}`
      : `character:${achievements.characterId}`,
    characterId: achievements.characterId,
    name,
    source: 'milkonomy-v1',
    importedAt,
    completeness: missingFields.length === 0 ? 'full' : 'partial',
    mechanicsCompleteness,
    missingFields,
    provenanceMap,
    equipmentOwnership,
    actions,
    specialEquipment,
    communityBuffs: numericRecord(data.communityBuffs, true),
    shrines: numericRecord(data.shrines, true),
    achievements: achievements.completed,
    inventoryMap,
    materialInventoryMap: {},
    seals: sealList(data.seals),
  };
}

function importPreset(data: Record<string, unknown>, importedAt: number): PlayerProfile {
  const name = nameOf(data);
  const actions = actionRecord();
  const rawActions = record(data.actionConfigMap) ?? {};
  for (const action of SKILLING_ACTIONS) {
    const raw = record(rawActions[action]);
    if (!raw) continue;
    actions[action] = {
      playerLevel: integer(raw.playerLevel, 1),
      tool: equipment(raw.tool),
      body: equipment(raw.body),
      legs: equipment(raw.legs),
      back: equipment(raw.back),
      charm: equipment(raw.charm),
      houseLevel: integer(raw.houseLevel),
      teas: teaList(raw.tea),
      loadoutMode: 'manual', // Preset 匯入通常為手動設定
      teaMode: 'auto',
    };
  }

  const specialEquipment = Object.fromEntries(
    Object.entries(record(data.specialEquimentMap) ?? {}).flatMap(([slot, raw]) => {
      const normalized = equipment(raw);
      return normalized ? [[slot, normalized]] : [];
    }),
  );
  const communityBuffs = Object.fromEntries(
    Object.entries(record(data.communityBuffMap) ?? {}).flatMap(([key, raw]) => {
      const level = record(raw)?.level;
      return typeof level === 'number' && Number.isFinite(level) ? [[key, level]] : [];
    }),
  );
  const shrines = Object.fromEntries(
    Object.entries(record(data.shrineBuffMap) ?? {}).flatMap(([key, raw]) => {
      const level = record(raw)?.level;
      return typeof level === 'number' && Number.isFinite(level) ? [[key, level]] : [];
    }),
  );
  const achievements = Object.fromEntries(
    Object.entries(record(data.achievementBuffMap) ?? {}).map(([key, raw]) => (
      [key, record(raw)?.enabled === true]
    )),
  );

  const provenanceMap: Record<string, 'unknown' | 'imported' | 'user-confirmed'> = {
    skills: 'imported',
    equipment: 'imported',
    inventoryMap: 'unknown',
    shrines: Object.keys(shrines).length > 0 ? 'imported' : 'unknown',
    communityBuffs: Object.keys(communityBuffs).length > 0 ? 'imported' : 'unknown',
    houses: 'imported',
  };

  return {
    id: `milkonomy-preset:${name}`,
    characterId: null,
    name,
    source: 'milkonomy-preset',
    importedAt,
    completeness: 'partial',
    mechanicsCompleteness: 'estimated',
    missingFields: ['characterId', 'inventoryMap'],
    provenanceMap,
    equipmentOwnership: {},
    actions,
    specialEquipment,
    communityBuffs,
    shrines,
    achievements,
    inventoryMap: {},
    materialInventoryMap: {},
    seals: sealList(data.seals),
  };
}

export function importPlayerProfile(text: string, importedAt = Date.now()): PlayerProfile {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) {
    throw new ProfileImportError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProfileImportError();
  }
  const data = record(parsed);
  if (!data) throw new ProfileImportError();
  if (data.version === 1 && record(data.skills)) return importExporter(data, importedAt);
  if (record(data.actionConfigMap) && record(data.specialEquimentMap)) {
    return importPreset(data, importedAt);
  }
  throw new ProfileImportError();
}

export function validatePlayerProfile(input: unknown): PlayerProfile {
  const data = record(input);
  if (!data) throw new ProfileImportError();
  if (typeof data.id !== 'string' || !data.id) throw new ProfileImportError();
  if (typeof data.name !== 'string' || !data.name) throw new ProfileImportError();
  if (!record(data.actions)) throw new ProfileImportError();

  const completeness = data.completeness === 'full' || data.completeness === 'partial' ? data.completeness : 'partial';
  const mechanicsCompleteness = (
    data.mechanicsCompleteness === 'complete'
    || data.mechanicsCompleteness === 'estimated'
    || data.mechanicsCompleteness === 'incomplete'
  ) ? data.mechanicsCompleteness : undefined;

  return {
    id: data.id,
    characterId: typeof data.characterId === 'number' ? data.characterId : null,
    name: data.name,
    source: data.source === 'milkonomy-preset' ? 'milkonomy-preset' : 'milkonomy-v1',
    importedAt: typeof data.importedAt === 'number' ? data.importedAt : Date.now(),
    completeness,
    mechanicsCompleteness,
    loadoutMode: data.loadoutMode === 'manual' ? 'manual' : 'auto',
    teaMode: data.teaMode === 'manual' ? 'manual' : 'auto',
    missingFields: Array.isArray(data.missingFields) ? data.missingFields.filter((f): f is string => typeof f === 'string') : [],
    provenanceMap: record(data.provenanceMap) as Record<string, import('./types').FieldProvenance> ?? {},
    equipmentOwnership: record(data.equipmentOwnership) as Record<string, import('./types').OwnershipState> ?? {},
    actions: data.actions as Record<SkillingAction, ActionProfile>,
    specialEquipment: (record(data.specialEquipment) ?? {}) as Record<string, ProfileEquipment>,
    communityBuffs: numericRecord(data.communityBuffs, true),
    shrines: numericRecord(data.shrines, true),
    achievements: (record(data.achievements) ?? {}) as Record<string, boolean>,
    inventoryMap: equipmentInventoryRecord(data.inventoryMap),
    materialInventoryMap: {},
    seals: sealList(data.seals),
  };
}

/**
 * 依據玩家手動填入/確認的資料（provenanceMap 與實際設定值），
 * 重新計算角色的 mechanicsCompleteness 與 missingFields。
 * 當玩家補齊 unknown 資料（如神龕、裝備持有、公會等）後，
 * mechanicsCompleteness 必須能由 'estimated' 或 'incomplete' 升級為 'complete'。
 */
export function recomputeProfileCompleteness(profile: PlayerProfile): void {
  profile.provenanceMap = profile.provenanceMap ?? {};
  const prov = profile.provenanceMap;

  // 1. 檢查各領域是否有已確認或非空的有效資料
  const hasInventory = prov.inventoryMap === 'user-confirmed'
    || prov.inventoryMap === 'imported'
    || (profile.inventoryMap && Object.keys(profile.inventoryMap).length > 0)
    || (profile.equipmentOwnership && Object.keys(profile.equipmentOwnership).length > 0);

  const hasShrines = prov.shrines === 'user-confirmed'
    || prov.shrines === 'imported'
    || (profile.shrines && Object.keys(profile.shrines).length > 0);

  const hasCommunityBuffs = prov.communityBuffs === 'user-confirmed'
    || prov.communityBuffs === 'imported'
    || (profile.communityBuffs && Object.keys(profile.communityBuffs).length > 0);

  // 2. 判定機制完整度
  if (hasInventory && hasShrines && hasCommunityBuffs) {
    profile.mechanicsCompleteness = 'complete';
  } else if (hasInventory) {
    profile.mechanicsCompleteness = 'estimated';
  } else {
    profile.mechanicsCompleteness = 'incomplete';
  }

  // 3. 更新缺失欄位
  const missing: string[] = [];
  if (profile.characterId === null) missing.push('characterId');
  if (!hasInventory) missing.push('inventoryMap');
  if (!hasShrines) missing.push('shrines');
  if (!hasCommunityBuffs) missing.push('communityBuffs');
  profile.missingFields = missing;
  profile.completeness = missing.length === 0 ? 'full' : 'partial';
}


