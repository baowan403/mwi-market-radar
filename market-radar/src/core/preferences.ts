import type { MarketKey, RadarSettings, WatchItem } from './types';

export const DEFAULT_SETTINGS: RadarSettings = {
  period: '1d',
  minimumVolume: 0,
  maximumSpreadPct: null,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};

export type PreferenceKind = 'watchlist' | 'settings';

/** Fixed, value-free error for malformed persisted preference data. */
export class PreferenceDataError extends Error {
  readonly code = 'preference_data' as const;
  readonly kind: PreferenceKind;

  constructor(kind: PreferenceKind) {
    super('Stored preference data is invalid');
    this.name = 'PreferenceDataError';
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const WATCHLIST_ITEM_KEY_PATTERN = /^.+::(?:0|[1-9]\d*)$/;

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Normalize a watchlist using the same deterministic order as the GM store. */
export function normalizeWatchlist(value: unknown): WatchItem[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid watchlist: expected an array');
  }

  const keys = new Set<string>();
  const normalized = value.map((entry, index): WatchItem => {
    if (!isRecord(entry) || typeof entry.key !== 'string') {
      throw new Error(`Invalid watchlist entry at index ${index}: key is required`);
    }
    if (!WATCHLIST_ITEM_KEY_PATTERN.test(entry.key)) {
      throw new Error(`Invalid watchlist key at index ${index}`);
    }
    if (keys.has(entry.key)) {
      throw new Error(`Invalid watchlist: duplicate key at index ${index}`);
    }
    const order = entry.order;
    if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0) {
      throw new Error(`Invalid watchlist order at index ${index}`);
    }

    keys.add(entry.key);
    return { key: entry.key as MarketKey, order };
  });

  return normalized.sort((left, right) => {
    const byOrder = left.order - right.order;
    return byOrder !== 0 ? byOrder : left.key.localeCompare(right.key);
  });
}

/** Validate and clone settings with the same rules as the GM store. */
export function normalizeSettings(value: unknown): RadarSettings {
  if (!isRecord(value)) {
    throw new Error('Invalid settings: expected an object');
  }
  if (value.period !== '1d' && value.period !== '3d' && value.period !== '7d') {
    throw new Error('Invalid settings period');
  }
  if (!isFiniteNonnegative(value.minimumVolume)) {
    throw new Error('Invalid settings minimumVolume: expected a finite non-negative number');
  }
  if (value.maximumSpreadPct !== null && !isFiniteNonnegative(value.maximumSpreadPct)) {
    throw new Error('Invalid settings maximumSpreadPct: expected null or a finite non-negative number');
  }
  if (!isFiniteNonnegative(value.anomalyMovePct)) {
    throw new Error('Invalid settings anomalyMovePct: expected a finite non-negative number');
  }
  if (!isFiniteNonnegative(value.anomalyVolumeMultiple)) {
    throw new Error('Invalid settings anomalyVolumeMultiple: expected a finite non-negative number');
  }

  return {
    period: value.period,
    minimumVolume: value.minimumVolume,
    maximumSpreadPct: value.maximumSpreadPct,
    anomalyMovePct: value.anomalyMovePct,
    anomalyVolumeMultiple: value.anomalyVolumeMultiple,
  };
}

export function defaultSettings(): RadarSettings {
  return { ...DEFAULT_SETTINGS };
}
