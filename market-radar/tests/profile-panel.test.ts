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
    expect(alchemy?.textContent).toContain('神聖蒸餾器 +10');
    expect(alchemy?.textContent).toContain('煉金師上衣 +7');
    expect(alchemy?.textContent).toContain('煉金師下衣 +5');
    expect(alchemy?.textContent).toContain('暴飲之囊 +5');
    expect(alchemy?.textContent).toContain('究極煉金茶、效率茶、催化茶');
    expect(alchemy?.textContent).toContain('實驗室 Lv4');
    expect(assumptions?.textContent).toContain('生產效率 Lv10');
    expect(assumptions?.textContent).toContain('力量神龕 Lv1');
    expect(assumptions?.textContent).toContain('節奏神龕 Lv3');
    expect(assumptions?.textContent).toContain('初心者');
    panel.destroy();
    store.close();
  });

  it('labels absent setup honestly and never auto-selects warehouse inventory', async () => {
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
    expect(alchemy?.textContent).toContain('工具未設定');
    expect(alchemy?.textContent).toContain('茶飲未設定');
    expect(document.querySelector('[data-profile-assumptions]')?.textContent).not.toContain('warehouse_only_item');
    panel.destroy();
    store.close();
  });
});
