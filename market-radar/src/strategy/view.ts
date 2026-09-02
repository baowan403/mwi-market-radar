import type { Snapshot } from '../core/types';
import { formatCompactNumber } from '../core/format-number';
import type { PlayerProfile } from '../profile/types';
import { backtestStrategySignals, type StrategyBacktestResult } from './backtest';
import { buildStrategyCandidates, type StrategyCandidate, type StrategyCandidateResult } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { buildStrategyMarginSeries, repriceFixedCandidate } from './margin-series';
import { createStrategyPriceBook } from './price-book';
import {
  evaluateRealizableStrategy,
  type LiquidityClassification,
  type RealizableStrategy,
} from './realizable';
import type { StrategyPinStore } from './store';
import {
  strategyTrendSignal,
  type StrategyPriority,
  type StrategySignal,
  type StrategySignalAction,
  type StrategySignalConfidence,
} from './signals';
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
  return formatCompactNumber(value);
}

function quantity(value: number): string {
  return formatCompactNumber(value);
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

const SIGNAL_LABELS: Record<StrategySignalAction, string> = {
  execute: '立即製造',
  prepare: '囤原料',
  wait: '暫停觀望',
  sell: '賣出清倉',
  stop: '逐步出場',
};

const PRIORITY_LABELS: Record<StrategyPriority, string> = {
  top: '最高',
  high: '高',
  medium: '中',
  low: '低',
};

const CONFIDENCE_LABELS: Record<StrategySignalConfidence, string> = {
  none: '無',
  low: '低',
  medium: '中',
  high: '高',
};

type StrategyScope = 'actionable' | 'limited';

interface AssessedStrategy {
  candidate: StrategyCandidate;
  liquidity: RealizableStrategy;
}

interface AssessedSignal {
  signal: StrategySignal;
  backtest: StrategyBacktestResult;
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

/** 格式化趨勢百分比：正值帶 +，null 顯示 — */
function trendPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function strategyRow(
  assessed: AssessedStrategy,
  assessedSignal: AssessedSignal,
  pinned: Set<string>,
  options: StrategyViewOptions,
): HTMLTableRowElement {
  const { candidate, liquidity } = assessed;
  const { signal, backtest } = assessedSignal;
  const row = element('tr');
  row.dataset.strategyRow = candidate.id;
  row.dataset.liquidityClassification = liquidity.classification;

  // ── 欄 1：自選 ──
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

  // ── 欄 2：步驟（動作類型）──
  const stepCell = element('td', 'strategy-step');
  stepCell.textContent = kindLabel(candidate.kind);
  row.append(stepCell);

  // ── 欄 3：路徑（材料流程）──
  const pathCell = element('td', 'strategy-path-cell');
  pathCell.textContent = candidate.path.map(options.itemName).join(' → ');
  row.append(pathCell);

  // ── 欄 4：日利 ──
  // ── 欄 4：日利 ──
  const profitCell = element('td', 'strategy-profit');
  profitCell.textContent = liquidity.realizableProfitPerDay === null
    ? '—'
    : money(liquidity.realizableProfitPerDay);
  row.append(profitCell);

  // ── 欄 5：1D 趨勢 ──
  const trend1dCell = element('td', 'strategy-trend-cell');
  const delta1d = element('span');
  delta1d.className = deltaClass(signal.metrics.margin1dPct);
  delta1d.textContent = trendPct(signal.metrics.margin1dPct);
  trend1dCell.append(delta1d);
  row.append(trend1dCell);

  // ── 欄 6：3D 趨勢 ──
  const trend3dCell = element('td', 'strategy-trend-cell');
  const delta3d = element('span');
  delta3d.className = deltaClass(signal.metrics.margin3dPct);
  delta3d.textContent = trendPct(signal.metrics.margin3dPct);
  trend3dCell.append(delta3d);
  row.append(trend3dCell);

  // ── 欄 7：7D 趨勢 ──
  const trend7dCell = element('td', 'strategy-trend-cell');
  const delta7d = element('span');
  delta7d.className = deltaClass(signal.metrics.margin7dPct);
  delta7d.textContent = trendPct(signal.metrics.margin7dPct);
  trend7dCell.append(delta7d);
  row.append(trend7dCell);

  // ── 欄 8：日產佔比（做滿24h佔市場日交易量%）──
  const shareCell = element('td', 'strategy-market-share');
  if (liquidity.marketSharePct !== null && Number.isFinite(liquidity.marketSharePct)) {
    shareCell.textContent = `${liquidity.marketSharePct.toFixed(1)}%`;
    shareCell.title = `做滿24小時產量佔市場日成交量約 ${liquidity.marketSharePct.toFixed(1)}%`;
  } else {
    shareCell.textContent = '—';
  }
  row.append(shareCell);

  // ── 欄 9：資金/D ──
  const capital = element('td', 'strategy-capital');
  capital.textContent = money(candidate.workingCapital24h);
  row.append(capital);

  // ── 欄 10：判定 ──
  const classificationCell = element('td');
  const classification = element('span', 'strategy-classification');
  classification.dataset.classification = liquidity.classification;
  classification.textContent = CLASSIFICATION_LABELS[liquidity.classification];
  classificationCell.append(classification);
  row.append(classificationCell);

  // ── 欄 11：優先級 ──
  const priorityCell = element('td', 'strategy-priority-cell');
  const priorityBadge = element('span', 'strategy-priority-badge');
  priorityBadge.dataset.strategyPriority = signal.priority;
  priorityBadge.textContent = PRIORITY_LABELS[signal.priority];
  priorityBadge.title = signal.reasons.join('；');
  priorityCell.append(priorityBadge);
  row.append(priorityCell);

  return row;
}

/** 判斷趨勢百分比的色彩 class */
function deltaClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'delta-neutral';
  if (value >= 3) return 'delta-up';
  if (value <= -3) return 'delta-down';
  return 'delta-neutral';
}

/** 生成列展開詳情子列（步驟假設） */
function detailRow(
  candidate: StrategyCandidate,
  options: StrategyViewOptions,
): HTMLTableRowElement {
  const row = element('tr', 'strategy-detail-row');
  row.dataset.strategyDetailFor = candidate.id;
  const cell = element('td');
  cell.colSpan = 7;
  const content = element('div', 'strategy-detail-content');
  const heading = element('strong');
  heading.textContent = `${candidate.steps.length} 步驟明細`;
  content.append(heading);
  const list = element('ol');
  for (const step of candidate.steps) {
    const item = element('li');
    item.append(stepAssumptions(step, options));
    list.append(item);
  }
  content.append(list);
  cell.append(content);
  row.append(cell);
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
  data: NormalizedStrategyGameData,
  scope: StrategyScope = 'actionable',
  signalCache = new Map<string, AssessedSignal>(),
  priceBookCache = new Map<number, ReturnType<typeof createStrategyPriceBook>>(),
): void {
  options.target.replaceChildren();
  const header = element('header', 'strategy-header');
  const heading = element('h2');
  heading.textContent = '策略推薦';
  const warning = element('p', 'strategy-warning');
  warning.textContent = '日利依所有市場邊的 3D／7D 成交量中位數與 5% 安全市占估算，不等同訂單簿深度。出售扣 5% 稅，點金免稅。';
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
    button.addEventListener('click', () => renderResults(
      result, pinned, options, snapshots, data, key, signalCache, priceBookCache,
    ));
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
  meta.textContent = `顯示前 ${Math.min(100, chosen.length)} / ${chosen.length} 條；依可實現日利排序`;
  options.target.append(meta);
  const scroll = element('div', 'strategy-table-scroll');
  const table = element('table', 'strategy-table');
  const columnGroup = element('colgroup');
  for (const key of [
    'pin', 'step', 'path', 'profit', 'trend1d', 'trend3d', 'trend7d', 'marketShare', 'capital', 'classification', 'priority',
  ]) {
    const column = element('col');
    column.dataset.strategyColumn = key;
    columnGroup.append(column);
  }
  const head = element('thead');
  const headerRow = element('tr');
  for (const label of ['自選', '步驟', '路徑', '日利', '1D', '3D', '7D', '日產佔比', '資金/D', '判定', '優先級']) {
    const cell = element('th');
    cell.textContent = label;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = element('tbody');
  for (const assessedCandidate of chosen.slice(0, 100)) {
    let assessedSignal = signalCache.get(assessedCandidate.candidate.id);
    if (!assessedSignal) {
      const series = buildStrategyMarginSeries({
        strategyId: assessedCandidate.candidate.id,
        snapshots,
        candidateAtSnapshot: (snapshot) => {
          let prices = priceBookCache.get(snapshot.timestamp);
          if (!prices) {
            prices = createStrategyPriceBook(snapshot, data);
            priceBookCache.set(snapshot.timestamp, prices);
          }
          return repriceFixedCandidate(assessedCandidate.candidate, prices);
        },
      });
      const backtest = backtestStrategySignals(series, {
        signalAt: (prefix) => strategyTrendSignal(prefix),
      });
      assessedSignal = {
        signal: strategyTrendSignal(series, { backtest: backtest.summary }),
        backtest,
      };
      signalCache.set(assessedCandidate.candidate.id, assessedSignal);
    }
    const mainRow = strategyRow(assessedCandidate, assessedSignal, pinned, options);
    const detail = detailRow(assessedCandidate.candidate, options);
    detail.hidden = true;
    // 點擊列展開/收合步驟面板
    mainRow.addEventListener('click', (event) => {
      // 不攔截按鈕、連結、details/summary 的點擊
      const target = event.target as HTMLElement;
      if (target.closest('button, a, summary')) return;
      detail.hidden = !detail.hidden;
      mainRow.classList.toggle('strategy-row-expanded', !detail.hidden);
    });
    mainRow.style.cursor = 'pointer';
    body.append(mainRow, detail);
  }
  table.append(columnGroup, head, body);
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
        renderResults(result, new Set(pins), options, snapshots, data);
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
