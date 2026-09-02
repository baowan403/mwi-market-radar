// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogData, MarketKey, Snapshot, WatchItem } from '../src/core/types';
import {
  buildItemChartModel,
  buildItemChartConfig,
  createItemDetailController,
  formatTaipeiChartLabel,
  type ItemChartFactory,
} from '../src/dashboard/item-detail';

const key = '/items/gloves::7' as MarketKey;
const latest = Date.parse('2026-08-31T10:00:00Z');
const hour = 60 * 60 * 1_000;

const catalog: CatalogData = {
  categories: [{ hrid: '/item_categories/equipment', name: '裝備', sortIndex: 1 }],
  items: [{ hrid: '/items/gloves', name: '時空手套', categoryHrid: '/item_categories/equipment', sortIndex: 1 }],
};

function snapshot(timestamp: number, quote: Partial<Snapshot['quotes'][MarketKey]> = {}): Snapshot {
  return {
    timestamp,
    quotes: {
      [key]: { a: 105, b: 95, p: 100, v: 5, ...quote },
    },
  } as Snapshot;
}

const snapshots: Snapshot[] = [
  snapshot(latest, { a: 125, b: 115, p: 120, v: 8 }),
  snapshot(latest - 2 * hour, { a: 110, b: 90, p: null, v: 4 }),
  snapshot(latest - 24 * hour, { a: 105, b: 95, p: 100, v: 5 }),
  snapshot(latest - 26 * hour, { a: 85, b: 75, p: 80, v: 2 }),
];

function chartFactory(): { factory: ItemChartFactory; charts: Array<{ destroy: ReturnType<typeof vi.fn> }> } {
  const charts: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const factory: ItemChartFactory = vi.fn(() => {
    const chart = { destroy: vi.fn() };
    charts.push(chart);
    return chart;
  });
  return { factory, charts };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('buildItemChartModel', () => {
  it('sorts snapshots, applies the selected period cutoff, labels Taipei time, and preserves p gaps', () => {
    const model = buildItemChartModel(key, snapshots, '1d');
    const marketPrice = model.datasets.find((dataset) => dataset.label === '市場價');
    const ask = model.datasets.find((dataset) => dataset.label === '賣一');
    const bid = model.datasets.find((dataset) => dataset.label === '買一');
    const volume = model.datasets.find((dataset) => dataset.label === '成交量');

    expect(model.labels).toEqual([
      formatTaipeiChartLabel(latest - 24 * hour),
      formatTaipeiChartLabel(latest - 2 * hour),
      formatTaipeiChartLabel(latest),
    ]);
    expect(marketPrice?.data).toEqual([100, null, 120]);
    expect(ask?.data).toEqual([105, 110, 125]);
    expect(bid?.data).toEqual([95, 90, 115]);
    expect(volume?.data).toEqual([5, 4, 8]);
    expect(marketPrice?.type).toBe('line');
    expect(volume?.type).toBe('bar');
    expect(model.datasets.every((dataset) => dataset.spanGaps === false)).toBe(true);
    expect(model.stats).toMatchObject({
      snapshotCount: 3,
      validPriceSamples: 3,
      actualElapsedHours: 24,
      high: 120,
      low: 100,
      latestQuality: 'official',
      hasGaps: true,
      oneSided: false,
    });
  });

  it('uses priceBasis for stats and reports one-sided latest quotes without filling p', () => {
    const oneSided = [
      snapshot(latest - hour, { p: null, a: 80, b: null }),
      snapshot(latest, { p: null, a: 100, b: null }),
    ];
    const model = buildItemChartModel(key, oneSided, '1d');
    const marketPrice = model.datasets.find((dataset) => dataset.label === '市場價');

    expect(marketPrice?.data).toEqual([null, null]);
    expect(model.stats).toMatchObject({
      validPriceSamples: 2,
      high: 100,
      low: 80,
      latestQuality: 'ask-only',
      oneSided: true,
    });
  });

  it('returns an honest insufficient-sample model for a missing item history', () => {
    const model = buildItemChartModel(key, [snapshot(latest, { p: null, a: null, b: null, v: null })], '7d');

    expect(model.labels).toHaveLength(1);
    expect(model.stats).toMatchObject({
      snapshotCount: 1,
      validPriceSamples: 0,
      actualElapsedHours: null,
      high: null,
      low: null,
      latestQuality: 'missing',
      hasGaps: false,
      oneSided: false,
    });
  });
});

describe('createItemDetailController', () => {
  function setup(overrides: Partial<Parameters<typeof createItemDetailController>[0]> = {}) {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    const watchlist: WatchItem[] = [];
    const chart = chartFactory();
    const controller = createItemDetailController({
      dialog,
      snapshots,
      catalog,
      getWatchlist: () => watchlist,
      onTogglePin: vi.fn().mockResolvedValue(undefined),
      chartFactory: chart.factory,
      ...overrides,
    });
    return { dialog, watchlist, chart, controller };
  }

  it('renders safe item metadata, opens with a canvas, and destroys old charts on period/close', async () => {
    const { dialog, chart, controller } = setup();

    controller.open(key);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('[data-detail-name]')?.textContent).toBe('時空手套');
    expect(dialog.querySelector('[data-detail-level]')?.textContent).toBe('+7');
    expect(dialog.querySelector('[data-detail-category]')?.textContent).toBe('裝備');
    expect(dialog.querySelector('canvas')).not.toBeNull();
    expect(chart.factory).toHaveBeenCalledTimes(1);

    dialog.querySelector<HTMLButtonElement>('[data-detail-period="7d"]')?.click();
    await Promise.resolve();
    expect(chart.charts[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(chart.factory).toHaveBeenCalledTimes(2);

    controller.close();
    expect(chart.charts[1]?.destroy).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute('open')).toBe(false);
    controller.destroy();
  });

  it('keeps missing samples visible with an insufficient-sample warning', () => {
    const { dialog, controller } = setup({
      snapshots: [snapshot(latest, { p: null, a: null, b: null, v: null })],
    });

    controller.open(key);

    expect(dialog.textContent).toContain('樣本不足');
    expect(dialog.querySelector('canvas')).not.toBeNull();
  });

  it('uses compact K and M values for quote and history magnitudes', () => {
    const { dialog, controller } = setup({
      snapshots: [
        snapshot(latest - hour, { p: 1_000_000_000, a: 1_000_000_000, b: 999_000_000, v: 1_234 }),
        snapshot(latest, { p: 56_430_000, a: 57_000_000, b: 56_000_000, v: 12_300 }),
      ],
    });

    controller.open(key);

    expect(dialog.querySelector('[data-detail-metric="price"]')?.textContent).toContain('56.43M');
    expect(dialog.querySelector('[data-detail-metric="volume"]')?.textContent).toContain('12.3K');
    expect(dialog.querySelector('[data-detail-stats]')?.textContent).toContain('高 1,000M');
    expect(dialog.textContent).not.toMatch(/\d(?:\.\d+)?B\b/);
  });

  it('uses textContent for hostile names and never creates an image element', () => {
    const { dialog, controller } = setup({
      catalog: {
        ...catalog,
        items: [{ ...catalog.items[0]!, name: '<img src=x onerror=alert(1)>' }],
      },
    });

    controller.open(key);

    expect(dialog.querySelectorAll('img')).toHaveLength(0);
    expect(dialog.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('delegates pin success and does not fake state on failure', async () => {
    const onTogglePin = vi.fn().mockRejectedValue(new Error('private write detail'));
    const { dialog, controller } = setup({ onTogglePin });
    controller.open(key);

    const pin = dialog.querySelector<HTMLButtonElement>('[data-detail-pin]') as HTMLButtonElement;
    pin.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(onTogglePin).toHaveBeenCalledWith(key);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(dialog.querySelector('[data-detail-error]')?.textContent).toContain('自選儲存失敗');
    expect(dialog.textContent).not.toContain('private write detail');
  });

  it('destroys the chart when native close is dispatched and ignores later opens after destroy', () => {
    const { dialog, chart, controller } = setup();
    controller.open(key);
    dialog.dispatchEvent(new Event('close'));
    expect(chart.charts[0]?.destroy).toHaveBeenCalledTimes(1);
    controller.destroy();
    controller.open(key);
    expect(chart.factory).toHaveBeenCalledTimes(1);
  });

  it('uses native dialog.close when an open dialog supports it and destroys the chart once', () => {
    const { dialog, chart, controller } = setup();
    const close = vi.fn(() => dialog.removeAttribute('open'));
    Object.defineProperty(dialog, 'close', { configurable: true, value: close });
    controller.open(key);

    controller.close();

    expect(close).toHaveBeenCalledTimes(1);
    expect(chart.charts[0]?.destroy).toHaveBeenCalledTimes(1);
    controller.close();
    expect(chart.charts[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it('recovers from a synchronous pin callback throw and allows a second click', async () => {
    const onTogglePin = vi.fn(() => {
      throw new Error('private callback detail');
    });
    const { dialog, controller } = setup({ onTogglePin });
    controller.open(key);
    const pin = dialog.querySelector<HTMLButtonElement>('[data-detail-pin]') as HTMLButtonElement;

    pin.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(pin.disabled).toBe(false);
    expect(dialog.querySelector('[data-detail-error]')?.textContent).toBe('自選儲存失敗');
    expect(dialog.textContent).not.toContain('private callback detail');

    pin.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onTogglePin).toHaveBeenCalledTimes(2);
  });

  it('assigns separate price and volume axes in the model and Chart.js config', () => {
    const model = buildItemChartModel(key, snapshots, '1d');
    const config = buildItemChartConfig(model);

    expect(model.datasets.filter((dataset) => dataset.type === 'line').every((dataset) => dataset.yAxisID === 'yPrice')).toBe(true);
    expect(model.datasets.find((dataset) => dataset.type === 'bar')?.yAxisID).toBe('yVolume');
    expect(config.options?.scales).toMatchObject({
      yPrice: { position: 'left' },
      yVolume: { position: 'right', grid: { drawOnChartArea: false } },
    });
    const priceTick = config.options?.scales?.yPrice?.ticks?.callback;
    const volumeTick = config.options?.scales?.yVolume?.ticks?.callback;
    expect(priceTick?.call({} as never, 1_000_000_000, 0, [])).toBe('1,000M');
    expect(volumeTick?.call({} as never, 12_300, 0, [])).toBe('12.3K');
  });

  it('reports p/ask/bid gaps and one-sided quotes even when p is present', () => {
    const model = buildItemChartModel(key, [
      snapshot(latest - hour, { p: 100, a: 101, b: 99 }),
      snapshot(latest, { p: 110, a: 111, b: null }),
    ], '1d');

    expect(model.stats.hasGaps).toBe(true);
    expect(model.stats.oneSided).toBe(true);
  });

  it('marks the canvas as an image and renders a text chart summary fallback', () => {
    const { dialog, controller } = setup();
    controller.open(key);

    expect(dialog.querySelector('canvas')?.getAttribute('role')).toBe('img');
    expect(dialog.querySelector('[data-detail-chart-summary]')?.textContent).toContain('樣本');
    expect(dialog.querySelector('[data-detail-chart-summary]')?.textContent).toContain('高');
  });
});
