// @vitest-environment jsdom

import exporter from './fixtures/profile-export-v1.json';
import preset from './fixtures/profile-preset.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfilePanel } from '../src/profile/panel';
import { createMemoryProfileStore } from '../src/profile/store';

beforeEach(() => {
  document.body.innerHTML = `
    <button id="open" type="button"></button>
    <span id="summary"></span>
    <dialog id="dialog"></dialog>
  `;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('profile panel', () => {
  it('imports, activates, and renders one local profile without network access', async () => {
    const store = createMemoryProfileStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const panel = createProfilePanel({
      openButton: document.querySelector<HTMLButtonElement>('#open')!,
      summary: document.querySelector<HTMLElement>('#summary')!,
      dialog: document.querySelector<HTMLDialogElement>('#dialog')!,
      store,
      now: () => 1_788_220_800_000,
    });

    await panel.importText(JSON.stringify(exporter));

    expect(document.querySelector('#summary')?.textContent).toContain('測試牛一號');
    expect(document.querySelector('#summary')?.textContent).toContain('煉金 103');
    expect(await store.getActiveId()).toBe('character:700001');
    expect(panel.getActiveProfile()?.name).toBe('測試牛一號');
    expect(fetchSpy).not.toHaveBeenCalled();
    panel.destroy();
    store.close();
  });

  it('switches profiles and marks preset imports as partial', async () => {
    const store = createMemoryProfileStore();
    const panel = createProfilePanel({
      openButton: document.querySelector<HTMLButtonElement>('#open')!,
      summary: document.querySelector<HTMLElement>('#summary')!,
      dialog: document.querySelector<HTMLDialogElement>('#dialog')!,
      store,
    });
    await panel.importText(JSON.stringify(exporter));
    await panel.importText(JSON.stringify({
      name: '部分預設', color: '#000000', actionConfigMap: {}, specialEquimentMap: {},
    }));

    expect(document.querySelector('#summary')?.textContent).toContain('部分資料');
    await panel.selectProfile('character:700001');
    expect(document.querySelector('#summary')?.textContent).toContain('測試牛一號');
    panel.destroy();
    store.close();
  });

  it('shows the exact imported action equipment, teas, house, and shared modifiers', async () => {
    const store = createMemoryProfileStore();
    const names: Record<string, string> = {
      '/items/holy_alembic': '神聖蒸餾器',
      '/items/alchemist_robe_top': '煉金師上衣',
      '/items/alchemist_robe_bottoms': '煉金師下衣',
      '/items/guzzling_pouch': '暴飲之囊',
      '/items/ultra_alchemy_tea': '究極煉金茶',
      '/items/efficiency_tea': '效率茶',
      '/items/catalytic_tea': '催化茶',
    };
    const panel = createProfilePanel({
      openButton: document.querySelector<HTMLButtonElement>('#open')!,
      summary: document.querySelector<HTMLElement>('#summary')!,
      dialog: document.querySelector<HTMLDialogElement>('#dialog')!,
      store,
      itemName: (hrid) => names[hrid] ?? hrid,
    });

    await panel.importText(JSON.stringify(preset));
    await panel.open();

    const assumptions = document.querySelector<HTMLElement>('[data-profile-assumptions]');
    const alchemy = document.querySelector<HTMLElement>('[data-profile-action="alchemy"]');
    expect(assumptions?.textContent).toContain('目前計算配置');
    expect(document.querySelectorAll('[data-profile-action]')).toHaveLength(10);
    expect(alchemy?.textContent).toContain('煉金 103');

    // 檢查工具、上衣、下衣與房屋的控制項
    const toolSelect = alchemy?.querySelector<HTMLSelectElement>('select[aria-label="煉金工具"]');
    const toolLevel = alchemy?.querySelector<HTMLInputElement>('input[aria-label="煉金工具強化等級"]');
    expect(toolSelect?.value).toBe('/items/holy_alembic');
    expect(toolLevel?.value).toBe('10');

    const topSelect = alchemy?.querySelector<HTMLSelectElement>('select[aria-label="煉金上衣"]');
    const topLevel = alchemy?.querySelector<HTMLInputElement>('input[aria-label="煉金上衣強化等級"]');
    expect(topSelect?.value).toBe('/items/alchemist_robe_top');
    expect(topLevel?.value).toBe('7');

    const bottomSelect = alchemy?.querySelector<HTMLSelectElement>('select[aria-label="煉金下衣"]');
    const bottomLevel = alchemy?.querySelector<HTMLInputElement>('input[aria-label="煉金下衣強化等級"]');
    expect(bottomSelect?.value).toBe('/items/alchemist_robe_bottoms');
    expect(bottomLevel?.value).toBe('5');

    const houseLevel = alchemy?.querySelector<HTMLInputElement>('input[aria-label="實驗室等級"]');
    expect(houseLevel?.value).toBe('4');

    // 檢查通用配件 (暴飲袋)
    const pouchCheck = document.querySelector<HTMLInputElement>('#special--items-guzzling_pouch');
    expect(pouchCheck?.checked).toBe(true);

    // 檢查生活神龕
    const powerShrine = document.querySelector<HTMLInputElement>('input[data-shrine-key="power"]');
    expect(powerShrine?.value).toBe('1');
    const rhythmShrine = document.querySelector<HTMLInputElement>('input[data-shrine-key="rhythm"]');
    expect(rhythmShrine?.value).toBe('3');

    expect(assumptions?.textContent).toContain('生產效率 Lv10');
    expect(assumptions?.textContent).toContain('初心者');
    panel.destroy();
    store.close();
  });

  it('labels absent setup honestly and provides interactive selects', async () => {
    const store = createMemoryProfileStore();
    const sparse = {
      ...structuredClone(exporter),
      equipment: {},
      actionTeas: {},
      inventoryMap: {
        ...exporter.inventoryMap,
        '/items/warehouse_only_item': 10,
      },
    };
    const panel = createProfilePanel({
      openButton: document.querySelector<HTMLButtonElement>('#open')!,
      summary: document.querySelector<HTMLElement>('#summary')!,
      dialog: document.querySelector<HTMLDialogElement>('#dialog')!,
      store,
      itemName: (hrid) => hrid,
    });

    await panel.importText(JSON.stringify(sparse));
    await panel.open();

    const alchemy = document.querySelector<HTMLElement>('[data-profile-action="alchemy"]');
    const toolSelect = alchemy?.querySelector<HTMLSelectElement>('select[aria-label="煉金工具"]');
    expect(toolSelect?.value).toBe('');
    expect(document.querySelector('[data-profile-assumptions]')?.textContent).not.toContain('warehouse_only_item');
    panel.destroy();
    store.close();
  });

  it('allows user to customize gear, specials, and shrines with immediate persistence', async () => {
    const store = createMemoryProfileStore();
    let notifiedProfile: any = null;
    const panel = createProfilePanel({
      openButton: document.querySelector<HTMLButtonElement>('#open')!,
      summary: document.querySelector<HTMLElement>('#summary')!,
      dialog: document.querySelector<HTMLDialogElement>('#dialog')!,
      store,
      onActiveProfileChange: (p) => { notifiedProfile = p; },
    });

    await panel.importText(JSON.stringify(preset));
    await panel.open();

    const alchemy = document.querySelector<HTMLElement>('[data-profile-action="alchemy"]');
    const toolLevelInput = alchemy?.querySelector<HTMLInputElement>('input[aria-label="煉金工具強化等級"]')!;
    toolLevelInput.value = '15';
    toolLevelInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));

    expect(notifiedProfile?.actions.alchemy.tool?.enhancementLevel).toBe(15);

    // 修改神龕
    const powerShrineInput = document.querySelector<HTMLInputElement>('input[data-shrine-key="power"]')!;
    powerShrineInput.value = '8';
    powerShrineInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));

    panel.destroy();
    store.close();
  });

  it('recomputes completeness from estimated to complete when user confirms unknown fields and persists to storage', async () => {
    const store = createMemoryProfileStore();
    let notifiedProfile: any = null;
    const panel = createProfilePanel({
      openButton: document.querySelector<HTMLButtonElement>('#open')!,
      summary: document.querySelector<HTMLElement>('#summary')!,
      dialog: document.querySelector<HTMLDialogElement>('#dialog')!,
      store,
      onActiveProfileChange: (p) => { notifiedProfile = p; },
    });

    // 匯入 Preset (初始 mechanicsCompleteness 為 estimated，inventoryMap 為 unknown)
    await panel.importText(JSON.stringify(preset));
    expect(panel.getActiveProfile()?.mechanicsCompleteness).toBe('estimated');

    await panel.open();

    // 1. 玩家在 UI 上勾選生活配件（確認 inventoryMap / equipment）
    const alchemy = document.querySelector<HTMLElement>('[data-profile-action="alchemy"]');
    const toolLevelInput = alchemy?.querySelector<HTMLInputElement>('input[aria-label="煉金工具強化等級"]')!;
    toolLevelInput.value = '10';
    toolLevelInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));

    expect(notifiedProfile?.provenanceMap.inventoryMap).toBe('user-confirmed');
    // 有了裝備但生活神龕尚未齊備，完整度維持 estimated
    expect(notifiedProfile?.mechanicsCompleteness).toBe('estimated');

    // 2. 玩家在 UI 上僅手動修改 power 神龕（單一神龕確認）
    const powerShrineInput = document.querySelector<HTMLInputElement>('input[data-shrine-key="power"]')!;
    powerShrineInput.value = '5';
    powerShrineInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));

    // 斷言：單改 power 神龕時，power 設為 user-confirmed，但總體 shrines 仍為 unknown，不得升為 complete！
    expect(notifiedProfile?.provenanceMap['shrine:power']).toBe('user-confirmed');
    expect(notifiedProfile?.provenanceMap.shrines).toBe('unknown');
    expect(notifiedProfile?.mechanicsCompleteness).toBe('estimated');

    // 3. 玩家將剩餘 4 個生活神龕（rhythm, spirit, rare, scholar）全數確認
    for (const key of ['rhythm', 'spirit', 'rare', 'scholar']) {
      const input = document.querySelector<HTMLInputElement>(`input[data-shrine-key="${key}"]`)!;
      input.value = '3';
      input.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 10));
    }

    // 4. 斷言：五項神龕均確認後，shrines 升為 user-confirmed，且完整度正式升級為 complete
    expect(notifiedProfile?.provenanceMap.shrines).toBe('user-confirmed');
    expect(notifiedProfile?.mechanicsCompleteness).toBe('complete');

    // 5. 斷言持久化：自 store 重新載入，確認 complete 狀態成功持久化
    const reloaded = await store.get(notifiedProfile.id);
    expect(reloaded?.mechanicsCompleteness).toBe('complete');
    expect(reloaded?.provenanceMap?.shrines).toBe('user-confirmed');

    panel.destroy();
    store.close();
  });
});

