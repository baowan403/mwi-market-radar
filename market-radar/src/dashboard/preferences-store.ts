import {
  DEFAULT_SETTINGS,
  PreferenceDataError,
  normalizeSettings,
  normalizeWatchlist,
} from '../core/preferences';
import type { RadarSettings, WatchItem } from '../core/types';

export { DEFAULT_SETTINGS, PreferenceDataError } from '../core/preferences';

export const PREFERENCES_DATABASE_NAME = 'mwi-market-radar';
export const PREFERENCES_DATABASE_VERSION = 1;
export const PREFERENCES_STORE_NAME = 'preferences';
export const WATCHLIST_PREFERENCE_KEY = 'watchlist';
export const SETTINGS_PREFERENCE_KEY = 'settings';

export const PREFERENCES_DB_NAME = PREFERENCES_DATABASE_NAME;
export const PREFERENCES_DB_VERSION = PREFERENCES_DATABASE_VERSION;

export type PreferenceStoreErrorCode = 'preference_storage';

export class PreferenceStoreError extends Error {
  readonly code: PreferenceStoreErrorCode = 'preference_storage';
  readonly operation: 'open' | 'blocked' | 'read' | 'write' | 'abort' | 'closed';

  constructor(operation: PreferenceStoreError['operation']) {
    super('Preference storage is unavailable');
    this.name = 'PreferenceStoreError';
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PreferencesStore {
  getWatchlist(): Promise<WatchItem[]>;
  setWatchlist(value: WatchItem[]): Promise<void>;
  getSettings(): Promise<RadarSettings>;
  setSettings(value: RadarSettings): Promise<void>;
  /** Concrete adapters may expose lifecycle cleanup; providers need not. */
  close?(): void;
}

export interface PreferencesStoreOptions {
  indexedDB?: IDBFactory;
}

export interface MemoryPreferencesInitial {
  watchlist?: unknown;
  settings?: unknown;
}

const MISSING = Symbol('missing preference');

function preferenceDataError(kind: 'watchlist' | 'settings'): PreferenceDataError {
  return new PreferenceDataError(kind);
}

function storageError(operation: PreferenceStoreError['operation']): PreferenceStoreError {
  return new PreferenceStoreError(operation);
}

/** In-memory implementation used by tests and non-browser providers. */
export class MemoryPreferencesStore implements PreferencesStore {
  #watchlist: unknown | typeof MISSING;
  #settings: unknown | typeof MISSING;
  #closed = false;

  constructor(initial: MemoryPreferencesInitial = {}) {
    this.#watchlist = initial.watchlist === undefined ? MISSING : initial.watchlist;
    this.#settings = initial.settings === undefined ? MISSING : initial.settings;
  }

  #ensureOpen(): void {
    if (this.#closed) throw storageError('closed');
  }

  async getWatchlist(): Promise<WatchItem[]> {
    this.#ensureOpen();
    if (this.#watchlist === MISSING) return [];
    try {
      return normalizeWatchlist(this.#watchlist);
    } catch {
      throw preferenceDataError('watchlist');
    }
  }

  async setWatchlist(value: WatchItem[]): Promise<void> {
    this.#ensureOpen();
    let normalized: WatchItem[];
    try {
      normalized = normalizeWatchlist(value);
    } catch {
      throw preferenceDataError('watchlist');
    }
    this.#watchlist = normalized;
  }

  async getSettings(): Promise<RadarSettings> {
    this.#ensureOpen();
    if (this.#settings === MISSING) return { ...DEFAULT_SETTINGS };
    try {
      return normalizeSettings(this.#settings);
    } catch {
      throw preferenceDataError('settings');
    }
  }

  async setSettings(value: RadarSettings): Promise<void> {
    this.#ensureOpen();
    let normalized: RadarSettings;
    try {
      normalized = normalizeSettings(value);
    } catch {
      throw preferenceDataError('settings');
    }
    this.#settings = normalized;
  }

  close(): void {
    this.#closed = true;
  }
}

export function createMemoryPreferencesStore(initial: MemoryPreferencesInitial = {}): MemoryPreferencesStore {
  return new MemoryPreferencesStore(initial);
}

function openPreferencesDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  let request: IDBOpenDBRequest;
  try {
    request = factory.open(PREFERENCES_DATABASE_NAME, PREFERENCES_DATABASE_VERSION);
  } catch {
    return Promise.reject(storageError('open'));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (operation: PreferenceStoreError['operation']): void => {
      if (settled) return;
      settled = true;
      reject(storageError(operation));
    };

    request.onupgradeneeded = (): void => {
      try {
        const database = request.result;
        if (!database.objectStoreNames.contains(PREFERENCES_STORE_NAME)) {
          database.createObjectStore(PREFERENCES_STORE_NAME);
        }
      } catch {
        fail('open');
      }
    };
    request.onblocked = (): void => fail('blocked');
    request.onerror = (): void => fail('open');
    request.onsuccess = (): void => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
  });
}

function transactionError(
  operation: 'read' | 'write',
): PreferenceStoreError {
  return storageError(operation);
}

function readPreference(
  database: IDBDatabase,
  key: string,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let value: unknown;
    let failure: PreferenceStoreError | null = null;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(PREFERENCES_STORE_NAME, 'readonly');
      const request = transaction.objectStore(PREFERENCES_STORE_NAME).get(key);
      request.onsuccess = (): void => {
        value = request.result;
      };
      request.onerror = (): void => {
        failure = transactionError('read');
      };
    } catch {
      reject(transactionError('read'));
      return;
    }
    transaction.onerror = (): void => reject(failure ?? transactionError('read'));
    transaction.onabort = (): void => reject(failure ?? storageError('abort'));
    transaction.oncomplete = (): void => resolve(value);
  });
}

function writePreference(
  database: IDBDatabase,
  key: string,
  value: unknown,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let failure: PreferenceStoreError | null = null;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(PREFERENCES_STORE_NAME, 'readwrite');
      const request = transaction.objectStore(PREFERENCES_STORE_NAME).put(value, key);
      request.onerror = (): void => {
        failure = transactionError('write');
      };
    } catch {
      reject(transactionError('write'));
      return;
    }
    transaction.onerror = (): void => reject(failure ?? transactionError('write'));
    transaction.onabort = (): void => reject(failure ?? storageError('abort'));
    transaction.oncomplete = (): void => resolve();
  });
}

/** IndexedDB-backed preference store with no generic key/value surface. */
export function createPreferencesStore(options: PreferencesStoreOptions = {}): PreferencesStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let closed = false;
  let database: IDBDatabase | null = null;
  let databasePromise: Promise<IDBDatabase> | null = null;

  const closeDatabase = (): void => {
    closed = true;
    database?.close();
    database = null;
  };

  const open = (): Promise<IDBDatabase> => {
    if (closed) return Promise.reject(storageError('closed'));
    if (database !== null) return Promise.resolve(database);
    if (databasePromise !== null) return databasePromise;
    if (typeof factory?.open !== 'function') return Promise.reject(storageError('open'));

    const pending = openPreferencesDatabase(factory).then((opened) => {
      if (closed) {
        opened.close();
        throw storageError('closed');
      }
      database = opened;
      opened.onversionchange = closeDatabase;
      return opened;
    });
    databasePromise = pending.catch((error: unknown) => {
      databasePromise = null;
      if (error instanceof PreferenceStoreError) throw error;
      throw storageError('open');
    });
    return databasePromise;
  };

  const getRaw = async (key: string): Promise<unknown> => readPreference(await open(), key);
  const setRaw = async (key: string, value: unknown): Promise<void> => writePreference(await open(), key, value);

  return {
    async getWatchlist(): Promise<WatchItem[]> {
      const stored = await getRaw(WATCHLIST_PREFERENCE_KEY);
      if (stored === undefined) return [];
      try {
        return normalizeWatchlist(stored);
      } catch {
        throw preferenceDataError('watchlist');
      }
    },

    async setWatchlist(value: WatchItem[]): Promise<void> {
      let normalized: WatchItem[];
      try {
        normalized = normalizeWatchlist(value);
      } catch {
        throw preferenceDataError('watchlist');
      }
      await setRaw(WATCHLIST_PREFERENCE_KEY, normalized);
    },

    async getSettings(): Promise<RadarSettings> {
      const stored = await getRaw(SETTINGS_PREFERENCE_KEY);
      if (stored === undefined) return { ...DEFAULT_SETTINGS };
      try {
        return normalizeSettings(stored);
      } catch {
        throw preferenceDataError('settings');
      }
    },

    async setSettings(value: RadarSettings): Promise<void> {
      let normalized: RadarSettings;
      try {
        normalized = normalizeSettings(value);
      } catch {
        throw preferenceDataError('settings');
      }
      await setRaw(SETTINGS_PREFERENCE_KEY, normalized);
    },

    close(): void {
      closeDatabase();
    },
  };
}

export const createIndexedDBPreferencesStore = createPreferencesStore;
