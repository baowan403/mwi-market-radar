import { describe, expect, it } from 'vitest';
import {
  CATEGORY_GROUPS,
  OFFICIAL_CATEGORIES,
  shortCategory,
} from '../src/core/categories';
import {
  compareNullable,
  filterRows,
  flagsForRow,
  sortRows,
  type SortField,
  type MarketRow,
} from '../src/core/rankings';

function row(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    key: '/items/default::0',
    name: 'Default',
    categoryHrid: '/item_categories/resource',
    enhancementLevel: 0,
    price: 100,
    bid: 95,
    ask: 105,
    spreadPct: 10,
    volume: 10,
    changes: { '1d': 0, '3d': null, '7d': null },
    volatilityPct: null,
    volumeMultiple: null,
    quality: 'official',
    flags: [],
    ...overrides,
  };
}

describe('categories', () => {
  it('defines exactly the ten official short categories', () => {
    expect(OFFICIAL_CATEGORIES).toEqual([
      'currency',
      'loot',
      'scroll',
      'labyrinth',
      'dungeon_key',
      'food',
      'drink',
      'ability_book',
      'equipment',
      'resource',
    ]);
  });

  it('defines the required convenience groups without changing official categories', () => {
    expect(CATEGORY_GROUPS).toEqual({
      resource: ['resource'],
      consumable: ['food', 'drink', 'scroll'],
      ability_book: ['ability_book'],
      labyrinth: ['labyrinth'],
      equipment: ['equipment'],
      other: ['currency', 'loot', 'dungeon_key'],
    });
  });

  it('strips only a fixed leading category prefix', () => {
    expect(shortCategory('/item_categories/resource')).toBe('resource');
    expect(shortCategory('nested/item_categories/resource')).toBe('nested/item_categories/resource');
    expect(shortCategory('/item_categories/resource/item_categories/loot')).toBe(
      'resource/item_categories/loot',
    );
  });
});

describe('nullable numeric comparison', () => {
  it('keeps null and NaN last in both directions', () => {
    expect(compareNullable(null, 1, 'asc')).toBeGreaterThan(0);
    expect(compareNullable(null, 1, 'desc')).toBeGreaterThan(0);
    expect(compareNullable(Number.NaN, 1, 'asc')).toBeGreaterThan(0);
    expect(compareNullable(Number.NaN, 1, 'desc')).toBeGreaterThan(0);
    expect(compareNullable(1, Number.NaN, 'desc')).toBeLessThan(0);
    expect(compareNullable(Number.NaN, null, 'asc')).toBe(0);
    expect(compareNullable(1, null, 'desc')).toBeLessThan(0);
    expect(compareNullable(1, 2, 'asc')).toBeLessThan(0);
    expect(compareNullable(1, 2, 'desc')).toBeGreaterThan(0);
  });
});

describe('sortRows', () => {
  it('does not mutate input and uses name then key as deterministic ties', () => {
    const input = [
      row({ key: '/items/z::0', name: '同名', price: 10 }),
      row({ key: '/items/a::0', name: '同名', price: 10 }),
      row({ key: '/items/null::0', name: '缺價', price: null }),
    ];
    const before = structuredClone(input);
    const sorted = sortRows(input, 'price', 'asc');

    expect(input).toEqual(before);
    expect(sorted.map((item) => item.key)).toEqual([
      '/items/a::0',
      '/items/z::0',
      '/items/null::0',
    ]);
  });

  it('puts null values last even for descending sort', () => {
    const sorted = sortRows(
      [row({ key: '/items/null::0', name: 'Null', volume: null }), row({ key: '/items/high::0', name: 'High', volume: 9 }), row({ key: '/items/low::0', name: 'Low', volume: 2 })],
      'volume',
      'desc',
    );

    expect(sorted.map((item) => item.volume)).toEqual([9, 2, null]);
  });

  it('puts NaN values last in both directions', () => {
    const rows = [
      row({ key: '/items/nan::0', name: 'NaN', price: Number.NaN }),
      row({ key: '/items/valid::0', name: 'Valid', price: 9 }),
      row({ key: '/items/null::0', name: 'Null', price: null }),
    ];

    expect(sortRows(rows, 'price', 'asc')[0]?.key).toBe('/items/valid::0');
    expect(sortRows(rows, 'price', 'desc')[0]?.key).toBe('/items/valid::0');
  });

  it.each([
    'price',
    'bid',
    'ask',
    'spread',
    'volume',
    'change1d',
    'change3d',
    'change7d',
    'volatility',
    'volumeMultiple',
    'name',
    'category',
    'enhancement',
  ] as SortField[])('supports sorting by %s', (field) => {
    expect(sortRows([row()], field, 'asc')).toHaveLength(1);
  });

  it('sorts the selected period change numerically', () => {
    const sorted = sortRows(
      [row({ key: '/items/down::0', changes: { '1d': -5, '3d': null, '7d': null } }), row({ key: '/items/up::0', changes: { '1d': 7, '3d': null, '7d': null } })],
      'change1d',
      'desc',
    );

    expect(sorted.map((item) => item.key)).toEqual(['/items/up::0', '/items/down::0']);
  });
});

describe('filterRows', () => {
  const rows = [
    row({
      key: '/items/Cowbell::0',
      name: '紅色 Cowbell',
      categoryHrid: '/item_categories/food',
      enhancementLevel: 3,
      volume: 20,
      spreadPct: 5,
    }),
    row({
      key: '/items/Gloves::7',
      name: '時空手套',
      categoryHrid: '/item_categories/equipment',
      enhancementLevel: 7,
      volume: null,
      spreadPct: null,
    }),
  ];

  it('filters by case-insensitive name or key query', () => {
    expect(filterRows(rows, { query: 'COWBELL' }).map((item) => item.key)).toEqual([
      '/items/Cowbell::0',
    ]);
    expect(filterRows(rows, { query: 'gloves::7' }).map((item) => item.key)).toEqual([
      '/items/Gloves::7',
    ]);
  });

  it('filters by expanded official category set and enhancement levels', () => {
    expect(
      filterRows(rows, {
        categories: new Set(['/item_categories/food']),
        enhancementLevels: new Set([3]),
      }).map((item) => item.key),
    ).toEqual(['/items/Cowbell::0']);

    expect(filterRows(rows, { categories: new Set(['consumable']) }).map((item) => item.key)).toEqual([
      '/items/Cowbell::0',
    ]);
  });

  it('rejects null volume for a minimum and null spread for a maximum', () => {
    expect(filterRows(rows, { minimumVolume: 1 }).map((item) => item.key)).toEqual([
      '/items/Cowbell::0',
    ]);
    expect(filterRows(rows, { maximumSpreadPct: 10 }).map((item) => item.key)).toEqual([
      '/items/Cowbell::0',
    ]);
  });
});

describe('flagsForRow', () => {
  it('combines move and thin for a large move with insufficient volume', () => {
    const flags = flagsForRow(
      row({
        price: 100,
        spreadPct: 5,
        changes: { '1d': 20, '3d': null, '7d': null },
        volume: 2,
      }),
      { movePct: 5, volumeMultiple: 2, wideSpreadPct: 10, minimumVolume: 5 },
    );

    expect(flags).toEqual(['move', 'thin']);
  });

  it('adds volume-spike, wide-spread, and one-sided only for valid source values', () => {
    const flags = flagsForRow(
      row({
        volumeMultiple: 3,
        spreadPct: 15,
        quality: 'ask-only',
        changes: { '1d': -6, '3d': null, '7d': null },
      }),
      { movePct: 5, volumeMultiple: 2, wideSpreadPct: 10, minimumVolume: 1 },
    );

    expect(flags).toEqual(['move', 'volume-spike', 'wide-spread', 'one-sided']);
  });

  it('never flags a missing price as a move', () => {
    const flags = flagsForRow(
      row({ price: null, changes: { '1d': 99, '3d': null, '7d': null } }),
      { movePct: 5, volumeMultiple: 2, wideSpreadPct: 10, minimumVolume: 1 },
    );

    expect(flags).not.toContain('move');
  });

  it('uses the selected period and keeps every flag unique', () => {
    const flags = flagsForRow(
      row({ changes: { '1d': 1, '3d': 8, '7d': null } }),
      { period: '3d', movePct: 5, volumeMultiple: 99, wideSpreadPct: 99, minimumVolume: 1 },
    );

    expect(flags).toEqual(['move']);
    expect(new Set(flags).size).toBe(flags.length);
  });
});
