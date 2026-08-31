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

export interface CatalogItem {
  hrid: string;
  name: string;
  categoryHrid: string;
  sortIndex: number;
}
