import type { Snapshot } from '../core/types';
import type { PlayerProfile } from '../profile/types';
import { buildStrategyCandidates, type StrategyCandidate, type StrategyCandidateResult } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { createMarketPriceBook } from './price-book';
import type { StrategyPinStore } from './store';

export interface StrategyView {
  render(): Promise<void>;
  destroy(): void;
}

export interface StrategyViewOptions {
  target: HTMLElement;
  getProfile(): PlayerProfile | null;
  getSnapshot(): Snapshot | null;
  loadGameData(): Promise<NormalizedStrategyGameData>;
  pinStore: StrategyPinStore;
  calculate?: typeof buildStrategyCandidates;
  itemName(hrid: string): string;
  onImportProfile(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function money(value: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value);
}

function kindLabel(kind: StrategyCandidate['kind']): string {
  return {
    manufacture: '單步製造',
    workflow: '多步工作流',
    decompose: '分解',
    coinify: '點金',
    'decompose-coinify': '分解 → 點金',
  }[kind];
}

function renderNoProfile(options: StrategyViewOptions): void {
  options.target.replaceChildren();
  const empty = element('section', 'strategy-empty');
  const heading = element('h2');
  heading.textContent = '導入角色快照後計算';
  const copy = element('p');
  copy.textContent = '策略收益需要你的技能、裝備、茶、房屋與神龕。角色資料只保存在此瀏覽器。';
  const button = element('button', 'toolbar-button');
  button.type = 'button';
  button.dataset.strategyImport = 'true';
  button.textContent = '導入角色快照';
  button.addEventListener('click', options.onImportProfile);
  empty.append(heading, copy, button);
  options.target.append(empty);
}

function strategyRow(
  candidate: StrategyCandidate,
  pinned: Set<string>,
  options: StrategyViewOptions,
): HTMLTableRowElement {
  const row = element('tr');
  row.dataset.strategyRow = candidate.id;

  const pinCell = element('td');
  const pin = element('button', 'pin-button');
  pin.type = 'button';
  pin.dataset.strategyPin = candidate.id;
  pin.setAttribute('aria-label', `釘選策略 ${candidate.title}`);
  pin.setAttribute('aria-pressed', String(pinned.has(candidate.id)));
  pin.textContent = pinned.has(candidate.id) ? '★' : '☆';
  pin.addEventListener('click', () => {
    pin.disabled = true;
    void options.pinStore.toggle(candidate.id).then((isPinned) => {
      if (isPinned) pinned.add(candidate.id);
      else pinned.delete(candidate.id);
      pin.setAttribute('aria-pressed', String(isPinned));
      pin.textContent = isPinned ? '★' : '☆';
    }).finally(() => { pin.disabled = false; });
  });
  pinCell.append(pin);
  row.append(pinCell);

  const strategyCell = element('td', 'strategy-name-cell');
  const type = element('span', 'strategy-kind');
  type.textContent = kindLabel(candidate.kind);
  const title = element('strong');
  title.textContent = options.itemName(candidate.path.at(-1) ?? candidate.title);
  const path = element('span', 'strategy-path');
  path.textContent = candidate.path.map(options.itemName).join(' → ');
  strategyCell.append(type, title, path);
  row.append(strategyCell);

  for (const [value, className] of [
    [candidate.profitPerDay, 'strategy-profit'],
    [candidate.profitPerHour, 'strategy-profit-hour'],
    [candidate.workingCapital24h, 'strategy-capital'],
  ] as const) {
    const cell = element('td', className);
    cell.textContent = money(value);
    row.append(cell);
  }
  const stepCell = element('td');
  const details = element('details', 'strategy-steps');
  const summary = element('summary');
  summary.textContent = `${candidate.steps.length} 步`;
  const list = element('ol');
  for (const step of candidate.steps) {
    const item = element('li');
    item.textContent = `${step.action}｜${options.itemName(step.outputHrid)}｜${money(step.profitPerHour ?? 0)}/h`;
    list.append(item);
  }
  details.append(summary, list);
  stepCell.append(details);
  row.append(stepCell);
  return row;
}

function renderResults(
  result: StrategyCandidateResult,
  pinned: Set<string>,
  options: StrategyViewOptions,
): void {
  options.target.replaceChildren();
  const header = element('header', 'strategy-header');
  const heading = element('h2');
  heading.textContent = '策略推薦';
  const warning = element('p', 'strategy-warning');
  warning.textContent = '目前為理論收益，尚未套用市場承接量；安全批量與可實現日利將在下一階段加入。';
  header.append(heading, warning);
  options.target.append(header);

  const positive = result.candidates.filter((candidate) => candidate.profitPerDay > 0);
  positive.sort((left, right) => {
    const byPinned = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
    return byPinned || right.profitPerDay - left.profitPerDay;
  });
  if (positive.length === 0) {
    const empty = element('p', 'strategy-no-result');
    empty.textContent = '目前價格下沒有資料完整且理論收益為正的策略。';
    options.target.append(empty);
    return;
  }

  const meta = element('p', 'strategy-meta');
  meta.textContent = `顯示前 ${Math.min(100, positive.length)} / ${positive.length} 條正收益策略`;
  options.target.append(meta);
  const scroll = element('div', 'strategy-table-scroll');
  const table = element('table', 'strategy-table');
  const head = element('thead');
  const headerRow = element('tr');
  for (const label of ['自選', '策略路徑', '理論日利', '每小時利潤', '24h 資金', '步驟']) {
    const cell = element('th');
    cell.textContent = label;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = element('tbody');
  for (const candidate of positive.slice(0, 100)) body.append(strategyRow(candidate, pinned, options));
  table.append(head, body);
  scroll.append(table);
  options.target.append(scroll);
}

export function createStrategyView(options: StrategyViewOptions): StrategyView {
  const calculate = options.calculate ?? buildStrategyCandidates;
  let generation = 0;
  let destroyed = false;
  return {
    async render(): Promise<void> {
      if (destroyed) return;
      const current = ++generation;
      const profile = options.getProfile();
      if (!profile) {
        renderNoProfile(options);
        return;
      }
      const snapshot = options.getSnapshot();
      if (!snapshot) {
        options.target.textContent = '尚無市場快照，無法計算策略。';
        return;
      }
      options.target.innerHTML = '<p class="strategy-loading">正在計算個人化策略…</p>';
      try {
        const [data, pins] = await Promise.all([options.loadGameData(), options.pinStore.list()]);
        if (destroyed || current !== generation) return;
        const result = calculate({ profile, data, prices: createMarketPriceBook(snapshot) });
        renderResults(result, new Set(pins), options);
      } catch {
        if (!destroyed && current === generation) options.target.textContent = '策略資料無法使用，請稍後再試。';
      }
    },
    destroy(): void {
      destroyed = true;
      generation += 1;
    },
  };
}
