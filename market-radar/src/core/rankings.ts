import { CATEGORY_GROUPS, shortCategory } from './categories';
import type { Period } from './types';
import type { PriceQuality } from './price';

export interface MarketRow {
  key: string;
  name: string;
  categoryHrid: string;
  enhancementLevel: number;
  price: number | null;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  volume: number | null;
  changes: Record<Period, number | null>;
  volatilityPct: number | null;
  volumeMultiple: number | null;
  quality: PriceQuality;
  flags: MarketFlag[];
}

export type MarketFlag =
  | 'move'
  | 'volume-spike'
  | 'wide-spread'
  | 'one-sided'
  | 'thin';

export type SortDirection = 'asc' | 'desc';

/**
 * Supported table sort columns. The longer aliases make this helper safe to
 * use with domain/property names while the short names match the UI headers.
 */
export type SortField =
  | 'price'
  | 'bid'
  | 'ask'
  | 'spread'
  | 'spreadPct'
  | 'volume'
  | 'change1d'
  | 'change3d'
  | 'change7d'
  | 'volatility'
  | 'volatilityPct'
  | 'volumeMultiple'
  | 'name'
  | 'category'
  | 'categoryHrid'
  | 'enhancement'
  | 'enhancementLevel';

export interface RowFilters {
  query?: string;
  categories?: ReadonlySet<string>;
  enhancementLevels?: ReadonlySet<number>;
  minimumVolume?: number | null;
  maximumSpreadPct?: number | null;
}

export interface FlagThresholds {
  /** Period whose change is used for the move signal. */
  period?: Period;
  /** Alias accepted by callers that call the value the selected period. */
  selectedPeriod?: Period;
  movePct?: number;
  /** Minimum row volume multiple needed for a volume-spike signal. */
  volumeMultiple?: number;
  /** Alias that avoids confusion with MarketRow.volumeMultiple. */
  volumeMultipleThreshold?: number;
  wideSpreadPct?: number;
  minimumVolume?: number;
}

const DEFAULT_FLAG_THRESHOLDS: Required<Pick<FlagThresholds, 'period' | 'movePct' | 'volumeMultiple' | 'wideSpreadPct' | 'minimumVolume'>> = {
  period: '1d',
  movePct: 5,
  volumeMultiple: 2,
  wideSpreadPct: 10,
  minimumVolume: 1,
};

const NUMERIC_SORT_FIELDS = new Set<SortField>([
  'price',
  'bid',
  'ask',
  'spread',
  'spreadPct',
  'volume',
  'change1d',
  'change3d',
  'change7d',
  'volatility',
  'volatilityPct',
  'volumeMultiple',
  'enhancement',
  'enhancementLevel',
]);

function isMissingNumber(value: number | null | undefined): boolean {
  return value === null || value === undefined || !Number.isFinite(value);
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Compare numbers while keeping null/NaN values at the end in either direction. */
export function compareNullable(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: SortDirection,
): number {
  const aMissing = isMissingNumber(a);
  const bMissing = isMissingNumber(b);

  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }

  const left = a as number;
  const right = b as number;
  if (left === right) return 0;
  return direction === 'asc' ? (left < right ? -1 : 1) : left > right ? -1 : 1;
}

function numericValue(row: MarketRow, field: SortField): number | null {
  switch (field) {
    case 'price':
      return row.price;
    case 'bid':
      return row.bid;
    case 'ask':
      return row.ask;
    case 'spread':
    case 'spreadPct':
      return row.spreadPct;
    case 'volume':
      return row.volume;
    case 'change1d':
      return row.changes['1d'];
    case 'change3d':
      return row.changes['3d'];
    case 'change7d':
      return row.changes['7d'];
    case 'volatility':
    case 'volatilityPct':
      return row.volatilityPct;
    case 'volumeMultiple':
      return row.volumeMultiple;
    case 'enhancement':
    case 'enhancementLevel':
      return row.enhancementLevel;
    default:
      return null;
  }
}

function textValue(row: MarketRow, field: SortField): string {
  if (field === 'category' || field === 'categoryHrid') {
    return shortCategory(row.categoryHrid);
  }
  return row.name;
}

function compareText(a: string, b: string, direction: SortDirection): number {
  const comparison = a.localeCompare(b, 'zh-Hant');
  return direction === 'asc' ? comparison : -comparison;
}

function tieBreaker(left: MarketRow, right: MarketRow): number {
  const byName = left.name.localeCompare(right.name, 'zh-Hant');
  if (byName !== 0) return byName;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function compareRows(left: MarketRow, right: MarketRow, field: SortField, direction: SortDirection): number {
  const primary = NUMERIC_SORT_FIELDS.has(field)
    ? compareNullable(numericValue(left, field), numericValue(right, field), direction)
    : compareText(textValue(left, field), textValue(right, field), direction);
  return primary !== 0 ? primary : tieBreaker(left, right);
}

/** Sort a copy of rows; the caller's array and row objects are never mutated. */
export function sortRows(
  rows: readonly MarketRow[],
  field: SortField,
  direction: SortDirection = 'asc',
): MarketRow[] {
  return [...rows].sort((left, right) => compareRows(left, right, field, direction));
}

function matchesCategory(row: MarketRow, selected: ReadonlySet<string>): boolean {
  const short = shortCategory(row.categoryHrid);
  if (selected.has(row.categoryHrid) || selected.has(short)) return true;

  for (const group of selected) {
    const members = CATEGORY_GROUPS[group];
    if (members?.includes(short as (typeof members)[number])) return true;
  }
  return false;
}

/** Apply all provided filters without changing the source row array. */
export function filterRows(rows: readonly MarketRow[], filters: RowFilters = {}): MarketRow[] {
  const query = filters.query?.toLowerCase() ?? '';
  const hasCategories = Boolean(filters.categories && filters.categories.size > 0);
  const hasEnhancements = Boolean(filters.enhancementLevels && filters.enhancementLevels.size > 0);
  const minimumVolume = filters.minimumVolume;
  const hasMinimumVolume = typeof minimumVolume === 'number' && Number.isFinite(minimumVolume) && minimumVolume > 0;
  const maximumSpreadPct = filters.maximumSpreadPct;
  const hasMaximumSpread = typeof maximumSpreadPct === 'number' && Number.isFinite(maximumSpreadPct);

  return rows.filter((row) => {
    if (query && !`${row.name} ${row.key}`.toLowerCase().includes(query)) return false;
    if (hasCategories && !matchesCategory(row, filters.categories!)) return false;
    if (hasEnhancements && !filters.enhancementLevels!.has(row.enhancementLevel)) return false;

    if (hasMinimumVolume &&
      (row.volume === null || !Number.isFinite(row.volume) || row.volume < minimumVolume!)) {
      return false;
    }
    if (hasMaximumSpread &&
      (row.spreadPct === null || !Number.isFinite(row.spreadPct) || row.spreadPct > maximumSpreadPct!)) {
      return false;
    }
    return true;
  });
}

/** Return anomaly/liquidity flags in a stable order with no duplicates. */
export function flagsForRow(row: MarketRow, thresholds: FlagThresholds = {}): MarketFlag[] {
  const options = {
    ...DEFAULT_FLAG_THRESHOLDS,
    ...thresholds,
    volumeMultiple: thresholds.volumeMultipleThreshold ?? thresholds.volumeMultiple ?? DEFAULT_FLAG_THRESHOLDS.volumeMultiple,
    period: thresholds.selectedPeriod ?? thresholds.period ?? DEFAULT_FLAG_THRESHOLDS.period,
  };
  const flags: MarketFlag[] = [];
  const change = row.changes[options.period];
  const price = row.price;
  const volumeMultiple = row.volumeMultiple;
  const spread = row.spreadPct;
  const volume = row.volume;

  if (
    isFiniteNumber(price) &&
    isFiniteNumber(change) &&
    isFiniteNumber(options.movePct) &&
    Math.abs(change) >= options.movePct
  ) {
    flags.push('move');
  }
  if (
    isFiniteNumber(volumeMultiple) &&
    isFiniteNumber(volume) &&
    volume >= 0 &&
    isFiniteNumber(options.volumeMultiple) &&
    volumeMultiple >= options.volumeMultiple
  ) {
    flags.push('volume-spike');
  }
  if (
    isFiniteNumber(spread) &&
    isFiniteNumber(options.wideSpreadPct) &&
    spread >= options.wideSpreadPct
  ) {
    flags.push('wide-spread');
  }
  if (row.quality === 'ask-only' || row.quality === 'bid-only') {
    flags.push('one-sided');
  }
  if (
    volume === null ||
    !isFiniteNumber(volume) ||
    (isFiniteNumber(options.minimumVolume) && volume < options.minimumVolume)
  ) {
    flags.push('thin');
  }

  return flags;
}
