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

export type DashboardSource = 'cloud' | 'cloud+local' | 'local-fallback';

export interface DashboardSourceInfo {
  source: DashboardSource;
  stale: boolean;
  warningCode: 'cloud_stale' | null;
  warning?: string | null;
  generatedAt: string | null;
  historySourceLabel: string | null;
  latestTimestamp: number | null;
}

export interface BridgeBootstrap {
  watchlist: WatchItem[];
  settings: RadarSettings;
  collectorStatus: CollectorStatus;
  latestTimestamp: number | null;
  snapshotCount: number;
  /** Optional source metadata supplied by cloud/hybrid dashboard clients. */
  source?: DashboardSource;
  sourceInfo?: DashboardSourceInfo;
  /** Optional fixed warning when dashboard preferences could not be read. */
  preferencesWarning?: 'preferences_unavailable' | null;
}

export type BridgeRequest =
  | { id: string; type: 'bootstrap' }
  | { id: string; type: 'snapshots'; beforeTimestamp: number | null; limit: number }
  | { id: string; type: 'set-watchlist'; value: WatchItem[] }
  | { id: string; type: 'set-settings'; value: RadarSettings };

export interface BridgeSnapshotPage {
  items: Snapshot[];
  nextBeforeTimestamp: number | null;
  hasMore: boolean;
}

export type SnapshotPage = BridgeSnapshotPage;

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
  nameZhHant?: string | null;
  nameEn?: string;
  categoryHrid: string;
  sortIndex: number;
}

export interface CatalogCategory {
  hrid: string;
  name: string;
  nameZhHant?: string;
  nameEn?: string;
  sortIndex: number;
}

export interface CatalogData {
  categories: CatalogCategory[];
  items: CatalogItem[];
}
