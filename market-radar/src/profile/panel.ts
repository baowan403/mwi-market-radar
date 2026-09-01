import { ProfileImportError, importPlayerProfile } from './import';
import type { ProfileStore } from './store';
import type { PlayerProfile } from './types';

export interface ProfilePanel {
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
}

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

export function createProfilePanel(options: ProfilePanelOptions): ProfilePanel {
  const now = options.now ?? Date.now;
  const confirmDelete = options.confirmDelete ?? ((message: string) => window.confirm(message));
  let destroyed = false;
  let activeProfile: PlayerProfile | null = null;
  let textArea: HTMLTextAreaElement | null = null;
  let errorNode: HTMLElement | null = null;

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
    async importText(text: string): Promise<void> {
      if (destroyed) return;
      try {
        const profile = importPlayerProfile(text, now());
        await options.store.put(profile);
        await options.store.setActiveId(profile.id);
        if (textArea) textArea.value = '';
        await panel.refresh();
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
        renderDialog(profiles, activeId);
      } catch {
        activeProfile = null;
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
