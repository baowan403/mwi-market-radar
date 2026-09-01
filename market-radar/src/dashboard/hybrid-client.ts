import type {
  BridgeBootstrap,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../core/types';
import type { DashboardClient } from './client';
import { DEFAULT_SETTINGS, type PreferencesStore } from './preferences-store';
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
  historySourceLabel: string | null;
  latestTimestamp: number | null;
}

export interface HybridBootstrap extends BridgeBootstrap {
  source: HybridSource;
  sourceInfo: HybridSourceInfo;
  preferencesWarning: 'preferences_unavailable' | null;
}

export interface HybridCloudClient extends CloudClient {}

export interface HybridClientOptions {
  cloud: HybridCloudClient;
  local?: DashboardClient;
  preferences: PreferencesStore;
}

export interface HybridRefreshOptions {
  signal?: AbortSignal;
  refreshDaily?: boolean;
}

export interface HybridClient extends DashboardClient {
  bootstrap(): Promise<HybridBootstrap>;
  refresh(options?: HybridRefreshOptions): Promise<HybridBootstrap>;
  setLocalClient(client: DashboardClient | undefined): void;
  getSourceInfo(): HybridSourceInfo;
  destroy(): void;
}

export type HybridMarketErrorCode = 'no_data' | 'preferences' | 'cancelled';

const HYBRID_ERROR_MESSAGES: Record<HybridMarketErrorCode, string> = {
  no_data: 'No market data source is available',
  preferences: 'Dashboard preferences are unavailable',
  cancelled: 'Hybrid market request cancelled',
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

interface HybridOperation {
  generation: number;
  controller: AbortController;
  promise: Promise<HybridState>;
  consumers: number;
  settled: boolean;
  cancelled: boolean;
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
    historySourceLabel: data.historySourceLabel ?? null,
    latestTimestamp: data.latestTimestamp,
  };
}

function emptyCloudSourceInfo(): CloudSourceInfo {
  return {
    latestTimestamp: null,
    generatedAt: null,
    historySourceLabel: null,
    stale: false,
    warningCode: null,
    warning: null,
  };
}

function statusFromSource(
  sourceInfo: HybridSourceInfo,
  fallbackStatus: CollectorStatus | null,
): CollectorStatus {
  if (sourceInfo.source !== 'local-fallback') {
    const latest = sourceInfo.latestTimestamp;
    return {
      state: 'ok',
      lastAttemptAt: latest,
      lastSuccessAt: latest,
      officialTimestamp: latest,
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
  let localClient = options.local;
  let state: HybridState | null = null;
  let activeOperation: HybridOperation | null = null;
  let generation = 0;
  let destroyed = false;
  let preferencesPromise: Promise<{
    watchlist: WatchItem[];
    settings: RadarSettings;
    warning: 'preferences_unavailable' | null;
  }> | null = null;
  let preferences: {
    watchlist: WatchItem[];
    settings: RadarSettings;
    warning: 'preferences_unavailable' | null;
  } | null = null;

  const loadPreferences = async (): Promise<{
    watchlist: WatchItem[];
    settings: RadarSettings;
    warning: 'preferences_unavailable' | null;
  }> => {
    if (preferences !== null && preferences.warning === null) return preferences;
    if (preferencesPromise !== null) return preferencesPromise;
    const pending = Promise.allSettled([
      options.preferences.getWatchlist(),
      options.preferences.getSettings(),
    ]).then(([watchlistResult, settingsResult]) => {
      const watchlist = watchlistResult.status === 'fulfilled' && Array.isArray(watchlistResult.value)
        ? [...watchlistResult.value]
        : [];
      const settings = settingsResult.status === 'fulfilled' && settingsResult.value !== null
        ? { ...settingsResult.value }
        : { ...DEFAULT_SETTINGS };
      const warning = watchlistResult.status === 'rejected' || settingsResult.status === 'rejected'
        ? 'preferences_unavailable' as const
        : null;
      preferences = { watchlist, settings, warning };
      return preferences;
    });
    preferencesPromise = pending;
    try {
      return await pending;
    } finally {
      if (preferencesPromise === pending) preferencesPromise = null;
    }
  };

  const safeCall = <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return Promise.resolve(call());
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const cancelOperation = (operation: HybridOperation): void => {
    if (operation.settled || operation.cancelled) return;
    operation.cancelled = true;
    if (activeOperation === operation) {
      generation += 1;
      activeOperation = null;
    }
    operation.controller.abort();
  };

  const attachOperation = (
    operation: HybridOperation,
    signal?: AbortSignal,
  ): Promise<HybridState> => {
    operation.consumers += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      operation.consumers -= 1;
      if (operation.consumers === 0 && !operation.settled) cancelOperation(operation);
    };
    if (signal?.aborted) {
      release();
      return Promise.reject(new HybridMarketError('cancelled'));
    }
    return new Promise<HybridState>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        release();
        reject(new HybridMarketError('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      operation.promise.then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        release();
        resolve(value);
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        release();
        reject(error);
      });
      if (signal?.aborted) onAbort();
    });
  };

  const loadData = (force: boolean, signal?: AbortSignal, refreshDaily = false): Promise<HybridState> => {
    if (destroyed) return Promise.reject(new HybridMarketError('no_data'));
    if (signal?.aborted) return Promise.reject(new HybridMarketError('cancelled'));
    if (!force) {
      if (activeOperation !== null) return attachOperation(activeOperation, signal);
      if (state !== null) return Promise.resolve(state);
    }

    const operationGeneration = ++generation;
    const controller = new AbortController();
    const operation = {} as HybridOperation;
    operation.generation = operationGeneration;
    operation.controller = controller;
    operation.consumers = 0;
    operation.settled = false;
    operation.cancelled = false;
    const cloudRequest: CloudRequestOptions = { signal: controller.signal, refreshDaily };
    const currentLocalClient = localClient;
    const cloudPromise = safeCall(() => force
      ? options.cloud.refresh(cloudRequest)
      : options.cloud.load(cloudRequest));
    const localListPromise = currentLocalClient === undefined
      ? Promise.reject(new Error('local unavailable'))
      : safeCall(() => currentLocalClient.listSnapshots());
    const localBootstrapPromise = currentLocalClient === undefined
      ? Promise.reject(new Error('local unavailable'))
      : safeCall(() => currentLocalClient.bootstrap());
    const pending = Promise.allSettled([
      cloudPromise,
      localListPromise,
      localBootstrapPromise,
    ]).then(([cloudResult, localListResult, localBootstrapResult]) => {
      if (
        operation.cancelled
        || controller.signal.aborted
        || destroyed
      ) throw new HybridMarketError('cancelled');
      const cloudData = cloudResult.status === 'fulfilled' ? cloudResult.value : null;
      const localSnapshots = localListResult.status === 'fulfilled' ? localListResult.value : null;
      const localBootstrap = localBootstrapResult.status === 'fulfilled' ? localBootstrapResult.value : null;
      const localLatest = localSnapshots === null ? null : latestTimestamp(localSnapshots);
      const localUsable = localSnapshots !== null
        && localSnapshots.length > 0
        && localBootstrap !== null
        && localBootstrap.snapshotCount === localSnapshots.length
        && localBootstrap.latestTimestamp === localLatest;
      if (cloudData === null && !localUsable) throw new HybridMarketError('no_data');

      let snapshots: Snapshot[];
      let sourceInfo: HybridSourceInfo;
      if (cloudData !== null) {
        snapshots = !localUsable ? [...cloudData.snapshots] : mergeSnapshots(cloudData.snapshots, localSnapshots);
        const hasLocalExtra = localUsable
          && localSnapshots.some((candidate) => !cloudData.snapshots.some((cloudSnapshot) => cloudSnapshot.timestamp === candidate.timestamp));
        sourceInfo = {
          ...cloudSourceInfo(cloudData),
          source: hasLocalExtra ? 'cloud+local' : 'cloud',
        };
      } else {
        snapshots = [...localSnapshots!].sort((left, right) => left.timestamp - right.timestamp);
        sourceInfo = {
          source: 'local-fallback',
          stale: false,
          warningCode: null,
          warning: null,
          generatedAt: null,
          historySourceLabel: null,
          latestTimestamp: latestTimestamp(snapshots),
        };
      }

      const nextState: HybridState = {
        snapshots,
        sourceInfo,
        collectorStatus: statusFromSource(sourceInfo, localBootstrap?.collectorStatus ?? null),
      };
      if (
        operation.cancelled
        || controller.signal.aborted
        || destroyed
      ) throw new HybridMarketError('cancelled');
      if (operation.generation === generation) state = nextState;
      return nextState;
    });
    operation.promise = pending.then((value) => {
      operation.settled = true;
      return value;
    }, (error: unknown) => {
      operation.settled = true;
      throw error;
    });
    activeOperation = operation;
    void operation.promise.then(() => {
      if (activeOperation === operation) activeOperation = null;
    }, () => {
      if (activeOperation === operation) activeOperation = null;
    });
    return attachOperation(operation, signal);
  };

  const buildBootstrap = (
    nextState: HybridState,
    nextPreferences: { watchlist: WatchItem[]; settings: RadarSettings; warning: 'preferences_unavailable' | null },
  ): HybridBootstrap => ({
    watchlist: [...nextPreferences.watchlist],
    settings: { ...nextPreferences.settings },
    collectorStatus: { ...nextState.collectorStatus },
    latestTimestamp: latestTimestamp(nextState.snapshots),
    snapshotCount: nextState.snapshots.length,
    source: nextState.sourceInfo.source,
    sourceInfo: { ...nextState.sourceInfo },
    preferencesWarning: nextPreferences.warning,
  });

  const bootstrap = async (): Promise<HybridBootstrap> => {
    const [nextState, nextPreferences] = await Promise.all([loadData(false), loadPreferences()]);
    return buildBootstrap(nextState, nextPreferences);
  };

  return {
    bootstrap,
    listSnapshots: async () => [...(await loadData(false)).snapshots],
    setWatchlist: async (value) => {
      try {
        await options.preferences.setWatchlist(value);
      } catch {
        throw new HybridMarketError('preferences');
      }
      const nextPreferences = await loadPreferences();
      nextPreferences.watchlist = [...value];
      preferences = nextPreferences;
    },
    setSettings: async (value) => {
      try {
        await options.preferences.setSettings(value);
      } catch {
        throw new HybridMarketError('preferences');
      }
      const nextPreferences = await loadPreferences();
      nextPreferences.settings = { ...value };
      preferences = nextPreferences;
    },
    refresh: async (requestOptions = {}) => {
      const nextState = await loadData(true, requestOptions.signal, requestOptions.refreshDaily);
      const nextPreferences = await loadPreferences();
      return buildBootstrap(nextState, nextPreferences);
    },
    setLocalClient: (client) => {
      localClient = client;
    },
    getSourceInfo: () => ({
      ...(state?.sourceInfo ?? {
        ...emptyCloudSourceInfo(),
        source: 'cloud',
      }),
    }),
    destroy: (): void => {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      if (activeOperation !== null) cancelOperation(activeOperation);
      activeOperation = null;
      state = null;
    },
  };
}

export const createHybridDashboardClient = createHybridClient;
