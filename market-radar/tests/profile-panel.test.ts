// @vitest-environment jsdom

import exporter from './fixtures/profile-export-v1.json';
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
});
