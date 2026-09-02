import { ProfileImportError, importPlayerProfile } from './import';
import type { ProfileStore } from './store';
import {
  SKILLING_ACTIONS,
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
): HTMLElement {
  const section = element('section', 'profile-assumptions');
  section.dataset.profileAssumptions = 'true';
  const heading = element('h3');
  heading.textContent = '目前計算配置';
  const note = element('p', 'profile-assumption-note');
  note.textContent = '顯示匯入快照的實際設定，不會從倉庫自動替換裝備。';
  section.append(heading, note);

  const actions = element('div', 'profile-assumption-actions');
  const pouch = profile.specialEquipment.pouch ?? null;
  for (const action of SKILLING_ACTIONS) {
    const config = profile.actions[action];
    const details = element('details', 'profile-assumption-action');
    details.dataset.profileAction = action;
    details.open = action === 'alchemy';
    const summary = element('summary');
    summary.textContent = `${ACTION_LABELS[action]} ${config.playerLevel}`;
    const grid = element('div', 'profile-assumption-grid');
    appendAssumptionRow(grid, '工具', equipmentText(config.tool, itemName));
    for (const [label, equipment] of [
      ['上衣', config.body],
      ['下衣', config.legs],
      ['背部', config.back],
      ['護符', config.charm],
      ['口袋', pouch],
    ] as const) {
      if (equipment !== null) appendAssumptionRow(grid, label, equipmentText(equipment, itemName));
    }
    appendAssumptionRow(
      grid,
      '茶飲',
      config.teas.length === 0 ? '未設定' : config.teas.map(itemName).join('、'),
    );
    appendAssumptionRow(
      grid,
      '房屋',
      config.houseLevel > 0 ? `${HOUSE_LABELS[action]} Lv${config.houseLevel}` : '未設定',
    );
    details.append(summary, grid);
    actions.append(details);
  }
  section.append(actions);

  const modifiers = element('details', 'profile-assumption-modifiers');
  modifiers.open = true;
  const modifierSummary = element('summary');
  modifierSummary.textContent = '共用增益';
  const modifierGrid = element('div', 'profile-assumption-grid');
  const community = positiveModifiers(profile.communityBuffs, COMMUNITY_LABELS);
  const shrines = positiveModifiers(profile.shrines, SHRINE_LABELS);
  const tierAchievements = Object.entries(profile.achievements)
    .filter(([key, enabled]) => enabled && key in ACHIEVEMENT_TIER_LABELS)
    .map(([key]) => ACHIEVEMENT_TIER_LABELS[key]);
  const completedAchievements = Object.entries(profile.achievements)
    .filter(([key, enabled]) => enabled && key.startsWith('/achievements/')).length;
  appendAssumptionRow(modifierGrid, '社群', community.length === 0 ? '未設定' : community.join('、'));
  appendAssumptionRow(modifierGrid, '神龕', shrines.length === 0 ? '未設定' : shrines.join('、'));
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

    if (activeProfile !== null) card.append(renderProfileAssumptions(activeProfile, itemName));

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
