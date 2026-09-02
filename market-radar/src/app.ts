import './styles.css';
import { OFFICIAL_CATEGORIES, shortCategory } from './core/categories';
import type {
  BridgeBootstrap,
  CatalogData,
  CollectorStatus,
  Period,
  RadarSettings,
  Snapshot,
  WatchItem,
} from './core/types';
import {
  createDashboardClient,
  waitForBridgeReady as defaultWaitForBridgeReady,
  type BridgeDomTarget,
  type BridgeReadyWaitOptions,
  type DashboardClient,
} from './dashboard/client';
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
import {
  buildHealthModel,
  POLL_FAILURE_MESSAGE,
  PREFERENCES_WARNING_MESSAGE,
  SETTINGS_FAILURE_MESSAGE,
  renderDataSource,
  renderCollectorStatus,
  renderBridgeUnavailable,
  type DashboardDataSourceInfo,
} from './dashboard/status';
import {
  createCloudClient,
} from './dashboard/cloud-client';
import {
  fetchOfficialSnapshot,
} from './collector/official-client';
import {
  createHybridClient,
  type HybridClient,
  type HybridCloudClient,
  type HybridBootstrap,
} from './dashboard/hybrid-client';
import {
  createPreferencesStore,
  MemoryPreferencesStore,
  type PreferencesStore,
} from './dashboard/preferences-store';
import { renderMarketTable, ITEM_SELECTED_EVENT } from './dashboard/table';
import {
  createItemDetailController,
  type ItemChartFactory,
  type ItemDetailController,
} from './dashboard/item-detail';
import {
  rankRowsForMode,
  renderRankingModeButtons,
  updateRankingModeButtons,
  type RankingMode,
} from './dashboard/rankings-view';
import { createProfilePanel, type ProfilePanel } from './profile/panel';
import {
  createMemoryProfileStore,
  createProfileStore as createIndexedProfileStore,
  type ProfileStore,
} from './profile/store';
import { catalogItemName } from './core/catalog';
import { normalizeStrategyGameData, type NormalizedStrategyGameData } from './strategy/game-data';
import {
  createMemoryStrategyPinStore,
  createStrategyPinStore,
  type StrategyPinStore,
} from './strategy/store';
import { createStrategyView, type StrategyView } from './strategy/view';

const dashboardMarkup = `
  <div class="radar-shell">
    <header class="topbar" data-testid="topbar">
      <div class="brand-lockup">
        <p class="eyebrow">Milky Way Idle</p>
        <h1>Market Radar</h1>
      </div>
      <div id="collector-status" class="collector-status" data-testid="collector-status" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-summary">讀取採集狀態</span>
      </div>
      <div id="data-source" class="data-source" data-source="unavailable" aria-label="行情資料來源">
        <span class="data-source-label" data-source-label="true">資料不可用</span>
        <span class="data-source-detail" data-source-detail="true">等待可用資料來源</span>
      </div>
      <div class="profile-control">
        <span id="profile-summary" class="profile-summary">尚未導入角色</span>
        <button id="profile-open" class="toolbar-button" type="button">角色快照</button>
      </div>
    </header>

    <nav id="product-nav" class="product-nav" aria-label="主要功能">
      <button type="button" class="product-tab is-active" data-product-surface="market" aria-pressed="true">市場行情</button>
      <button type="button" class="product-tab" data-product-surface="strategy" aria-pressed="false">策略推薦</button>
    </nav>

    <nav id="category-nav" class="category-nav" data-testid="category-nav" aria-label="市場分類"></nav>

    <section id="toolbar" class="toolbar" data-testid="toolbar" aria-label="行情工具列"></section>

    <section id="content" class="content" data-testid="content"></section>

    <dialog id="item-detail" aria-label="物品詳情" hidden></dialog>
    <dialog id="profile-dialog" aria-label="角色快照" hidden></dialog>
  </div>
`;

const PRIMARY_VIEWS: Array<{ key: PrimaryView; label: string }> = [
  { key: 'watchlist', label: '自選' },
  { key: 'all', label: '全部' },
  { key: 'resource', label: '資源' },
  { key: 'consumable', label: '消耗品' },
  { key: 'ability_book', label: '技能書' },
  { key: 'labyrinth', label: '迷宮' },
  { key: 'equipment', label: '裝備' },
  { key: 'other', label: '其他' },
];

export const PAGE_SIZE = 100;

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
  mode: RankingMode;
  sortState: SortState | null;
  pageIndex: number;
  query: string;
  enhancementLevels: Set<number> | null;
  minimumVolume: number | null;
  maximumSpreadPct: number | null;
  officialCategories: Set<string>;
  statusError: string | null;
  sourceInfo: DashboardDataSourceInfo | null;
  preferencesWarning: string | null;
}

const mountGenerations = new WeakMap<HTMLElement, number>();

export interface DashboardMountOptions {
  root?: HTMLElement | null;
  client?: DashboardClient;
  bridgeTarget?: BridgeDomTarget | null;
  waitForBridgeReady?: (target: BridgeDomTarget, options?: BridgeReadyWaitOptions) => Promise<boolean>;
  bridgeReadyTimeoutMs?: number;
  cloudClient?: HybridCloudClient;
  fetchLive?: ((options: { signal?: AbortSignal }) => Promise<Snapshot>) | null;
  preferencesStore?: PreferencesStore;
  createCloudClient?: (baseDataUrl: string | URL) => HybridCloudClient;
  createPreferencesStore?: () => PreferencesStore;
  profileStore?: ProfileStore;
  createProfileStore?: () => ProfileStore;
  strategyPinStore?: StrategyPinStore;
  createStrategyPinStore?: () => StrategyPinStore;
  strategyDataLoader?: () => Promise<NormalizedStrategyGameData>;
  createLocalClient?: (target: BridgeDomTarget) => DashboardClient;
  catalogLoader?: () => CatalogInput | Promise<CatalogInput>;
  chartFactory?: ItemChartFactory;
  pollMs?: number;
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
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

async function defaultStrategyDataLoader(): Promise<NormalizedStrategyGameData> {
  const response = await fetch('./strategy-data.json', {
    method: 'GET', credentials: 'omit', cache: 'no-store',
  });
  if (!response.ok) throw new Error('Strategy data request failed');
  return normalizeStrategyGameData(await response.json());
}

function renderLoading(content: HTMLElement): void {
  content.replaceChildren();
  const empty = document.createElement('section');
  empty.className = 'empty-state is-loading';
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
  summary.textContent = '分類';
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
  onMode: (mode: RankingMode) => void,
  onPeriod: (period: Period) => void,
  onQuery: (query: string) => void,
  onEnhancements: (levels: Set<number> | null) => void,
  onMinimumVolume: (value: number | null) => void,
  onMaximumSpread: (value: number | null) => void,
  onCategories: (categories: Set<string>) => void,
  onResetSort: () => void,
  onRefresh?: () => void,
): void {
  target.replaceChildren();

  // 次級篩選：全部 / 資源 / 消耗品 / ... （原 primary views，降級至工具列）
  const viewGroup = createElement('nav', 'toolbar-views');
  viewGroup.setAttribute('aria-label', '物品分類');
  for (const view of PRIMARY_VIEWS) {
    const button = createElement('button', 'toolbar-button view-button');
    button.type = 'button';
    button.dataset.primaryView = view.key;
    button.setAttribute('aria-pressed', String(state.view === view.key));
    button.classList.toggle('is-active', state.view === view.key);
    button.textContent = view.label;
    button.addEventListener('click', () => {
      state.view = view.key;
      state.pageIndex = 0;
      // Re-render toolbar to update pressed state + results
      renderToolbar(target, state, rows, onMode, onPeriod, onQuery, onEnhancements, onMinimumVolume, onMaximumSpread, onCategories, onResetSort, onRefresh);
      onMode(state.mode); // trigger results re-render
    });
    viewGroup.append(button);
  }
  target.append(viewGroup);

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

  const enhancementLabel = createElement('div', 'filter-control enhancement-control');
  const enhancementText = createElement('span', 'control-label');
  enhancementText.textContent = '強化等級';
  enhancementLabel.append(enhancementText);
  const enhancementHint = createElement('span', 'control-hint');
  enhancementHint.textContent = '可複選';
  enhancementLabel.append(enhancementHint);
  const enhancement = createElement('details', 'enhancement-picker');
  enhancement.dataset.filter = 'enhancement';
  const enhancementSummary = createElement('summary', 'enhancement-summary');
  enhancementSummary.dataset.enhancementSummary = 'true';
  const selectedLevels = state.enhancementLevels === null ? [] : [...state.enhancementLevels].sort((left, right) => left - right);
  const updateEnhancementSummary = (selected: readonly number[]): void => {
    enhancementSummary.textContent = selected.length === 0
      ? '全部等級'
      : selected.length === 1
        ? `+${selected[0]}`
        : `已選 ${selected.length} 個`;
  };
  updateEnhancementSummary(selectedLevels);
  enhancement.append(enhancementSummary);
  const enhancementOptions = createElement('div', 'enhancement-options');
  let clearEnhancement: HTMLButtonElement | null = null;
  const levels = [...new Set(rows.map((row) => row.enhancementLevel))].sort((left, right) => left - right);
  for (const level of levels) {
    const optionLabel = createElement('label', 'filter-check enhancement-option');
    const option = createElement('input');
    option.type = 'checkbox';
    option.dataset.enhancementLevel = String(level);
    option.checked = state.enhancementLevels?.has(level) ?? false;
    option.addEventListener('change', () => {
      const selected = [...enhancementOptions.querySelectorAll<HTMLInputElement>('input[data-enhancement-level]:checked')]
        .map((input) => Number(input.dataset.enhancementLevel))
        .filter((value) => Number.isSafeInteger(value));
      updateEnhancementSummary(selected);
      if (clearEnhancement) clearEnhancement.disabled = selected.length === 0;
      onEnhancements(selected.length === 0 ? null : new Set(selected));
    });
    optionLabel.append(option);
    const optionText = createElement('span');
    optionText.textContent = `+${level}`;
    optionLabel.append(optionText);
    enhancementOptions.append(optionLabel);
  }

  clearEnhancement = createElement('button', 'enhancement-clear');
  clearEnhancement.type = 'button';
  clearEnhancement.dataset.enhancementReset = 'true';
  clearEnhancement.textContent = '清除選擇';
  clearEnhancement.disabled = selectedLevels.length === 0;
  clearEnhancement.addEventListener('click', () => {
    for (const option of enhancementOptions.querySelectorAll<HTMLInputElement>('input[data-enhancement-level]')) {
      option.checked = false;
    }
    updateEnhancementSummary([]);
    clearEnhancement.disabled = true;
    enhancement.open = false;
    onEnhancements(null);
  });
  enhancementOptions.append(clearEnhancement);
  enhancement.append(enhancementOptions);
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

  if (onRefresh !== undefined) {
    const refresh = createElement('button', 'toolbar-button cloud-refresh-button');
    refresh.type = 'button';
    refresh.dataset.cloudRefresh = 'true';
    refresh.setAttribute('aria-busy', 'false');
    refresh.textContent = '立即重新整理';
    refresh.addEventListener('click', onRefresh);
    target.append(refresh);
  }
}

function renderDashboard(
  root: HTMLElement,
  client: DashboardClient,
  state: DashboardState,
  isActive: () => boolean,
  provider?: HybridClient,
  lifecycleSignal?: AbortSignal,
  chartFactory?: ItemChartFactory,
  now: () => number = () => Date.now(),
  pollMs = 60_000,
  setIntervalFn: (callback: () => void, delayMs: number) => unknown = (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearIntervalFn: (handle: unknown) => void = (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
): { detailController: ItemDetailController; refreshProvider(): Promise<void>; renderMarket(): void; destroy(): void } | null {
  const nav = root.querySelector<HTMLElement>('#category-nav');
  const toolbar = root.querySelector<HTMLElement>('#toolbar');
  const content = root.querySelector<HTMLElement>('#content');
  const status = root.querySelector<HTMLElement>('#collector-status');
  const source = root.querySelector<HTMLElement>('#data-source');
  const detailDialog = root.querySelector<HTMLDialogElement>('#item-detail');
  if (!nav || !toolbar || !content || !status || !source || !detailDialog) return null;

  let derivedCache: ReturnType<typeof deriveRows> | null = null;
  let mutationQueue: Promise<void> | null = null;
  let mutationRunning = false;
  type WatchlistOperation = (watchlist: readonly WatchItem[]) => WatchItem[];
  interface PendingMutation {
    operation: WatchlistOperation;
    resolve: () => void;
    reject: (reason?: unknown) => void;
  }
  let activeMutation: PendingMutation | null = null;
  const pendingMutations: PendingMutation[] = [];
  let settingsWriteRunning = false;
  let pendingSettings: RadarSettings | null = null;
  let pollInFlight = false;
  let pollTimer: unknown;
  let pollTimerActive = false;
  let providerRefreshInFlight: Promise<void> | null = null;
  let manualRefreshBusy = false;

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
    const filtered = filterViewRows(derived, filters);
    const ranked = rankRowsForMode(filtered, state.mode, state.period);
    return {
      derived,
      visible: state.sortState === null && state.mode !== 'market'
        ? ranked
        : sortViewRows(ranked, state.sortState, state.view),
    };
  };

  const renderStatus = (): void => {
    if (!isActive()) return;
    renderDataSource(source, state.sourceInfo);
    renderCollectorStatus(
      status,
      state.collectorStatus,
      state.statusError ?? state.preferencesWarning,
      buildHealthModel(state.collectorStatus, state.snapshots, now()),
    );
  };

  const renderResultsOnly = (): void => {
    if (!isActive()) return;
    const allVisibleRows = currentRows().visible;
    const totalRows = allVisibleRows.length;
    const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / PAGE_SIZE);
    const pageIndex = totalPages === 0 ? 0 : Math.min(state.pageIndex, totalPages - 1);
    state.pageIndex = Math.max(0, pageIndex);
    const visibleRows = allVisibleRows.slice(state.pageIndex * PAGE_SIZE, (state.pageIndex + 1) * PAGE_SIZE);
    renderMarketTable(content, {
      rows: visibleRows,
      catalog: state.catalog,
      selectedPeriod: state.period,
      sortState: state.sortState,
      view: state.view,
      onSort: (field) => {
        if (!isActive()) return;
        state.sortState = cycleSort(state.sortState, field);
        state.pageIndex = 0;
        renderResultsOnly();
      },
      onTogglePin: (key) => {
        if (!isActive()) return;
        void enqueueWatchlistMutation((watchlist) => togglePin(watchlist, key as `${string}::${number}`))
          .catch(() => undefined);
      },
      onMoveWatchItem: (key, direction) => {
        if (!isActive()) return;
        void enqueueWatchlistMutation((watchlist) => {
          const currentIndex = watchlist.findIndex((item) => item.key === key);
          const destination = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
          return moveWatchItem(watchlist, currentIndex, destination);
        }).catch(() => undefined);
      },
      pagination: totalRows === 0 ? undefined : {
        pageIndex: state.pageIndex,
        pageSize: PAGE_SIZE,
        totalRows,
        onPageChange: (nextPageIndex) => {
          if (!isActive()) return;
          const nextTotalPages = Math.ceil(totalRows / PAGE_SIZE);
          state.pageIndex = Math.max(0, Math.min(nextTotalPages - 1, nextPageIndex));
          renderResultsOnly();
        },
      },
    });
  };

  const updateRefreshButton = (): void => {
    const refresh = toolbar.querySelector<HTMLButtonElement>('[data-cloud-refresh]');
    if (!refresh) return;
    refresh.disabled = manualRefreshBusy;
    refresh.setAttribute('aria-busy', String(manualRefreshBusy));
  };

  const previousLatestTimestamp = (): number | null => state.snapshots.reduce<number | null>(
    (latest, snapshot) => Number.isFinite(snapshot.timestamp)
      && (latest === null || snapshot.timestamp > latest)
      ? snapshot.timestamp
      : latest,
    null,
  );

  const refreshProviderData = (refreshDaily = false): Promise<void> => {
    if (providerRefreshInFlight !== null) return providerRefreshInFlight;
    if (provider === undefined) return Promise.resolve();

    const pending = (async (): Promise<void> => {
      await provider.refresh({
        signal: lifecycleSignal,
        refreshDaily,
      });
      const nextBootstrap: HybridBootstrap = await provider.bootstrap();
      const nextSnapshots = await client.listSnapshots();
      if (!isActive()) return;

      const metadataChanged = nextBootstrap.latestTimestamp !== previousLatestTimestamp()
        || nextBootstrap.snapshotCount !== state.snapshots.length;
      state.collectorStatus = nextBootstrap.collectorStatus;
      state.sourceInfo = nextBootstrap.sourceInfo;
      state.preferencesWarning = nextBootstrap.preferencesWarning === 'preferences_unavailable'
        ? PREFERENCES_WARNING_MESSAGE
        : null;
      state.statusError = null;
      if (refreshDaily || metadataChanged) {
        state.snapshots = nextSnapshots;
        state.pageIndex = 0;
        invalidateDerived();
        renderResultsOnly();
      }
      renderStatus();
    })();
    providerRefreshInFlight = pending;
    void pending.then(() => {
      if (providerRefreshInFlight === pending) providerRefreshInFlight = null;
    }, () => {
      if (providerRefreshInFlight === pending) providerRefreshInFlight = null;
    });
    return pending;
  };

  const onManualRefresh = (): void => {
    if (provider === undefined || manualRefreshBusy || providerRefreshInFlight !== null) return;
    manualRefreshBusy = true;
    updateRefreshButton();
    void refreshProviderData(true)
      .catch(() => {
        if (!isActive()) return;
        state.statusError = POLL_FAILURE_MESSAGE;
        renderStatus();
      })
      .finally(() => {
        manualRefreshBusy = false;
        updateRefreshButton();
      });
  };

  const updatePeriodButtons = (): void => {
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-period]')) {
      button.setAttribute('aria-pressed', String(button.dataset.period === state.period));
    }
  };

  const updateModeButtons = (): void => {
    updateRankingModeButtons(nav, state.mode);
  };

  const renderNavigationOnly = (): void => {
    if (!isActive()) return;
    // 主導航第一排：行情表 / 漲幅榜 / 跌幅榜 ...
    nav.replaceChildren();
    renderRankingModeButtons(nav, state.mode, (mode) => {
      if (!isActive()) return;
      state.mode = mode;
      state.sortState = null;
      state.pageIndex = 0;
      renderNavigationOnly();
      renderResultsOnly();
    });
  };

  const sameWatchlist = (left: readonly WatchItem[], right: readonly WatchItem[]): boolean => {
    return left.length === right.length
      && left.every((item, index) => item.key === right[index]?.key && item.order === right[index]?.order);
  };

  const runMutation = async (operation: WatchlistOperation): Promise<void> => {
    if (!isActive()) return;

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
      throw new Error('watchlist persistence failed');
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

  const drainSettingsWrites = async (): Promise<void> => {
    if (settingsWriteRunning) return;
    settingsWriteRunning = true;
    try {
      while (pendingSettings !== null) {
        if (!isActive()) {
          pendingSettings = null;
          break;
        }
        const nextSettings = pendingSettings;
        pendingSettings = null;
        try {
          await client.setSettings(nextSettings);
          if (isActive() && pendingSettings === null) {
            state.statusError = null;
            renderStatus();
          }
        } catch {
          if (isActive()) {
            state.statusError = SETTINGS_FAILURE_MESSAGE;
            renderStatus();
          }
        }
      }
    } finally {
      settingsWriteRunning = false;
      if (pendingSettings !== null && isActive()) void drainSettingsWrites();
    }
  };

  const enqueueSettingsWrite = (): void => {
    pendingSettings = { ...state.settings };
    void drainSettingsWrites();
  };

  const drainMutations = async (): Promise<void> => {
    while (pendingMutations.length > 0) {
      const pending = pendingMutations.shift();
      if (pending === undefined) continue;
      activeMutation = pending;
      try {
        await runMutation(pending.operation);
        pending.resolve();
      } catch (error) {
        pending.reject(error);
      } finally {
        if (activeMutation === pending) activeMutation = null;
      }
      if (!isActive()) {
        for (const remaining of pendingMutations) remaining.resolve();
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

  function enqueueWatchlistMutation(operation: WatchlistOperation): Promise<void> {
    if (!isActive()) return Promise.resolve();
    const result = new Promise<void>((resolve, reject) => {
      pendingMutations.push({ operation, resolve, reject });
    });
    startMutationDrain();
    return result;
  }

  const poll = async (): Promise<void> => {
    if (!isActive() || pollInFlight) return;
    pollInFlight = true;
    try {
      if (provider !== undefined) {
        await refreshProviderData();
      } else {
        const nextBootstrap = await client.bootstrap();
        if (!isActive()) return;

        const metadataChanged = nextBootstrap.latestTimestamp !== previousLatestTimestamp()
          || nextBootstrap.snapshotCount !== state.snapshots.length;
        state.collectorStatus = nextBootstrap.collectorStatus;

        if (metadataChanged) {
          const nextSnapshots = await client.listSnapshots();
          if (!isActive()) return;
          state.snapshots = nextSnapshots;
          invalidateDerived();
          renderResultsOnly();
        }
      }
      state.statusError = null;
      renderStatus();
    } catch {
      if (isActive()) {
        state.statusError = POLL_FAILURE_MESSAGE;
        renderStatus();
      }
    } finally {
      pollInFlight = false;
    }
  };

  const detailController = createItemDetailController({
    dialog: detailDialog,
    snapshots: () => state.snapshots,
    catalog: () => state.catalog,
    getWatchlist: () => state.watchlist,
    onTogglePin: (key) => enqueueWatchlistMutation((watchlist) => togglePin(watchlist, key)),
    chartFactory,
    initialPeriod: state.period,
  });
  const onItemSelected = (event: Event): void => {
    if (!isActive() || !(event instanceof CustomEvent)) return;
    const key = event.detail as { key?: unknown };
    if (typeof key?.key !== 'string') return;
    detailController.open(key.key);
  };
  root.addEventListener(ITEM_SELECTED_EVENT, onItemSelected);

  renderNavigationOnly();
  renderToolbar(
    toolbar,
    state,
    getDerivedRows(),
    (mode) => {
      if (!isActive()) return;
      state.mode = mode;
      state.sortState = null;
      state.pageIndex = 0;
      updateModeButtons();
      renderResultsOnly();
    },
    (period) => {
      if (!isActive()) return;
      state.period = period;
      state.settings = { ...state.settings, period };
      enqueueSettingsWrite();
      state.pageIndex = 0;
      invalidateDerived();
      updatePeriodButtons();
      renderResultsOnly();
    },
    (query) => {
      if (!isActive()) return;
      state.query = query;
      state.pageIndex = 0;
      renderResultsOnly();
    },
    (levels) => {
      if (!isActive()) return;
      state.enhancementLevels = levels;
      state.pageIndex = 0;
      renderResultsOnly();
    },
    (value) => {
      if (!isActive()) return;
      state.minimumVolume = value;
      state.settings = { ...state.settings, minimumVolume: value ?? 0 };
      enqueueSettingsWrite();
      state.pageIndex = 0;
      renderResultsOnly();
    },
    (value) => {
      if (!isActive()) return;
      state.maximumSpreadPct = value;
      state.settings = { ...state.settings, maximumSpreadPct: value };
      enqueueSettingsWrite();
      state.pageIndex = 0;
      renderResultsOnly();
    },
    (categories) => {
      if (!isActive()) return;
      state.officialCategories = categories;
      state.pageIndex = 0;
      renderResultsOnly();
    },
    () => {
      if (!isActive()) return;
      state.sortState = null;
      state.pageIndex = 0;
      renderResultsOnly();
    },
    provider === undefined ? undefined : onManualRefresh,
  );
  renderStatus();
  renderResultsOnly();
  const pollingDelay = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 60_000;
  pollTimer = setIntervalFn(() => {
    void poll();
  }, pollingDelay);
  pollTimerActive = true;
  return {
    detailController,
    refreshProvider: refreshProviderData,
    renderMarket: renderResultsOnly,
    destroy(): void {
      root.removeEventListener(ITEM_SELECTED_EVENT, onItemSelected);
      if (pollTimerActive) {
        const handle = pollTimer;
        pollTimer = undefined;
        pollTimerActive = false;
        clearIntervalFn(handle);
      }
      activeMutation?.resolve();
      for (const pending of pendingMutations) pending.resolve();
      pendingMutations.length = 0;
      pendingSettings = null;
      detailController.destroy();
    },
  };
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

  const target = options.bridgeTarget
    ?? (typeof document === 'undefined' ? null : document.documentElement);
  const catalogLoader = options.catalogLoader ?? defaultCatalogLoader;
  const lifecycleController = typeof AbortController === 'undefined' ? null : new AbortController();
  let runtime: {
    detailController: ItemDetailController;
    refreshProvider(): Promise<void>;
    renderMarket(): void;
    destroy(): void;
  } | null = null;
  let provider: HybridClient | null = null;
  let preferences: PreferencesStore | null = null;
  const profileStore = options.profileStore
    ?? options.createProfileStore?.()
    ?? (typeof indexedDB === 'undefined' ? createMemoryProfileStore() : createIndexedProfileStore());
  const strategyPinStore = options.strategyPinStore
    ?? options.createStrategyPinStore?.()
    ?? (typeof indexedDB === 'undefined' ? createMemoryStrategyPinStore() : createStrategyPinStore());
  let strategyView: StrategyView | null = null;
  let strategySurfaceActive = false;
  let strategyDataPromise: Promise<NormalizedStrategyGameData> | null = null;
  const productMarket = root.querySelector<HTMLButtonElement>('[data-product-surface="market"]');
  const productStrategy = root.querySelector<HTMLButtonElement>('[data-product-surface="strategy"]');
  const categoryNav = root.querySelector<HTMLElement>('#category-nav');
  const toolbar = root.querySelector<HTMLElement>('#toolbar');
  const profileOpen = root.querySelector<HTMLButtonElement>('#profile-open');
  const profileSummary = root.querySelector<HTMLElement>('#profile-summary');
  const profileDialog = root.querySelector<HTMLDialogElement>('#profile-dialog');
  if (!profileOpen || !profileSummary || !profileDialog || !productMarket || !productStrategy || !categoryNav || !toolbar) {
    throw new Error('Profile shell is incomplete');
  }
  let profileItemName = (hrid: string): string => (
    hrid.split('/').at(-1)?.replaceAll('_', ' ') ?? hrid
  );
  const profilePanel: ProfilePanel = createProfilePanel({
    openButton: profileOpen,
    summary: profileSummary,
    dialog: profileDialog,
    store: profileStore,
    now: options.now,
    itemName: (hrid) => profileItemName(hrid),
    onActiveProfileChange: () => {
      if (strategySurfaceActive) void strategyView?.render();
    },
  });
  const showMarket = (): void => {
    strategySurfaceActive = false;
    productMarket.setAttribute('aria-pressed', 'true');
    productStrategy.setAttribute('aria-pressed', 'false');
    productMarket.classList.add('is-active');
    productStrategy.classList.remove('is-active');
    categoryNav.hidden = false;
    toolbar.hidden = false;
    runtime?.renderMarket();
  };
  const showStrategy = (): void => {
    strategySurfaceActive = true;
    productMarket.setAttribute('aria-pressed', 'false');
    productStrategy.setAttribute('aria-pressed', 'true');
    productMarket.classList.remove('is-active');
    productStrategy.classList.add('is-active');
    categoryNav.hidden = true;
    toolbar.hidden = true;
    void strategyView?.render();
  };
  productMarket.addEventListener('click', showMarket);
  productStrategy.addEventListener('click', showStrategy);
  let localAttached = false;

  const waitForLocalBridge = (): Promise<boolean> => {
    if (target === null) return Promise.resolve(false);
    return (options.waitForBridgeReady ?? defaultWaitForBridgeReady)(target, {
      timeoutMs: options.bridgeReadyTimeoutMs,
      signal: lifecycleController?.signal,
    });
  };

  const attachLocalClient = (): void => {
    if (provider === null || target === null || localAttached) return;
    const local = (options.createLocalClient ?? createDashboardClient)(target);
    provider.setLocalClient(local);
    localAttached = true;
  };

  try {
    let client: DashboardClient;
    let bootstrap: BridgeBootstrap;
    let snapshots: Snapshot[];
    const catalogPromise = Promise.resolve().then(catalogLoader);

    if (options.client !== undefined) {
      client = options.client;
      [bootstrap, snapshots] = await Promise.all([client.bootstrap(), client.listSnapshots()]);
    } else {
      preferences = options.preferencesStore
        ?? options.createPreferencesStore?.()
        ?? (typeof indexedDB === 'undefined' ? new MemoryPreferencesStore() : createPreferencesStore());
      const cloud = options.cloudClient
        ?? (options.createCloudClient ?? createCloudClient)(new URL('./data/', document.baseURI));
      const fetchLive = options.fetchLive !== undefined
        ? options.fetchLive
        : (options.cloudClient !== undefined ? null : ((opts: { signal?: AbortSignal }) => fetchOfficialSnapshot({ signal: opts.signal })));
      provider = createHybridClient({ cloud, preferences, fetchLive });

      try {
        [bootstrap, snapshots] = await Promise.all([provider.bootstrap(), provider.listSnapshots()]);
      } catch {
        const ready = await waitForLocalBridge();
        if (!ready) throw new Error('No cloud or local market data');
        attachLocalClient();
        [bootstrap, snapshots] = await Promise.all([provider.bootstrap(), provider.listSnapshots()]);
      }
      client = provider;
    }
    const catalogInput = await catalogPromise;
    if (!isActive()) {
      profilePanel.destroy();
      profileStore.close();
      strategyPinStore.close();
      productMarket.removeEventListener('click', showMarket);
      productStrategy.removeEventListener('click', showStrategy);
      return { destroy: () => undefined };
    }

    const settings = { ...bootstrap.settings };
    const state: DashboardState = {
      snapshots,
      catalog: normalizeCatalog(catalogInput),
      watchlist: normalizeWatchlist(bootstrap.watchlist),
      settings,
      collectorStatus: bootstrap.collectorStatus,
      period: settings.period,
      view: 'all',
      mode: 'market',
      sortState: null,
      pageIndex: 0,
      query: '',
      enhancementLevels: null,
      minimumVolume: settings.minimumVolume > 0 ? settings.minimumVolume : null,
      maximumSpreadPct: settings.maximumSpreadPct,
      officialCategories: new Set(),
      statusError: null,
      sourceInfo: provider === null ? null : bootstrap.sourceInfo ?? null,
      preferencesWarning: provider !== null && bootstrap.preferencesWarning === 'preferences_unavailable'
        ? PREFERENCES_WARNING_MESSAGE
        : null,
    };
    profileItemName = (hrid) => {
      const item = state.catalog.itemsByHrid.get(hrid);
      return item ? catalogItemName(item) : hrid.split('/').at(-1)?.replaceAll('_', ' ') ?? hrid;
    };
    runtime = renderDashboard(
      root,
      client,
      state,
      isActive,
      provider ?? undefined,
      lifecycleController?.signal,
      options.chartFactory,
      options.now,
      options.pollMs,
      options.setInterval,
      options.clearInterval,
    );
    if (runtime === null) throw new Error('Dashboard runtime is incomplete');
    const loadStrategyData = (): Promise<NormalizedStrategyGameData> => {
      if (strategyDataPromise === null) {
        strategyDataPromise = (options.strategyDataLoader ?? defaultStrategyDataLoader)()
          .catch((error: unknown) => {
            strategyDataPromise = null;
            throw error;
          });
      }
      return strategyDataPromise;
    };
    strategyView = createStrategyView({
      target: content,
      getProfile: () => profilePanel.getActiveProfile(),
      getSnapshots: () => state.snapshots,
      loadGameData: loadStrategyData,
      pinStore: strategyPinStore,
      itemName: (hrid) => {
        const item = state.catalog.itemsByHrid.get(hrid);
        return item ? catalogItemName(item) : hrid.split('/').at(-1)?.replaceAll('_', ' ') ?? hrid;
      },
      onImportProfile: () => { void profilePanel.open(); },
    });
    if (strategySurfaceActive) void strategyView.render();

    if (provider !== null && !localAttached && target !== null) {
      void waitForLocalBridge().then(async (ready) => {
        if (!ready || !isActive() || provider === null || runtime === null) return;
        try {
          attachLocalClient();
          await runtime.refreshProvider();
        } catch {
          // Keep the cloud rows and source label when the optional local bridge fails.
        }
      }).catch(() => undefined);
    }
  } catch {
    if (isActive()) {
      renderBridgeUnavailable(status);
      renderUnavailableContent(content);
    }
  }

  return {
    destroy(): void {
      destroyed = true;
      lifecycleController?.abort();
      if (mountGenerations.get(root) === mountGeneration) {
        mountGenerations.set(root, mountGeneration + 1);
      }
      runtime?.destroy();
      provider?.destroy();
      preferences?.close?.();
      profilePanel.destroy();
      profileStore.close();
      productMarket.removeEventListener('click', showMarket);
      productStrategy.removeEventListener('click', showStrategy);
      strategyView?.destroy();
      strategyPinStore.close();
    },
  };
}

if (typeof document !== 'undefined' && document.querySelector('#app')) {
  void mountDashboard();
}
