import { ProfileImportError, importPlayerProfile, recomputeProfileCompleteness } from './import';
import type { ProfileStore } from './store';
import {
  SKILLING_ACTIONS,
  SHRINE_KEYS,
  type PlayerProfile,
  type ProfileEquipment,
  type SkillingAction,
} from './types';

export interface ProfilePanel {
  open(): Promise<void>;
  getActiveProfile(): PlayerProfile | null;
  importText(text: string): Promise<void>;
  selectProfile(id: string): Promise<void>;
  refresh(): Promise<void>;
  destroy(): void;
}

export interface ProfilePanelOptions {
  openButton: HTMLButtonElement;
  summary: HTMLElement;
  dialog: HTMLDialogElement;
  store: ProfileStore;
  now?: () => number;
  confirmDelete?: (message: string) => boolean;
  itemName?: (hrid: string) => string;
  onActiveProfileChange?: (profile: PlayerProfile | null) => void;
}

const ACTION_LABELS: Record<SkillingAction, string> = {
  milking: '擠奶',
  foraging: '採摘',
  woodcutting: '伐木',
  cheesesmithing: '乳酪鍛造',
  crafting: '製作',
  tailoring: '裁縫',
  cooking: '烹飪',
  brewing: '沖泡',
  alchemy: '煉金',
  enhancing: '強化',
};

const HOUSE_LABELS: Record<SkillingAction, string> = {
  milking: '乳牛棚',
  foraging: '花園',
  woodcutting: '原木棚',
  cheesesmithing: '鍛造坊',
  crafting: '工作坊',
  tailoring: '裁縫室',
  cooking: '廚房',
  brewing: '沖泡室',
  alchemy: '實驗室',
  enhancing: '觀測站',
};

const COMMUNITY_LABELS: Record<string, string> = {
  experience: '經驗',
  gathering_quantity: '採集數量',
  production_efficiency: '生產效率',
  enhancing_speed: '強化速度',
  moo_card: '牛牛卡',
};

const SHRINE_LABELS: Record<string, string> = {
  power: '力量神龕',
  rhythm: '節奏神龕',
  spirit: '精神神龕',
  rare: '稀有神龕',
  scholar: '學者神龕',
};

const ACTION_TOOLS: Record<SkillingAction, { hrid: string; name: string }[]> = {
  milking: [
    { hrid: '/items/cheese_brush', name: '乳酪刷子' },
    { hrid: '/items/verdant_brush', name: '翠綠刷子' },
    { hrid: '/items/azure_brush', name: '蔚藍刷子' },
    { hrid: '/items/burble_brush', name: '泡泡刷子' },
    { hrid: '/items/crimson_brush', name: '緋紅刷子' },
    { hrid: '/items/rainbow_brush', name: '彩虹刷子' },
    { hrid: '/items/holy_brush', name: '神聖刷子' },
    { hrid: '/items/celestial_brush', name: '星空刷子' },
  ],
  foraging: [
    { hrid: '/items/cheese_shears', name: '乳酪剪刀' },
    { hrid: '/items/verdant_shears', name: '翠綠剪刀' },
    { hrid: '/items/azure_shears', name: '蔚藍剪刀' },
    { hrid: '/items/burble_shears', name: '泡泡剪刀' },
    { hrid: '/items/crimson_shears', name: '緋紅剪刀' },
    { hrid: '/items/rainbow_shears', name: '彩虹剪刀' },
    { hrid: '/items/holy_shears', name: '神聖剪刀' },
    { hrid: '/items/celestial_shears', name: '星空剪刀' },
  ],
  woodcutting: [
    { hrid: '/items/cheese_hatchet', name: '乳酪斧頭' },
    { hrid: '/items/verdant_hatchet', name: '翠綠斧頭' },
    { hrid: '/items/azure_hatchet', name: '蔚藍斧頭' },
    { hrid: '/items/burble_hatchet', name: '泡泡斧頭' },
    { hrid: '/items/crimson_hatchet', name: '緋紅斧頭' },
    { hrid: '/items/rainbow_hatchet', name: '彩虹斧頭' },
    { hrid: '/items/holy_hatchet', name: '神聖斧頭' },
    { hrid: '/items/celestial_hatchet', name: '星空斧頭' },
  ],
  cheesesmithing: [
    { hrid: '/items/cheese_hammer', name: '乳酪錘子' },
    { hrid: '/items/verdant_hammer', name: '翠綠錘子' },
    { hrid: '/items/azure_hammer', name: '蔚藍錘子' },
    { hrid: '/items/burble_hammer', name: '泡泡錘子' },
    { hrid: '/items/crimson_hammer', name: '緋紅錘子' },
    { hrid: '/items/rainbow_hammer', name: '彩虹錘子' },
    { hrid: '/items/holy_hammer', name: '神聖錘子' },
    { hrid: '/items/celestial_hammer', name: '星空錘子' },
  ],
  crafting: [
    { hrid: '/items/cheese_chisel', name: '乳酪鑿子' },
    { hrid: '/items/verdant_chisel', name: '翠綠鑿子' },
    { hrid: '/items/azure_chisel', name: '蔚藍鑿子' },
    { hrid: '/items/burble_chisel', name: '泡泡鑿子' },
    { hrid: '/items/crimson_chisel', name: '緋紅鑿子' },
    { hrid: '/items/rainbow_chisel', name: '彩虹鑿子' },
    { hrid: '/items/holy_chisel', name: '神聖鑿子' },
    { hrid: '/items/celestial_chisel', name: '星空鑿子' },
  ],
  tailoring: [
    { hrid: '/items/cheese_needle', name: '乳酪針' },
    { hrid: '/items/verdant_needle', name: '翠綠針' },
    { hrid: '/items/azure_needle', name: '蔚藍針' },
    { hrid: '/items/burble_needle', name: '泡泡針' },
    { hrid: '/items/crimson_needle', name: '緋紅針' },
    { hrid: '/items/rainbow_needle', name: '彩虹針' },
    { hrid: '/items/holy_needle', name: '神聖針' },
    { hrid: '/items/celestial_needle', name: '星空針' },
  ],
  cooking: [
    { hrid: '/items/cheese_spatula', name: '乳酪鍋鏟' },
    { hrid: '/items/verdant_spatula', name: '翠綠鍋鏟' },
    { hrid: '/items/azure_spatula', name: '蔚藍鍋鏟' },
    { hrid: '/items/burble_spatula', name: '泡泡鍋鏟' },
    { hrid: '/items/crimson_spatula', name: '緋紅鍋鏟' },
    { hrid: '/items/rainbow_spatula', name: '彩虹鍋鏟' },
    { hrid: '/items/holy_spatula', name: '神聖鍋鏟' },
    { hrid: '/items/celestial_spatula', name: '星空鍋鏟' },
  ],
  brewing: [
    { hrid: '/items/cheese_pot', name: '乳酪壺' },
    { hrid: '/items/verdant_pot', name: '翠綠壺' },
    { hrid: '/items/azure_pot', name: '蔚藍壺' },
    { hrid: '/items/burble_pot', name: '泡泡壺' },
    { hrid: '/items/crimson_pot', name: '緋紅壺' },
    { hrid: '/items/rainbow_pot', name: '彩虹壺' },
    { hrid: '/items/holy_pot', name: '神聖壺' },
    { hrid: '/items/celestial_pot', name: '星空壺' },
  ],
  alchemy: [
    { hrid: '/items/cheese_alembic', name: '乳酪蒸餾器' },
    { hrid: '/items/verdant_alembic', name: '翠綠蒸餾器' },
    { hrid: '/items/azure_alembic', name: '蔚藍蒸餾器' },
    { hrid: '/items/burble_alembic', name: '泡泡蒸餾器' },
    { hrid: '/items/crimson_alembic', name: '緋紅蒸餾器' },
    { hrid: '/items/rainbow_alembic', name: '彩虹蒸餾器' },
    { hrid: '/items/holy_alembic', name: '神聖蒸餾器' },
    { hrid: '/items/celestial_alembic', name: '星空蒸餾器' },
  ],
  enhancing: [
    { hrid: '/items/cheese_enhancer', name: '乳酪強化器' },
    { hrid: '/items/verdant_enhancer', name: '翠綠強化器' },
    { hrid: '/items/azure_enhancer', name: '蔚藍強化器' },
    { hrid: '/items/burble_enhancer', name: '泡泡強化器' },
    { hrid: '/items/crimson_enhancer', name: '緋紅強化器' },
    { hrid: '/items/rainbow_enhancer', name: '彩虹強化器' },
    { hrid: '/items/holy_enhancer', name: '神聖強化器' },
    { hrid: '/items/celestial_enhancer', name: '星空強化器' },
  ],
};

const ACTION_TOPS: Record<SkillingAction, { hrid: string; name: string }[]> = {
  milking: [{ hrid: '/items/dairyhands_top', name: '乳牛工上裝' }],
  foraging: [{ hrid: '/items/foragers_top', name: '採摘者上裝' }],
  woodcutting: [{ hrid: '/items/lumberjacks_top', name: '伐木工上裝' }],
  cheesesmithing: [{ hrid: '/items/cheesemakers_top', name: '乳酪工上裝' }],
  crafting: [{ hrid: '/items/crafters_top', name: '工匠上裝' }],
  tailoring: [{ hrid: '/items/tailors_top', name: '裁縫上裝' }],
  cooking: [{ hrid: '/items/chefs_top', name: '廚師上裝' }],
  brewing: [{ hrid: '/items/brewers_top', name: '釀造工上裝' }],
  alchemy: [
    { hrid: '/items/alchemists_top', name: '煉金術士上裝' },
    { hrid: '/items/alchemist_robe_top', name: '煉金師上衣' },
  ],
  enhancing: [{ hrid: '/items/enhancers_top', name: '強化工上裝' }],
};

const ACTION_BOTTOMS: Record<SkillingAction, { hrid: string; name: string }[]> = {
  milking: [{ hrid: '/items/dairyhands_bottoms', name: '乳牛工下裝' }],
  foraging: [{ hrid: '/items/foragers_bottoms', name: '採摘者下裝' }],
  woodcutting: [{ hrid: '/items/lumberjacks_bottoms', name: '伐木工下裝' }],
  cheesesmithing: [{ hrid: '/items/cheesemakers_bottoms', name: '乳酪工下裝' }],
  crafting: [{ hrid: '/items/crafters_bottoms', name: '工匠下裝' }],
  tailoring: [{ hrid: '/items/tailors_bottoms', name: '裁縫下裝' }],
  cooking: [{ hrid: '/items/chefs_bottoms', name: '廚師下裝' }],
  brewing: [{ hrid: '/items/brewers_bottoms', name: '釀造工下裝' }],
  alchemy: [
    { hrid: '/items/alchemists_bottoms', name: '煉金術士下裝' },
    { hrid: '/items/alchemist_robe_bottoms', name: '煉金師下衣' },
  ],
  enhancing: [{ hrid: '/items/enhancers_bottoms', name: '強化工下裝' }],
};

const COMMON_SKILLING_GEAR: { hrid: string; name: string; slot: string }[] = [
  { hrid: '/items/red_culinary_hat', name: '紅廚師帽 (烹飪/沖泡)', slot: 'head' },
  { hrid: '/items/eye_watch', name: '掌上監工/眼表 (鍛造/製作/裁縫)', slot: 'hands' },
  { hrid: '/items/collectors_boots', name: '採集者靴子 (採摘/擠奶/伐木)', slot: 'feet' },
  { hrid: '/items/enchanted_gloves', name: '附魔手套 (全生活效率)', slot: 'hands' },
  { hrid: '/items/gatherer_cape_refined', name: '採集者披風 (採集效率)', slot: 'back' },
  { hrid: '/items/artificer_cape', name: '巧匠披風 (生產效率)', slot: 'back' },
  { hrid: '/items/philosophers_necklace', name: '哲學家項鍊 (煉金稀有)', slot: 'neck' },
  { hrid: '/items/guzzling_pouch', name: '暴飲袋 (茶飲濃度)', slot: 'pouch' },
];

const SHRINE_NAMES: Record<string, string> = {
  power: '力量神龕 (作業效率 +0.5%/Lv)',
  rhythm: '節奏神龕 (作業速度 +0.5%/Lv)',
  spirit: '靈魂神龕 (精華掉率 +3.0%/Lv)',
  rare: '稀有神龕 (稀有掉率 +1.5%/Lv)',
  scholar: '學者神龕 (生活經驗 +0.5%/Lv)',
};

const ACHIEVEMENT_TIER_LABELS: Record<string, string> = {
  beginner: '初心者',
  novice: '新手',
  adept: '熟練者',
  veteran: '老手',
  champion: '冠軍',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function snapshotAge(importedAt: number, now: number): string {
  const elapsed = Math.max(0, now - importedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '剛剛更新';
  if (minutes < 60) return `${minutes} 分鐘前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}

function profileSummary(profile: PlayerProfile, now: number): string {
  const partial = profile.completeness === 'partial' ? '｜部分資料' : '';
  return `${profile.name}｜煉金 ${profile.actions.alchemy.playerLevel}${partial}｜${snapshotAge(profile.importedAt, now)}`;
}

function fallbackItemName(hrid: string): string {
  return hrid.split('/').at(-1)?.replaceAll('_', ' ') ?? hrid;
}

function equipmentText(
  value: ProfileEquipment | null,
  itemName: (hrid: string) => string,
): string {
  if (value === null) return '未設定';
  return `${itemName(value.itemHrid)} +${value.enhancementLevel}`;
}

function appendAssumptionRow(target: HTMLElement, label: string, value: string): void {
  const term = element('span', 'profile-assumption-label');
  term.textContent = label;
  const detail = element('strong', 'profile-assumption-value');
  detail.textContent = value;
  target.append(term, detail);
}

function positiveModifiers(
  values: Record<string, number>,
  labels: Record<string, string>,
): string[] {
  return Object.entries(values)
    .filter(([, level]) => Number.isFinite(level) && level > 0)
    .map(([key, level]) => `${labels[key] ?? key.replaceAll('_', ' ')} Lv${level}`);
}

function renderProfileAssumptions(
  profile: PlayerProfile,
  itemName: (hrid: string) => string,
  onUpdate?: () => Promise<void> | void,
): HTMLElement {
  const section = element('section', 'profile-assumptions');
  section.dataset.profileAssumptions = 'true';
  const heading = element('h3');
  heading.textContent = '目前計算配置';
  const note = element('p', 'profile-assumption-note');
  note.textContent = '可直接下拉選擇生活裝備並填寫強化等級（支援模擬）；修改後即時自動重算。';

  // ── 全域配裝推論模式 (Auto / Manual) ──
  const modeRow = element('div', 'profile-loadout-mode-row');
  modeRow.style.display = 'flex';
  modeRow.style.alignItems = 'center';
  modeRow.style.gap = '8px';
  modeRow.style.margin = '8px 0 6px 0';

  const modeLabel = element('span', 'profile-assumption-label');
  modeLabel.textContent = '配裝推論模式：';
  const modeSelect = element('select', 'profile-select');
  modeSelect.dataset.profileLoadoutMode = 'true';
  modeSelect.setAttribute('aria-label', '配裝推論模式');
  const autoOpt = element('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = '啟發式自動配裝 (Auto: 依持有池啟發式穿戴生活裝備)';
  const manualOpt = element('option');
  manualOpt.value = 'manual';
  manualOpt.textContent = '手動嚴格鎖定 (Manual: 100% 依目前裝備與空槽計算)';
  if (profile.loadoutMode === 'manual') manualOpt.selected = true;
  else autoOpt.selected = true;
  modeSelect.append(autoOpt, manualOpt);

  modeSelect.addEventListener('change', () => {
    profile.loadoutMode = modeSelect.value as 'auto' | 'manual';
    void onUpdate?.();
  });
  modeRow.append(modeLabel, modeSelect);

  // ── 全域茶飲推論模式 (Auto / Manual) ──
  const teaModeRow = element('div', 'profile-tea-mode-row');
  teaModeRow.style.display = 'flex';
  teaModeRow.style.alignItems = 'center';
  teaModeRow.style.gap = '8px';
  teaModeRow.style.margin = '4px 0 12px 0';

  const teaModeLabel = element('span', 'profile-assumption-label');
  teaModeLabel.textContent = '茶飲推論模式：';
  const teaModeSelect = element('select', 'profile-select');
  teaModeSelect.dataset.profileTeaMode = 'true';
  teaModeSelect.setAttribute('aria-label', '茶飲推論模式');
  const teaAutoOpt = element('option');
  teaAutoOpt.value = 'auto';
  teaAutoOpt.textContent = '自動推薦茶飲 (Auto: 依邊際獲利動態枚舉 0~3 杯最佳茶飲)';
  const teaManualOpt = element('option');
  teaManualOpt.value = 'manual';
  teaManualOpt.textContent = '手動嚴格鎖定 (Manual: 100% 依目前各技能設定茶飲)';
  if (profile.teaMode === 'manual') teaManualOpt.selected = true;
  else teaAutoOpt.selected = true;
  teaModeSelect.append(teaAutoOpt, teaManualOpt);

  teaModeSelect.addEventListener('change', () => {
    profile.teaMode = teaModeSelect.value as 'auto' | 'manual';
    void onUpdate?.();
  });
  teaModeRow.append(teaModeLabel, teaModeSelect);

  section.append(heading, note, modeRow, teaModeRow);

  const actions = element('div', 'profile-assumption-actions');

  for (const action of SKILLING_ACTIONS) {
    const config = profile.actions[action];
    const details = element('details', 'profile-assumption-action');
    details.dataset.profileAction = action;
    details.open = action === 'alchemy';
    const summary = element('summary');
    summary.textContent = `${ACTION_LABELS[action]} ${config.playerLevel}`;
    const grid = element('div', 'profile-assumption-grid');

    // 1. 工具 (Tool)
    const toolLabel = element('span', 'profile-assumption-label');
    toolLabel.textContent = '工具';
    const toolControl = element('div', 'profile-control-row');
    const toolSelect = element('select', 'profile-select');
    toolSelect.setAttribute('aria-label', `${ACTION_LABELS[action]}工具`);
    const toolNone = element('option');
    toolNone.value = '';
    toolNone.textContent = '未設定';
    toolSelect.append(toolNone);
    for (const tool of ACTION_TOOLS[action]) {
      const opt = element('option');
      opt.value = tool.hrid;
      opt.textContent = tool.name;
      opt.selected = config.tool?.itemHrid === tool.hrid;
      toolSelect.append(opt);
    }
    const toolLevelInput = element('input', 'profile-num-input');
    toolLevelInput.type = 'number';
    toolLevelInput.min = '0';
    toolLevelInput.max = '20';
    toolLevelInput.value = String(config.tool?.enhancementLevel ?? 0);
    toolLevelInput.setAttribute('aria-label', `${ACTION_LABELS[action]}工具強化等級`);

    const updateTool = () => {
      const hrid = toolSelect.value;
      const level = Math.max(0, Math.min(20, Math.floor(Number(toolLevelInput.value) || 0)));
      toolLevelInput.value = String(level);
      if (!hrid) {
        config.tool = null;
      } else {
        config.tool = { itemHrid: hrid, enhancementLevel: level };
        profile.inventoryMap[hrid] = level;
        profile.equipmentOwnership = profile.equipmentOwnership ?? {};
        profile.equipmentOwnership[hrid] = 'owned';
      }
      profile.provenanceMap = profile.provenanceMap ?? {};
      profile.provenanceMap.equipment = 'user-confirmed';
      profile.provenanceMap.inventoryMap = 'user-confirmed';
      recomputeProfileCompleteness(profile);
      void onUpdate?.();
    };
    toolSelect.addEventListener('change', updateTool);
    toolLevelInput.addEventListener('change', updateTool);
    toolControl.append(toolSelect, toolLevelInput);
    grid.append(toolLabel, toolControl);

    // 2. 上衣 (Body)
    const topLabel = element('span', 'profile-assumption-label');
    topLabel.textContent = '上衣';
    const topControl = element('div', 'profile-control-row');
    const topSelect = element('select', 'profile-select');
    topSelect.setAttribute('aria-label', `${ACTION_LABELS[action]}上衣`);
    const topNone = element('option');
    topNone.value = '';
    topNone.textContent = '未設定';
    topSelect.append(topNone);
    const currentTopHrid = config.body?.itemHrid ?? '';
    let topMatched = false;
    for (const topItem of ACTION_TOPS[action]) {
      const topOpt = element('option');
      topOpt.value = topItem.hrid;
      topOpt.textContent = topItem.name;
      if (currentTopHrid === topItem.hrid) {
        topOpt.selected = true;
        topMatched = true;
      }
      topSelect.append(topOpt);
    }
    if (currentTopHrid && !topMatched) {
      const topOpt = element('option');
      topOpt.value = currentTopHrid;
      topOpt.textContent = itemName(currentTopHrid);
      topOpt.selected = true;
      topSelect.append(topOpt);
    }
    const topLevelInput = element('input', 'profile-num-input');
    topLevelInput.type = 'number';
    topLevelInput.min = '0';
    topLevelInput.max = '20';
    topLevelInput.value = String(config.body?.enhancementLevel ?? 0);
    topLevelInput.setAttribute('aria-label', `${ACTION_LABELS[action]}上衣強化等級`);

    const updateTop = () => {
      const hrid = topSelect.value;
      const level = Math.max(0, Math.min(20, Math.floor(Number(topLevelInput.value) || 0)));
      topLevelInput.value = String(level);
      if (!hrid) {
        config.body = null;
      } else {
        config.body = { itemHrid: hrid, enhancementLevel: level };
        profile.inventoryMap[hrid] = level;
        profile.equipmentOwnership = profile.equipmentOwnership ?? {};
        profile.equipmentOwnership[hrid] = 'owned';
      }
      profile.provenanceMap = profile.provenanceMap ?? {};
      profile.provenanceMap.equipment = 'user-confirmed';
      profile.provenanceMap.inventoryMap = 'user-confirmed';
      recomputeProfileCompleteness(profile);
      void onUpdate?.();
    };
    topSelect.addEventListener('change', updateTop);
    topLevelInput.addEventListener('change', updateTop);
    topControl.append(topSelect, topLevelInput);
    grid.append(topLabel, topControl);

    // 3. 下衣 (Legs)
    const bottomLabel = element('span', 'profile-assumption-label');
    bottomLabel.textContent = '下衣';
    const bottomControl = element('div', 'profile-control-row');
    const bottomSelect = element('select', 'profile-select');
    bottomSelect.setAttribute('aria-label', `${ACTION_LABELS[action]}下衣`);
    const bottomNone = element('option');
    bottomNone.value = '';
    bottomNone.textContent = '未設定';
    bottomSelect.append(bottomNone);
    const currentBottomHrid = config.legs?.itemHrid ?? '';
    let bottomMatched = false;
    for (const bottomItem of ACTION_BOTTOMS[action]) {
      const bottomOpt = element('option');
      bottomOpt.value = bottomItem.hrid;
      bottomOpt.textContent = bottomItem.name;
      if (currentBottomHrid === bottomItem.hrid) {
        bottomOpt.selected = true;
        bottomMatched = true;
      }
      bottomSelect.append(bottomOpt);
    }
    if (currentBottomHrid && !bottomMatched) {
      const bottomOpt = element('option');
      bottomOpt.value = currentBottomHrid;
      bottomOpt.textContent = itemName(currentBottomHrid);
      bottomOpt.selected = true;
      bottomSelect.append(bottomOpt);
    }
    const bottomLevelInput = element('input', 'profile-num-input');
    bottomLevelInput.type = 'number';
    bottomLevelInput.min = '0';
    bottomLevelInput.max = '20';
    bottomLevelInput.value = String(config.legs?.enhancementLevel ?? 0);
    bottomLevelInput.setAttribute('aria-label', `${ACTION_LABELS[action]}下衣強化等級`);

    const updateBottom = () => {
      const hrid = bottomSelect.value;
      const level = Math.max(0, Math.min(20, Math.floor(Number(bottomLevelInput.value) || 0)));
      bottomLevelInput.value = String(level);
      if (!hrid) {
        config.legs = null;
      } else {
        config.legs = { itemHrid: hrid, enhancementLevel: level };
        profile.inventoryMap[hrid] = level;
        profile.equipmentOwnership = profile.equipmentOwnership ?? {};
        profile.equipmentOwnership[hrid] = 'owned';
      }
      profile.provenanceMap = profile.provenanceMap ?? {};
      profile.provenanceMap.equipment = 'user-confirmed';
      profile.provenanceMap.inventoryMap = 'user-confirmed';
      recomputeProfileCompleteness(profile);
      void onUpdate?.();
    };
    bottomSelect.addEventListener('change', updateBottom);
    bottomLevelInput.addEventListener('change', updateBottom);
    bottomControl.append(bottomSelect, bottomLevelInput);
    grid.append(bottomLabel, bottomControl);

    // 4. 房屋 (House)
    const houseLabel = element('span', 'profile-assumption-label');
    houseLabel.textContent = HOUSE_LABELS[action];
    const houseControl = element('div', 'profile-control-row');
    const houseLevelInput = element('input', 'profile-num-input');
    houseLevelInput.type = 'number';
    houseLevelInput.min = '0';
    houseLevelInput.max = '10';
    houseLevelInput.value = String(config.houseLevel);
    houseLevelInput.setAttribute('aria-label', `${HOUSE_LABELS[action]}等級`);
    const houseUnit = element('span', 'profile-input-unit');
    houseUnit.textContent = '級';

    const updateHouse = () => {
      const lvl = Math.max(0, Math.min(10, Math.floor(Number(houseLevelInput.value) || 0)));
      houseLevelInput.value = String(lvl);
      config.houseLevel = lvl;
      profile.provenanceMap = profile.provenanceMap ?? {};
      profile.provenanceMap.houses = 'user-confirmed';
      recomputeProfileCompleteness(profile);
      void onUpdate?.();
    };
    houseLevelInput.addEventListener('change', updateHouse);
    houseControl.append(houseLevelInput, houseUnit);
    grid.append(houseLabel, houseControl);

    details.append(summary, grid);
    actions.append(details);
  }
  section.append(actions);

  // 通用生活配件面板 (廚師帽、眼表、採集鞋、附魔手套等)
  const specials = element('details', 'profile-assumption-specials');
  specials.open = true;
  const specialsSummary = element('summary');
  specialsSummary.textContent = '通用生活配件 (勾選啟用與強化等級)';
  const specialsGrid = element('div', 'profile-specials-grid');

  for (const gear of COMMON_SKILLING_GEAR) {
    const row = element('div', 'profile-special-row');
    const check = element('input');
    check.type = 'checkbox';
    check.id = `special-${gear.hrid.replaceAll('/', '-')}`;
    
    // 判斷是否持有/啟用
    const slotGear = profile.specialEquipment[gear.slot];
    const currentLevel = profile.inventoryMap[gear.hrid] ?? (slotGear?.itemHrid === gear.hrid ? slotGear.enhancementLevel : -1);
    check.checked = currentLevel >= 0;

    const lbl = element('label');
    lbl.htmlFor = check.id;
    lbl.textContent = gear.name;

    const levelInput = element('input', 'profile-num-input');
    levelInput.type = 'number';
    levelInput.min = '0';
    levelInput.max = '20';
    levelInput.value = String(Math.max(0, currentLevel));
    levelInput.disabled = !check.checked;
    levelInput.setAttribute('aria-label', `${gear.name}強化等級`);

    const updateGear = () => {
      const level = Math.max(0, Math.min(20, Math.floor(Number(levelInput.value) || 0)));
      levelInput.value = String(level);
      levelInput.disabled = !check.checked;
      if (check.checked) {
        profile.inventoryMap[gear.hrid] = level;
        profile.specialEquipment[gear.slot] = { itemHrid: gear.hrid, enhancementLevel: level };
        profile.equipmentOwnership = profile.equipmentOwnership ?? {};
        profile.equipmentOwnership[gear.hrid] = 'owned';
      } else {
        delete profile.inventoryMap[gear.hrid];
        if (profile.specialEquipment[gear.slot]?.itemHrid === gear.hrid) {
          delete profile.specialEquipment[gear.slot];
        }
        profile.equipmentOwnership = profile.equipmentOwnership ?? {};
        profile.equipmentOwnership[gear.hrid] = 'not-owned';
      }
      profile.provenanceMap = profile.provenanceMap ?? {};
      profile.provenanceMap.equipment = 'user-confirmed';
      profile.provenanceMap.inventoryMap = 'user-confirmed';
      recomputeProfileCompleteness(profile);
      void onUpdate?.();
    };

    check.addEventListener('change', updateGear);
    levelInput.addEventListener('change', updateGear);

    row.append(check, lbl, levelInput);
    specialsGrid.append(row);
  }
  specials.append(specialsSummary, specialsGrid);
  section.append(specials);

  // 生活神龕面板 (5 種神龕手動等級配置)
  const shrines = element('details', 'profile-assumption-shrines');
  shrines.open = true;
  const shrinesSummary = element('summary');
  shrinesSummary.textContent = '生活神龕 (手動設定 0~10 級)';
  const shrinesGrid = element('div', 'profile-shrines-grid');

  for (const key of SHRINE_KEYS) {
    const row = element('div', 'profile-shrine-row');
    const lbl = element('span', 'profile-shrine-label');
    const shrineName = SHRINE_NAMES[key] ?? key;
    lbl.textContent = shrineName;
    const input = element('input', 'profile-num-input');
    input.type = 'number';
    input.min = '0';
    input.max = '10';
    input.value = String(profile.shrines[key] ?? 0);
    input.dataset.shrineKey = key;
    input.setAttribute('aria-label', shrineName);

    input.addEventListener('change', () => {
      const lvl = Math.max(0, Math.min(10, Math.floor(Number(input.value) || 0)));
      input.value = String(lvl);
      profile.shrines[key] = lvl;
      profile.provenanceMap = profile.provenanceMap ?? {};
      profile.provenanceMap[`shrine:${key}`] = 'user-confirmed';
      recomputeProfileCompleteness(profile);
      void onUpdate?.();
    });

    row.append(lbl, input);
    shrinesGrid.append(row);
  }
  shrines.append(shrinesSummary, shrinesGrid);
  section.append(shrines);

  // 共用公會增益與成就 (唯讀)
  const modifiers = element('details', 'profile-assumption-modifiers');
  modifiers.open = true;
  const modifierSummary = element('summary');
  modifierSummary.textContent = '公會加成與成就';
  const modifierGrid = element('div', 'profile-assumption-grid');
  const community = positiveModifiers(profile.communityBuffs, COMMUNITY_LABELS);
  const tierAchievements = Object.entries(profile.achievements)
    .filter(([key, enabled]) => enabled && key in ACHIEVEMENT_TIER_LABELS)
    .map(([key]) => ACHIEVEMENT_TIER_LABELS[key]);
  const completedAchievements = Object.entries(profile.achievements)
    .filter(([key, enabled]) => enabled && key.startsWith('/achievements/')).length;
  appendAssumptionRow(modifierGrid, '公會', community.length === 0 ? '未設定' : community.join('、'));
  appendAssumptionRow(
    modifierGrid,
    '成就',
    tierAchievements.length > 0
      ? tierAchievements.join('、')
      : completedAchievements > 0
        ? `已完成 ${completedAchievements} 項`
        : '未設定',
  );
  modifiers.append(modifierSummary, modifierGrid);
  section.append(modifiers);

  return section;
}

export function createProfilePanel(options: ProfilePanelOptions): ProfilePanel {
  const now = options.now ?? Date.now;
  const confirmDelete = options.confirmDelete ?? ((message: string) => window.confirm(message));
  const itemName = options.itemName ?? fallbackItemName;
  let destroyed = false;
  let activeProfile: PlayerProfile | null = null;
  let textArea: HTMLTextAreaElement | null = null;
  let errorNode: HTMLElement | null = null;
  let lastNotifiedId: string | null | undefined;

  const closeDialog = (): void => {
    if (typeof options.dialog.close === 'function' && options.dialog.open) {
      try {
        options.dialog.close();
      } catch {
        options.dialog.removeAttribute('open');
      }
    } else {
      options.dialog.removeAttribute('open');
    }
    options.dialog.hidden = true;
  };

  const openDialog = async (): Promise<void> => {
    await panel.refresh();
    if (destroyed) return;
    options.dialog.hidden = false;
    if (typeof options.dialog.showModal === 'function') {
      try {
        options.dialog.showModal();
      } catch {
        options.dialog.setAttribute('open', '');
      }
    } else {
      options.dialog.setAttribute('open', '');
    }
  };

  const renderDialog = (profiles: PlayerProfile[], activeId: string | null): void => {
    options.dialog.replaceChildren();
    const card = element('section', 'profile-card');
    const heading = element('h2');
    heading.textContent = '角色快照';
    card.append(heading);

    const privacy = element('p', 'profile-privacy');
    privacy.textContent = '角色資料只保存在此瀏覽器，不會上傳。';
    card.append(privacy);

    const selectLabel = element('label');
    selectLabel.textContent = '目前角色';
    const select = element('select');
    select.setAttribute('aria-label', '目前角色');
    const emptyOption = element('option');
    emptyOption.value = '';
    emptyOption.textContent = '尚未選擇角色';
    select.append(emptyOption);
    for (const profile of profiles) {
      const option = element('option');
      option.value = profile.id;
      option.textContent = `${profile.name}${profile.completeness === 'partial' ? '（部分資料）' : ''}`;
      option.selected = profile.id === activeId;
      select.append(option);
    }
    select.addEventListener('change', () => {
      void panel.selectProfile(select.value);
    });
    selectLabel.append(select);
    card.append(selectLabel);

    if (activeProfile !== null) {
      const current = activeProfile;
      card.append(
        renderProfileAssumptions(current, itemName, async () => {
          await options.store.put(current);
          options.onActiveProfileChange?.(structuredClone(current));
          options.summary.textContent = profileSummary(current, now());
        }),
      );
    }

    const importLabel = element('label');
    importLabel.textContent = '貼上 Milkonomy 角色快照';
    textArea = element('textarea', 'profile-json-input');
    textArea.setAttribute('aria-label', '貼上 Milkonomy 角色快照');
    textArea.spellcheck = false;
    importLabel.append(textArea);
    card.append(importLabel);

    errorNode = element('p', 'profile-error');
    errorNode.setAttribute('role', 'alert');
    errorNode.hidden = true;
    card.append(errorNode);

    const actions = element('div', 'profile-actions');
    const importButton = element('button', 'toolbar-button');
    importButton.type = 'button';
    importButton.textContent = '導入並使用';
    importButton.addEventListener('click', () => {
      void panel.importText(textArea?.value ?? '').catch(() => undefined);
    });
    actions.append(importButton);

    const deleteButton = element('button', 'toolbar-button danger-button');
    deleteButton.type = 'button';
    deleteButton.textContent = '刪除此角色';
    deleteButton.disabled = activeProfile === null;
    deleteButton.addEventListener('click', () => {
      const profile = activeProfile;
      if (!profile || !confirmDelete(`確定刪除角色「${profile.name}」的本機快照？`)) return;
      void options.store.delete(profile.id).then(() => panel.refresh());
    });
    actions.append(deleteButton);

    const closeButton = element('button', 'toolbar-button');
    closeButton.type = 'button';
    closeButton.textContent = '關閉';
    closeButton.addEventListener('click', closeDialog);
    actions.append(closeButton);
    card.append(actions);
    options.dialog.append(card);
  };

  const onOpen = (): void => { void openDialog(); };
  const onCancel = (event: Event): void => {
    event.preventDefault();
    closeDialog();
  };
  options.openButton.addEventListener('click', onOpen);
  options.dialog.addEventListener('cancel', onCancel);

  const panel: ProfilePanel = {
    open: openDialog,
    getActiveProfile(): PlayerProfile | null {
      return activeProfile === null ? null : structuredClone(activeProfile);
    },
    async importText(text: string): Promise<void> {
      if (destroyed) return;
      try {
        const profile = importPlayerProfile(text, now());
        await options.store.put(profile);
        await options.store.setActiveId(profile.id);
        if (textArea) textArea.value = '';
        await panel.refresh();
        closeDialog();
      } catch (error) {
        if (errorNode) {
          errorNode.hidden = false;
          errorNode.textContent = error instanceof ProfileImportError
            ? error.message
            : '角色快照儲存空間無法使用';
        }
        throw error;
      }
    },
    async selectProfile(id: string): Promise<void> {
      if (destroyed) return;
      await options.store.setActiveId(id || null);
      await panel.refresh();
    },
    async refresh(): Promise<void> {
      if (destroyed) return;
      try {
        const [profiles, activeId] = await Promise.all([
          options.store.list(),
          options.store.getActiveId(),
        ]);
        if (destroyed) return;
        activeProfile = activeId === null
          ? null
          : profiles.find((profile) => profile.id === activeId) ?? null;
        options.summary.textContent = activeProfile === null
          ? '尚未導入角色'
          : profileSummary(activeProfile, now());
        const nextId = activeProfile?.id ?? null;
        if (nextId !== lastNotifiedId) {
          lastNotifiedId = nextId;
          options.onActiveProfileChange?.(activeProfile === null ? null : structuredClone(activeProfile));
        }
        renderDialog(profiles, activeId);
      } catch {
        activeProfile = null;
        if (lastNotifiedId !== null) {
          lastNotifiedId = null;
          options.onActiveProfileChange?.(null);
        }
        options.summary.textContent = '角色快照無法使用';
        renderDialog([], null);
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      options.openButton.removeEventListener('click', onOpen);
      options.dialog.removeEventListener('cancel', onCancel);
      closeDialog();
    },
  };

  void panel.refresh();
  return panel;
}
