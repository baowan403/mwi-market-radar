import { CATEGORY_GROUPS } from '../core/categories';
import { priceBasis, spreadPct, type PriceQuality } from '../core/price';
import {
  calculateChange,
  calculateVolatilityPct,
  PERIOD_HOURS,
  volumeMultiple as calculateVolumeMultiple,
} from '../core/trends';
import type {
  CatalogCategory,
  CatalogData,
  CatalogItem,
  MarketKey,
  Period,
  Quote,
  Snapshot,
  WatchItem,
} from '../core/types';
import {
  flagsForRow,
  sortRows,
  type FlagThresholds,
  type MarketRow,
  type SortDirection,
  type SortField,
} from '../core/rankings';

const HOUR_MS = 3_600_000;
const VOLUME_BASELINE_DAYS = 7;
const VOLUME_BASELINE_TOLERANCE_MS = 2 * HOUR_MS;
const UNKNOWN_CATEGORY_HRID = '/item_categories/unknown';
const MARKET_KEY_PATTERN = /^.+::(?:0|[1-9]\d*)$/;

export interface NormalizedCatalog {
  categories: CatalogCategory[];
  items: CatalogItem[];
  categoriesByHrid: Map<string, CatalogCategory>;
  itemsByHrid: Map<string, CatalogItem>;
}

export type CatalogInput = CatalogData | NormalizedCatalog | unknown;

export interface ParsedMarketKey {
  itemHrid: string;
  enhancementLevel: number;
}

export interface DerivedMarketRow extends MarketRow {
  itemHrid: string;
  watchlisted: boolean;
  order: number | null;
  catalogSortIndex: number | null;
}

export type DashboardRow = DerivedMarketRow;

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteSortIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCatalogCategories(left: CatalogCategory, right: CatalogCategory): number {
  const byIndex = left.sortIndex - right.sortIndex;
  return byIndex !== 0 ? byIndex : lexicalCompare(left.hrid, right.hrid);
}

function compareCatalogItems(left: CatalogItem, right: CatalogItem): number {
  const byCategory = lexicalCompare(left.categoryHrid, right.categoryHrid);
  if (byCategory !== 0) return byCategory;
  const byIndex = left.sortIndex - right.sortIndex;
  return byIndex !== 0 ? byIndex : lexicalCompare(left.hrid, right.hrid);
}

/** Normalize a public catalog and expose stable HRID lookup maps. */
export function normalizeCatalog(input: CatalogInput): NormalizedCatalog {
  const rawCategories = isRecord(input) && Array.isArray(input.categories) ? input.categories : [];
  const rawItems = isRecord(input) && Array.isArray(input.items) ? input.items : [];

  const categoriesByHrid = new Map<string, CatalogCategory>();
  for (const [index, raw] of rawCategories.entries()) {
    if (!isRecord(raw) || typeof raw.hrid !== 'string' || typeof raw.name !== 'string') continue;
    if (categoriesByHrid.has(raw.hrid)) continue;
    categoriesByHrid.set(raw.hrid, {
      hrid: raw.hrid,
      name: raw.name,
      sortIndex: finiteSortIndex(raw.sortIndex, index),
    });
  }

  const itemsByHrid = new Map<string, CatalogItem>();
  for (const [index, raw] of rawItems.entries()) {
    if (!isRecord(raw) || typeof raw.hrid !== 'string' || typeof raw.name !== 'string') continue;
    if (itemsByHrid.has(raw.hrid)) continue;
    itemsByHrid.set(raw.hrid, {
      hrid: raw.hrid,
      name: raw.name,
      categoryHrid: typeof raw.categoryHrid === 'string' ? raw.categoryHrid : UNKNOWN_CATEGORY_HRID,
      sortIndex: finiteSortIndex(raw.sortIndex, index),
    });
  }

  const categories = [...categoriesByHrid.values()].sort(compareCatalogCategories);
  const items = [...itemsByHrid.values()].sort(compareCatalogItems);
  return {
    categories,
    items,
    categoriesByHrid: new Map(categories.map((category) => [category.hrid, { ...category }])),
    itemsByHrid: new Map(items.map((item) => [item.hrid, { ...item }])),
  };
}

export const loadCatalog = normalizeCatalog;

/** Parse the item HRID and enhancement using the final `::` separator. */
export function parseMarketKey(key: string): ParsedMarketKey | null {
  const separator = key.lastIndexOf('::');
  if (separator <= 0) return null;
  const itemHrid = key.slice(0, separator);
  const levelText = key.slice(separator + 2);
  if (!/^\d+$/.test(levelText)) return null;
  const enhancementLevel = Number(levelText);
  if (!Number.isSafeInteger(enhancementLevel) || enhancementLevel < 0) return null;
  return { itemHrid, enhancementLevel };
}

export function fallbackItemName(itemHrid: string): string {
  const segment = itemHrid.split('/').filter(Boolean).at(-1);
  return segment === undefined ? itemHrid : segment.replace(/_/g, ' ');
}

function finiteNonnegativeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function quoteOrEmpty(value: unknown): Quote {
  if (!isRecord(value)) return { a: null, b: null, p: null, v: null };
  return {
    a: finiteNonnegativeOrNull(value.a),
    b: finiteNonnegativeOrNull(value.b),
    p: finiteNonnegativeOrNull(value.p),
    v: finiteNonnegativeOrNull(value.v),
  };
}

function latestSnapshot(snapshots: readonly Snapshot[]): Snapshot | null {
  let latest: Snapshot | null = null;
  for (const snapshot of snapshots) {
    if (!Number.isFinite(snapshot.timestamp)) continue;
    if (latest === null || snapshot.timestamp > latest.timestamp) latest = snapshot;
  }
  return latest;
}

function periodWindow(
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
  period: Period,
): Snapshot[] {
  const start = latestTimestamp - PERIOD_HOURS[period] * HOUR_MS;
  return snapshots.filter(
    (snapshot) => Number.isFinite(snapshot.timestamp)
      && snapshot.timestamp >= start
      && snapshot.timestamp <= latestTimestamp,
  );
}

/** Compare today's volume with one nearest same-time sample from each prior day. */
export function volumeMultipleForKey(
  key: MarketKey,
  latest: Snapshot,
  snapshots: readonly Snapshot[],
): number | null {
  const currentVolume = quoteOrEmpty(latest.quotes[key]).v;
  const usedSnapshots = new Set<Snapshot>();
  const baselines: number[] = [];

  for (let day = 1; day <= VOLUME_BASELINE_DAYS; day += 1) {
    const targetTimestamp = latest.timestamp - day * 24 * HOUR_MS;
    let nearest: Snapshot | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of snapshots) {
      if (candidate === latest || usedSnapshots.has(candidate) || candidate.timestamp >= latest.timestamp) continue;
      const candidateVolume = quoteOrEmpty(candidate.quotes[key]).v;
      if (candidateVolume === null) continue;
      const distance = Math.abs(candidate.timestamp - targetTimestamp);
      if (distance > VOLUME_BASELINE_TOLERANCE_MS) continue;
      if (
        nearest === undefined
        || distance < nearestDistance
        || (distance === nearestDistance && candidate.timestamp < nearest.timestamp)
      ) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }

    if (nearest !== undefined) {
      usedSnapshots.add(nearest);
      const volume = quoteOrEmpty(nearest.quotes[key]).v;
      if (volume !== null) baselines.push(volume);
    }
  }

  if (baselines.filter((volume) => volume > 0).length < 3) return null;
  return calculateVolumeMultiple(currentVolume, baselines);
}

/** Derive immutable UI rows from the latest snapshot and catalog metadata. */
export function deriveRows(
  snapshots: readonly Snapshot[],
  catalogInput: CatalogInput,
  watchlist: readonly WatchItem[],
  selectedPeriod: Period,
  flagThresholds: FlagThresholds = {},
): DerivedMarketRow[] {
  const latest = latestSnapshot(snapshots);
  if (latest === null) return [];

  const catalog = normalizeCatalog(catalogInput);
  const normalizedWatchlist = normalizeWatchlist(watchlist);
  const watchOrders = new Map(normalizedWatchlist.map((entry) => [entry.key, entry.order]));
  const volatilitySnapshots = periodWindow(snapshots, latest.timestamp, selectedPeriod);
  const rows: DerivedMarketRow[] = [];

  for (const [key, rawQuote] of Object.entries(latest.quotes)) {
    const parsedKey = parseMarketKey(key);
    if (parsedKey === null) continue;

    const quote = quoteOrEmpty(rawQuote);
    const basis = priceBasis(quote);
    const catalogItem = catalog.itemsByHrid.get(parsedKey.itemHrid);
    const marketKey = key as MarketKey;
    const rowWithoutFlags: MarketRow = {
      key,
      name: catalogItem?.name ?? fallbackItemName(parsedKey.itemHrid),
      categoryHrid: catalogItem?.categoryHrid ?? UNKNOWN_CATEGORY_HRID,
      enhancementLevel: parsedKey.enhancementLevel,
      price: basis.value,
      bid: quote.b,
      ask: quote.a,
      spreadPct: spreadPct(quote),
      volume: quote.v,
      changes: {
        '1d': calculateChange(key as MarketKey, PERIOD_HOURS['1d'], snapshots).pct,
        '3d': calculateChange(key as MarketKey, PERIOD_HOURS['3d'], snapshots).pct,
        '7d': calculateChange(key as MarketKey, PERIOD_HOURS['7d'], snapshots).pct,
      },
      volatilityPct: calculateVolatilityPct(key as MarketKey, volatilitySnapshots),
      volumeMultiple: volumeMultipleForKey(marketKey, latest, snapshots),
      quality: basis.quality as PriceQuality,
      flags: [],
    };
    const flags = flagsForRow(rowWithoutFlags, { ...flagThresholds, period: selectedPeriod });
    rows.push({
      ...rowWithoutFlags,
      flags,
      itemHrid: parsedKey.itemHrid,
      watchlisted: watchOrders.has(marketKey),
      order: watchOrders.get(marketKey) ?? null,
      catalogSortIndex: catalogItem?.sortIndex ?? null,
    });
  }

  return rows;
}

/** Safely deduplicate and normalize watchlist order to 0..n-1. */
export function normalizeWatchlist(value: readonly WatchItem[] | unknown): WatchItem[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, { key: MarketKey; order: number; index: number }>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !MARKET_KEY_PATTERN.test(entry.key)) return;
    const order = entry.order;
    if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0) return;
    const existing = byKey.get(entry.key);
    if (existing === undefined || order < existing.order) {
      byKey.set(entry.key, { key: entry.key as MarketKey, order, index });
    }
  });
  const sorted = [...byKey.values()].sort((left, right) => {
    const byOrder = left.order - right.order;
    return byOrder !== 0 ? byOrder : lexicalCompare(left.key, right.key) || left.index - right.index;
  });
  return sorted.map(({ key }, order) => ({ key, order }));
}

/** Add/remove one market key while preserving and normalizing relative order. */
export function togglePin(watchlist: readonly WatchItem[], key: MarketKey): WatchItem[] {
  const normalized = normalizeWatchlist(watchlist);
  if (normalized.some((entry) => entry.key === key)) {
    return normalizeWatchlist(normalized.filter((entry) => entry.key !== key));
  }
  return normalizeWatchlist([...normalized, { key, order: normalized.length }]);
}

function watchIndex(watchlist: readonly WatchItem[], value: number | string): number {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : -1;
  return watchlist.findIndex((entry) => entry.key === value);
}

/** Move a watchlist entry by index or key, clamping destination deterministically. */
export function moveWatchItem(
  watchlist: readonly WatchItem[],
  from: number | string,
  to: number | string,
): WatchItem[] {
  const normalized = normalizeWatchlist(watchlist);
  const fromIndex = watchIndex(normalized, from);
  if (fromIndex < 0 || fromIndex >= normalized.length) return normalized;
  const rawToIndex = watchIndex(normalized, to);
  const toIndex = typeof to === 'number'
    ? Math.max(0, Math.min(normalized.length - 1, rawToIndex))
    : rawToIndex;
  if (toIndex < 0 || toIndex >= normalized.length || toIndex === fromIndex) return normalized;
  const moved = [...normalized];
  const [entry] = moved.splice(fromIndex, 1);
  if (entry === undefined) return normalized;
  moved.splice(toIndex, 0, entry);
  return normalizeWatchlist(moved.map((item, index) => ({ ...item, order: index })));
}

/** Cycle one column through descending, ascending, and the default ordering. */
export function cycleSort(current: SortState | null | undefined, field: SortField): SortState | null {
  if (current == null || current.field !== field) return { field, direction: 'desc' };
  return current.direction === 'desc' ? { field, direction: 'asc' } : null;
}

function compareDefaultRows(left: DerivedMarketRow, right: DerivedMarketRow, view: string): number {
  if (view === 'watchlist') {
    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  } else {
    const leftIndex = left.catalogSortIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.catalogSortIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  const byName = left.name.localeCompare(right.name, 'zh-Hant');
  if (byName !== 0) return byName;
  if (left.enhancementLevel !== right.enhancementLevel) {
    return left.enhancementLevel - right.enhancementLevel;
  }
  return lexicalCompare(left.key, right.key);
}

/** Sort derived rows without mutating them; null sort state uses the view default. */
export function sortViewRows(
  rows: readonly DerivedMarketRow[],
  sortState: SortState | null | undefined,
  view: string = 'all',
): DerivedMarketRow[] {
  if (sortState == null) return [...rows].sort((left, right) => compareDefaultRows(left, right, view));
  return sortRows(rows, sortState.field, sortState.direction) as DerivedMarketRow[];
}

export { CATEGORY_GROUPS };
