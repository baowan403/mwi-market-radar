import { CATEGORY_GROUPS } from '../core/categories';
import { filterRows, type MarketRow, type RowFilters } from '../core/rankings';
import type { DerivedMarketRow } from './state';

export type PrimaryView =
  | 'watchlist'
  | 'all'
  | 'resource'
  | 'consumable'
  | 'ability_book'
  | 'labyrinth'
  | 'equipment'
  | 'other';

export interface DashboardFilters extends RowFilters {
  view?: PrimaryView;
  primary?: PrimaryView;
  primaryView?: PrimaryView;
  officialCategories?: ReadonlySet<string>;
}

/** Apply a primary view and the shared search/category/liquidity filters. */
export function filterViewRows(
  rows: readonly DerivedMarketRow[],
  filters: DashboardFilters = {},
): DerivedMarketRow[] {
  const {
    view: requestedView,
    primary,
    primaryView,
    officialCategories,
    ...rowFilters
  } = filters;
  const view = requestedView ?? primary ?? primaryView ?? 'all';
  const effectiveFilters: RowFilters = {
    ...rowFilters,
    ...(officialCategories === undefined ? {} : { categories: officialCategories }),
  };
  let candidates: readonly DerivedMarketRow[] = rows;
  if (view === 'watchlist') {
    candidates = rows.filter((row) => row.watchlisted);
  } else if (view !== 'all') {
    const categories = CATEGORY_GROUPS[view];
    if (categories !== undefined) {
      candidates = filterRows(candidates as readonly MarketRow[], { categories: new Set(categories) }) as DerivedMarketRow[];
    }
  }
  return filterRows(candidates as readonly MarketRow[], effectiveFilters) as DerivedMarketRow[];
}

export const filterDashboardRows = filterViewRows;
export const applyViewFilters = filterViewRows;
