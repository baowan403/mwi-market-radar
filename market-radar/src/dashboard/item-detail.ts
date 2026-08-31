import {
  Chart,
  registerables,
  type ChartConfiguration,
} from 'chart.js';
import { shortCategory } from '../core/categories';
import { priceBasis, type PriceQuality } from '../core/price';
import { PERIOD_HOURS } from '../core/trends';
import type {
  CatalogData,
  MarketKey,
  Period,
  Quote,
  Snapshot,
  WatchItem,
} from '../core/types';
import {
  fallbackItemName,
  normalizeCatalog,
  parseMarketKey,
  type CatalogInput,
  type NormalizedCatalog,
} from './state';

Chart.register(...registerables);

type ChartValue = number | null;

export interface ItemChartDataset {
  type: 'line' | 'bar';
  label: string;
  data: ChartValue[];
  spanGaps: false;
}

export interface ItemChartStats {
  snapshotCount: number;
  validPriceSamples: number;
  actualElapsedHours: number | null;
  high: number | null;
  low: number | null;
  latestQuality: PriceQuality;
  hasGaps: boolean;
  oneSided: boolean;
}

export interface ItemChartModel {
  key: MarketKey;
  labels: string[];
  datasets: ItemChartDataset[];
  stats: ItemChartStats;
}

export interface ItemChartInstance {
  destroy(): void;
}

export type ItemChartFactory = (
  canvas: HTMLCanvasElement,
  model: ItemChartModel,
) => ItemChartInstance;

export interface ItemDetailControllerOptions {
  dialog: HTMLDialogElement;
  snapshots: readonly Snapshot[] | (() => readonly Snapshot[]);
  catalog: CatalogInput | NormalizedCatalog | (() => CatalogInput | NormalizedCatalog);
  watchlist?: readonly WatchItem[];
  getWatchlist?: () => readonly WatchItem[];
  onTogglePin?: (key: MarketKey) => void | Promise<void>;
  chartFactory?: ItemChartFactory;
  initialPeriod?: Period;
}

export interface ItemDetailController {
  open(key: MarketKey | string): void;
  close(): void;
  destroy(): void;
}

const EMPTY_QUOTE: Quote = { a: null, b: null, p: null, v: null };
const ITEM_DETAIL_PERIODS: readonly Period[] = ['1d', '3d', '7d'];

function finiteNonnegativeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function quoteFor(snapshot: Snapshot, key: MarketKey): Quote {
  return snapshot.quotes[key] ?? EMPTY_QUOTE;
}

function sortedWindow(
  snapshots: readonly Snapshot[],
  period: Period,
): Snapshot[] {
  const valid = snapshots.filter((snapshot) => Number.isFinite(snapshot.timestamp));
  const latestTimestamp = valid.reduce<number | null>(
    (latest, snapshot) => latest === null || snapshot.timestamp > latest ? snapshot.timestamp : latest,
    null,
  );
  if (latestTimestamp === null) return [];

  const cutoff = latestTimestamp - PERIOD_HOURS[period] * 60 * 60 * 1_000;
  return valid
    .filter((snapshot) => snapshot.timestamp >= cutoff && snapshot.timestamp <= latestTimestamp)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function formatTaipeiChartLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function emptyStats(): ItemChartStats {
  return {
    snapshotCount: 0,
    validPriceSamples: 0,
    actualElapsedHours: null,
    high: null,
    low: null,
    latestQuality: 'missing',
    hasGaps: false,
    oneSided: false,
  };
}

export function buildItemChartModel(
  key: MarketKey | string,
  snapshots: readonly Snapshot[],
  period: Period,
): ItemChartModel {
  const marketKey = key as MarketKey;
  const window = sortedWindow(snapshots, period);
  const marketPrices: ChartValue[] = [];
  const asks: ChartValue[] = [];
  const bids: ChartValue[] = [];
  const volumes: ChartValue[] = [];
  const basisPrices: number[] = [];
  let oneSided = false;

  for (const snapshot of window) {
    const quote = quoteFor(snapshot, marketKey);
    marketPrices.push(finiteNonnegativeOrNull(quote.p));
    asks.push(finiteNonnegativeOrNull(quote.a));
    bids.push(finiteNonnegativeOrNull(quote.b));
    volumes.push(finiteNonnegativeOrNull(quote.v));

    const basis = priceBasis(quote);
    if (basis.value !== null) basisPrices.push(basis.value);
    if (basis.quality === 'ask-only' || basis.quality === 'bid-only') oneSided = true;
  }

  const latestQuote = window.length === 0 ? EMPTY_QUOTE : quoteFor(window.at(-1) as Snapshot, marketKey);
  const latestBasis = priceBasis(latestQuote);
  const stats = emptyStats();
  stats.snapshotCount = window.length;
  stats.validPriceSamples = basisPrices.length;
  stats.latestQuality = latestBasis.quality;
  stats.hasGaps = marketPrices.some((value) => value === null);
  stats.oneSided = oneSided;
  if (basisPrices.length > 0) {
    stats.high = Math.max(...basisPrices);
    stats.low = Math.min(...basisPrices);
  }
  if (window.length >= 2) {
    const elapsedHours = (window.at(-1)!.timestamp - window[0]!.timestamp) / (60 * 60 * 1_000);
    stats.actualElapsedHours = Number.isFinite(elapsedHours) ? elapsedHours : null;
  }

  return {
    key: marketKey,
    labels: window.map((snapshot) => formatTaipeiChartLabel(snapshot.timestamp)),
    datasets: [
      { type: 'line', label: '市場價', data: marketPrices, spanGaps: false },
      { type: 'line', label: '賣一', data: asks, spanGaps: false },
      { type: 'line', label: '買一', data: bids, spanGaps: false },
      { type: 'bar', label: '成交量', data: volumes, spanGaps: false },
    ],
    stats,
  };
}

function defaultChartFactory(canvas: HTMLCanvasElement, model: ItemChartModel): ItemChartInstance {
  const configuration: ChartConfiguration = {
    type: 'line',
    data: {
      labels: model.labels,
      datasets: model.datasets.map((dataset) => ({
        ...dataset,
        borderWidth: 2,
        pointRadius: 1.5,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: false } },
    },
  };
  return new Chart(canvas, configuration);
}

function resolveSnapshots(source: ItemDetailControllerOptions['snapshots']): readonly Snapshot[] {
  return typeof source === 'function' ? source() : source;
}

function resolveCatalog(source: ItemDetailControllerOptions['catalog']): NormalizedCatalog {
  return normalizeCatalog(typeof source === 'function' ? source() : source);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function valueText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function latestSnapshot(snapshots: readonly Snapshot[]): Snapshot | null {
  return snapshots.reduce<Snapshot | null>(
    (latest, snapshot) => latest === null || snapshot.timestamp > latest.timestamp ? snapshot : latest,
    null,
  );
}

function detailName(catalog: NormalizedCatalog, key: MarketKey): { name: string; level: number; category: string } {
  const parsed = parseMarketKey(key);
  if (parsed === null) return { name: fallbackItemName(key), level: 0, category: '未知' };
  const item = catalog.itemsByHrid.get(parsed.itemHrid);
  const categoryHrid = item?.categoryHrid ?? '/item_categories/unknown';
  return {
    name: item?.name ?? fallbackItemName(parsed.itemHrid),
    level: parsed.enhancementLevel,
    category: catalog.categoriesByHrid.get(categoryHrid)?.name
      ?? (categoryHrid === '/item_categories/unknown' ? '未知' : shortCategory(categoryHrid)),
  };
}

export function createItemDetailController(options: ItemDetailControllerOptions): ItemDetailController {
  const chartFactory = options.chartFactory ?? defaultChartFactory;
  const getWatchlist = options.getWatchlist ?? (() => options.watchlist ?? []);
  const initialPeriod = options.initialPeriod ?? '1d';
  let currentKey: MarketKey | null = null;
  let currentPeriod: Period = initialPeriod;
  let chart: ItemChartInstance | null = null;
  let disposed = false;
  let pinInFlight = false;

  const destroyChart = (): void => {
    if (chart === null) return;
    chart.destroy();
    chart = null;
  };

  const clearDialog = (): void => {
    destroyChart();
    options.dialog.removeAttribute('open');
    options.dialog.hidden = true;
    options.dialog.removeAttribute('data-detail-key');
    options.dialog.replaceChildren();
    currentKey = null;
  };

  const updatePin = (): void => {
    if (currentKey === null) return;
    const pin = options.dialog.querySelector<HTMLButtonElement>('[data-detail-pin]');
    if (!pin) return;
    const watchlisted = getWatchlist().some((item) => item.key === currentKey);
    pin.setAttribute('aria-pressed', String(watchlisted));
    pin.textContent = watchlisted ? '已加入自選' : '加入自選';
  };

  const render = (): void => {
    if (disposed || currentKey === null) return;
    destroyChart();
    const key = currentKey;
    const catalog = resolveCatalog(options.catalog);
    const snapshots = resolveSnapshots(options.snapshots);
    const model = buildItemChartModel(key, snapshots, currentPeriod);
    const info = detailName(catalog, key);
    const latest = latestSnapshot(snapshots);
    const quote = latest === null ? EMPTY_QUOTE : quoteFor(latest, key);
    const basis = priceBasis(quote);

    options.dialog.replaceChildren();
    options.dialog.dataset.detailKey = key;
    options.dialog.hidden = false;

    const card = element('article', 'item-detail-card');
    const header = element('header', 'item-detail-header');
    const headingGroup = element('div');
    const eyebrow = element('p', 'eyebrow');
    eyebrow.textContent = 'Market detail';
    headingGroup.append(eyebrow);
    const heading = element('h2');
    heading.dataset.detailName = 'true';
    heading.textContent = info.name;
    headingGroup.append(heading);
    const level = element('span', 'item-level');
    level.dataset.detailLevel = 'true';
    level.textContent = `+${info.level}`;
    headingGroup.append(level);
    const category = element('span', 'detail-category');
    category.dataset.detailCategory = 'true';
    category.textContent = info.category;
    headingGroup.append(category);
    header.append(headingGroup);

    const close = element('button', 'toolbar-button');
    close.type = 'button';
    close.dataset.detailClose = 'true';
    close.setAttribute('aria-label', '關閉物品詳情');
    close.textContent = '關閉';
    close.addEventListener('click', () => clearDialog());
    header.append(close);
    card.append(header);

    const quoteGrid = element('div', 'detail-quote-grid');
    for (const [label, keyName, value] of [
      ['目前價', 'price', basis.value],
      ['買一', 'bid', finiteNonnegativeOrNull(quote.b)],
      ['賣一', 'ask', finiteNonnegativeOrNull(quote.a)],
      ['成交量', 'volume', finiteNonnegativeOrNull(quote.v)],
    ] as const) {
      const metric = element('div', 'detail-metric');
      metric.dataset.detailMetric = keyName;
      const metricLabel = element('span', 'status-label');
      metricLabel.textContent = label;
      metric.append(metricLabel);
      const metricValue = element('strong', 'detail-metric-value');
      metricValue.textContent = valueText(value);
      metric.append(metricValue);
      quoteGrid.append(metric);
    }
    card.append(quoteGrid);

    const periods = element('div', 'detail-period-controls');
    for (const period of ITEM_DETAIL_PERIODS) {
      const button = element('button', 'toolbar-button');
      button.type = 'button';
      button.dataset.detailPeriod = period;
      button.setAttribute('aria-pressed', String(currentPeriod === period));
      button.textContent = period.toUpperCase();
      button.addEventListener('click', () => {
        currentPeriod = period;
        render();
      });
      periods.append(button);
    }
    card.append(periods);

    const stats = element('div', 'detail-stats');
    const statsText = element('p');
    statsText.dataset.detailStats = 'true';
    statsText.textContent = `快照 ${model.stats.snapshotCount} · 有效價格 ${model.stats.validPriceSamples} · 實際間隔 ${model.stats.actualElapsedHours === null ? '—' : `${model.stats.actualElapsedHours} 小時`} · 高 ${valueText(model.stats.high)} · 低 ${valueText(model.stats.low)}`;
    stats.append(statsText);
    const quality = element('p');
    quality.setAttribute('data-detail-quality', model.stats.latestQuality);
    quality.textContent = `最新資料品質：${model.stats.latestQuality}`;
    stats.append(quality);
    if (model.stats.validPriceSamples < 2) {
      const insufficient = element('p', 'detail-warning');
      insufficient.dataset.detailInsufficient = 'true';
      insufficient.textContent = '樣本不足';
      stats.append(insufficient);
    }
    if (model.stats.hasGaps) {
      const gaps = element('p', 'detail-warning');
      gaps.dataset.detailWarning = 'gap';
      gaps.textContent = '資料有缺口，圖線不連接缺值';
      stats.append(gaps);
    }
    if (model.stats.oneSided) {
      const oneSided = element('p', 'detail-warning');
      oneSided.dataset.detailWarning = 'one-sided';
      oneSided.textContent = '單邊報價';
      stats.append(oneSided);
    }
    card.append(stats);

    const chartContainer = element('div', 'detail-chart-container');
    const canvas = element('canvas');
    canvas.dataset.detailChart = 'true';
    canvas.setAttribute('aria-label', '物品價格與成交量圖');
    chartContainer.append(canvas);
    card.append(chartContainer);

    const actions = element('div', 'detail-actions');
    const pin = element('button', 'toolbar-button detail-pin-button');
    pin.type = 'button';
    pin.dataset.detailPin = 'true';
    pin.addEventListener('click', (event) => {
      event.stopPropagation();
      if (pinInFlight || currentKey === null || options.onTogglePin === undefined) return;
      const requestedKey = currentKey;
      pinInFlight = true;
      void Promise.resolve(options.onTogglePin(requestedKey)).then(() => {
        if (disposed || currentKey !== requestedKey) return;
        updatePin();
      }).catch(() => {
        if (disposed || currentKey !== requestedKey) return;
        const error = element('p', 'detail-warning');
        error.dataset.detailError = 'true';
        error.textContent = '自選儲存失敗';
        card.append(error);
      }).finally(() => {
        pinInFlight = false;
      });
    });
    actions.append(pin);
    card.append(actions);
    options.dialog.append(card);
    updatePin();

    try {
      chart = chartFactory(canvas, model);
    } catch {
      const chartError = element('p', 'detail-warning');
      chartError.textContent = '圖表暫時無法顯示';
      chartContainer.append(chartError);
    }
  };

  const onDialogClose = (): void => clearDialog();
  const onDialogCancel = (event: Event): void => {
    event.preventDefault();
    clearDialog();
  };
  options.dialog.addEventListener('close', onDialogClose);
  options.dialog.addEventListener('cancel', onDialogCancel);

  return {
    open(key: MarketKey | string): void {
      if (disposed) return;
      currentKey = key as MarketKey;
      currentPeriod = initialPeriod;
      render();
      options.dialog.hidden = false;
      if (typeof options.dialog.showModal === 'function') {
        try {
          options.dialog.showModal();
        } catch {
          options.dialog.setAttribute('open', '');
        }
      }
      if (!options.dialog.hasAttribute('open')) options.dialog.setAttribute('open', '');
    },

    close(): void {
      if (disposed) return;
      clearDialog();
    },

    destroy(): void {
      if (disposed) return;
      disposed = true;
      options.dialog.removeEventListener('close', onDialogClose);
      options.dialog.removeEventListener('cancel', onDialogCancel);
      clearDialog();
    },
  };
}
