// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeBootstrap,
  CatalogData,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../src/core/types';
import type { DashboardClient } from '../src/dashboard/client';
import { mountDashboard } from '../src/app';
import * as dashboardState from '../src/dashboard/state';

const BASE_TIMESTAMP = Date.parse('2026-08-30T10:00:00Z');
const LATEST_TIMESTAMP = Date.parse('2026-08-31T10:00:00Z');

const catalog: CatalogData = {
  categories: [
    { hrid: '/item_categories/currency', name: '貨幣', sortIndex: 1 },
    { hrid: '/item_categories/loot', name: '戰利品', sortIndex: 2 },
    { hrid: '/item_categories/scroll', name: '卷軸', sortIndex: 3 },
    { hrid: '/item_categories/labyrinth', name: '迷宮', sortIndex: 4 },
    { hrid: '/item_categories/dungeon_key', name: '地下城鑰匙', sortIndex: 5 },
    { hrid: '/item_categories/food', name: '食物', sortIndex: 6 },
    { hrid: '/item_categories/drink', name: '飲料', sortIndex: 7 },
    { hrid: '/item_categories/ability_book', name: '技能書', sortIndex: 8 },
    { hrid: '/item_categories/equipment', name: '裝備', sortIndex: 9 },
    { hrid: '/item_categories/resource', name: '資源', sortIndex: 10 },
  ],
  items: [
    { hrid: '/items/alpha', name: 'Alpha Ore', categoryHrid: '/item_categories/resource', sortIndex: 0 },
    { hrid: '/items/gloves', name: 'Chrono Gloves', categoryHrid: '/item_categories/equipment', sortIndex: 1 },
    { hrid: '/items/unsafe', name: '<img src=x onerror=alert(1)>', categoryHrid: '/item_categories/loot', sortIndex: 2 },
  ],
};

const snapshots: Snapshot[] = [
  {
    timestamp: BASE_TIMESTAMP,
    quotes: {
      '/items/alpha::0': { a: 101, b: 99, p: 100, v: 4 },
      '/items/gloves::7': { a: 101, b: 99, p: 100, v: 4 },
      '/items/gloves::10': { a: 101, b: 99, p: 100, v: 4 },
      '/items/unsafe::0': { a: 101, b: 99, p: 100, v: 4 },
      '/items/unknown_item::0': { a: null, b: null, p: 50, v: 4 },
    },
  },
  {
    timestamp: LATEST_TIMESTAMP,
    quotes: {
      '/items/alpha::0': { a: 121, b: 119, p: 120, v: 8 },
      '/items/gloves::7': { a: 81, b: 79, p: 80, v: 1 },
      '/items/gloves::10': { a: 91, b: 89, p: 90, v: 3 },
      '/items/unsafe::0': { a: 101, b: 99, p: 100, v: 4 },
      '/items/unknown_item::0': { a: null, b: null, p: 50, v: 4 },
      '/items/no_market::0': { a: null, b: null, p: null, v: null },
    },
  },
];

const settings: RadarSettings = {
  period: '1d',
  minimumVolume: 0,
  maximumSpreadPct: null,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};

const collectorStatus: CollectorStatus = {
  state: 'ok',
  lastAttemptAt: LATEST_TIMESTAMP,
  lastSuccessAt: LATEST_TIMESTAMP,
  officialTimestamp: LATEST_TIMESTAMP,
  nextRunAt: LATEST_TIMESTAMP + 60 * 60 * 1_000,
  lastErrorCode: null,
};

const bootstrap: BridgeBootstrap = {
  watchlist: [
    { key: '/items/gloves::7', order: 0 },
    { key: '/items/alpha::0', order: 1 },
  ],
  settings,
  collectorStatus,
  latestTimestamp: LATEST_TIMESTAMP,
  snapshotCount: snapshots.length,
};

function createClient(overrides: Partial<DashboardClient> = {}): DashboardClient {
  return {
    bootstrap: vi.fn().mockResolvedValue(bootstrap),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    setWatchlist: vi.fn().mockResolvedValue(undefined),
    setSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createRoot(): HTMLElement {
  document.body.innerHTML = '<main id="app"></main>';
  return document.querySelector<HTMLElement>('#app') as HTMLElement;
}

function rows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-market-row]')];
}

function rowByKey(root: HTMLElement, key: string): HTMLElement {
  const row = rows(root).find((candidate) => candidate.dataset.marketKey === key);
  if (!row) throw new Error(`Missing row ${key}`);
  return row;
}

function createManyRowFixture(count = 305): {
  snapshots: Snapshot[];
  bootstrap: BridgeBootstrap;
} {
  const quotes = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const key = `/items/page_${String(index).padStart(3, '0')}::0`;
      return [key, { a: index + 2, b: index, p: index + 1, v: index + 1 }];
    }),
  ) as Snapshot['quotes'];
  const pagedSnapshots: Snapshot[] = [{ timestamp: LATEST_TIMESTAMP, quotes }];
  return {
    snapshots: pagedSnapshots,
    bootstrap: {
      ...bootstrap,
      watchlist: [],
      latestTimestamp: LATEST_TIMESTAMP,
      snapshotCount: pagedSnapshots.length,
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void } {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('mountDashboard', () => {
  it('loads catalog and bridge data and renders all market rows', async () => {
    const root = createRoot();
    const client = createClient();
    const catalogLoader = vi.fn().mockResolvedValue(catalog);

    await mountDashboard({ root, client, catalogLoader });

    expect(catalogLoader).toHaveBeenCalledTimes(1);
    expect(client.bootstrap).toHaveBeenCalledTimes(1);
    expect(client.listSnapshots).toHaveBeenCalledTimes(1);
    expect(rows(root)).toHaveLength(6);
    expect(root.textContent).toContain('Chrono Gloves');
    expect(root.textContent).toContain('+7');
    expect(root.textContent).toContain('unknown item');
  });

  it('switches between market and profile-gated strategy surfaces', async () => {
    const root = createRoot();
    const strategyDataLoader = vi.fn();
    await mountDashboard({
      root,
      client: createClient(),
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      strategyDataLoader,
    });

    root.querySelector<HTMLButtonElement>('[data-product-surface="strategy"]')?.click();
    await flushAsyncWork();
    expect(root.querySelector('[data-product-surface="strategy"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('#category-nav')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('#toolbar')?.hidden).toBe(true);
    expect(root.textContent).toContain('導入角色快照後計算');
    expect(strategyDataLoader).not.toHaveBeenCalled();

    root.querySelector<HTMLButtonElement>('[data-product-surface="market"]')?.click();
    expect(root.querySelector<HTMLElement>('#category-nav')?.hidden).toBe(false);
    expect(rows(root)).toHaveLength(6);
  });

  it('shows the no-bridge state with no market rows and never inserts demo data', async () => {
    const root = createRoot();
    const client = createClient({
      bootstrap: vi.fn().mockRejectedValue(new Error('bridge timeout')),
      listSnapshots: vi.fn().mockRejectedValue(new Error('bridge timeout')),
    });

    await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
    });

    expect(root.textContent).toContain('尚未偵測到 MWI Market Radar 腳本');
    expect(rows(root)).toHaveLength(0);
    expect(root.textContent).not.toContain('Alpha Ore');
  });

  it('renders eight primary views and ten expandable official categories', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });

    expect([...root.querySelectorAll<HTMLElement>('[data-primary-view]')].map((button) => button.textContent)).toEqual([
      '自選', '全市場', '資源', '消耗品', '技能書', '迷宮', '裝備', '其他',
    ]);
    expect(root.querySelectorAll('[data-official-category]')).toHaveLength(10);
    const all = root.querySelector<HTMLElement>('[data-primary-view="all"]');
    expect(all?.getAttribute('aria-pressed')).toBe('true');
    root.querySelector<HTMLElement>('[data-primary-view="resource"]')?.click();
    expect(root.querySelector('[data-primary-view="resource"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/alpha::0']);
  });

  it('renders period controls, search, enhancement, liquidity, and reset controls', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });

    expect(root.querySelectorAll('[data-period]')).toHaveLength(3);
    expect(root.querySelector('[data-period="1d"]')?.textContent).toBe('1D');
    expect(root.querySelector('[data-period="3d"]')?.textContent).toBe('3D');
    expect(root.querySelector('[data-period="7d"]')?.textContent).toBe('7D');
    expect(root.querySelector('input[data-filter="search"]')).not.toBeNull();
    expect(root.querySelector('details[data-filter="enhancement"]')).not.toBeNull();
    expect(root.querySelector('input[data-filter="minimum-volume"]')).not.toBeNull();
    expect(root.querySelector('input[data-filter="maximum-spread"]')).not.toBeNull();
    expect(root.querySelector('[data-sort-reset]')).not.toBeNull();

    const search = root.querySelector<HTMLInputElement>('input[data-filter="search"]') as HTMLInputElement;
    search.value = 'Chrono';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/gloves::7', '/items/gloves::10']);

    const level7 = root.querySelector<HTMLInputElement>('[data-enhancement-level="7"]');
    if (!level7) throw new Error('Missing enhancement level 7 option');
    level7.checked = true;
    level7.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/gloves::7']);
    expect(root.querySelector('[data-enhancement-summary]')?.textContent).toBe('+7');
  });

  it('renders secondary market modes, ranks filtered results, and updates on period changes', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });

    const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-ranking-mode]')];
    expect(modeButtons.map((button) => button.textContent)).toEqual([
      '行情表', '漲幅榜', '跌幅榜', '成交量榜', '異常量榜', '波動榜', '大價差榜', '無買/無賣',
    ]);
    expect(root.querySelector('[data-ranking-mode="market"]')?.getAttribute('aria-pressed')).toBe('true');

    root.querySelector<HTMLButtonElement>('[data-ranking-mode="gainers"]')?.click();
    expect(root.querySelector('[data-ranking-mode="gainers"]')?.classList.contains('is-active')).toBe(true);
    expect(rows(root).at(0)?.dataset.marketKey).toBe('/items/alpha::0');
    expect(rows(root).some((row) => row.dataset.marketKey === '/items/no_market::0')).toBe(false);

    const search = root.querySelector<HTMLInputElement>('input[data-filter="search"]') as HTMLInputElement;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/alpha::0']);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    root.querySelector<HTMLButtonElement>('[data-ranking-mode="losers"]')?.click();
    expect(root.querySelector('[data-ranking-mode="losers"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rows(root).at(0)?.dataset.marketKey).toBe('/items/gloves::7');
    root.querySelector<HTMLButtonElement>('[data-sort-field="price"]')?.click();
    expect(root.querySelector('[data-sort-header="price"]')?.getAttribute('aria-sort')).toBe('descending');
    root.querySelector<HTMLButtonElement>('[data-ranking-mode="gainers"]')?.click();
    expect(root.querySelector('[data-sort-header="price"]')?.getAttribute('aria-sort')).toBe('none');
    root.querySelector<HTMLButtonElement>('[data-period="3d"]')?.click();
    expect(root.querySelector('.table-empty')?.textContent).toBe('目前篩選沒有符合項目');
  });

  it('cycles sortable headers descending, ascending, then default with nulls last', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const priceHeader = (): HTMLTableCellElement => root.querySelector<HTMLTableCellElement>('[data-sort-header="price"]') as HTMLTableCellElement;
    const priceButton = (): HTMLButtonElement => priceHeader().querySelector<HTMLButtonElement>('[data-sort-field="price"]') as HTMLButtonElement;

    priceButton().click();
    expect(priceHeader().getAttribute('aria-sort')).toBe('descending');
    expect(rows(root).at(-1)?.dataset.marketKey).toBe('/items/no_market::0');
    priceButton().click();
    expect(priceHeader().getAttribute('aria-sort')).toBe('ascending');
    expect(rows(root).at(-1)?.dataset.marketKey).toBe('/items/no_market::0');
    priceButton().click();
    expect(priceHeader().getAttribute('aria-sort')).toBe('none');
  });

  it('renders red up, green down, and gray missing trend semantics with text arrows', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });

    const up = rowByKey(root, '/items/alpha::0').querySelector<HTMLElement>('[data-change-period="1d"]');
    const down = rowByKey(root, '/items/gloves::7').querySelector<HTMLElement>('[data-change-period="1d"]');
    const missing = rowByKey(root, '/items/no_market::0').querySelector<HTMLElement>('[data-change-period="1d"]');
    expect(up?.textContent).toContain('▲');
    expect(up?.dataset.trend).toBe('up');
    expect(down?.textContent).toContain('▼');
    expect(down?.dataset.trend).toBe('down');
    expect(missing?.textContent).toContain('—');
    expect(missing?.dataset.trend).toBe('flat');
  });

  it('pins enhancement levels independently and persists only after success', async () => {
    const root = createRoot();
    const client = createClient();
    await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const pin10 = rowByKey(root, '/items/gloves::10').querySelector<HTMLButtonElement>('[data-pin]') as HTMLButtonElement;

    pin10.click();
    await flushAsyncWork();
    expect(client.setWatchlist).toHaveBeenCalledWith([
      { key: '/items/gloves::7', order: 0 },
      { key: '/items/alpha::0', order: 1 },
      { key: '/items/gloves::10', order: 2 },
    ]);
    expect(rowByKey(root, '/items/gloves::10').querySelector('[data-pin]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rowByKey(root, '/items/gloves::7').querySelector('[data-pin]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#item-detail')?.hasAttribute('open')).toBe(false);

    (client.setWatchlist as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('private write detail'));
    const pinUnsafe = rowByKey(root, '/items/unsafe::0').querySelector<HTMLButtonElement>('[data-pin]') as HTMLButtonElement;
    pinUnsafe.click();
    await flushAsyncWork();
    expect(pinUnsafe.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('[data-status-error]')?.textContent).toContain('自選儲存失敗');
    expect(root.querySelector('[data-status-error]')?.textContent).not.toContain('private write detail');
  });

  it('supports manual watchlist reorder controls and temporary market sort', async () => {
    const root = createRoot();
    const client = createClient();
    await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });
    root.querySelector<HTMLElement>('[data-primary-view="watchlist"]')?.click();
    const down = rowByKey(root, '/items/gloves::7').querySelector<HTMLButtonElement>('[data-watch-move="down"]');
    expect(down).not.toBeNull();
    expect(down?.disabled).toBe(false);
    down?.click();
    await flushAsyncWork();
    expect(client.setWatchlist).toHaveBeenCalledWith([
      { key: '/items/alpha::0', order: 0 },
      { key: '/items/gloves::7', order: 1 },
    ]);
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/alpha::0', '/items/gloves::7']);

    root.querySelector<HTMLButtonElement>('[data-sort-field="price"]')?.click();
    root.querySelector<HTMLElement>('[data-sort-reset]')?.click();
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/alpha::0', '/items/gloves::7']);
  });

  it('formats collector status times in Taipei time and uses an em dash for nulls', async () => {
    const root = createRoot();
    const client = createClient({
      bootstrap: vi.fn().mockResolvedValue({
        ...bootstrap,
        collectorStatus: { ...collectorStatus, officialTimestamp: null, lastSuccessAt: null, nextRunAt: null },
      }),
    });
    await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });

    expect(root.querySelector('[data-status-field="official"]')?.textContent).toContain('—');
    expect(root.querySelector('[data-status-field="collected"]')?.textContent).toContain('—');
    expect(root.querySelector('[data-status-field="next"]')?.textContent).toContain('—');
    expect(root.querySelector('[data-status-field="state"]')?.textContent).toContain('ok');
  });

  it('renders hostile catalog names as text and never creates an image element', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });

    expect(root.querySelectorAll('img')).toHaveLength(0);
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('opens item detail on row selection without changing the selection event contract', async () => {
    const root = createRoot();
    const chartFactory = vi.fn(() => ({ destroy: vi.fn() }));
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog), chartFactory });
    const selected = vi.fn();
    root.addEventListener('mwi-radar:item-selected', selected);

    rowByKey(root, '/items/alpha::0').click();

    expect(selected).toHaveBeenCalledTimes(1);
    expect((selected.mock.calls[0]?.[0] as CustomEvent<{ key: string }>).detail.key).toBe('/items/alpha::0');
    expect(root.querySelector('[data-detail-key]')?.getAttribute('data-detail-key')).toBe('/items/alpha::0');
    expect(root.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  });

  it('does not turn the all enhancement option into an accidental +0 filter', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const level7 = root.querySelector<HTMLInputElement>('[data-enhancement-level="7"]');
    if (!level7) throw new Error('Missing enhancement level 7 option');

    level7.checked = true;
    level7.dispatchEvent(new Event('change', { bubbles: true }));

    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/gloves::7']);
  });

  it('represents all enhancements with an empty concrete selection and an explicit clear button', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const enhancement = root.querySelector<HTMLElement>('details[data-filter="enhancement"]');
    const level7 = root.querySelector<HTMLInputElement>('[data-enhancement-level="7"]');
    if (!level7) throw new Error('Missing enhancement level 7 option');

    expect(root.querySelector('[data-enhancement-level=""]')).toBeNull();
    level7.checked = true;
    level7.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/gloves::7']);

    const clear = root.querySelector<HTMLButtonElement>('[data-enhancement-reset]');
    expect(clear).not.toBeNull();
    clear?.click();
    expect(enhancement?.querySelectorAll('input:checked')).toHaveLength(0);
    expect(root.querySelector('[data-enhancement-summary]')?.textContent).toBe('全部等級');
    expect(rows(root)).toHaveLength(6);
  });

  it('summarizes multiple enhancement selections without expanding the control text', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const level7 = root.querySelector<HTMLInputElement>('[data-enhancement-level="7"]');
    const level10 = root.querySelector<HTMLInputElement>('[data-enhancement-level="10"]');
    if (!level7 || !level10) throw new Error('Missing enhancement options');

    level7.checked = true;
    level7.dispatchEvent(new Event('change', { bubbles: true }));
    level10.checked = true;
    level10.dispatchEvent(new Event('change', { bubbles: true }));

    expect(root.querySelector('[data-enhancement-summary]')?.textContent).toBe('已選 2 個');
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(['/items/gloves::7', '/items/gloves::10']);
  });

  it('serializes rapid pin writes and computes each operation from the latest committed state', async () => {
    const root = createRoot();
    const writes: Array<ReturnType<typeof deferred<void>> & { value: WatchItem[] }> = [];
    const client = createClient({
      setWatchlist: vi.fn((value: WatchItem[]) => {
        const pending = deferred<void>();
        writes.push({ ...pending, value });
        return pending.promise;
      }),
    });
    await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });

    rowByKey(root, '/items/unsafe::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();
    rowByKey(root, '/items/unknown_item::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();

    expect(writes).toHaveLength(1);
    writes[0]?.resolve();
    await flushAsyncWork();
    expect(writes).toHaveLength(2);
    expect(writes[1]?.value).toEqual([
      { key: '/items/gloves::7', order: 0 },
      { key: '/items/alpha::0', order: 1 },
      { key: '/items/unsafe::0', order: 2 },
      { key: '/items/unknown_item::0', order: 3 },
    ]);
    writes[1]?.resolve();
    await flushAsyncWork();

    expect(rowByKey(root, '/items/unsafe::0').querySelector('[data-pin]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rowByKey(root, '/items/unknown_item::0').querySelector('[data-pin]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('continues the serialized watchlist queue after a failed mutation', async () => {
    const root = createRoot();
    const writes: Array<ReturnType<typeof deferred<void>> & { value: WatchItem[] }> = [];
    const client = createClient({
      setWatchlist: vi.fn((value: WatchItem[]) => {
        const pending = deferred<void>();
        writes.push({ ...pending, value });
        return pending.promise;
      }),
    });
    await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });

    rowByKey(root, '/items/unsafe::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();
    rowByKey(root, '/items/unknown_item::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();
    writes[0]?.reject(new Error('private write failure'));
    await flushAsyncWork();

    expect(writes).toHaveLength(2);
    expect(writes[1]?.value).toEqual([
      { key: '/items/gloves::7', order: 0 },
      { key: '/items/alpha::0', order: 1 },
      { key: '/items/unknown_item::0', order: 2 },
    ]);
    expect(root.querySelector('[data-status-error]')?.textContent).toContain('自選儲存失敗');
    writes[1]?.resolve();
    await flushAsyncWork();
    expect(rowByKey(root, '/items/unknown_item::0').querySelector('[data-pin]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('serializes rapid watchlist reorders without losing the second move', async () => {
    const root = createRoot();
    const reorderBootstrap = {
      ...bootstrap,
      watchlist: [
        { key: '/items/gloves::7', order: 0 },
        { key: '/items/alpha::0', order: 1 },
        { key: '/items/unsafe::0', order: 2 },
      ],
    };
    const writes: Array<ReturnType<typeof deferred<void>> & { value: WatchItem[] }> = [];
    const client = createClient({
      bootstrap: vi.fn().mockResolvedValue(reorderBootstrap),
      setWatchlist: vi.fn((value: WatchItem[]) => {
        const pending = deferred<void>();
        writes.push({ ...pending, value });
        return pending.promise;
      }),
    });
    await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });
    root.querySelector<HTMLElement>('[data-primary-view="watchlist"]')?.click();

    const down = rowByKey(root, '/items/gloves::7').querySelector<HTMLButtonElement>('[data-watch-move="down"]');
    down?.click();
    down?.click();
    expect(writes).toHaveLength(1);
    writes[0]?.resolve();
    await flushAsyncWork();

    expect(writes).toHaveLength(2);
    expect(writes[1]?.value).toEqual([
      { key: '/items/alpha::0', order: 0 },
      { key: '/items/unsafe::0', order: 1 },
      { key: '/items/gloves::7', order: 2 },
    ]);
    writes[1]?.resolve();
    await flushAsyncWork();
    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual([
      '/items/alpha::0', '/items/unsafe::0', '/items/gloves::7',
    ]);
  });

  it('keeps filter inputs mounted and reuses derived rows while typing and sorting', async () => {
    const root = createRoot();
    const deriveSpy = vi.spyOn(dashboardState, 'deriveRows');
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const initialDeriveCalls = deriveSpy.mock.calls.length;
    const search = root.querySelector<HTMLInputElement>('input[data-filter="search"]') as HTMLInputElement;
    search.focus();
    search.value = 'C';
    search.setSelectionRange(1, 1);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('input[data-filter="search"]')).toBe(search);
    search.value = 'Ch';
    search.setSelectionRange(2, 2);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('Ch');
    root.querySelector<HTMLButtonElement>('[data-sort-field="price"]')?.click();
    expect(deriveSpy.mock.calls.length).toBe(initialDeriveCalls);
    deriveSpy.mockRestore();
  });

  it('does not mutate the root when a pending watchlist write resolves after destroy', async () => {
    const root = createRoot();
    const pending = deferred<void>();
    const client = createClient({ setWatchlist: vi.fn().mockReturnValue(pending.promise) });
    const handle = await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });
    rowByKey(root, '/items/unsafe::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();
    const beforeDestroy = root.innerHTML;
    handle.destroy();
    pending.resolve();
    await flushAsyncWork();

    expect(root.innerHTML).toBe(beforeDestroy);
  });

  it('settles queued watchlist operations after destroy without starting another write', async () => {
    const root = createRoot();
    const writes: Array<ReturnType<typeof deferred<void>> & { value: WatchItem[] }> = [];
    const client = createClient({
      setWatchlist: vi.fn((value: WatchItem[]) => {
        const pending = deferred<void>();
        writes.push({ ...pending, value });
        return pending.promise;
      }),
    });
    const handle = await mountDashboard({ root, client, catalogLoader: vi.fn().mockResolvedValue(catalog) });

    rowByKey(root, '/items/unsafe::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();
    rowByKey(root, '/items/unknown_item::0').querySelector<HTMLButtonElement>('[data-pin]')?.click();
    expect(writes).toHaveLength(1);
    const beforeDestroy = root.innerHTML;
    handle.destroy();
    writes[0]?.resolve();
    await flushAsyncWork();

    expect(writes).toHaveLength(1);
    expect(root.innerHTML).toBe(beforeDestroy);
  });

  it('places aria-sort on the header cell and marks the active primary view', async () => {
    const root = createRoot();
    await mountDashboard({ root, client: createClient(), catalogLoader: vi.fn().mockResolvedValue(catalog) });
    const priceButton = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-sort-field="price"]') as HTMLButtonElement;
    const priceHeader = (): HTMLTableCellElement => root.querySelector<HTMLTableCellElement>('[data-sort-header="price"]') as HTMLTableCellElement;

    expect(root.querySelector('[data-primary-view="all"]')?.classList.contains('is-active')).toBe(true);
    priceButton().click();
    expect(priceHeader().getAttribute('aria-sort')).toBe('descending');
    expect(priceButton().hasAttribute('aria-sort')).toBe(false);
    root.querySelector<HTMLElement>('[data-primary-view="resource"]')?.click();
    expect(root.querySelector('[data-primary-view="resource"]')?.classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-primary-view="all"]')?.classList.contains('is-active')).toBe(false);
  });

  it('polls health without rebuilding the table or focused inputs when data is unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATEST_TIMESTAMP);
    const root = createRoot();
    const client = createClient();
    const setIntervalSpy = vi.fn((callback: () => void, delay: number) => setInterval(callback, delay));
    const clearIntervalSpy = vi.fn((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
    const handle = await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
      pollMs: 60_000,
      now: () => Date.now(),
    });
    const table = root.querySelector('table');
    const search = root.querySelector<HTMLInputElement>('input[data-filter="search"]') as HTMLInputElement;
    search.focus();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
    expect(client.listSnapshots).toHaveBeenCalledTimes(1);
    expect(root.querySelector('table')).toBe(table);
    expect(root.querySelector('input[data-filter="search"]')).toBe(search);
    expect(document.activeElement).toBe(search);
    handle.destroy();
  });

  it('shows stale health after polling advances beyond the freshness window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATEST_TIMESTAMP);
    const root = createRoot();
    const staleBootstrap = {
      ...bootstrap,
      collectorStatus: { ...collectorStatus, lastSuccessAt: LATEST_TIMESTAMP },
    };
    const client = createClient({ bootstrap: vi.fn().mockResolvedValue(staleBootstrap) });
    const handle = await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      pollMs: 60_000,
      now: () => Date.now(),
    });

    await vi.advanceTimersByTimeAsync(2.5 * 60 * 60 * 1_000 + 60_000);

    expect(root.querySelector('[data-status-field="state"]')?.textContent).toContain('資料已停止更新');
    handle.destroy();
  });

  it('fetches snapshots and refreshes rows when poll metadata changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATEST_TIMESTAMP);
    const root = createRoot();
    const nextTimestamp = LATEST_TIMESTAMP + 60 * 60 * 1_000;
    const nextSnapshots: Snapshot[] = [
      ...snapshots,
      {
        timestamp: nextTimestamp,
        quotes: {
          '/items/alpha::0': { a: 131, b: 129, p: 130, v: 9 },
          '/items/gloves::7': { a: 82, b: 80, p: 81, v: 2 },
        },
      },
    ];
    const nextBootstrap = {
      ...bootstrap,
      latestTimestamp: nextTimestamp,
      snapshotCount: nextSnapshots.length,
      collectorStatus: { ...collectorStatus, officialTimestamp: nextTimestamp, lastSuccessAt: nextTimestamp },
    };
    const client = createClient({
      bootstrap: vi.fn().mockResolvedValueOnce(bootstrap).mockResolvedValueOnce(nextBootstrap),
      listSnapshots: vi.fn().mockResolvedValueOnce(snapshots).mockResolvedValueOnce(nextSnapshots),
    });
    const handle = await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      pollMs: 60_000,
      now: () => Date.now(),
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.listSnapshots).toHaveBeenCalledTimes(2);
    expect(rowByKey(root, '/items/alpha::0').textContent).toContain('130');
    handle.destroy();
  });

  it('keeps old rows and reports a safe poll failure', async () => {
    vi.useFakeTimers();
    const root = createRoot();
    const client = createClient({
      bootstrap: vi.fn().mockResolvedValueOnce(bootstrap).mockRejectedValueOnce(new Error('private poll payload')),
    });
    const handle = await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      pollMs: 60_000,
    });
    const beforeRows = rows(root).map((row) => row.dataset.marketKey);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(rows(root).map((row) => row.dataset.marketKey)).toEqual(beforeRows);
    expect(root.textContent).toContain('市場資料更新失敗');
    expect(root.textContent).not.toContain('private poll payload');
    handle.destroy();
  });

  it('does not overlap polling and resumes after the in-flight check settles', async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: BridgeBootstrap) => void;
    const root = createRoot();
    const client = createClient({
      bootstrap: vi.fn()
        .mockResolvedValueOnce(bootstrap)
        .mockImplementationOnce(() => new Promise<BridgeBootstrap>((resolve) => {
          resolvePoll = resolve;
        }))
        .mockResolvedValue(bootstrap),
    });
    const handle = await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      pollMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
    resolvePoll(bootstrap);
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.bootstrap).toHaveBeenCalledTimes(3);
    handle.destroy();
  });

  it('clears polling and ignores an in-flight poll result after destroy', async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: BridgeBootstrap) => void;
    const root = createRoot();
    const client = createClient({
      bootstrap: vi.fn()
        .mockResolvedValueOnce(bootstrap)
        .mockImplementationOnce(() => new Promise<BridgeBootstrap>((resolve) => {
          resolvePoll = resolve;
        })),
    });
    const clearIntervalSpy = vi.fn((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
    const handle = await mountDashboard({
      root,
      client,
      catalogLoader: vi.fn().mockResolvedValue(catalog),
      pollMs: 60_000,
      clearInterval: clearIntervalSpy,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const beforeDestroy = root.innerHTML;

    handle.destroy();
    resolvePoll({ ...bootstrap, latestTimestamp: LATEST_TIMESTAMP + 1, snapshotCount: 999 });
    await flushAsyncWork();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toBe(beforeDestroy);
  });

  it('renders 305 rows as three full pages and one final partial page', async () => {
    const root = createRoot();
    const fixture = createManyRowFixture();
    await mountDashboard({
      root,
      client: createClient({
        bootstrap: vi.fn().mockResolvedValue(fixture.bootstrap),
        listSnapshots: vi.fn().mockResolvedValue(fixture.snapshots),
      }),
      catalogLoader: vi.fn().mockResolvedValue(catalog),
    });

    const pageLabel = (): string => root.querySelector<HTMLElement>('[data-pagination-page]')?.textContent ?? '';
    const previous = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-pagination-previous]') as HTMLButtonElement;
    const next = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-pagination-next]') as HTMLButtonElement;

    expect(rows(root)).toHaveLength(100);
    expect(pageLabel()).toBe('第 1 / 4 頁・共 305 筆');
    expect(previous().disabled).toBe(true);
    expect(next().disabled).toBe(false);

    next().click();
    expect(rows(root)).toHaveLength(100);
    expect(pageLabel()).toBe('第 2 / 4 頁・共 305 筆');
    expect(previous().disabled).toBe(false);

    next().click();
    expect(rows(root)).toHaveLength(100);
    expect(pageLabel()).toBe('第 3 / 4 頁・共 305 筆');

    next().click();
    expect(rows(root)).toHaveLength(5);
    expect(pageLabel()).toBe('第 4 / 4 頁・共 305 筆');
    expect(next().disabled).toBe(true);
  });

  it('sorts and filters the full row set before slicing and resets to page one', async () => {
    const root = createRoot();
    const fixture = createManyRowFixture();
    await mountDashboard({
      root,
      client: createClient({
        bootstrap: vi.fn().mockResolvedValue(fixture.bootstrap),
        listSnapshots: vi.fn().mockResolvedValue(fixture.snapshots),
      }),
      catalogLoader: vi.fn().mockResolvedValue(catalog),
    });

    root.querySelector<HTMLButtonElement>('[data-pagination-next]')?.click();
    const pageLabel = (): string => root.querySelector<HTMLElement>('[data-pagination-page]')?.textContent ?? '';
    expect(pageLabel()).toContain('第 2 / 4 頁');

    root.querySelector<HTMLButtonElement>('[data-sort-field="price"]')?.click();
    expect(pageLabel()).toContain('第 1 / 4 頁');
    expect(rows(root)[0]?.dataset.marketKey).toBe('/items/page_304::0');

    const search = root.querySelector<HTMLInputElement>('input[data-filter="search"]') as HTMLInputElement;
    search.value = 'page_29';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows(root).length).toBeGreaterThan(0);
    expect(rows(root).every((row) => row.dataset.marketKey?.includes('page_29'))).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-pagination-page]')?.textContent).toMatch(/^第 1 \/ 1 頁・共 \d+ 筆$/);
  });

  it('does not render pagination controls for an empty result', async () => {
    const root = createRoot();
    const fixture = createManyRowFixture();
    await mountDashboard({
      root,
      client: createClient({
        bootstrap: vi.fn().mockResolvedValue(fixture.bootstrap),
        listSnapshots: vi.fn().mockResolvedValue(fixture.snapshots),
      }),
      catalogLoader: vi.fn().mockResolvedValue(catalog),
    });

    const search = root.querySelector<HTMLInputElement>('input[data-filter="search"]') as HTMLInputElement;
    search.value = 'not-found';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelector('.table-empty')?.textContent).toBe('目前篩選沒有符合項目');
    expect(root.querySelector('[data-pagination]')).toBeNull();
  });
});
