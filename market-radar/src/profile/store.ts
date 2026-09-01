import type { PlayerProfile } from './types';

export const PROFILE_DATABASE_NAME = 'mwi-market-radar-profiles';
export const PROFILE_DATABASE_VERSION = 1;
export const PROFILE_STORE_NAME = 'profiles';
export const PROFILE_META_STORE_NAME = 'meta';
const ACTIVE_ID_KEY = 'active-profile-id';

export interface ProfileStore {
  list(): Promise<PlayerProfile[]>;
  get(id: string): Promise<PlayerProfile | null>;
  put(profile: PlayerProfile): Promise<void>;
  delete(id: string): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
  close(): void;
}

export class ProfileStoreError extends Error {
  readonly code = 'profile_storage';

  constructor() {
    super('角色快照儲存空間無法使用');
    this.name = 'ProfileStoreError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function storageError(): ProfileStoreError {
  return new ProfileStoreError();
}

function cloneProfile(profile: PlayerProfile): PlayerProfile {
  return structuredClone(profile);
}

function isProfile(value: unknown): value is PlayerProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Partial<PlayerProfile>;
  return typeof profile.id === 'string'
    && profile.id.length > 0
    && typeof profile.name === 'string'
    && typeof profile.importedAt === 'number'
    && profile.actions !== null
    && typeof profile.actions === 'object';
}

export function createMemoryProfileStore(): ProfileStore {
  const profiles = new Map<string, PlayerProfile>();
  let activeId: string | null = null;
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw storageError();
  };

  return {
    async list(): Promise<PlayerProfile[]> {
      ensureOpen();
      return [...profiles.values()]
        .map(cloneProfile)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant') || left.id.localeCompare(right.id));
    },
    async get(id: string): Promise<PlayerProfile | null> {
      ensureOpen();
      const profile = profiles.get(id);
      return profile === undefined ? null : cloneProfile(profile);
    },
    async put(profile: PlayerProfile): Promise<void> {
      ensureOpen();
      if (!isProfile(profile)) throw storageError();
      profiles.set(profile.id, cloneProfile(profile));
    },
    async delete(id: string): Promise<void> {
      ensureOpen();
      profiles.delete(id);
      if (activeId === id) activeId = null;
    },
    async getActiveId(): Promise<string | null> {
      ensureOpen();
      return activeId;
    },
    async setActiveId(id: string | null): Promise<void> {
      ensureOpen();
      if (id !== null && !profiles.has(id)) throw storageError();
      activeId = id;
    },
    close(): void {
      closed = true;
    },
  };
}

export interface ProfileStoreOptions {
  indexedDB?: IDBFactory;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  let request: IDBOpenDBRequest;
  try {
    request = factory.open(PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION);
  } catch {
    return Promise.reject(storageError());
  }

  return new Promise((resolve, reject) => {
    request.onupgradeneeded = (): void => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
        database.createObjectStore(PROFILE_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(PROFILE_META_STORE_NAME)) {
        database.createObjectStore(PROFILE_META_STORE_NAME);
      }
    };
    request.onerror = (): void => reject(storageError());
    request.onblocked = (): void => reject(storageError());
    request.onsuccess = (): void => resolve(request.result);
  });
}

function requestValue<T>(request: IDBRequest<T>, transaction: IDBTransaction): Promise<T> {
  return new Promise((resolve, reject) => {
    let value: T;
    request.onsuccess = (): void => { value = request.result; };
    request.onerror = (): void => reject(storageError());
    transaction.onerror = (): void => reject(storageError());
    transaction.onabort = (): void => reject(storageError());
    transaction.oncomplete = (): void => resolve(value);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = (): void => reject(storageError());
    transaction.onabort = (): void => reject(storageError());
    transaction.oncomplete = (): void => resolve();
  });
}

export function createProfileStore(options: ProfileStoreOptions = {}): ProfileStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let database: IDBDatabase | null = null;
  let pending: Promise<IDBDatabase> | null = null;
  let closed = false;

  const open = async (): Promise<IDBDatabase> => {
    if (closed || typeof factory?.open !== 'function') throw storageError();
    if (database) return database;
    if (!pending) {
      pending = openDatabase(factory).then((opened) => {
        if (closed) {
          opened.close();
          throw storageError();
        }
        database = opened;
        opened.onversionchange = (): void => {
          opened.close();
          database = null;
          closed = true;
        };
        return opened;
      }).catch(() => {
        pending = null;
        throw storageError();
      });
    }
    return pending;
  };

  return {
    async list(): Promise<PlayerProfile[]> {
      const db = await open();
      const transaction = db.transaction(PROFILE_STORE_NAME, 'readonly');
      const values = await requestValue(transaction.objectStore(PROFILE_STORE_NAME).getAll(), transaction);
      if (!Array.isArray(values) || values.some((value) => !isProfile(value))) throw storageError();
      return (values as PlayerProfile[])
        .map(cloneProfile)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant') || left.id.localeCompare(right.id));
    },
    async get(id: string): Promise<PlayerProfile | null> {
      const db = await open();
      const transaction = db.transaction(PROFILE_STORE_NAME, 'readonly');
      const value = await requestValue(transaction.objectStore(PROFILE_STORE_NAME).get(id), transaction);
      if (value === undefined) return null;
      if (!isProfile(value)) throw storageError();
      return cloneProfile(value);
    },
    async put(profile: PlayerProfile): Promise<void> {
      if (!isProfile(profile)) throw storageError();
      const db = await open();
      const transaction = db.transaction(PROFILE_STORE_NAME, 'readwrite');
      transaction.objectStore(PROFILE_STORE_NAME).put(cloneProfile(profile), profile.id);
      await transactionDone(transaction);
    },
    async delete(id: string): Promise<void> {
      const db = await open();
      const transaction = db.transaction([PROFILE_STORE_NAME, PROFILE_META_STORE_NAME], 'readwrite');
      transaction.objectStore(PROFILE_STORE_NAME).delete(id);
      const meta = transaction.objectStore(PROFILE_META_STORE_NAME);
      const activeRequest = meta.get(ACTIVE_ID_KEY);
      activeRequest.onsuccess = (): void => {
        if (activeRequest.result === id) meta.delete(ACTIVE_ID_KEY);
      };
      await transactionDone(transaction);
    },
    async getActiveId(): Promise<string | null> {
      const db = await open();
      const transaction = db.transaction(PROFILE_META_STORE_NAME, 'readonly');
      const value = await requestValue(transaction.objectStore(PROFILE_META_STORE_NAME).get(ACTIVE_ID_KEY), transaction);
      return typeof value === 'string' ? value : null;
    },
    async setActiveId(id: string | null): Promise<void> {
      if (id !== null && await this.get(id) === null) throw storageError();
      const db = await open();
      const transaction = db.transaction(PROFILE_META_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(PROFILE_META_STORE_NAME);
      if (id === null) store.delete(ACTIVE_ID_KEY);
      else store.put(id, ACTIVE_ID_KEY);
      await transactionDone(transaction);
    },
    close(): void {
      closed = true;
      database?.close();
      database = null;
      pending = null;
    },
  };
}
