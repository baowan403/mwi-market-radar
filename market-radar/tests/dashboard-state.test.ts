import { describe, expect, it } from 'vitest';
import type {
  CatalogData,
  CatalogItem,
  Quote,
  Snapshot,
  WatchItem,
} from '../src/core/types';
import {
  cycleSort,
  deriveRows,
  moveWatchItem,
  normalizeCatalog,
  normalizeWatchlist,
  sortViewRows,
  togglePin,
} from '../src/dashboard/state';
import { filterViewRows } from '../src/dashboard/filters';

const HOUR = 3_600_000;

const catalog: CatalogData = {
  categories: [
    { hrid: '/item_categories/equipment', name: 'Equipment', sortIndex: 2 },
    { hrid: '/item_categories/food', name: 'Food', sortIndex: 1 },
  ],
  items: [
    { hrid: '/items/gloves', name: '時空手套', categoryHrid: '/item_categories/equipment', sortIndex: 2 },
    { hrid: '/items/apple', name: '紅蘋果', categoryHrid: '/item_categories/food', sortIndex: 1 },
  ],
};

function quote(overrides: Partial<Quote> = {}): Quote {
  return { a: 105, b: 95, p: 100, v: 10, ...overrides };
}

function snapshot(timestamp: number, quotes: Record<string, Quote>): Snapshot {
  return { timestamp, quotes: quotes as Snapshot['quotes'] };
}

const history: Snapshot[] = [
  snapshot(0, { '/items/gloves::7': quote({ p: 100 }) }),
  snapshot(24 * HOUR, { '/items/gloves::7': quote({ p: 110 }) }),
  snapshot(72 * HOUR, { '/items/gloves::7': quote({ p: 120 }) }),
  snapshot(96 * HOUR, { '/items/gloves::7': quote({ p: 120 }) }),
  snapshot(144 * HOUR, { '/items/gloves::7': quote({ p: 130 }) }),
  snapshot(168 * HOUR, {
    '/items/gloves::7': quote({ p: 140, v: 2, a: 150, b: 130 }),
    '/items/apple::0': quote({ p: 25, v: 20 }),
    '/items/mystery_item::0': quote({ p: null, a: null, b: null, v: null }),
  }),
];

describe('dashboard state', () => {
  it('normalizes catalog arrays and maps item/category hrids', () => {
    const normalized = normalizeCatalog(catalog);

    expect(normalized.itemsByHrid.get('/items/gloves')).toEqual(catalog.items[0]);
    expect(normalized.categoriesByHrid.get('/item_categories/food')?.name).toBe('Food');
    expect(normalized.items).toEqual(catalog.items);
  });

  it('returns no rows for an empty history', () => {
    expect(deriveRows([], catalog, [], '1d')).toEqual([]);
  });

  it('uses the latest shuffled snapshot, preserves enhancements, and labels unknown items safely', () => {
    const rows = deriveRows([history[5]!, history[0]!], catalog, [], '1d');

    expect(rows.map((row) => row.key)).toEqual([
      '/items/gloves::7',
      '/items/apple::0',
      '/items/mystery_item::0',
    ]);
    expect(rows[0]).toMatchObject({
      name: '時空手套',
      enhancementLevel: 7,
      categoryHrid: '/item_categories/equipment',
      price: 140,
      watchlisted: false,
      order: null,
    });
    expect(rows[2]).toMatchObject({
      name: 'mystery item',
      categoryHrid: '/item_categories/unknown',
      price: null,
      quality: 'missing',
    });
  });

  it('calculates honest 1d/3d/7d changes and selected-window volatility', () => {
    const rows = deriveRows([...history].reverse(), catalog, [], '7d');
    const gloves = rows.find((row) => row.key === '/items/gloves::7');

    expect(gloves?.changes['1d']).toBeCloseTo((140 - 130) / 130 * 100);
    expect(gloves?.changes['3d']).toBeCloseTo((140 - 120) / 120 * 100);
    expect(gloves?.changes['7d']).toBeCloseTo(40);
    expect(gloves?.volatilityPct).not.toBeNull();
    expect(gloves?.flags).toContain('move');
    expect(gloves?.volumeMultiple).toBeNull();

    const oneDay = deriveRows(history, catalog, [], '1d').find((row) => row.key === '/items/gloves::7');
    expect(oneDay?.volatilityPct).toBeNull();
  });

  it('does not mutate snapshots, catalog, or watchlist inputs', () => {
    const snapshots = [...history].reverse();
    const watchlist: WatchItem[] = [{ key: '/items/gloves::7', order: 0 }];
    const snapshotsBefore = structuredClone(snapshots);
    const catalogBefore = structuredClone(catalog);
    const watchlistBefore = structuredClone(watchlist);

    deriveRows(snapshots, catalog, watchlist, '1d');

    expect(snapshots).toEqual(snapshotsBefore);
    expect(catalog).toEqual(catalogBefore);
    expect(watchlist).toEqual(watchlistBefore);
  });
});

describe('dashboard filters and pins', () => {
  const rows = deriveRows([history[5]!], catalog, [{ key: '/items/gloves::7', order: 0 }], '1d');

  it('filters primary views, official/group categories, search, and liquidity', () => {
    expect(filterViewRows(rows, { view: 'watchlist' }).map((row) => row.key)).toEqual(['/items/gloves::7']);
    expect(filterViewRows(rows, { view: 'resource' })).toEqual([]);
    expect(filterViewRows(rows, { view: 'consumable' }).map((row) => row.key)).toEqual(['/items/apple::0']);
    expect(filterViewRows(rows, { view: 'equipment', query: '手套' }).map((row) => row.key)).toEqual(['/items/gloves::7']);
    expect(filterViewRows(rows, {
      categories: new Set(['/item_categories/food']),
      minimumVolume: 10,
      maximumSpreadPct: 10,
    }).map((row) => row.key)).toEqual(['/items/apple::0']);
    expect(filterViewRows(rows, { query: 'MYSTERY' }).map((row) => row.key)).toEqual(['/items/mystery_item::0']);
  });

  it('normalizes duplicate pins, toggles with append order, and moves deterministically', () => {
    const initial: WatchItem[] = [
      { key: '/items/b::0', order: 8 },
      { key: '/items/a::0', order: 2 },
      { key: '/items/a::0', order: 1 },
    ];
    expect(normalizeWatchlist(initial)).toEqual([
      { key: '/items/a::0', order: 0 },
      { key: '/items/b::0', order: 1 },
    ]);
    expect(togglePin(initial, '/items/c::0')).toEqual([
      { key: '/items/a::0', order: 0 },
      { key: '/items/b::0', order: 1 },
      { key: '/items/c::0', order: 2 },
    ]);
    expect(togglePin(initial, '/items/a::0')).toEqual([{ key: '/items/b::0', order: 0 }]);
    expect(moveWatchItem(initial, 1, 0)).toEqual([
      { key: '/items/a::0', order: 0 },
      { key: '/items/b::0', order: 1 },
    ]);
  });
});

describe('dashboard sort state', () => {
  it('cycles desc to asc to default and uses manual/catalog defaults', () => {
    expect(cycleSort(null, 'price')).toEqual({ field: 'price', direction: 'desc' });
    expect(cycleSort({ field: 'price', direction: 'desc' }, 'price')).toEqual({ field: 'price', direction: 'asc' });
    expect(cycleSort({ field: 'price', direction: 'asc' }, 'price')).toBeNull();

    const rows = deriveRows([history[5]!], catalog, [
      { key: '/items/apple::0', order: 0 },
      { key: '/items/gloves::7', order: 1 },
    ], '1d');
    const watchlistRows = filterViewRows(rows, { view: 'watchlist' });
    expect(sortViewRows(watchlistRows, null, 'watchlist').map((row) => row.key)).toEqual([
      '/items/apple::0',
      '/items/gloves::7',
    ]);
    expect(sortViewRows(rows, null, 'all').map((row) => row.key)).toEqual([
      '/items/apple::0',
      '/items/gloves::7',
      '/items/mystery_item::0',
    ]);
    const sorted = sortViewRows(rows, { field: 'price', direction: 'asc' }, 'all');
    expect(sorted.at(-1)?.price).toBeNull();
    expect(rows[0]?.key).toBe('/items/gloves::7');
  });
});
