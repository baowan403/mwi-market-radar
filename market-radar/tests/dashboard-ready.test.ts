// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CatalogData,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../src/core/types';
import { mountDashboard } from '../src/app';
import { installDashboardBridge, type DashboardBridgeStore } from '../src/userscript/dashboard-bridge';

const catalog: CatalogData = {
  categories: [{ hrid: '/item_categories/resource', name: '資源', sortIndex: 1 }],
  items: [{ hrid: '/items/alpha', name: 'Alpha Ore', categoryHrid: '/item_categories/resource', sortIndex: 1 }],
};

const snapshot: Snapshot = {
  timestamp: 1_000,
  quotes: { '/items/alpha::0': { a: 11, b: 9, p: 10, v: 2 } },
};

const settings: RadarSettings = {
  period: '1d',
  minimumVolume: 0,
  maximumSpreadPct: null,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};

const collectorStatus: CollectorStatus = {
  state: 'ok',
  lastAttemptAt: 1_000,
  lastSuccessAt: 1_000,
  officialTimestamp: 1_000,
  nextRunAt: 2_000,
  lastErrorCode: null,
};

function createStore(): DashboardBridgeStore {
  return {
    listSnapshots: vi.fn().mockResolvedValue([snapshot]),
    getWatchlist: vi.fn().mockResolvedValue([] as WatchItem[]),
    setWatchlist: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    setSettings: vi.fn().mockResolvedValue(undefined),
    getCollectorStatus: vi.fn().mockResolvedValue(collectorStatus),
  };
}

function createRoot(): HTMLElement {
  document.body.innerHTML = '<main id="app"></main>';
  return document.querySelector<HTMLElement>('#app') as HTMLElement;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('dashboard bridge ready handshake', () => {
  it('waits for a late DOM bridge marker before starting client requests', async () => {
    const root = createRoot();
    const target = document.createElement('div');
    const store = createStore();
    const mountPromise = mountDashboard({
      root,
      bridgeTarget: target,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      pollMs: 60_000,
    });

    await Promise.resolve();
    expect(target.dataset.mwiRadarBridge).toBeUndefined();
    const cleanup = installDashboardBridge({
      target,
      currentUrl: window.location.origin,
      allowedBaseUrls: [window.location.origin],
      store,
    });

    const handle = await mountPromise;
    expect(root.querySelector('[data-market-row="/items/alpha::0"]')).not.toBeNull();
    expect(store.listSnapshots).toHaveBeenCalledTimes(1);
    handle.destroy();
    cleanup();
  });

  it('uses the existing missing-bridge state after a bounded ready timeout', async () => {
    const root = createRoot();
    const target = document.createElement('div');

    await mountDashboard({
      root,
      bridgeTarget: target,
      bridgeReadyTimeoutMs: 1,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
    });

    expect(root.textContent).toContain('尚未偵測到 MWI Market Radar 腳本');
    expect(root.querySelector('[data-market-row]')).toBeNull();
  });
});
