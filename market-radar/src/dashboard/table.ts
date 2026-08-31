import { shortCategory } from '../core/categories';
import type { SortField } from '../core/rankings';
import type { Period } from '../core/types';
import type { DerivedMarketRow, NormalizedCatalog, SortState } from './state';

export const ITEM_SELECTED_EVENT = 'mwi-radar:item-selected';

export interface MarketTableOptions {
  rows: readonly DerivedMarketRow[];
  catalog: NormalizedCatalog;
  selectedPeriod: Period;
  sortState: SortState | null;
  view: string;
  onSort(field: SortField): void;
  onTogglePin(key: DerivedMarketRow['key']): void;
  onMoveWatchItem?(key: DerivedMarketRow['key'], direction: 'up' | 'down'): void;
}

interface ColumnDefinition {
  field?: SortField;
  label: string;
  key: string;
  className?: string;
}

const COLUMNS: ColumnDefinition[] = [
  { label: '自選', key: 'pin', className: 'pin-column' },
  { field: 'name', label: '物品 / 強化', key: 'name', className: 'name-column' },
  { field: 'category', label: '官方分類', key: 'category' },
  { field: 'price', label: '目前價', key: 'price' },
  { field: 'bid', label: '買一', key: 'bid' },
  { field: 'ask', label: '賣一', key: 'ask' },
  { field: 'spreadPct', label: '價差 %', key: 'spread' },
  { field: 'volume', label: '成交量', key: 'volume' },
  { field: 'change1d', label: '1D', key: 'change-1d' },
  { field: 'change3d', label: '3D', key: 'change-3d' },
  { field: 'change7d', label: '7D', key: 'change-7d' },
  { label: '資料品質', key: 'quality' },
];

const QUALITY_LABELS: Record<DerivedMarketRow['quality'], string> = {
  official: '官方',
  midpoint: '中間價',
  'ask-only': '單邊賣',
  'bid-only': '單邊買',
  missing: '無市場',
};

const FLAG_LABELS: Record<DerivedMarketRow['flags'][number], string> = {
  thin: '薄量',
  'one-sided': '單邊',
  'wide-spread': '大價差',
  'volume-spike': '異常量',
  move: '異動',
};

function finiteValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function formatValue(value: number | null, maximumFractionDigits = 2): string {
  if (!finiteValue(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function categoryName(row: DerivedMarketRow, catalog: NormalizedCatalog): string {
  return catalog.categoriesByHrid.get(row.categoryHrid)?.name
    ?? (row.categoryHrid === '/item_categories/unknown' ? '未知' : shortCategory(row.categoryHrid));
}

function trend(value: number | null): { label: string; state: 'up' | 'down' | 'flat' } {
  if (!finiteValue(value) || value === 0) return { label: '—', state: 'flat' };
  return value > 0
    ? { label: `▲ ${formatValue(value)}%`, state: 'up' }
    : { label: `▼ ${formatValue(Math.abs(value))}%`, state: 'down' };
}

function sortableHeader(
  column: ColumnDefinition,
  sortState: SortState | null,
  onSort: (field: SortField) => void,
): HTMLTableCellElement {
  const header = document.createElement('th');
  header.scope = 'col';
  header.dataset.sortHeader = column.key;
  if (column.className) header.className = column.className;

  if (column.field === undefined) {
    header.textContent = column.label;
    return header;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'table-sort-button';
  button.dataset.sortField = column.field;
  button.textContent = column.label;
  const direction = sortState?.field === column.field ? sortState.direction : null;
  header.setAttribute('aria-sort', direction === 'desc' ? 'descending' : direction === 'asc' ? 'ascending' : 'none');
  button.addEventListener('click', () => onSort(column.field as SortField));
  header.append(button);
  return header;
}

function appendTextCell(row: HTMLTableRowElement, value: string, className?: string): void {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.append(cell);
}

function appendTrendCell(row: HTMLTableRowElement, period: Period, value: number | null): void {
  const cell = document.createElement('td');
  const valueElement = document.createElement('span');
  const rendered = trend(value);
  valueElement.className = 'trend-value';
  valueElement.dataset.changePeriod = period;
  valueElement.dataset.trend = rendered.state;
  valueElement.textContent = rendered.label;
  cell.append(valueElement);
  row.append(cell);
}

function appendPinCell(
  row: HTMLTableRowElement,
  marketRow: DerivedMarketRow,
  onTogglePin: (key: DerivedMarketRow['key']) => void,
  onMoveWatchItem?: (key: DerivedMarketRow['key'], direction: 'up' | 'down') => void,
  isWatchlistView = false,
): void {
  const cell = document.createElement('td');
  cell.className = 'pin-column';
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'pin-button';
  pin.dataset.pin = 'true';
  pin.dataset.pinKey = marketRow.key;
  pin.setAttribute('aria-pressed', String(marketRow.watchlisted));
  pin.setAttribute('aria-label', `${marketRow.watchlisted ? '取消自選' : '加入自選'} ${marketRow.name} +${marketRow.enhancementLevel}`);
  pin.textContent = marketRow.watchlisted ? '★' : '☆';
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    onTogglePin(marketRow.key);
  });
  cell.append(pin);

  if (isWatchlistView && marketRow.watchlisted && onMoveWatchItem !== undefined) {
    const move = document.createElement('span');
    move.className = 'watch-move-controls';
    for (const direction of ['up', 'down'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.watchMove = direction;
      button.setAttribute('aria-label', `${direction === 'up' ? '上移' : '下移'} ${marketRow.name} +${marketRow.enhancementLevel}`);
      button.textContent = direction === 'up' ? '↑' : '↓';
      if (direction === 'up') button.disabled = marketRow.order === 0;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onMoveWatchItem(marketRow.key, direction);
      });
      move.append(button);
    }
    cell.append(move);
  }
  row.append(cell);
}

function appendNameCell(row: HTMLTableRowElement, marketRow: DerivedMarketRow): void {
  const cell = document.createElement('td');
  cell.className = 'name-column';
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = marketRow.name;
  cell.append(name);
  const level = document.createElement('span');
  level.className = 'item-level';
  level.textContent = `+${marketRow.enhancementLevel}`;
  cell.append(level);
  if (marketRow.flags.length > 0) {
    const badges = document.createElement('span');
    badges.className = 'market-flags';
    for (const flag of marketRow.flags) {
      const badge = document.createElement('span');
      badge.className = 'market-flag';
      badge.dataset.flag = flag;
      badge.textContent = FLAG_LABELS[flag];
      badges.append(badge);
    }
    cell.append(badges);
  }
  row.append(cell);
}

export function renderMarketTable(target: HTMLElement, options: MarketTableOptions): void {
  target.replaceChildren();
  target.classList.add('table-scroll');

  if (options.rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'table-empty';
    empty.textContent = '目前篩選沒有符合項目';
    target.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'market-table';
  table.dataset.marketTable = 'true';
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const column of COLUMNS) headerRow.append(sortableHeader(column, options.sortState, options.onSort));
  head.append(headerRow);
  table.append(head);

  const body = document.createElement('tbody');
  for (const marketRow of options.rows) {
    const row = document.createElement('tr');
    row.dataset.marketRow = marketRow.key;
    row.dataset.marketKey = marketRow.key;
    row.tabIndex = 0;
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      target.dispatchEvent(new CustomEvent(ITEM_SELECTED_EVENT, {
        bubbles: true,
        detail: { key: marketRow.key },
      }));
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      target.dispatchEvent(new CustomEvent(ITEM_SELECTED_EVENT, {
        bubbles: true,
        detail: { key: marketRow.key },
      }));
    });

    appendPinCell(row, marketRow, options.onTogglePin, options.onMoveWatchItem, options.view === 'watchlist');
    appendNameCell(row, marketRow);
    appendTextCell(row, categoryName(marketRow, options.catalog));
    appendTextCell(row, formatValue(marketRow.price));
    appendTextCell(row, formatValue(marketRow.bid));
    appendTextCell(row, formatValue(marketRow.ask));
    appendTextCell(row, formatValue(marketRow.spreadPct));
    appendTextCell(row, formatValue(marketRow.volume));
    appendTrendCell(row, '1d', marketRow.changes['1d']);
    appendTrendCell(row, '3d', marketRow.changes['3d']);
    appendTrendCell(row, '7d', marketRow.changes['7d']);
    appendTextCell(row, QUALITY_LABELS[marketRow.quality]);
    body.append(row);
  }
  table.append(body);
  target.append(table);
}
