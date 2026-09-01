export const STRATEGY_DATABASE_NAME = 'mwi-market-radar-strategies';
export const STRATEGY_DATABASE_VERSION = 1;
const PIN_STORE = 'strategy-pins';

export interface StrategyPinStore {
  list(): Promise<string[]>;
  toggle(id: string): Promise<boolean>;
  close(): void;
}

export class StrategyPinStoreError extends Error {
  readonly code = 'strategy_pin_storage';
  constructor() {
    super('策略自選儲存空間無法使用');
    this.name = 'StrategyPinStoreError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function validId(id: string): boolean {
  return id.length > 0 && id.length <= 500 && !/[\r\n\0]/.test(id);
}

export function createMemoryStrategyPinStore(): StrategyPinStore {
  const ids = new Set<string>();
  let closed = false;
  const open = () => { if (closed) throw new StrategyPinStoreError(); };
  return {
    async list() {
      open();
      return [...ids].sort();
    },
    async toggle(id) {
      open();
      if (!validId(id)) throw new StrategyPinStoreError();
      if (ids.has(id)) {
        ids.delete(id);
        return false;
      }
      ids.add(id);
      return true;
    },
    close() { closed = true; },
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open(STRATEGY_DATABASE_NAME, STRATEGY_DATABASE_VERSION); } catch {
      reject(new StrategyPinStoreError());
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PIN_STORE)) request.result.createObjectStore(PIN_STORE);
    };
    request.onerror = () => reject(new StrategyPinStoreError());
    request.onblocked = () => reject(new StrategyPinStoreError());
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new StrategyPinStoreError());
    transaction.onabort = () => reject(new StrategyPinStoreError());
  });
}

export function createStrategyPinStore(options: { indexedDB?: IDBFactory } = {}): StrategyPinStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  let closed = false;
  const open = async () => {
    if (closed || !factory) throw new StrategyPinStoreError();
    if (database) return database;
    if (!opening) opening = openDatabase(factory).then((value) => {
      if (closed) {
        value.close();
        throw new StrategyPinStoreError();
      }
      database = value;
      return value;
    });
    return opening;
  };
  return {
    async list() {
      const db = await open();
      const transaction = db.transaction(PIN_STORE, 'readonly');
      const request = transaction.objectStore(PIN_STORE).getAllKeys();
      const values = await new Promise<IDBValidKey[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new StrategyPinStoreError());
      });
      await transactionDone(transaction);
      if (!values.every((value) => typeof value === 'string' && validId(value))) throw new StrategyPinStoreError();
      return (values as string[]).sort();
    },
    async toggle(id) {
      if (!validId(id)) throw new StrategyPinStoreError();
      const db = await open();
      const transaction = db.transaction(PIN_STORE, 'readwrite');
      const store = transaction.objectStore(PIN_STORE);
      const existing = await new Promise<unknown>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new StrategyPinStoreError());
      });
      const pinned = existing !== true;
      if (pinned) store.put(true, id);
      else store.delete(id);
      await transactionDone(transaction);
      return pinned;
    },
    close() {
      closed = true;
      database?.close();
      database = null;
      opening = null;
    },
  };
}
