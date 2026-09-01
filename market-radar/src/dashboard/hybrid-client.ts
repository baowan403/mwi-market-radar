import type {
  BridgeBootstrap,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../core/types';
import type { DashboardClient } from './client';
import type { PreferencesStore } from './preferences-store';
import type {
  CloudClient,
  CloudMarketData,
  CloudRequestOptions,
  CloudSourceInfo,
} from './cloud-client';

export type HybridSource = 'cloud' | 'cloud+local' | 'local-fallback';

export interface HybridSourceInfo {
  source: HybridSource;
  stale: boolean;
  warningCode: 'cloud_stale' | null;
  warning?: string | null;
  generatedAt: string | null;
  latestTimestamp: number | null;
}

export interface HybridBootstrap extends BridgeBootstrap {
  source: HybridSource;
  sourceInfo: HybridSourceInfo;
}

export interface HybridCloudClient extends CloudClient {}

export interface HybridClientOptions {
  cloud: HybridCloudClient;
  local?: DashboardClient;
  preferences: PreferencesStore;
}

export interface HybridRefreshOptions {
  signal?: AbortSignal;
}

export interface HybridClient extends DashboardClient {
  bootstrap(): Promise<HybridBootstrap>;
  refresh(options?: HybridRefreshOptions): Promise<HybridBootstrap>;
  getSourceInfo(): HybridSourceInfo;
}

export type HybridMarketErrorCode = 'no_data' | 'preferences';

const HYBRID_ERROR_MESSAGES: Record<HybridMarketErrorCode, string> = {
  no_data: 'No market data source is available',
  preferences: 'Dashboard preferences are unavailable',
};

export class HybridMarketError extends Error {
  readonly code: HybridMarketErrorCode;

  constructor(code: HybridMarketErrorCode) {
    super(HYBRID_ERROR_MESSAGES[code]);
    this.name = 'HybridMarketError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface HybridState {
  snapshots: Snapshot[];
  sourceInfo: HybridSourceInfo;
  collectorStatus: CollectorStatus;
}

function latestTimestamp(snapshots: readonly Snapshot[]): number | null {
  return snapshots.reduce<number | null>((latest, snapshot) => (
    latest === null || snapshot.timestamp > latest ? snapshot.timestamp : latest
  ), null);
}

function mergeSnapshots(
  cloudSnapshots: readonly Snapshot[],
  localSnapshots: readonly Snapshot[],
): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of localSnapshots) byTimestamp.set(snapshot.timestamp, snapshot);
  for (const snapshot of cloudSnapshots) byTimestamp.set(snapshot.timestamp, snapshot);
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function cloudSourceInfo(data: CloudMarketData): HybridSourceInfo {
  return {
    source: 'cloud',
    stale: data.stale,
    warningCode: data.warningCode,
    warning: data.warning,
    generatedAt: data.generatedAt,
    latestTimestamp: data.latestTimestamp,
  };
}

function emptyCloudSourceInfo(): CloudSourceInfo {
  return {
    latestTimestamp: null,
    generatedAt: null,
    stale: false,
    warningCode: null,
    warning: null,
  };
}

function statusFromSource(
  sourceInfo: HybridSourceInfo,
  fallbackStatus: CollectorStatus | null,
): CollectorStatus {
  const generatedAt = sourceInfo.generatedAt === null ? null : Date.parse(sourceInfo.generatedAt);
  if (sourceInfo.source !== 'local-fallback') {
    return {
      state: 'ok',
      lastAttemptAt: generatedAt !== null && Number.isFinite(generatedAt) ? generatedAt : null,
      lastSuccessAt: generatedAt !== null && Number.isFinite(generatedAt) ? generatedAt : null,
      officialTimestamp: sourceInfo.latestTimestamp,
      nextRunAt: null,
      lastErrorCode: null,
    };
  }
  if (fallbackStatus !== null) return { ...fallbackStatus, nextRunAt: null };
  return {
    state: 'ok',
    lastAttemptAt: null,
    lastSuccessAt: null,
    officialTimestamp: null,
    nextRunAt: null,
    lastErrorCode: null,
  };
}

export function createHybridClient(options: HybridClientOptions): HybridClient {
  let state: HybridState | null = null;
  let loadPromise: Promise<HybridState> | null = null;
  let preferencesPromise: Promise<{ watchlist: WatchItem[]; settings: RadarSettings }> | null = null;
  let preferences: { watchlist: WatchItem[]; settings: RadarSettings } | null = null;

  const loadPreferences = async (): Promise<{ watchlist: WatchItem[]; settings: RadarSettings }> => {
    if (preferences !== null) return preferences;
    if (preferencesPromise !== null) return preferencesPromise;
    const pending = Promise.all([
      options.preferences.getWatchlist(),
      options.preferences.getSettings(),
    ]).then(([watchlist, settings]) => {
      preferences = { watchlist: [...watchlist], settings: { ...settings } };
      return preferences;
    }).catch(() => {
      throw new HybridMarketError('preferences');
    });
    preferencesPromise = pending;
    try {
      return await pending;
    } finally {
      if (preferencesPromise === pending) preferencesPromise = null;
    }
  };

  const loadData = async (
    force: boolean,
    signal?: AbortSignal,
  ): Promise<HybridState> => {
    if (!force && state !== null) return state;
    if (!force && loadPromise !== null) return loadPromise;

    const cloudRequest: CloudRequestOptions = signal === undefined ? {} : { signal };
    const safeCall = <T>(call: () => Promise<T>): Promise<T> => {
      try {
        return Promise.resolve(call());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const cloudPromise = safeCall(() => force
      ? options.cloud.refresh(cloudRequest)
      : options.cloud.load(cloudRequest));
    const localListPromise = options.local === undefined
      ? Promise.reject(new Error('local unavailable'))
      : safeCall(() => options.local!.listSnapshots());
    const localBootstrapPromise = options.local === undefined
      ? Promise.reject(new Error('local unavailable'))
      : safeCall(() => options.local!.bootstrap());
    const pending = Promise.allSettled([
      cloudPromise,
      localListPromise,
      localBootstrapPromise,
    ]).then(([cloudResult, localListResult, localBootstrapResult]) => {
      const cloudData = cloudResult.status === 'fulfilled' ? cloudResult.value : null;
      const localSnapshots = localListResult.status === 'fulfilled' ? localListResult.value : null;
      const localBootstrap = localBootstrapResult.status === 'fulfilled' ? localBootstrapResult.value : null;
      if (cloudData === null && localSnapshots === null) throw new HybridMarketError('no_data');

      let snapshots: Snapshot[];
      let sourceInfo: HybridSourceInfo;
      if (cloudData !== null) {
        snapshots = localSnapshots === null ? [...cloudData.snapshots] : mergeSnapshots(cloudData.snapshots, localSnapshots);
        const hasLocalExtra = localSnapshots !== null
          && localSnapshots.some((snapshot) => !cloudData.snapshots.some((cloudSnapshot) => cloudSnapshot.timestamp === snapshot.timestamp));
        sourceInfo = {
          ...cloudSourceInfo(cloudData),
          source: hasLocalExtra ? 'cloud+local' : 'cloud',
        };
      } else {
        snapshots = [...localSnapshots!].sort((left, right) => left.timestamp - right.timestamp);
        const localLatest = latestTimestamp(snapshots);
        sourceInfo = {
          source: 'local-fallback',
          stale: false,
          warningCode: null,
          warning: null,
          generatedAt: null,
          latestTimestamp: localLatest,
        };
      }

      const collectorStatus = statusFromSource(
        sourceInfo,
        localBootstrap?.collectorStatus ?? null,
      );
      const nextState: HybridState = { snapshots, sourceInfo, collectorStatus };
      state = nextState;
      return nextState;
    });
    loadPromise = pending;
    try {
      return await pending;
    } finally {
      if (loadPromise === pending) loadPromise = null;
    }
  };

  const bootstrap = async (): Promise<HybridBootstrap> => {
    const [nextState, nextPreferences] = await Promise.all([loadData(false), loadPreferences()]);
    return {
      watchlist: [...nextPreferences.watchlist],
      settings: { ...nextPreferences.settings },
      collectorStatus: { ...nextState.collectorStatus },
      latestTimestamp: nextState.sourceInfo.latestTimestamp ?? latestTimestamp(nextState.snapshots),
      snapshotCount: nextState.snapshots.length,
      source: nextState.sourceInfo.source,
      sourceInfo: { ...nextState.sourceInfo },
    };
  };

  return {
    bootstrap,
    listSnapshots: async () => [...(await loadData(false)).snapshots],
    setWatchlist: async (value) => {
      await options.preferences.setWatchlist(value);
      const nextPreferences = await loadPreferences();
      nextPreferences.watchlist = [...value];
      preferences = nextPreferences;
    },
    setSettings: async (value) => {
      await options.preferences.setSettings(value);
      const nextPreferences = await loadPreferences();
      nextPreferences.settings = { ...value };
      preferences = nextPreferences;
    },
    refresh: async (requestOptions = {}) => {
      const nextState = await loadData(true, requestOptions.signal);
      const nextPreferences = await loadPreferences();
      return {
        watchlist: [...nextPreferences.watchlist],
        settings: { ...nextPreferences.settings },
        collectorStatus: { ...nextState.collectorStatus },
        latestTimestamp: nextState.sourceInfo.latestTimestamp ?? latestTimestamp(nextState.snapshots),
        snapshotCount: nextState.snapshots.length,
        source: nextState.sourceInfo.source,
        sourceInfo: { ...nextState.sourceInfo },
      };
    },
    getSourceInfo: () => ({
      ...(state?.sourceInfo ?? {
        ...emptyCloudSourceInfo(),
        source: 'cloud',
      }),
    }),
  };
}

export const createHybridDashboardClient = createHybridClient;
