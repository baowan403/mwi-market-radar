export type Period = '1d' | '3d' | '7d';

export type MarketKey = `${string}::${number}`;

export interface Quote {
  a: number | null;
  b: number | null;
  p: number | null;
  v: number | null;
}

export interface Snapshot {
  timestamp: number;
  quotes: Record<MarketKey, Quote>;
}

export interface WatchItem {
  key: MarketKey;
  order: number;
}

export interface RadarSettings {
  period: Period;
  minimumVolume: number;
  maximumSpreadPct: number | null;
  anomalyMovePct: number;
  anomalyVolumeMultiple: number;
}

export type CollectorState = 'idle' | 'checking' | 'retrying' | 'ok' | 'error';

export interface CollectorStatus {
  state: CollectorState;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  officialTimestamp: number | null;
  nextRunAt: number | null;
  lastErrorCode: string | null;
}

export interface BridgeBootstrap {
  watchlist: WatchItem[];
  settings: RadarSettings;
  collectorStatus: CollectorStatus;
  latestTimestamp: number | null;
  snapshotCount: number;
}

export type BridgeRequest =
  | { id: string; type: 'bootstrap' }
  | { id: string; type: 'snapshots' }
  | { id: string; type: 'set-watchlist'; value: WatchItem[] }
  | { id: string; type: 'set-settings'; value: RadarSettings };

export interface BridgeSuccessResponse<T = unknown> {
  id: string;
  ok: true;
  value: T;
}

export interface BridgeErrorPayload {
  code: string;
  message: string;
}

export interface BridgeErrorResponse {
  id: string;
  ok: false;
  error: BridgeErrorPayload;
}

export type BridgeResponse<T = unknown> = BridgeSuccessResponse<T> | BridgeErrorResponse;

export interface CatalogItem {
  hrid: string;
  name: string;
  categoryHrid: string;
  sortIndex: number;
}
