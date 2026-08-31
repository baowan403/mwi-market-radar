import './styles.css';
import { OFFICIAL_CATEGORIES, shortCategory } from './core/categories';
import type {
  CatalogData,
  CollectorStatus,
  Period,
  RadarSettings,
  Snapshot,
  WatchItem,
} from './core/types';
import { createDashboardClient, type DashboardClient } from './dashboard/client';
import { filterViewRows, type DashboardFilters, type PrimaryView } from './dashboard/filters';
import {
  cycleSort,
  deriveRows,
  moveWatchItem,
  normalizeCatalog,
  normalizeWatchlist,
  sortViewRows,
  togglePin,
  type CatalogInput,
  type NormalizedCatalog,
  type SortState,
} from './dashboard/state';
import { renderCollectorStatus, renderBridgeUnavailable } from './dashboard/status';
import { renderMarketTable } from './dashboard/table';

const dashboardMarkup = `
  <div class="radar-shell">
    <header class="topbar" data-testid="topbar">
      <div class="brand-lockup">
        <p class="eyebrow">Milky Way Idle</p>
        <h1>Market Radar</h1>
        <p class="brand-note">公開市場快照的本機看盤頁</p>
      </div>
      <div id="collector-status" class="collector-status" data-testid="collector-status" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-summary">讀取採集狀態</span>
      </div>
    </header>

    <nav id="category-nav" class="category-nav" data-testid="category-nav" aria-label="市場分類"></nav>

    <section id="toolbar" class="toolbar" data-testid="toolbar" aria-label="行情工具列"></section>

    <section id="content" class="content" data-testid="content"></section>

    <dialog id="item-detail" aria-label="物品詳情" hidden></dialog>
  </div>
`;

const PRIMARY_VIEWS: Array<{ key: PrimaryView; label: string }> = [
  { key: 'watchlist', label: '自選' },
  { key: 'all', label: '全市場' },
  { key: 'resource', label: '資源' },
  { key: 'consumable', label: '消耗品' },
  { key: 'ability_book', label: '技能書' },
  { key: 'labyrinth', label: '迷宮' },
  { key: 'equipment', label: '裝備' },
  { key: 'other', label: '其他' },
];

const OFFICIAL_CATEGORY_LABELS: Record<string, string> = {
  currency: '貨幣',
  loot: '戰利品',
  scroll: '卷軸',
  labyrinth: '迷宮',
  dungeon_key: '地下城鑰匙',
  food: '食物',
  drink: '飲料',
  ability_book: '技能書',
  equipment: '裝備',
  resource: '資源',
};

interface DashboardState {
  snapshots: Snapshot[];
  catalog: NormalizedCatalog;
  watchlist: WatchItem[];
  settings: RadarSettings;
  collectorStatus: CollectorStatus;
  period: Period;
  view: PrimaryView;
  sortState: SortState | null;
  query: string;
  enhancementLevels: Set<number> | null;
  minimumVolume: number | null;
  maximumSpreadPct: number | null;
  officialCategories: Set<string>;
  statusError: string | null;
}

const mountGenerations = new WeakMap<HTMLElement, number>();

export interface DashboardMountOptions {
  root?: HTMLElement | null;
  client?: DashboardClient;
  catalogLoader?: () => CatalogInput | Promise<CatalogInput>;
}

export interface DashboardMountHandle {
  destroy(): void;
}

async function defaultCatalogLoader(): Promise<CatalogData> {
  const response = await fetch('./catalog.json', {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Catalog request failed');
  try {
    return await response.json() as CatalogData;
  } catch {
    throw new Error('Catalog response JSON parse failed');
  }
}

function renderLoading(content: HTMLElement): void {
  content.replaceChildren();
  const empty = document.createElement('section');
  empty.className = 'empty-state is-loading';
  empty.setAttribute('aria-live', 'polite');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Market feed';
  empty.append(eyebrow);
  const heading = document.createElement('h2');
  heading.textContent = '正在讀取市場快照';
  empty.append(heading);
  const description = document.createElement('p');
  description.textContent = '等待本機採集器與公開物品目錄。';
  empty.append(description);
  content.append(empty);
}

function renderUnavailableContent(content: HTMLElement): void {
  content.replaceChildren();
  const empty = document.createElement('section');
  empty.className = 'empty-state';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Collector unavailable';
  empty.append(eyebrow);
  const heading = document.createElement('h2');
  heading.textContent = '尚無可顯示的行情';
  empty.append(heading);
  const description = document.createElement('p');
  description.textContent = '請在 MWI 遊戲分頁安裝並啟用 MWI Market Radar 腳本。';
  empty.append(description);
  content.append(empty);
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function renderPrimaryNavigation(
  target: HTMLElement,
  state: DashboardState,
  onView: (view: PrimaryView) => void,
): void {
  target.replaceChildren();
  for (const view of PRIMARY_VIEWS) {
    const button = createElement('button', 'category-tab');
    button.type = 'button';
    button.dataset.primaryView = view.key;
    button.setAttribute('aria-pressed', String(state.view === view.key));
    button.classList.toggle('is-active', state.view === view.key);
    button.textContent = view.label;
    button.addEventListener('click', () => onView(view.key));
    target.append(button);
  }
}

function categoryHrid(category: string): string {
  return `/item_categories/${category}`;
}

function renderOfficialCategories(
  parent: HTMLElement,
  state: DashboardState,
  onCategories: (categories: Set<string>) => void,
): void {
  const details = createElement('details', 'official-categories');
  const summary = createElement('summary');
  summary.textContent = '官方分類';
  details.append(summary);
  const list = createElement('div', 'official-category-list');

  for (const category of OFFICIAL_CATEGORIES) {
    const label = createElement('label', 'filter-check');
    const checkbox = createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.officialCategory = categoryHrid(category);
    checkbox.checked = state.officialCategories.has(category) || state.officialCategories.has(categoryHrid(category));
    checkbox.addEventListener('change', () => {
      const categories = new Set(state.officialCategories);
      if (checkbox.checked) categories.add(category);
      else categories.delete(category);
      onCategories(categories);
    });
    label.append(checkbox);
    const text = createElement('span');
    text.textContent = OFFICIAL_CATEGORY_LABELS[category] ?? shortCategory(category);
    label.append(text);
    list.append(label);
  }
  details.append(list);
  parent.append(details);
}

function renderToolbar(
  target: HTMLElement,
  state: DashboardState,
  rows: ReturnType<typeof deriveRows>,
  onPeriod: (period: Period) => void,
  onQuery: (query: string) => void,
  onEnhancements: (levels: Set<number> | null) => void,
  onMinimumVolume: (value: number | null) => void,
  onMaximumSpread: (value: number | null) => void,
  onCategories: (categories: Set<string>) => void,
  onResetSort: () => void,
): void {
  target.replaceChildren();

  const periodGroup = createElement('div', 'period-controls');
  const periodLabel = createElement('span', 'control-label');
  periodLabel.textContent = '區間';
  periodGroup.append(periodLabel);
  for (const period of ['1d', '3d', '7d'] as const) {
    const button = createElement('button', 'toolbar-button period-button');
    button.type = 'button';
    button.dataset.period = period;
    button.setAttribute('aria-pressed', String(state.period === period));
    button.textContent = period.toUpperCase();
    button.addEventListener('click', () => onPeriod(period));
    periodGroup.append(button);
  }
  target.append(periodGroup);

  const searchLabel = createElement('label', 'filter-control search-field');
  const searchText = createElement('span', 'control-label');
  searchText.textContent = '搜尋物品';
  searchLabel.append(searchText);
  const search = createElement('input');
  search.type = 'search';
  search.dataset.filter = 'search';
  search.placeholder = '名稱或 HRID';
  search.value = state.query;
  search.addEventListener('input', () => onQuery(search.value));
  searchLabel.append(search);
  target.append(searchLabel);

  const enhancementLabel = createElement('label', 'filter-control');
  const enhancementText = createElement('span', 'control-label');
  enhancementText.textContent = '強化等級';
  enhancementLabel.append(enhancementText);
  const enhancement = createElement('select');
  enhancement.multiple = true;
  enhancement.dataset.filter = 'enhancement';
  enhancement.size = Math.min(4, Math.max(2, new Set(rows.map((row) => row.enhancementLevel)).size + 1));
  const allOption = createElement('option');
  allOption.value = '';
  allOption.textContent = '全部';
  allOption.selected = state.enhancementLevels === null;
  enhancement.append(allOption);
  const levels = [...new Set(rows.map((row) => row.enhancementLevel))].sort((left, right) => left - right);
  for (const level of levels) {
    const option = createElement('option');
    option.value = String(level);
    option.textContent = `+${level}`;
    option.selected = state.enhancementLevels?.has(level) ?? false;
    enhancement.append(option);
  }
  enhancement.addEventListener('change', () => {
    const selected = [...enhancement.selectedOptions]
      .map((option) => option.value)
      .filter((value) => value !== '')
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value));
    onEnhancements(selected.length === 0 ? null : new Set(selected));
  });
  enhancementLabel.append(enhancement);
  target.append(enhancementLabel);

  const minimumLabel = createElement('label', 'filter-control numeric-filter');
  const minimumText = createElement('span', 'control-label');
  minimumText.textContent = '最低成交量';
  minimumLabel.append(minimumText);
  const minimum = createElement('input');
  minimum.type = 'number';
  minimum.min = '0';
  minimum.step = 'any';
  minimum.dataset.filter = 'minimum-volume';
  minimum.placeholder = '不限';
  minimum.value = state.minimumVolume === null ? '' : String(state.minimumVolume);
  minimum.addEventListener('input', () => {
    const value = Number(minimum.value);
    onMinimumVolume(minimum.value === '' || !Number.isFinite(value) ? null : Math.max(0, value));
  });
  minimumLabel.append(minimum);
  target.append(minimumLabel);

  const maximumLabel = createElement('label', 'filter-control numeric-filter');
  const maximumText = createElement('span', 'control-label');
  maximumText.textContent = '最大價差 %';
  maximumLabel.append(maximumText);
  const maximum = createElement('input');
  maximum.type = 'number';
  maximum.min = '0';
  maximum.step = 'any';
  maximum.dataset.filter = 'maximum-spread';
  maximum.placeholder = '不限';
  maximum.value = state.maximumSpreadPct === null ? '' : String(state.maximumSpreadPct);
  maximum.addEventListener('input', () => {
    const value = Number(maximum.value);
    onMaximumSpread(maximum.value === '' || !Number.isFinite(value) ? null : Math.max(0, value));
  });
  maximumLabel.append(maximum);
  target.append(maximumLabel);

  renderOfficialCategories(target, state, onCategories);

  const reset = createElement('button', 'toolbar-button reset-button');
  reset.type = 'button';
  reset.dataset.sortReset = 'true';
  reset.textContent = '排序重置';
  reset.addEventListener('click', onResetSort);
  target.append(reset);
}

function renderDashboard(
  root: HTMLElement,
  client: DashboardClient,
  state: DashboardState,
  isActive: () => boolean,
): void {
  const nav = root.querySelector<HTMLElement>('#category-nav');
  const toolbar = root.querySelector<HTMLElement>('#toolbar');
  const content = root.querySelector<HTMLElement>('#content');
  const status = root.querySelector<HTMLElement>('#collector-status');
  if (!nav || !toolbar || !content || !status) return;

  let derivedCache: ReturnType<typeof deriveRows> | null = null;
  let mutationQueue: Promise<void> | null = null;
  let mutationRunning = false;
  const pendingMutations: Array<(watchlist: readonly WatchItem[]) => WatchItem[]> = [];

  const invalidateDerived = (): void => {
    derivedCache = null;
  };

  const getDerivedRows = (): ReturnType<typeof deriveRows> => {
    if (derivedCache === null) {
      derivedCache = deriveRows(state.snapshots, state.catalog, state.watchlist, state.period, {
        period: state.period,
        movePct: state.settings.anomalyMovePct,
        volumeMultiple: state.settings.anomalyVolumeMultiple,
        wideSpreadPct: state.settings.maximumSpreadPct ?? 10,
        minimumVolume: state.settings.minimumVolume,
      });
    }
    return derivedCache;
  };

  const currentRows = (): { derived: ReturnType<typeof deriveRows>; visible: ReturnType<typeof deriveRows> } => {
    const derived = getDerivedRows();
    const filters: DashboardFilters = {
      view: state.view,
      query: state.query,
      enhancementLevels: state.enhancementLevels ?? undefined,
      minimumVolume: state.minimumVolume,
      maximumSpreadPct: state.maximumSpreadPct,
      officialCategories: state.officialCategories,
    };
    return {
      derived,
      visible: sortViewRows(filterViewRows(derived, filters), state.sortState, state.view),
    };
  };

  const renderStatus = (): void => {
    if (!isActive()) return;
    renderCollectorStatus(status, state.collectorStatus, state.statusError);
  };

  const renderResultsOnly = (): void => {
    if (!isActive()) return;
    const visibleRows = currentRows().visible;
    renderMarketTable(content, {
      rows: visibleRows,
      catalog: state.catalog,
      selectedPeriod: state.period,
      sortState: state.sortState,
      view: state.view,
      onSort: (field) => {
        if (!isActive()) return;
        state.sortState = cycleSort(state.sortState, field);
        renderResultsOnly();
      },
      onTogglePin: (key) => {
        if (!isActive()) return;
        enqueueWatchlistMutation((watchlist) => togglePin(watchlist, key as `${string}::${number}`));
      },
      onMoveWatchItem: (key, direction) => {
        if (!isActive()) return;
        enqueueWatchlistMutation((watchlist) => {
          const currentIndex = watchlist.findIndex((item) => item.key === key);
          const destination = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
          return moveWatchItem(watchlist, currentIndex, destination);
        });
      },
    });
  };

  const updatePeriodButtons = (): void => {
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-period]')) {
      button.setAttribute('aria-pressed', String(button.dataset.period === state.period));
    }
  };

  const renderNavigationOnly = (): void => {
    if (!isActive()) return;
    renderPrimaryNavigation(nav, state, (view) => {
      if (!isActive()) return;
      state.view = view;
      renderNavigationOnly();
      renderResultsOnly();
    });
  };

  const sameWatchlist = (left: readonly WatchItem[], right: readonly WatchItem[]): boolean => {
    return left.length === right.length
      && left.every((item, index) => item.key === right[index]?.key && item.order === right[index]?.order);
  };

  const runMutation = async (
    operation: (watchlist: readonly WatchItem[]) => WatchItem[],
  ): Promise<void> => {
    if (!isActive()) {
      pendingMutations.length = 0;
      return;
    }

    let next: WatchItem[];
    try {
      next = operation(state.watchlist);
    } catch {
      state.statusError = '自選儲存失敗';
      renderStatus();
      return;
    }
    if (sameWatchlist(next, state.watchlist)) return;

    try {
      await client.setWatchlist(next);
    } catch {
      if (isActive()) {
        state.statusError = '自選儲存失敗';
        renderStatus();
      }
      return;
    }

    if (!isActive()) {
      pendingMutations.length = 0;
      return;
    }
    state.watchlist = normalizeWatchlist(next);
    state.statusError = null;
    invalidateDerived();
    renderStatus();
    renderResultsOnly();
  };

  const drainMutations = async (): Promise<void> => {
    while (pendingMutations.length > 0) {
      const operation = pendingMutations.shift();
      if (operation === undefined) continue;
      await runMutation(operation);
      if (!isActive()) {
        pendingMutations.length = 0;
        break;
      }
    }
  };

  const startMutationDrain = (): void => {
    if (mutationRunning || !isActive()) return;
    mutationRunning = true;
    mutationQueue = drainMutations().finally(() => {
      mutationRunning = false;
      mutationQueue = null;
      if (pendingMutations.length > 0) startMutationDrain();
    });
  };

  function enqueueWatchlistMutation(operation: (watchlist: readonly WatchItem[]) => WatchItem[]): void {
    if (!isActive()) return;
    pendingMutations.push(operation);
    startMutationDrain();
  }

  renderNavigationOnly();
  renderToolbar(
    toolbar,
    state,
    getDerivedRows(),
    (period) => {
      if (!isActive()) return;
      state.period = period;
      state.settings = { ...state.settings, period };
      invalidateDerived();
      updatePeriodButtons();
      renderResultsOnly();
    },
    (query) => {
      if (!isActive()) return;
      state.query = query;
      renderResultsOnly();
    },
    (levels) => {
      if (!isActive()) return;
      state.enhancementLevels = levels;
      renderResultsOnly();
    },
    (value) => {
      if (!isActive()) return;
      state.minimumVolume = value;
      renderResultsOnly();
    },
    (value) => {
      if (!isActive()) return;
      state.maximumSpreadPct = value;
      renderResultsOnly();
    },
    (categories) => {
      if (!isActive()) return;
      state.officialCategories = categories;
      renderResultsOnly();
    },
    () => {
      if (!isActive()) return;
      state.sortState = null;
      renderResultsOnly();
    },
  );
  renderStatus();
  renderResultsOnly();
}

export function renderApp(root: HTMLElement | null = document.querySelector<HTMLElement>('#app')): void {
  if (!root) throw new Error('Missing #app root');
  root.innerHTML = dashboardMarkup;
  const content = root.querySelector<HTMLElement>('#content');
  if (content) renderLoading(content);
}

export async function mountDashboard(options: DashboardMountOptions = {}): Promise<DashboardMountHandle> {
  const root = options.root ?? (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('#app'));
  if (!root) throw new Error('Missing #app root');

  const mountGeneration = (mountGenerations.get(root) ?? 0) + 1;
  mountGenerations.set(root, mountGeneration);
  let destroyed = false;
  const isActive = (): boolean => !destroyed && mountGenerations.get(root) === mountGeneration;

  renderApp(root);

  const status = root.querySelector<HTMLElement>('#collector-status');
  const content = root.querySelector<HTMLElement>('#content');
  if (!status || !content) throw new Error('Dashboard shell is incomplete');

  const target = typeof window === 'undefined' ? new EventTarget() : window;
  const client = options.client ?? createDashboardClient(target);
  const catalogLoader = options.catalogLoader ?? defaultCatalogLoader;

  try {
    const [bootstrap, snapshots, catalogInput] = await Promise.all([
      client.bootstrap(),
      client.listSnapshots(),
      catalogLoader(),
    ]);
    if (!isActive()) return { destroy: () => undefined };

    const settings = { ...bootstrap.settings };
    const state: DashboardState = {
      snapshots,
      catalog: normalizeCatalog(catalogInput),
      watchlist: normalizeWatchlist(bootstrap.watchlist),
      settings,
      collectorStatus: bootstrap.collectorStatus,
      period: settings.period,
      view: 'all',
      sortState: null,
      query: '',
      enhancementLevels: null,
      minimumVolume: settings.minimumVolume > 0 ? settings.minimumVolume : null,
      maximumSpreadPct: settings.maximumSpreadPct,
      officialCategories: new Set(),
      statusError: null,
    };
    renderDashboard(root, client, state, isActive);
  } catch {
    if (isActive()) {
      renderBridgeUnavailable(status);
      renderUnavailableContent(content);
    }
  }

  return {
    destroy(): void {
      destroyed = true;
      if (mountGenerations.get(root) === mountGeneration) {
        mountGenerations.set(root, mountGeneration + 1);
      }
    },
  };
}

if (typeof document !== 'undefined' && document.querySelector('#app')) {
  void mountDashboard();
}
