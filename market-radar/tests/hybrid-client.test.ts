import { describe, expect, it, vi } from 'vitest';
import type { BridgeBootstrap, RadarSettings, Snapshot, WatchItem } from '../src/core/types';
import type { DashboardClient } from '../src/dashboard/client';
import { DEFAULT_SETTINGS, MemoryPreferencesStore } from '../src/dashboard/preferences-store';
import {
  HybridMarketError,
  createHybridClient,
  type HybridCloudClient,
} from '../src/dashboard/hybrid-client';

const SETTINGS: RadarSettings = {
  period: '1d',
  minimumVolume: 0,
  maximumSpreadPct: null,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};
const KEY = '/items/test::0';

function snapshot(timestamp: number, price: number): Snapshot {
  return { timestamp, quotes: { [KEY]: { a: price + 1, b: price - 1, p: price, v: 1 } } };
}

function localBootstrap(snapshots: Snapshot[]): BridgeBootstrap {
  return {
    watchlist: [{ key: '/items/local::0', order: 0 }],
    settings: SETTINGS,
    collectorStatus: {
      state: 'ok',
      lastAttemptAt: null,
      lastSuccessAt: null,
      officialTimestamp: snapshots.at(-1)?.timestamp ?? null,
      nextRunAt: null,
      lastErrorCode: null,
    },
    latestTimestamp: snapshots.at(-1)?.timestamp ?? null,
    snapshotCount: snapshots.length,
  };
}

function localClient(snapshots: Snapshot[]): DashboardClient {
  return {
    bootstrap: vi.fn().mockResolvedValue(localBootstrap(snapshots)),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    setWatchlist: vi.fn().mockResolvedValue(undefined),
    setSettings: vi.fn().mockResolvedValue(undefined),
  };
}

function cloudClient(snapshots: Snapshot[], overrides: Partial<HybridCloudClient> = {}): HybridCloudClient {
  return {
    load: vi.fn().mockResolvedValue({
      snapshots,
      latestTimestamp: snapshots.at(-1)?.timestamp ?? null,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
    }),
    refresh: vi.fn().mockResolvedValue({
      snapshots,
      latestTimestamp: snapshots.at(-1)?.timestamp ?? null,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
    }),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    getSourceInfo: vi.fn().mockReturnValue({ stale: false, warningCode: null }),
    ...overrides,
  };
}

describe('hybrid dashboard client', () => {
  it('uses cloud as primary and merges local-only snapshots while cloud wins equal timestamps', async () => {
    const cloud = cloudClient([snapshot(100, 200), snapshot(300, 300)]);
    const local = localClient([snapshot(100, 999), snapshot(200, 250)]);
    const preferences = new MemoryPreferencesStore();
    const client = createHybridClient({ cloud, local, preferences });

    const loaded = await client.listSnapshots();

    expect(loaded).toEqual([snapshot(100, 200), snapshot(200, 250), snapshot(300, 300)]);
    await expect(client.bootstrap()).resolves.toMatchObject({ source: 'cloud+local' });
    expect((await client.bootstrap()).watchlist).toEqual([]);
  });

  it('falls back to local snapshots when cloud fails and exposes safe source metadata', async () => {
    const cloud = cloudClient([], {
      load: vi.fn().mockRejectedValue(new Error('private cloud payload')),
      listSnapshots: vi.fn().mockRejectedValue(new Error('private cloud payload')),
    });
    const local = localClient([snapshot(200, 250)]);
    const client = createHybridClient({ cloud, local, preferences: new MemoryPreferencesStore() });

    await expect(client.listSnapshots()).resolves.toEqual([snapshot(200, 250)]);
    const bootstrap = await client.bootstrap();
    expect(bootstrap.source).toBe('local-fallback');
    expect(JSON.stringify(bootstrap)).not.toContain('private cloud payload');
  });

  it('keeps cloud data when local fails and throws typed no-data when both fail', async () => {
    const cloud = cloudClient([snapshot(300, 300)]);
    const local = localClient([]);
    (local.listSnapshots as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('private local payload'));
    (local.bootstrap as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('private local payload'));
    const client = createHybridClient({ cloud, local, preferences: new MemoryPreferencesStore() });

    await expect(client.listSnapshots()).resolves.toEqual([snapshot(300, 300)]);
    expect((await client.bootstrap()).source).toBe('cloud');

    const failedCloud = cloudClient([], {
      load: vi.fn().mockRejectedValue(new Error('private cloud payload')),
      listSnapshots: vi.fn().mockRejectedValue(new Error('private cloud payload')),
    });
    const failedLocal = localClient([]);
    (failedLocal.bootstrap as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('private local payload'));
    (failedLocal.listSnapshots as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('private local payload'));
    const failed = createHybridClient({ cloud: failedCloud, local: failedLocal, preferences: new MemoryPreferencesStore() });
    const error = await failed.listSnapshots().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HybridMarketError);
    expect((error as HybridMarketError).code).toBe('no_data');
    expect((error as Error).message).not.toContain('private');
  });

  it('uses preferences exclusively for watchlist/settings and does not delegate writes to local', async () => {
    const local = localClient([]);
    const preferences = new MemoryPreferencesStore();
    const client = createHybridClient({ cloud: cloudClient([]), local, preferences });
    const value: WatchItem[] = [{ key: '/items/preferred::7', order: 0 }];

    await client.setWatchlist(value);
    await client.setSettings({ ...DEFAULT_SETTINGS, period: '3d' });
    await expect(client.bootstrap()).resolves.toMatchObject({ watchlist: value, settings: { period: '3d' } });
    expect(local.setWatchlist).not.toHaveBeenCalled();
    expect(local.setSettings).not.toHaveBeenCalled();
  });

  it('refreshes cloud/local snapshots without rereading preferences', async () => {
    const cloud = cloudClient([snapshot(100, 100)]);
    const local = localClient([snapshot(100, 100)]);
    const preferences = new MemoryPreferencesStore({ watchlist: [{ key: '/items/pinned::0', order: 0 }] });
    const client = createHybridClient({ cloud, local, preferences });

    await client.bootstrap();
    await client.refresh();
    await expect(client.listSnapshots()).resolves.toEqual([snapshot(100, 100)]);
    expect(cloud.refresh).toHaveBeenCalledTimes(1);
    expect(local.bootstrap).toHaveBeenCalledTimes(2);
    expect(local.listSnapshots).toHaveBeenCalledTimes(2);
    await expect(client.bootstrap()).resolves.toMatchObject({ watchlist: [{ key: '/items/pinned::0', order: 0 }] });
  });

  it('reports the merged snapshot latest while preserving the cloud latest in source metadata', async () => {
    const cloud = cloudClient([snapshot(100, 100)]);
    const local = localClient([snapshot(100, 999), snapshot(200, 200)]);
    const client = createHybridClient({ cloud, local, preferences: new MemoryPreferencesStore() });

    const bootstrap = await client.bootstrap();

    expect(bootstrap.latestTimestamp).toBe(200);
    expect(bootstrap.sourceInfo).toMatchObject({ source: 'cloud+local', latestTimestamp: 100 });
    expect(bootstrap.collectorStatus.officialTimestamp).toBe(100);
  });

  it('commits only the latest refresh generation when an older refresh resolves last', async () => {
    let resolveFirstCloud!: (value: Awaited<ReturnType<HybridCloudClient['load']>>) => void;
    let resolveSecondCloud!: (value: Awaited<ReturnType<HybridCloudClient['load']>>) => void;
    const firstCloud = new Promise<Awaited<ReturnType<HybridCloudClient['load']>>>((resolve) => {
      resolveFirstCloud = resolve;
    });
    const secondCloud = new Promise<Awaited<ReturnType<HybridCloudClient['load']>>>((resolve) => {
      resolveSecondCloud = resolve;
    });
    const cloud = cloudClient([], {
      refresh: vi.fn()
        .mockReturnValueOnce(firstCloud)
        .mockReturnValueOnce(secondCloud),
    });
    const local = localClient([]);
    const client = createHybridClient({ cloud, local, preferences: new MemoryPreferencesStore() });
    const first = client.refresh();
    const second = client.refresh();
    resolveSecondCloud({
      snapshots: [snapshot(200, 200)],
      latestTimestamp: 200,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
    });
    resolveFirstCloud({
      snapshots: [snapshot(100, 100)],
      latestTimestamp: 100,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
    });

    await Promise.all([first, second]);
    await expect(client.listSnapshots()).resolves.toEqual([snapshot(200, 200)]);
  });

  it('does not commit a caller-aborted refresh when local promises cannot be cancelled', async () => {
    let resolveCloud!: (value: Awaited<ReturnType<HybridCloudClient['load']>>) => void;
    let resolveLocal!: (value: Snapshot[]) => void;
    const cloud = cloudClient([], {
      refresh: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveCloud = resolve;
      })),
    });
    const local = localClient([]);
    (local.listSnapshots as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((resolve) => {
      resolveLocal = resolve;
    }));
    const client = createHybridClient({ cloud, local, preferences: new MemoryPreferencesStore() });
    const controller = new AbortController();
    const pending = client.refresh({ signal: controller.signal }).catch((cause: unknown) => cause);
    controller.abort();
    resolveCloud({
      snapshots: [snapshot(300, 300)],
      latestTimestamp: 300,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
    });
    resolveLocal([snapshot(300, 999)]);

    const error = await pending;
    expect(error).toMatchObject({ code: 'cancelled' });
    expect(client.getSourceInfo().latestTimestamp).toBeNull();
  });

  it('clears an aborted active operation so a new bootstrap does not wait for a hung local read', async () => {
    let resolveCloud!: (value: Awaited<ReturnType<HybridCloudClient['load']>>) => void;
    const cloud = cloudClient([snapshot(200, 200)], {
      refresh: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveCloud = resolve;
      })),
    });
    const local = localClient([]);
    let localReads = 0;
    (local.listSnapshots as ReturnType<typeof vi.fn>).mockImplementation(() => {
      localReads += 1;
      return localReads === 1 ? new Promise<Snapshot[]>(() => undefined) : Promise.resolve([]);
    });
    const client = createHybridClient({ cloud, local, preferences: new MemoryPreferencesStore() });
    const controller = new AbortController();
    const aborted = client.refresh({ signal: controller.signal }).catch((cause: unknown) => cause);
    controller.abort();

    const next = client.bootstrap();
    const result = await Promise.race([
      next.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);

    expect(result).toBe(true);
    await expect(aborted).resolves.toMatchObject({ code: 'cancelled' });
    resolveCloud({
      snapshots: [snapshot(100, 100)],
      latestTimestamp: 100,
      generatedAt: '2026-09-01T12:09:00.000Z',
      stale: false,
      warningCode: null,
    });
  });
});
