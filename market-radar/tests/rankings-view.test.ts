// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DerivedMarketRow } from '../src/dashboard/state';
import { normalizeCatalog } from '../src/dashboard/state';
import { renderMarketTable } from '../src/dashboard/table';
import {
  RANKING_MODES,
  rankRowsForMode,
  renderRankingModeButtons,
} from '../src/dashboard/rankings-view';

function row(overrides: Partial<DerivedMarketRow> = {}): DerivedMarketRow {
  return {
    key: '/items/default::0',
    itemHrid: '/items/default',
    name: 'Default',
    categoryHrid: '/item_categories/resource',
    enhancementLevel: 0,
    price: 100,
    bid: 95,
    ask: 105,
    spreadPct: 10,
    volume: 10,
    changes: { '1d': null, '3d': null, '7d': null },
    volatilityPct: 1,
    volumeMultiple: 1,
    quality: 'official',
    flags: [],
    watchlisted: false,
    order: null,
    catalogSortIndex: 0,
    ...overrides,
  };
}

describe('rankRowsForMode', () => {
  const rows = [
    row({ key: '/items/gainer::0', name: 'Gainer', changes: { '1d': 12, '3d': 2, '7d': 3 } }),
    row({ key: '/items/loser::0', name: 'Loser', changes: { '1d': -12, '3d': -2, '7d': -3 } }),
    row({ key: '/items/null-change::0', name: 'Null change', changes: { '1d': null, '3d': null, '7d': null } }),
    row({ key: '/items/volume::0', name: 'Volume', volume: 99, volumeMultiple: 4 }),
    row({ key: '/items/anomaly::0', name: 'Anomaly', volume: 9, volumeMultiple: 9 }),
    row({ key: '/items/volatile::0', name: 'Volatile', volatilityPct: 20 }),
    row({ key: '/items/spread::0', name: 'Spread', spreadPct: 40 }),
    row({ key: '/items/no-bid::0', name: 'No bid', bid: null }),
    row({ key: '/items/no-ask::0', name: 'No ask', ask: null }),
  ];

  it('exposes the market table and seven ranking modes in the required order', () => {
    expect(RANKING_MODES.map((entry) => entry.mode)).toEqual([
      'market', 'gainers', 'losers', 'volume', 'volume-anomaly', 'volatility', 'spread', 'missing-side',
    ]);
  });

  it('sorts each ranking by the selected period/source and excludes nulls', () => {
    expect(rankRowsForMode(rows, 'gainers', '1d').map((item) => item.key)).toEqual([
      '/items/gainer::0',
      '/items/loser::0',
    ]);
    expect(rankRowsForMode(rows, 'losers', '1d').map((item) => item.key)).toEqual([
      '/items/loser::0',
      '/items/gainer::0',
    ]);
    expect(rankRowsForMode(rows, 'volume', '1d')[0]?.key).toBe('/items/volume::0');
    expect(rankRowsForMode(rows, 'volume-anomaly', '1d')[0]?.key).toBe('/items/anomaly::0');
    expect(rankRowsForMode(rows, 'volatility', '1d')[0]?.key).toBe('/items/volatile::0');
    expect(rankRowsForMode(rows, 'spread', '1d')[0]?.key).toBe('/items/spread::0');
    expect(rankRowsForMode(rows, 'missing-side', '1d').map((item) => item.key)).toEqual([
      '/items/no-ask::0',
      '/items/no-bid::0',
    ]);
  });

  it('uses the requested period for gainers and losers', () => {
    const periodRows = [
      row({ key: '/items/a::0', name: 'A', changes: { '1d': 1, '3d': 30, '7d': -3 } }),
      row({ key: '/items/b::0', name: 'B', changes: { '1d': 2, '3d': 20, '7d': -8 } }),
    ];

    expect(rankRowsForMode(periodRows, 'gainers', '3d').map((item) => item.key)).toEqual(['/items/a::0', '/items/b::0']);
    expect(rankRowsForMode(periodRows, 'losers', '7d').map((item) => item.key)).toEqual(['/items/b::0', '/items/a::0']);
  });

  it('does not mutate input rows', () => {
    const before = [...rows];
    const result = rankRowsForMode(rows, 'gainers', '1d');
    expect(result).not.toBe(rows);
    expect(rows).toEqual(before);
  });
});

describe('ranking mode buttons', () => {
  it('renders active state with aria-pressed for all eight modes', () => {
    const target = document.createElement('div');
    renderRankingModeButtons(target, 'volume', () => undefined);

    const buttons = [...target.querySelectorAll<HTMLButtonElement>('[data-ranking-mode]')];
    expect(buttons).toHaveLength(8);
    expect(buttons.find((button) => button.dataset.rankingMode === 'volume')?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons.find((button) => button.dataset.rankingMode === 'gainers')?.getAttribute('aria-pressed')).toBe('false');
    expect(buttons.find((button) => button.dataset.rankingMode === 'volume')?.classList.contains('is-active')).toBe(true);
  });

  it('renders all source flags as Chinese badges without dropping simultaneous signals', () => {
    const target = document.createElement('div');
    renderMarketTable(target, {
      rows: [row({
        quality: 'ask-only',
        flags: ['thin', 'one-sided', 'wide-spread', 'volume-spike', 'move'],
      })],
      catalog: normalizeCatalog({ categories: [], items: [] }),
      selectedPeriod: '1d',
      sortState: null,
      view: 'all',
      onSort: () => undefined,
      onTogglePin: () => undefined,
    });

    expect([...target.querySelectorAll<HTMLElement>('[data-flag]')].map((badge) => badge.textContent)).toEqual([
      '薄量', '單邊', '大價差', '異常量', '異動',
    ]);
  });

  it('uses the natural empty-state text when a ranking has no rows', () => {
    const target = document.createElement('div');
    renderMarketTable(target, {
      rows: [],
      catalog: normalizeCatalog({ categories: [], items: [] }),
      selectedPeriod: '1d',
      sortState: null,
      view: 'gainers',
      onSort: () => undefined,
      onTogglePin: () => undefined,
    });

    expect(target.textContent).toContain('目前篩選沒有符合項目');
  });
});
