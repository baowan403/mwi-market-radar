// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeResponse,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  SnapshotPage,
  WatchItem,
} from '../src/core/types';
import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
} from '../src/dashboard/client';
import {
  installDashboardBridge,
  type DashboardBridgeStore,
} from '../src/userscript/dashboard-bridge';

const snapshots: Snapshot[] = [
  {
    timestamp: 1_000,
    quotes: { '/items/test::0': { a: 101, b: 99, p: 100, v: 2 } },
  },
  {
    timestamp: 2_000,
    quotes: { '/items/test::0': { a: 111, b: 109, p: 110, v: 3 } },
  },
];

const watchlist: WatchItem[] = [{ key: '/items/test::0', order: 0 }];
const settings: RadarSettings = {
  period: '1d',
  minimumVolume: 1,
  maximumSpreadPct: 10,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};
const collectorStatus: CollectorStatus = {
  state: 'ok',
  lastAttemptAt: 2_000,
  lastSuccessAt: 2_000,
  officialTimestamp: 2_000,
  nextRunAt: 3_000,
  lastErrorCode: null,
};

function createStore(overrides: Partial<DashboardBridgeStore> = {}): DashboardBridgeStore {
  return {
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    setWatchlist: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    setSettings: vi.fn().mockResolvedValue(undefined),
    getCollectorStatus: vi.fn().mockResolvedValue(collectorStatus),
    ...overrides,
  };
}

async function dispatchRequest(
  target: EventTarget,
  detail: Record<string, unknown>,
): Promise<BridgeResponse> {
  const response = new Promise<BridgeResponse>((resolve) => {
    const onResponse = (event: Event): void => {
      if (event.type !== BRIDGE_RESPONSE_EVENT) return;
      if (typeof (event as CustomEvent<unknown>).detail !== 'string') return;
      const value = JSON.parse((event as CustomEvent<string>).detail) as { id?: unknown };
      if (value?.id !== detail.id) return;
      target.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      resolve(value as BridgeResponse);
    };
    target.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
  });
  target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: JSON.stringify(detail) }));
  return response;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installDashboardBridge', () => {
  it('returns bootstrap data from all store reads and computes latest timestamp/count', async () => {
    const target = new EventTarget();
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar/index.html',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    const response = await dispatchRequest(target, { id: 'bootstrap-1', type: 'bootstrap' });

    expect(response).toEqual({
      id: 'bootstrap-1',
      ok: true,
      value: {
        watchlist,
        settings,
        collectorStatus,
        latestTimestamp: 2_000,
        snapshotCount: 2,
      },
    });
    expect(store.listSnapshots).toHaveBeenCalledTimes(1);
    expect(store.getWatchlist).toHaveBeenCalledTimes(1);
    expect(store.getSettings).toHaveBeenCalledTimes(1);
    expect(store.getCollectorStatus).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('returns one newest-first snapshot page for the snapshots operation', async () => {
    const target = new EventTarget();
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    await expect(dispatchRequest(target, {
      id: 'snapshots-1',
      type: 'snapshots',
      beforeTimestamp: null,
      limit: 2,
    })).resolves.toEqual({
      id: 'snapshots-1',
      ok: true,
      value: {
        items: [snapshots[1], snapshots[0]],
        nextBeforeTimestamp: null,
        hasMore: false,
      },
    });
    cleanup();
  });

  it('pages from the bootstrap cache without returning snapshots in bootstrap', async () => {
    const target = new EventTarget();
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    const summary = await dispatchRequest(target, { id: 'cache-bootstrap', type: 'bootstrap' });
    expect((summary as { value: unknown }).value).toEqual({
      watchlist,
      settings,
      collectorStatus,
      latestTimestamp: 2_000,
      snapshotCount: 2,
    });

    await expect(dispatchRequest(target, {
      id: 'cache-page-1',
      type: 'snapshots',
      beforeTimestamp: null,
      limit: 1,
    })).resolves.toEqual({
      id: 'cache-page-1',
      ok: true,
      value: { items: [snapshots[1]], nextBeforeTimestamp: 2_000, hasMore: true },
    });
    await expect(dispatchRequest(target, {
      id: 'cache-page-2',
      type: 'snapshots',
      beforeTimestamp: 2_000,
      limit: 1,
    })).resolves.toEqual({
      id: 'cache-page-2',
      ok: true,
      value: { items: [snapshots[0]], nextBeforeTimestamp: null, hasMore: false },
    });
    expect(store.listSnapshots).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('acknowledges the two strict setter operations and passes values to the store', async () => {
    const target = new EventTarget();
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });
    const nextWatchlist: WatchItem[] = [{ key: '/items/other::7', order: 0 }];
    const nextSettings = { ...settings, period: '7d' as const };

    await expect(dispatchRequest(target, {
      id: 'set-watchlist-1',
      type: 'set-watchlist',
      value: nextWatchlist,
    })).resolves.toEqual({
      id: 'set-watchlist-1',
      ok: true,
      value: { acknowledged: true },
    });
    await expect(dispatchRequest(target, {
      id: 'set-settings-1',
      type: 'set-settings',
      value: nextSettings,
    })).resolves.toEqual({
      id: 'set-settings-1',
      ok: true,
      value: { acknowledged: true },
    });

    expect(store.setWatchlist).toHaveBeenCalledWith(nextWatchlist);
    expect(store.setSettings).toHaveBeenCalledWith(nextSettings);
    cleanup();
  });

  it('does not listen or respond on a URL outside the approved origin and base path', async () => {
    const target = new EventTarget();
    const store = createStore();
    const response = vi.fn();
    target.addEventListener(BRIDGE_RESPONSE_EVENT, response);
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar-evil/page',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, {
      detail: JSON.stringify({ id: 'denied-1', type: 'bootstrap' }),
    }));
    await flushAsyncWork();

    expect(response).not.toHaveBeenCalled();
    expect(store.listSnapshots).not.toHaveBeenCalled();
    cleanup();
  });

  it('rejects unknown and malformed requests with safe fixed errors', async () => {
    const target = new EventTarget();
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    await expect(dispatchRequest(target, {
      id: 'unknown-1',
      type: 'delete-gm-key',
      key: 'private-storage-key',
    })).resolves.toEqual({
      id: 'unknown-1',
      ok: false,
      error: { code: 'unsupported_request', message: 'Unsupported bridge request' },
    });
    await expect(dispatchRequest(target, {
      id: 'invalid-1',
      type: 'bootstrap',
      extra: 'private payload',
    })).resolves.toEqual({
      id: 'invalid-1',
      ok: false,
      error: { code: 'invalid_request', message: 'Invalid bridge request' },
    });
    await expect(dispatchRequest(target, {
      id: 'invalid-2',
      type: 'set-settings',
    })).resolves.toEqual({
      id: 'invalid-2',
      ok: false,
      error: { code: 'invalid_request', message: 'Invalid bridge request' },
    });
    await expect(dispatchRequest(target, {
      id: 'invalid-3',
      type: 'snapshots',
      beforeTimestamp: null,
      limit: 25,
    })).resolves.toEqual({
      id: 'invalid-3',
      ok: false,
      error: { code: 'invalid_request', message: 'Invalid bridge request' },
    });
    await expect(dispatchRequest(target, {
      id: 'invalid-4',
      type: 'set-watchlist',
      value: { key: '/items/test::0' },
    })).resolves.toEqual({
      id: 'invalid-4',
      ok: false,
      error: { code: 'invalid_request', message: 'Invalid bridge request' },
    });
    await expect(dispatchRequest(target, {
      id: 'invalid-5',
      type: 'set-settings',
      value: [],
    })).resolves.toEqual({
      id: 'invalid-5',
      ok: false,
      error: { code: 'invalid_request', message: 'Invalid bridge request' },
    });
    const responses = vi.fn();
    target.addEventListener(BRIDGE_RESPONSE_EVENT, responses);
    target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: '{not-json' }));
    await flushAsyncWork();
    expect(responses).not.toHaveBeenCalled();
    cleanup();
  });

  it('accepts a foreign-realm CustomEvent carrying a serialized null-prototype payload', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const ForeignCustomEvent = (frame.contentWindow as (Window & typeof globalThis) | null)?.CustomEvent;
    expect(ForeignCustomEvent).toBeDefined();
    const target = new EventTarget();
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });
    const response = new Promise<BridgeResponse>((resolve) => {
      target.addEventListener(BRIDGE_RESPONSE_EVENT, (event) => {
        expect(event.type).toBe(BRIDGE_RESPONSE_EVENT);
        expect(typeof (event as CustomEvent<unknown>).detail).toBe('string');
        resolve(JSON.parse((event as CustomEvent<string>).detail) as BridgeResponse);
      });
    });
    const payload = Object.create(null) as Record<string, unknown>;
    payload.id = 'foreign-1';
    payload.type = 'bootstrap';
    target.dispatchEvent(new ForeignCustomEvent!(BRIDGE_REQUEST_EVENT, {
      detail: JSON.stringify(payload),
    }));

    await expect(response).resolves.toMatchObject({ id: 'foreign-1', ok: true });
    cleanup();
    frame.remove();
  });

  it('sanitizes storage failures without returning the original error or value', async () => {
    const target = new EventTarget();
    const privateMessage = 'private storage detail and payload';
    const store = createStore({
      listSnapshots: vi.fn().mockRejectedValue(new Error(privateMessage)),
    });
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    const response = await dispatchRequest(target, {
      id: 'storage-1',
      type: 'snapshots',
      beforeTimestamp: null,
      limit: 12,
    });

    expect(response).toEqual({
      id: 'storage-1',
      ok: false,
      error: { code: 'storage_error', message: 'Market data storage unavailable' },
    });
    expect(JSON.stringify(response)).not.toContain(privateMessage);
    cleanup();
  });

  it('removes the listener during cleanup', async () => {
    const target = new EventTarget();
    const removeEventListener = vi.spyOn(target, 'removeEventListener');
    const store = createStore();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    cleanup();
    target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, {
      detail: JSON.stringify({ id: 'after-cleanup', type: 'snapshots', beforeTimestamp: null, limit: 12 }),
    }));
    await flushAsyncWork();

    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(store.listSnapshots).not.toHaveBeenCalled();
  });

  it('does not dispatch an in-flight response after cleanup', async () => {
    const target = new EventTarget();
    const response = vi.fn();
    target.addEventListener(BRIDGE_RESPONSE_EVENT, response);
    let resolveSnapshots!: (value: Snapshot[]) => void;
    const store = createStore({
      listSnapshots: vi.fn(() => new Promise<Snapshot[]>((resolve) => {
        resolveSnapshots = resolve;
      })),
    });
    const cleanup = installDashboardBridge({
      target,
      currentUrl: 'https://example.test/radar',
      allowedBaseUrls: ['https://example.test/radar'],
      store,
    });

    target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, {
      detail: JSON.stringify({ id: 'inflight-1', type: 'snapshots', beforeTimestamp: null, limit: 12 }),
    }));
    await flushAsyncWork();
    cleanup();
    resolveSnapshots(snapshots);
    await flushAsyncWork();

    expect(response).not.toHaveBeenCalled();
  });
});
