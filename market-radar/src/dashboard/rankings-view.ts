import { sortRows, type MarketRow } from '../core/rankings';
import type { Period } from '../core/types';
import type { DerivedMarketRow } from './state';

export type RankingMode =
  | 'market'
  | 'gainers'
  | 'losers'
  | 'volume'
  | 'volume-anomaly'
  | 'volatility'
  | 'spread'
  | 'missing-side';

export interface RankingModeDefinition {
  mode: RankingMode;
  label: string;
}

export const RANKING_MODES: readonly RankingModeDefinition[] = [
  { mode: 'market', label: '行情表' },
  { mode: 'gainers', label: '漲幅榜' },
  { mode: 'losers', label: '跌幅榜' },
  { mode: 'volume', label: '成交量榜' },
  { mode: 'volume-anomaly', label: '異常量榜' },
  { mode: 'volatility', label: '波動榜' },
  { mode: 'spread', label: '大價差榜' },
  { mode: 'missing-side', label: '無買/無賣' },
];

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function changeField(period: Period): 'change1d' | 'change3d' | 'change7d' {
  return period === '1d' ? 'change1d' : period === '3d' ? 'change3d' : 'change7d';
}

function rankNonNull(
  rows: readonly DerivedMarketRow[],
  field: 'change1d' | 'change3d' | 'change7d' | 'volume' | 'volumeMultiple' | 'volatility' | 'spread',
  direction: 'asc' | 'desc',
): DerivedMarketRow[] {
  const candidates = rows.filter((row) => {
    if (field === 'change1d' || field === 'change3d' || field === 'change7d') {
      return finite(row.changes[field.slice(6) as Period]);
    }
    if (field === 'volume') return finite(row.volume);
    if (field === 'volumeMultiple') return finite(row.volumeMultiple);
    if (field === 'volatility') return finite(row.volatilityPct);
    return finite(row.spreadPct);
  });
  return sortRows(candidates as readonly MarketRow[], field, direction) as DerivedMarketRow[];
}

/** Return a ranked copy for one secondary market mode. */
export function rankRowsForMode(
  rows: readonly DerivedMarketRow[],
  mode: RankingMode,
  period: Period,
): DerivedMarketRow[] {
  switch (mode) {
    case 'gainers':
      return rankNonNull(rows, changeField(period), 'desc');
    case 'losers':
      return rankNonNull(rows, changeField(period), 'asc');
    case 'volume':
      return rankNonNull(rows, 'volume', 'desc');
    case 'volume-anomaly':
      return rankNonNull(rows, 'volumeMultiple', 'desc');
    case 'volatility':
      return rankNonNull(rows, 'volatility', 'desc');
    case 'spread':
      return rankNonNull(rows, 'spread', 'desc');
    case 'missing-side':
      return sortRows(
        rows.filter((row) => row.bid === null || row.ask === null) as readonly MarketRow[],
        'name',
        'asc',
      ) as DerivedMarketRow[];
    case 'market':
      return [...rows];
  }
}

export function renderRankingModeButtons(
  target: HTMLElement,
  activeMode: RankingMode,
  onMode: (mode: RankingMode) => void,
): void {
  target.querySelector('[data-ranking-modes]')?.remove();
  const group = document.createElement('nav');
  group.className = 'ranking-modes';
  group.dataset.rankingModes = 'true';
  group.setAttribute('aria-label', '行情模式');
  for (const definition of RANKING_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ranking-mode-button';
    button.dataset.rankingMode = definition.mode;
    button.setAttribute('aria-pressed', String(activeMode === definition.mode));
    button.classList.toggle('is-active', activeMode === definition.mode);
    button.textContent = definition.label;
    button.addEventListener('click', () => onMode(definition.mode));
    group.append(button);
  }
  target.prepend(group);
}

export function updateRankingModeButtons(target: HTMLElement, activeMode: RankingMode): void {
  for (const button of target.querySelectorAll<HTMLButtonElement>('[data-ranking-mode]')) {
    const active = button.dataset.rankingMode === activeMode;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('is-active', active);
  }
}

export const renderMarketModes = renderRankingModeButtons;
