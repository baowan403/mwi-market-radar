import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STRATEGY_DATABASE_NAME,
  createMemoryStrategyPinStore,
  createStrategyPinStore,
  type StrategyPinStore,
} from '../src/strategy/store';

const stores: StrategyPinStore[] = [];

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(STRATEGY_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('delete blocked'));
  });
}

beforeEach(deleteDatabase);
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await deleteDatabase();
});

describe.each([
  ['memory', () => createMemoryStrategyPinStore()],
  ['indexeddb', () => createStrategyPinStore()],
] as const)('%s strategy pin store', (_name, create) => {
  it('toggles strategy ids independently from market item keys', async () => {
    const store = create();
    stores.push(store);
    expect(await store.toggle('workflow:a|b')).toBe(true);
    expect(await store.toggle('decompose-coinify:x')).toBe(true);
    expect(await store.list()).toEqual(['decompose-coinify:x', 'workflow:a|b']);
    expect(await store.toggle('workflow:a|b')).toBe(false);
    expect(await store.list()).toEqual(['decompose-coinify:x']);
  });
});

it('persists strategy pins across IndexedDB adapter restarts', async () => {
  const first = createStrategyPinStore();
  stores.push(first);
  await first.toggle('workflow:persisted');
  first.close();
  const second = createStrategyPinStore();
  stores.push(second);
  expect(await second.list()).toEqual(['workflow:persisted']);
});
