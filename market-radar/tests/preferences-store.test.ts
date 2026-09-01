import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarSettings, WatchItem } from '../src/core/types';
import {
  DEFAULT_SETTINGS,
  PreferenceDataError,
  normalizeSettings,
  normalizeWatchlist,
} from '../src/core/preferences';
import {
  PREFERENCES_DATABASE_NAME,
  PREFERENCES_STORE_NAME,
  SETTINGS_PREFERENCE_KEY,
  WATCHLIST_PREFERENCE_KEY,
  MemoryPreferencesStore,
  PreferenceStoreError,
  createPreferencesStore,
  type PreferencesStore,
} from '../src/dashboard/preferences-store';

const watchlist: WatchItem[] = [
  { key: '/items/alpha::7', order: 2 },
  { key: '/items/beta::0', order: 0 },
];
const settings: RadarSettings = {
  period: '7d',
  minimumVolume: 2.5,
  maximumSpreadPct: 12,
  anomalyMovePct: 6,
  anomalyVolumeMultiple: 3,
};

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PREFERENCES_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
    request.onblocked = () => reject(new Error('delete blocked'));
  });
}

function openRawDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREFERENCES_DATABASE_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function putRaw(key: string, value: unknown): Promise<void> {
  const db = await openRawDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PREFERENCES_STORE_NAME, 'readwrite');
    transaction.objectStore(PREFERENCES_STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('put failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('put aborted'));
  });
  db.close();
}

let stores: PreferencesStore[] = [];

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(async () => {
  for (const store of stores) store.close?.();
  stores = [];
  await deleteDatabase();
});

describe('MemoryPreferencesStore', () => {
  it('exposes only the four preference operations and close lifecycle', async () => {
    const store = new MemoryPreferencesStore();
    stores.push(store);

    expect(Object.keys(store).sort()).toEqual([]);
    expect('get' in store).toBe(false);
    await expect(store.getWatchlist()).resolves.toEqual([]);
    await expect(store.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('round trips normalized watchlist and strict settings without leaking shared defaults', async () => {
    const store = new MemoryPreferencesStore();
    stores.push(store);

    await store.setWatchlist(watchlist);
    await store.setSettings(settings);

    await expect(store.getWatchlist()).resolves.toEqual(normalizeWatchlist(watchlist));
    await expect(store.getSettings()).resolves.toEqual(settings);
    const first = await store.getSettings();
    first.minimumVolume = 99;
    await expect(store.getSettings()).resolves.toEqual(settings);
  });

  it('rejects corrupt and invalid preference data with one fixed typed code', async () => {
    const store = new MemoryPreferencesStore();
    stores.push(store);

    await expect(store.setWatchlist([
      { key: '/items/alpha::0', order: 0 },
      { key: '/items/alpha::0', order: 1 },
    ])).rejects.toBeInstanceOf(PreferenceDataError);
    await expect(store.setSettings({ ...DEFAULT_SETTINGS, period: '2d' } as unknown as RadarSettings)).rejects.toBeInstanceOf(PreferenceDataError);
    const corruptWatchlist = new MemoryPreferencesStore({
      watchlist: [{ key: '/items/private::0', order: -1 }],
    });
    const corruptSettings = new MemoryPreferencesStore({
      settings: { ...DEFAULT_SETTINGS, period: 'private' },
    });
    stores.push(corruptWatchlist, corruptSettings);
    const codes = await Promise.all([
      corruptWatchlist.getWatchlist(),
      corruptSettings.getSettings(),
    ].map((promise) => promise.catch((error: unknown) => error as PreferenceDataError)));
    expect(codes[0]).toMatchObject({ code: 'preference_data' });
    expect(codes[1]).toMatchObject({ code: 'preference_data' });
  });
});

describe('IndexedDB preferences', () => {
  it('creates the fixed version-one database and persists across adapter restarts', async () => {
    const first = createPreferencesStore();
    stores.push(first);
    await first.setWatchlist(watchlist);
    await first.setSettings(settings);
    first.close?.();

    const second = createPreferencesStore();
    stores.push(second);
    await expect(second.getWatchlist()).resolves.toEqual(normalizeWatchlist(watchlist));
    await expect(second.getSettings()).resolves.toEqual(settings);

    const database = await openRawDatabase();
    expect(database.version).toBe(1);
    expect([...database.objectStoreNames]).toEqual([PREFERENCES_STORE_NAME]);
    database.close();
  });

  it('returns fresh defaults when records are missing and does not expose arbitrary records', async () => {
    const store = createPreferencesStore();
    stores.push(store);

    const firstSettings = await store.getSettings();
    firstSettings.period = '3d';
    await expect(store.getWatchlist()).resolves.toEqual([]);
    await expect(store.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);

    const database = await openRawDatabase();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(PREFERENCES_STORE_NAME, 'readonly');
      const request = transaction.objectStore(PREFERENCES_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('read failed'));
    });
    database.close();
    expect(values).toEqual([]);
    expect(WATCHLIST_PREFERENCE_KEY).toBe('watchlist');
    expect(SETTINGS_PREFERENCE_KEY).toBe('settings');
  });

  it('wraps corrupt stored watchlist/settings values without returning raw data', async () => {
    const store = createPreferencesStore();
    stores.push(store);
    await store.getWatchlist();
    await putRaw(WATCHLIST_PREFERENCE_KEY, [{ key: '/items/private::0', order: -1 }]);
    const watchError = await store.getWatchlist().catch((error: unknown) => error);
    expect(watchError).toBeInstanceOf(PreferenceDataError);
    expect((watchError as PreferenceDataError).code).toBe('preference_data');
    expect((watchError as Error).message).not.toContain('private');

    await putRaw(SETTINGS_PREFERENCE_KEY, { ...DEFAULT_SETTINGS, period: 'private' });
    const settingsError = await store.getSettings().catch((error: unknown) => error);
    expect(settingsError).toBeInstanceOf(PreferenceDataError);
    expect((settingsError as Error).message).not.toContain('private');
  });

  it('rejects duplicate/invalid writes before persistence and does not leak values on closed writes', async () => {
    const store = createPreferencesStore();
    stores.push(store);
    const duplicate = [
      { key: '/items/private::0', order: 0 },
      { key: '/items/private::0', order: 1 },
    ];
    await expect(store.setWatchlist(duplicate as unknown as WatchItem[])).rejects.toMatchObject({ code: 'preference_data' });
    await expect(store.setSettings({ ...settings, maximumSpreadPct: -1 })).rejects.toMatchObject({ code: 'preference_data' });

    store.close?.();
    const error = await store.setWatchlist([{ key: '/items/private::7', order: 0 }]).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PreferenceStoreError);
    expect((error as Error).message).not.toContain('private');
  });

  it('closes safely on versionchange and reports fixed blocked/open errors', async () => {
    const store = createPreferencesStore();
    stores.push(store);
    await store.getSettings();
    const upgrade = indexedDB.open(PREFERENCES_DATABASE_NAME, 2);
    upgrade.onupgradeneeded = () => {
      const database = upgrade.result;
      if (!database.objectStoreNames.contains('upgrade-test')) database.createObjectStore('upgrade-test');
    };
    await new Promise<void>((resolve, reject) => {
      upgrade.onsuccess = () => {
        upgrade.result.close();
        resolve();
      };
      upgrade.onerror = () => reject(upgrade.error ?? new Error('upgrade failed'));
    });
    await expect(store.getSettings()).rejects.toMatchObject({ code: 'preference_storage' });

    const blockedFactory = {
      open: vi.fn(() => {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
        return request;
      }),
    } as unknown as IDBFactory;
    const blockedStore = createPreferencesStore({ indexedDB: blockedFactory });
    stores.push(blockedStore);
    await expect(blockedStore.getSettings()).rejects.toMatchObject({ code: 'preference_storage' });
  });
});
