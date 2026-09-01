import type { Snapshot } from '../core/types';
import type { PlayerProfile } from '../profile/types';
import { buildStrategyCandidates, type StrategyCandidate, type StrategyCandidateResult } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { createStrategyPriceBook } from './price-book';
import {
  evaluateRealizableStrategy,
  type LiquidityClassification,
  type RealizableStrategy,
} from './realizable';
import type { StrategyPinStore } from './store';
import type { StrategyFlow, StrategyStepResult } from './types';

export interface StrategyView {
  render(): Promise<void>;
  destroy(): void;
}

export interface StrategyViewOptions {
  target: HTMLElement;
  getProfile(): PlayerProfile | null;
  getSnapshots(): readonly Snapshot[];
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

function quantity(value: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value);
}

function metric(value: number | null, suffix = ''): string {
  return value === null || !Number.isFinite(value) ? '—' : `${quantity(value)}${suffix}`;
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

const CLASSIFICATION_LABELS: Record<LiquidityClassification, string> = {
  'long-run': '可長掛',
  'small-test': '小量試單',
  limited: '限量製作',
  reject: '不建議',
  insufficient: '資料不足',
};

type StrategyScope = 'actionable' | 'limited';

interface AssessedStrategy {
  candidate: StrategyCandidate;
  liquidity: RealizableStrategy;
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
  assessed: AssessedStrategy,
  pinned: Set<string>,
  options: StrategyViewOptions,
): HTMLTableRowElement {
  const { candidate, liquidity } = assessed;
  const row = element('tr');
  row.dataset.strategyRow = candidate.id;
  row.dataset.liquidityClassification = liquidity.classification;

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

  const classificationCell = element('td');
  const classification = element('span', 'strategy-classification');
  classification.dataset.classification = liquidity.classification;
  classification.textContent = CLASSIFICATION_LABELS[liquidity.classification];
  classificationCell.append(classification);
  row.append(classificationCell);

  const theoretical = element('td', 'strategy-profit-theoretical');
  theoretical.textContent = money(liquidity.theoreticalProfitPerDay);
  row.append(theoretical);
  const realizable = element('td', 'strategy-profit');
  realizable.textContent = liquidity.realizableProfitPerDay === null
    ? '—'
    : money(liquidity.realizableProfitPerDay);
  row.append(realizable);

  const safeCell = element('td', 'strategy-metrics');
  const safeHours = element('span');
  safeHours.textContent = `可執行 ${metric(liquidity.safeHoursPerDay, ' h/日')}`;
  const safeBatch = element('span');
  safeBatch.textContent = `安全批量 ${metric(liquidity.safeBatchUnits, '/日')}`;
  safeCell.append(safeHours, safeBatch);
  row.append(safeCell);

  const marketCell = element('td', 'strategy-metrics');
  const share = element('span');
  share.textContent = `市場占比 ${metric(liquidity.marketSharePct, '%')}`;
  const sellThrough = element('span');
  sellThrough.textContent = `售出估計 ${metric(liquidity.sellThroughDays, ' 日')}`;
  const bottleneck = element('span');
  bottleneck.textContent = liquidity.bottleneckHrid === null
    ? '瓶頸 無市場交易邊'
    : `瓶頸 ${liquidity.bottleneckSide === 'input' ? '買入' : '賣出'} ${options.itemName(liquidity.bottleneckHrid)}`;
  marketCell.append(share, sellThrough, bottleneck);
  row.append(marketCell);

  const capital = element('td', 'strategy-capital');
  capital.textContent = money(candidate.workingCapital24h);
  row.append(capital);

  const stepCell = element('td');
  const details = element('details', 'strategy-steps');
  const summary = element('summary');
  summary.textContent = `${candidate.steps.length} 步與假設`;
  const list = element('ol');
  for (const step of candidate.steps) {
    const item = element('li');
    item.append(stepAssumptions(step, options));
    list.append(item);
  }
  details.append(summary, list);
  stepCell.append(details);
  row.append(stepCell);
  return row;
}

function flowAssumption(
  flow: StrategyFlow,
  side: '投入' | '產出',
  options: StrategyViewOptions,
): string {
  const price = flow.unitPrice === null ? '內部流轉' : `單價 ${money(flow.unitPrice)}`;
  return `${side} ${options.itemName(flow.itemHrid)} ${quantity(flow.unitsPerHour)}/h・${price}`;
}

function stepAssumptions(step: StrategyStepResult, options: StrategyViewOptions): HTMLElement {
  const wrapper = element('div', 'strategy-step-assumptions');
  const headline = element('strong');
  headline.textContent = `${step.action}｜${options.itemName(step.outputHrid)}｜${quantity(step.actionsPerHour)} 次/h`;
  const economics = element('span');
  economics.textContent = `成本 ${metric(step.costPerHour, '/h')}・收入 ${metric(step.incomePerHour, '/h')}・利潤 ${metric(step.profitPerHour, '/h')}`;
  const flows = element('ul');
  for (const input of step.inputs) {
    const line = element('li');
    line.textContent = flowAssumption(input, '投入', options);
    flows.append(line);
  }
  for (const output of step.outputs) {
    const line = element('li');
    line.textContent = flowAssumption(output, '產出', options);
    flows.append(line);
  }
  wrapper.append(headline, economics, flows);
  return wrapper;
}

function renderResults(
  result: StrategyCandidateResult,
  pinned: Set<string>,
  options: StrategyViewOptions,
  snapshots: readonly Snapshot[],
  scope: StrategyScope = 'actionable',
): void {
  options.target.replaceChildren();
  const header = element('header', 'strategy-header');
  const heading = element('h2');
  heading.textContent = '策略推薦';
  const warning = element('p', 'strategy-warning');
  warning.textContent = '可實現日利採所有市場買賣邊的 3D／7D 成交量中位數與 5% 安全市占估算；這是成交量承接估計，不等同訂單簿深度或滑價保證。市場賣出按現行 5% 稅計算，點金不課市場稅。';
  header.append(heading, warning);
  options.target.append(header);

  const assessed = result.candidates
    .filter((candidate) => candidate.profitPerDay > 0)
    .map((candidate) => ({ candidate, liquidity: evaluateRealizableStrategy(candidate, snapshots) }));
  const actionable = assessed.filter(({ liquidity }) => (
    liquidity.classification !== 'reject'
    && liquidity.classification !== 'insufficient'
    && (liquidity.realizableProfitPerDay ?? 0) > 0
  ));
  const limited = assessed.filter(({ liquidity }) => (
    liquidity.classification === 'reject' || liquidity.classification === 'insufficient'
  ));
  const chosen = scope === 'actionable' ? actionable : limited;
  chosen.sort((left, right) => {
    const byPinned = Number(pinned.has(right.candidate.id)) - Number(pinned.has(left.candidate.id));
    if (byPinned) return byPinned;
    if (scope === 'limited' && left.liquidity.classification !== right.liquidity.classification) {
      return left.liquidity.classification === 'insufficient' ? -1 : 1;
    }
    const leftProfit = left.liquidity.realizableProfitPerDay ?? left.liquidity.theoreticalProfitPerDay;
    const rightProfit = right.liquidity.realizableProfitPerDay ?? right.liquidity.theoreticalProfitPerDay;
    return rightProfit - leftProfit || left.candidate.id.localeCompare(right.candidate.id);
  });

  const scopeNav = element('nav', 'strategy-scopes');
  scopeNav.setAttribute('aria-label', '策略承接分類');
  for (const [key, label, count] of [
    ['actionable', '可執行', actionable.length],
    ['limited', '觀察／排除', limited.length],
  ] as const) {
    const button = element('button', 'strategy-scope-button');
    button.type = 'button';
    button.dataset.strategyScope = key;
    button.setAttribute('aria-pressed', String(scope === key));
    button.textContent = `${label} ${count}`;
    button.addEventListener('click', () => renderResults(result, pinned, options, snapshots, key));
    scopeNav.append(button);
  }
  options.target.append(scopeNav);

  if (assessed.length === 0) {
    const empty = element('p', 'strategy-no-result');
    empty.textContent = '目前價格下沒有資料完整且理論收益為正的策略。';
    options.target.append(empty);
    return;
  }

  if (chosen.length === 0) {
    const empty = element('p', 'strategy-no-result');
    empty.textContent = scope === 'actionable'
      ? '目前沒有通過成交量承接門檻的正收益策略；請查看「觀察／排除」了解資料不足或不建議的原因。'
      : '目前沒有資料不足或超過安全市占的策略。';
    options.target.append(empty);
    return;
  }

  const meta = element('p', 'strategy-meta');
  meta.textContent = `顯示前 ${Math.min(100, chosen.length)} / ${chosen.length} 條；預設依可實現日利排序`;
  options.target.append(meta);
  const scroll = element('div', 'strategy-table-scroll');
  const table = element('table', 'strategy-table');
  const head = element('thead');
  const headerRow = element('tr');
  for (const label of ['自選', '策略路徑', '判定', '理論日利', '可實現日利', '安全執行', '市場承接', '24h 資金', '假設']) {
    const cell = element('th');
    cell.textContent = label;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = element('tbody');
  for (const candidate of chosen.slice(0, 100)) body.append(strategyRow(candidate, pinned, options));
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
      const snapshots = options.getSnapshots();
      const snapshot = snapshots.reduce<Snapshot | null>((latest, item) => (
        latest === null || item.timestamp > latest.timestamp ? item : latest
      ), null);
      if (!snapshot) {
        options.target.textContent = '尚無市場快照，無法計算策略。';
        return;
      }
      options.target.innerHTML = '<p class="strategy-loading">正在計算個人化策略…</p>';
      try {
        const [data, pins] = await Promise.all([options.loadGameData(), options.pinStore.list()]);
        if (destroyed || current !== generation) return;
        const result = calculate({ profile, data, prices: createStrategyPriceBook(snapshot, data) });
        renderResults(result, new Set(pins), options, snapshots);
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
