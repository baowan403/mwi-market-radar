import 'fake-indexeddb/auto';
import exporter from './fixtures/profile-export-v1.json';
import preset from './fixtures/profile-preset.json';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import {
  PROFILE_DATABASE_NAME,
  createMemoryProfileStore,
  createProfileStore,
  type ProfileStore,
} from '../src/profile/store';

const stores: ProfileStore[] = [];

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PROFILE_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
    request.onblocked = () => reject(new Error('delete blocked'));
  });
}

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await deleteDatabase();
});

describe.each([
  ['memory', () => createMemoryProfileStore()],
  ['indexeddb', () => createProfileStore()],
] as const)('%s profile store', (_name, create) => {
  it('keeps multiple characters isolated and preserves one active id', async () => {
    const store = create();
    stores.push(store);
    const first = importPlayerProfile(JSON.stringify(exporter), 100);
    const second = importPlayerProfile(JSON.stringify(preset), 200);

    await store.put(first);
    await store.put(second);
    await store.setActiveId(second.id);

    expect((await store.list()).map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(await store.getActiveId()).toBe(second.id);
    expect((await store.get(first.id))?.actions.alchemy.playerLevel).toBe(103);
    expect((await store.get(second.id))?.actions.brewing.playerLevel).toBe(80);
  });

  it('deletes only the selected profile and clears its active pointer', async () => {
    const store = create();
    stores.push(store);
    const first = importPlayerProfile(JSON.stringify(exporter));
    const second = importPlayerProfile(JSON.stringify(preset));
    await store.put(first);
    await store.put(second);
    await store.setActiveId(first.id);

    await store.delete(first.id);

    expect(await store.get(first.id)).toBeNull();
    expect(await store.get(second.id)).toEqual(second);
    expect(await store.getActiveId()).toBeNull();
  });
});

describe('IndexedDB profile persistence', () => {
  it('survives adapter restarts without sharing mutable references', async () => {
    const firstStore = createProfileStore();
    stores.push(firstStore);
    const profile = importPlayerProfile(JSON.stringify(exporter));
    await firstStore.put(profile);
    await firstStore.setActiveId(profile.id);
    firstStore.close();

    const secondStore = createProfileStore();
    stores.push(secondStore);
    const loaded = await secondStore.get(profile.id);
    expect(loaded).toEqual(profile);
    expect(await secondStore.getActiveId()).toBe(profile.id);
    loaded!.actions.alchemy.playerLevel = 1;
    expect((await secondStore.get(profile.id))?.actions.alchemy.playerLevel).toBe(103);
  });
});
