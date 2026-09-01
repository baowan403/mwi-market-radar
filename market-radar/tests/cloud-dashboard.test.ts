// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeBootstrap,
  CatalogData,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../src/core/types';
import type { DashboardClient } from '../src/dashboard/client';
import type { PreferencesStore } from '../src/dashboard/preferences-store';
import { MemoryPreferencesStore } from '../src/dashboard/preferences-store';
import { mountDashboard } from '../src/app';
import type { CloudMarketData } from '../src/dashboard/cloud-client';
import type { HybridCloudClient } from '../src/dashboard/hybrid-client';

const KEY = '/items/alpha::0';
const SETTINGS: RadarSettings = {
  period: '1d',
  minimumVolume: 0,
  maximumSpreadPct: null,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};
const CATALOG: CatalogData = {
  categories: [{ hrid: '/item_categories/resource', name: '資源', sortIndex: 1 }],
  items: [{ hrid: '/items/alpha', name: 'Alpha Ore', categoryHrid: '/item_categories/resource', sortIndex: 1 }],
};

function snapshot(timestamp: number, price: number, volume = 10): Snapshot {
  return { timestamp, quotes: { [KEY]: { a: price + 1, b: price - 1, p: price, v: volume } } };
}

function status(timestamp: number): CollectorStatus {
  return {
    state: 'ok',
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    officialTimestamp: timestamp,
    nextRunAt: null,
    lastErrorCode: null,
  };
}

function cloudData(snapshots: Snapshot[], overrides: Partial<CloudMarketData> = {}): CloudMarketData {
  const latestTimestamp = snapshots.at(-1)?.timestamp ?? null;
  return {
    snapshots,
    latestTimestamp,
    generatedAt: '2026-09-01T12:09:00.000Z',
    stale: false,
    warningCode: null,
    warning: null,
    ...overrides,
  };
}

function cloudClient(
  snapshots: Snapshot[],
  overrides: Partial<HybridCloudClient> = {},
): HybridCloudClient {
  const result = (): CloudMarketData => cloudData(snapshots);
  return {
    load: vi.fn().mockImplementation(async () => result()),
    refresh: vi.fn().mockImplementation(async () => result()),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    getSourceInfo: vi.fn().mockReturnValue({
      latestTimestamp: snapshots.at(-1)?.timestamp ?? null,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
      warning: null,
    }),
    ...overrides,
  };
}

function localClient(snapshots: Snapshot[]): DashboardClient {
  const latestTimestamp = snapshots.at(-1)?.timestamp ?? null;
  const bootstrap: BridgeBootstrap = {
    watchlist: [],
    settings: SETTINGS,
    collectorStatus: latestTimestamp === null ? { ...status(0), officialTimestamp: null } : status(latestTimestamp),
    latestTimestamp,
    snapshotCount: snapshots.length,
  };
  return {
    bootstrap: vi.fn().mockResolvedValue(bootstrap),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    setWatchlist: vi.fn().mockResolvedValue(undefined),
    setSettings: vi.fn().mockResolvedValue(undefined),
  };
}

function createRoot(): HTMLElement {
  document.body.innerHTML = '<main id="app"></main>';
  return document.querySelector<HTMLElement>('#app') as HTMLElement;
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error?: unknown): void } {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('cloud dashboard provider', () => {
  it('renders valid cloud data immediately without waiting for the local bridge', async () => {
    const root = createRoot();
    const target = document.createElement('div');
    const waiter = vi.fn(() => new Promise<boolean>(() => undefined));
    const started = Date.now();

    const handle = await mountDashboard({
      root,
      bridgeTarget: target,
      cloudClient: cloudClient([snapshot(1_000, 10)]),
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: waiter,
    });

    expect(Date.now() - started).toBeLessThan(500);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')).not.toBeNull();
    expect(root.querySelector('[data-source="cloud"] [data-source-label]')?.textContent).toContain('雲端共同行情');
    handle.destroy();
  });

  it('attaches a late local bridge in the background and merges local-only snapshots', async () => {
    const root = createRoot();
    const target = document.createElement('div');
    const local = localClient([snapshot(1_000, 99), snapshot(2_000, 20)]);
    const createLocalClient = vi.fn(() => local);
    const handle = await mountDashboard({
      root,
      bridgeTarget: target,
      cloudClient: cloudClient([snapshot(1_000, 10)]),
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn().mockResolvedValue(true),
      createLocalClient,
    });

    await flushAsyncWork();
    expect(createLocalClient).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-source="cloud+local"] [data-source-label]')?.textContent).toContain('雲端＋本機備援');
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')).not.toBeNull();
    handle.destroy();
  });

  it('uses local fallback after cloud failure when the bridge is ready', async () => {
    const root = createRoot();
    const local = localClient([snapshot(1_000, 10)]);
    const cloud = cloudClient([], {
      load: vi.fn().mockRejectedValue(new Error('cloud unavailable')),
      refresh: vi.fn().mockRejectedValue(new Error('cloud unavailable')),
    });

    const handle = await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloud,
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn().mockResolvedValue(true),
      createLocalClient: vi.fn(() => local),
    });

    expect(root.querySelector('[data-source="local-fallback"] [data-source-label]')?.textContent).toContain('本機備援');
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')).not.toBeNull();
    handle.destroy();
  });

  it('shows unavailable with zero rows when both cloud and local sources fail', async () => {
    const root = createRoot();
    const cloud = cloudClient([], {
      load: vi.fn().mockRejectedValue(new Error('cloud unavailable')),
      refresh: vi.fn().mockRejectedValue(new Error('cloud unavailable')),
    });

    await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloud,
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn().mockResolvedValue(false),
    });

    expect(root.querySelector('[data-source="unavailable"] [data-source-label]')?.textContent).toContain('資料不可用');
    expect(root.querySelector('[data-market-row]')).toBeNull();
  });

  it('runs one manual cloud refresh, disables the button, and updates rows on success', async () => {
    const root = createRoot();
    const refreshResult = deferred<CloudMarketData>();
    const cloud = cloudClient([snapshot(1_000, 10)], {
      refresh: vi.fn().mockReturnValue(refreshResult.promise),
    });
    const handle = await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloud,
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn(() => new Promise<boolean>(() => undefined)),
    });
    const refresh = root.querySelector<HTMLButtonElement>('[data-cloud-refresh]');
    expect(refresh).not.toBeNull();

    refresh?.click();
    refresh?.click();
    expect(cloud.refresh).toHaveBeenCalledTimes(1);
    expect(refresh?.disabled).toBe(true);
    expect(refresh?.getAttribute('aria-busy')).toBe('true');

    refreshResult.resolve(cloudData([snapshot(2_000, 20)]));
    await flushAsyncWork();
    expect(refresh?.disabled).toBe(false);
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')?.textContent).toContain('20');
    handle.destroy();
  });

  it('retains old rows and shows a safe warning when manual refresh fails', async () => {
    const root = createRoot();
    const cloud = cloudClient([snapshot(1_000, 10)], {
      refresh: vi.fn().mockRejectedValue(new Error('private cloud payload')),
    });
    const handle = await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloud,
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn(() => new Promise<boolean>(() => undefined)),
    });

    root.querySelector<HTMLButtonElement>('[data-cloud-refresh]')?.click();
    await flushAsyncWork();
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')?.textContent).toContain('10');
    expect(root.textContent).toContain('市場資料更新失敗');
    expect(root.textContent).not.toContain('private cloud payload');
    handle.destroy();
  });

  it('polls cloud metadata without rebuilding unchanged rows and refreshes new data', async () => {
    const root = createRoot();
    let current = [snapshot(1_000, 10)];
    const cloud = cloudClient(current, {
      refresh: vi.fn().mockImplementation(async () => cloudData(current)),
    });
    let poll!: () => void;
    const handle = await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloud,
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn(() => new Promise<boolean>(() => undefined)),
      setInterval: vi.fn((callback: () => void) => {
        poll = callback;
        return 1;
      }),
      clearInterval: vi.fn(),
    });
    const table = root.querySelector('table');
    poll();
    await flushAsyncWork();
    expect(root.querySelector('table')).toBe(table);

    current = [snapshot(2_000, 20)];
    poll();
    await flushAsyncWork();
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')?.textContent).toContain('20');
    handle.destroy();
  });

  it('renders a stale cloud source label and aborts in-flight refresh on destroy', async () => {
    const root = createRoot();
    const refreshResult = deferred<CloudMarketData>();
    const cloud = cloudClient([snapshot(1_000, 10)], {
      refresh: vi.fn().mockReturnValue(refreshResult.promise),
    });
    const handle = await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloud,
      preferencesStore: new MemoryPreferencesStore(),
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn(() => new Promise<boolean>(() => undefined)),
    });
    root.querySelector<HTMLButtonElement>('[data-cloud-refresh]')?.click();
    handle.destroy();
    refreshResult.resolve(cloudData([snapshot(2_000, 20)], { stale: true, warningCode: 'cloud_stale' }));
    await flushAsyncWork();

    expect(root.querySelector('[data-market-row="/items/alpha::0"]')?.textContent).toContain('10');
  });

  it('writes cloud-mode watchlist changes through the preference store only', async () => {
    const root = createRoot();
    const preferences: PreferencesStore = {
      getWatchlist: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue(SETTINGS),
      setWatchlist: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(undefined),
    };
    const handle = await mountDashboard({
      root,
      bridgeTarget: document.createElement('div'),
      cloudClient: cloudClient([snapshot(1_000, 10)]),
      preferencesStore: preferences,
      catalogLoader: vi.fn().mockResolvedValue(CATALOG),
      waitForBridgeReady: vi.fn(() => new Promise<boolean>(() => undefined)),
    });
    root.querySelector<HTMLButtonElement>('[data-pin]')?.click();
    await flushAsyncWork();

    expect(preferences.setWatchlist).toHaveBeenCalledWith([{ key: KEY, order: 0 }]);
    expect(preferences.setSettings).not.toHaveBeenCalled();
    handle.destroy();
  });
});
