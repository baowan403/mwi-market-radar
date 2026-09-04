import type { MarketKey, Snapshot } from '../core/types';
import { formatCompactNumber } from '../core/format-number';
import type { PlayerProfile, SkillingAction } from '../profile/types';
import { backtestStrategySignals, type StrategyBacktestResult } from './backtest';
import { buildStrategyCandidates, type StrategyCandidate, type StrategyCandidateResult } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { buildStrategyMarginSeries, repriceFixedCandidate, type StrategyMarginPoint } from './margin-series';
import { generateSparklineSvg } from './sparkline';
import { createStrategyPriceBook } from './price-book';
import {
  assessStrategyDecision,
  type StrategyDecision,
  type StrategyDecisionMode,
} from './decision';
import { formatSemanticPath } from './semantic-path';
import { marketCapacity } from './liquidity';
import {
  evaluateRealizableStrategy,
  externalStrategyFlows,
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
  now?: () => number;
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

const ACTION_LABELS: Record<string, string> = {
  milking: '擠奶',
  foraging: '採摘',
  woodcutting: '伐木',
  cheesesmithing: '鍛造',
  crafting: '製作',
  tailoring: '裁縫',
  cooking: '烹飪',
  brewing: '沖泡',
  alchemy: '煉金',
  enhancing: '強化',
};

function stepCountLabel(candidate: StrategyCandidate): string {
  return `${candidate.steps.length}步`;
}

function stepDetailTooltip(candidate: StrategyCandidate): string {
  const actions = candidate.steps.map((s) => ACTION_LABELS[s.action] ?? s.action);
  return `${candidate.steps.length} 步流程：${actions.join(' → ')}`;
}

const CLASSIFICATION_LABELS: Record<LiquidityClassification, string> = {
  'long-run': '低',
  'small-test': '中',
  limited: '高',
  reject: '極高',
  insufficient: '極高',
};

const CLASSIFICATION_OBSERVE_ORDER: Record<LiquidityClassification, number> = {
  insufficient: 0,
  reject: 1,
  limited: 2,
  'small-test': 3,
  'long-run': 4,
};

const SIGNAL_LABELS: Record<StrategySignalAction, string> = {
  execute: '立即製造',
  prepare: '備料觀察',
  wait: '暫停觀望',
  sell: '賣出清倉',
  stop: '逐步出場',
};

const MOMENTUM_LABELS: Record<StrategyPriority, string> = {
  top: '🔥 最高',
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

export type StrategyFilterSkill = 'all' | 'alpha' | SkillingAction;

export const STRATEGY_SKILL_OPTIONS: Array<{ value: StrategyFilterSkill; label: string }> = [
  { value: 'all', label: '全部生活技能（9大技能）' },
  { value: 'alpha', label: '⚡ 突發短缺 / 暴利' },
  { value: 'milking', label: '擠奶' },
  { value: 'foraging', label: '採摘' },
  { value: 'woodcutting', label: '伐木' },
  { value: 'cheesesmithing', label: '鍛造' },
  { value: 'crafting', label: '製作' },
  { value: 'tailoring', label: '裁縫' },
  { value: 'cooking', label: '烹飪' },
  { value: 'brewing', label: '沖泡' },
  { value: 'alchemy', label: '煉金' },
  { value: 'enhancing', label: '強化（暫無獨立候選模型）' },
];

/** 常見簡繁字符映射，確保輸入簡體亦可精準搜尋繁體資料庫 */
const SIMPLIFIED_TO_TRADITIONAL_MAP: Record<string, string> = {
  '盗': '盜', '炼': '煉', '制': '製', '奶': '奶', '药': '藥', '铁': '鐵',
  '铜': '銅', '银': '銀', '金': '金', '木': '木', '棍': '棍', '剑': '劍',
  '枪': '槍', '弓': '弓', '甲': '甲', '丝': '絲', '线': '線', '布': '布',
  '矿': '礦', '石': '石', '宝': '寶', '晶': '晶', '碎': '碎', '片': '片',
};

function normalizeSearchText(text: string): string {
  let normalized = text.toLowerCase().trim();
  for (const [s, t] of Object.entries(SIMPLIFIED_TO_TRADITIONAL_MAP)) {
    normalized = normalized.replaceAll(s, t);
  }
  return normalized;
}

function candidateSearchText(candidate: StrategyCandidate, itemName: (hrid: string) => string): string {
  const parts = new Set<string>();
  parts.add(candidate.title);
  parts.add(candidate.id);
  for (const hrid of candidate.path) {
    parts.add(hrid);
    parts.add(itemName(hrid));
  }
  for (const step of candidate.steps) {
    parts.add(step.actionHrid);
    for (const flow of [...step.inputs, ...step.outputs]) {
      parts.add(flow.itemHrid);
      parts.add(itemName(flow.itemHrid));
    }
  }
  return normalizeSearchText([...parts].join(' '));
}

function matchesSearchQuery(candidate: StrategyCandidate, query: string, itemName: (hrid: string) => string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const target = candidateSearchText(candidate, itemName);
  return target.includes(normalizedQuery);
}

function matchesSkill(
  candidate: StrategyCandidate,
  selectedSkill: StrategyFilterSkill,
  signal?: StrategySignal,
): boolean {
  if (selectedSkill === 'all') return true;
  if (selectedSkill === 'alpha') return signal?.isAlphaOpportunity === true;
  return candidate.steps.some((step) => step.action === selectedSkill);
}

type StrategyScope = 'actionable' | 'limited';

interface AssessedStrategy {
  candidate: StrategyCandidate;
  liquidity: RealizableStrategy;
  decision: StrategyDecision;
}

interface AssessedSignal {
  signal: StrategySignal;
  backtest: StrategyBacktestResult;
  series: readonly StrategyMarginPoint[];
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
  data: NormalizedStrategyGameData,
  sortMode: 'safe' | 'theoretical' = 'safe',
): HTMLTableRowElement {
  const { candidate, liquidity } = assessed;
  const { signal } = assessedSignal;
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

  const stepCell = element('td', 'strategy-step');
  stepCell.textContent = stepCountLabel(candidate);
  stepCell.title = stepDetailTooltip(candidate);
  row.append(stepCell);

  const pathCell = element('td', 'strategy-path-cell');
  pathCell.textContent = formatSemanticPath(candidate, data, options.itemName);
  row.append(pathCell);

  const profitCell = element('td', 'strategy-profit');
  const mainProfit = element('div', 'strategy-profit-main');
  const hasRealizable = liquidity.realizableProfitPerDay !== null && Number.isFinite(liquidity.realizableProfitPerDay);

  if (sortMode === 'safe') {
    if (hasRealizable) {
      mainProfit.textContent = money(liquidity.realizableProfitPerDay!);
      profitCell.append(mainProfit);
      if (liquidity.realizableProfitPerDay! < candidate.profitPerDay * 0.98) {
        const subProfit = element('div', 'strategy-profit-sub');
        subProfit.textContent = `理論 ~${money(candidate.profitPerDay)}`;
        subProfit.title = `理論極值為 ${money(candidate.profitPerDay)}，已受市場容量限制折算`;
        profitCell.append(subProfit);
      }
    } else {
      mainProfit.textContent = '—';
      mainProfit.title = '市場成交量樣本不足，無法確認安全容量';
      profitCell.append(mainProfit);
      const subProfit = element('div', 'strategy-profit-sub');
      subProfit.textContent = `理論 ~${money(candidate.profitPerDay)}`;
      subProfit.title = '市場成交量樣本不足，未經安全容量折算';
      profitCell.append(subProfit);
    }
  } else {
    mainProfit.textContent = money(candidate.profitPerDay);
    profitCell.append(mainProfit);
    if (hasRealizable && liquidity.realizableProfitPerDay! < candidate.profitPerDay * 0.98) {
      const subProfit = element('div', 'strategy-profit-sub');
      subProfit.textContent = `安全 ~${money(liquidity.realizableProfitPerDay!)}`;
      subProfit.title = `依市場容量限制，每日安全折算為 ${money(liquidity.realizableProfitPerDay!)}`;
      profitCell.append(subProfit);
    }
  }
  row.append(profitCell);

  const trend1dCell = element('td', 'strategy-trend-cell');
  const delta1d = element('span');
  delta1d.className = deltaClass(signal.metrics.margin1dPct);
  delta1d.textContent = trendPct(signal.metrics.margin1dPct);
  trend1dCell.append(delta1d);
  row.append(trend1dCell);

  const trend3dCell = element('td', 'strategy-trend-cell');
  const delta3d = element('span');
  delta3d.className = deltaClass(signal.metrics.margin3dPct);
  delta3d.textContent = trendPct(signal.metrics.margin3dPct);
  trend3dCell.append(delta3d);
  row.append(trend3dCell);

  const trend7dCell = element('td', 'strategy-trend-cell');
  const delta7d = element('span');
  delta7d.className = deltaClass(signal.metrics.margin7dPct);
  delta7d.textContent = trendPct(signal.metrics.margin7dPct);
  trend7dCell.append(delta7d);
  row.append(trend7dCell);

  const sparkCell = element('td', 'strategy-sparkline-cell');
  sparkCell.innerHTML = generateSparklineSvg(assessedSignal.series, { width: 72, height: 20 });
  sparkCell.title = '過去 72 小時利潤走勢波形（綠漲紅跌）';
  row.append(sparkCell);

  const shareCell = element('td', 'strategy-market-share');
  if (liquidity.marketSharePct !== null && Number.isFinite(liquidity.marketSharePct)) {
    const pct = liquidity.marketSharePct;
    shareCell.textContent = `${pct.toFixed(1)}%`;
    if (pct <= 5) shareCell.classList.add('share-safe');
    else if (pct <= 10) shareCell.classList.add('share-warning');
    else if (pct <= 25) shareCell.classList.add('share-danger');
    else shareCell.classList.add('share-critical');
    shareCell.title = `做滿 24 小時產量占市場日成交量約 ${pct.toFixed(1)}%`;
  } else {
    shareCell.textContent = '—';
  }
  row.append(shareCell);

  const capital = element('td', 'strategy-capital');
  capital.textContent = money(candidate.workingCapital24h);
  row.append(capital);

  const classificationCell = element('td', 'strategy-classification-cell');
  const classification = element('span', 'strategy-classification');
  classification.dataset.classification = liquidity.classification;
  classification.textContent = CLASSIFICATION_LABELS[liquidity.classification];
  classification.title = liquidity.classification === 'insufficient'
    ? '缺少足夠的 3D／7D 成交量資料，不列為可執行策略'
    : liquidity.bottleneckHrid
      ? `瓶頸：${options.itemName(liquidity.bottleneckHrid)}（${liquidity.bottleneckSide === 'input' ? '買入' : '賣出'}端）`
      : '未發現外部市場瓶頸';
  classificationCell.append(classification);
  row.append(classificationCell);

  const priorityCell = element('td', 'strategy-priority-cell');
  const priorityBadge = element('span', 'strategy-priority-badge');
  priorityBadge.dataset.strategyPriority = signal.priority;
  priorityBadge.textContent = MOMENTUM_LABELS[signal.priority];
  priorityBadge.title = `${SIGNAL_LABELS[signal.action]}｜${signal.reasons.join('；')}`;
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
  assessed: AssessedStrategy,
  assessedSignal: AssessedSignal,
  options: StrategyViewOptions,
): HTMLTableRowElement {
  const { candidate, liquidity, decision } = assessed;
  const row = element('tr', 'strategy-detail-row');
  row.dataset.strategyDetailFor = candidate.id;
  const cell = element('td');
  cell.colSpan = 12;
  const content = element('div', 'strategy-detail-content');
  const heading = element('strong');
  heading.textContent = `決策與 ${candidate.steps.length} 步驟明細`;
  const decisionSummary = element('div', 'strategy-detail-summary');
  const bottleneck = liquidity.bottleneckHrid
    ? `${liquidity.bottleneckSide === 'input' ? '買入' : '賣出'}瓶頸 ${options.itemName(liquidity.bottleneckHrid)}`
    : '無外部市場瓶頸';
  const details = [
    `安全執行 ${metric(liquidity.safeHoursPerDay, '小時')}`,
    bottleneck,
    `所需啟動現金 ${money(decision.funding.cashRequired)}`,
    `訊號 ${SIGNAL_LABELS[assessedSignal.signal.action]}｜${MOMENTUM_LABELS[assessedSignal.signal.priority]}動能`,
  ];
  if (
    liquidity.realizableProfitPerDay !== null
    && Math.abs(liquidity.realizableProfitPerDay - candidate.profitPerDay) > 1000
  ) {
    details.unshift(`⚠️ 容量折算（原 ${money(candidate.profitPerDay)} ➔ 折算 ${metric(liquidity.realizableProfitPerDay)}）`);
  }
  for (const detail of details) {
    const item = element('span');
    item.textContent = detail;
    decisionSummary.append(item);
  }
  content.append(heading, decisionSummary);
  const rationale = element('p', 'strategy-detail-rationale');
  rationale.textContent = `動能診斷：${assessedSignal.signal.reasons.join('；')}。失效條件：${assessedSignal.signal.invalidation.join('；')}`;
  content.append(rationale);

  // 插入掛機排程與原料採購規劃卡片
  content.append(buildScheduleCard(assessed, options));

  // 底層物理工序明細抽屜（預設完全折疊收合，點擊才展開）
  const physicsDetails = element('details', 'strategy-raw-physics-details');
  const physicsSummary = element('summary', 'strategy-physics-toggle');
  physicsSummary.textContent = '▶ 點擊展開工序物理明細（單小時流量與掉落分佈）';
  physicsDetails.append(physicsSummary);

  const list = element('ol');
  for (const step of candidate.steps) {
    const item = element('li');
    item.append(stepAssumptions(step, options));
    list.append(item);
  }
  physicsDetails.append(list);
  content.append(physicsDetails);
  cell.append(content);
  row.append(cell);
  return row;
}

/** 構建「掛機排程與原料採購規劃」卡片 */
function buildScheduleCard(assessed: AssessedStrategy, options: StrategyViewOptions): HTMLElement {
  const card = element('div', 'strategy-schedule-card');
  const header = element('div', 'strategy-schedule-header');
  const title = element('span', 'strategy-schedule-title');
  title.textContent = '⏱️ 掛機排程與原料採購規劃';

  const nav = element('div', 'strategy-schedule-hours-nav');
  const hoursOptions = [8, 12, 24];
  let currentHours = 24;

  const grid = element('div', 'strategy-procurement-grid');
  const scheduleCol = element('div', 'strategy-procurement-col');
  const scheduleTitle = element('div', 'strategy-procurement-subtitle');
  scheduleTitle.textContent = '工序時間分配';
  const scheduleList = element('ul', 'strategy-procurement-list');
  scheduleCol.append(scheduleTitle, scheduleList);

  const procurementCol = element('div', 'strategy-procurement-col');
  const procurementTitle = element('div', 'strategy-procurement-subtitle');
  procurementTitle.textContent = '外部原料採購需求與效益';
  const procurementList = element('ul', 'strategy-procurement-list');
  procurementCol.append(procurementTitle, procurementList);

  grid.append(scheduleCol, procurementCol);

  const update = (hours: number) => {
    currentHours = hours;
    for (const btn of nav.querySelectorAll<HTMLButtonElement>('.strategy-hours-pill')) {
      const h = Number(btn.dataset.hours);
      btn.setAttribute('aria-pressed', h === currentHours ? 'true' : 'false');
    }

    // 1. 工序時間清單
    scheduleList.innerHTML = '';
    assessed.candidate.steps.forEach((step, idx) => {
      const item = element('li');
      const fraction = (step as { workFraction?: number }).workFraction ?? (1 / assessed.candidate.steps.length);
      const stepHours = currentHours * fraction;
      const hoursText = stepHours >= 1 ? `${stepHours.toFixed(1)} 小時` : `${Math.round(stepHours * 60)} 分鐘`;
      const actionName = ACTION_LABELS[step.action] ?? step.action;
      item.innerHTML = `<strong>步驟 ${idx + 1}：${actionName}（${options.itemName(step.outputHrid)}）</strong> ── 耗時約 ${hoursText}（佔比 ${(fraction * 100).toFixed(1)}%）`;
      scheduleList.append(item);
    });

    // 2. 原料採購清單
    procurementList.innerHTML = '';
    const teaHrids = [...new Set(assessed.candidate.steps.flatMap((s) => s.inputs.filter((f) => f.itemHrid.includes('tea')).map((f) => f.itemHrid)))];
    if (teaHrids.length > 0) {
      const teaItem = element('li');
      teaItem.style.marginBottom = '6px';
      teaItem.style.paddingBottom = '6px';
      teaItem.style.borderBottom = '1px dashed var(--color-line)';
      teaItem.innerHTML = `🍵 <strong>建議飲用茶飲</strong>：${teaHrids.map((h) => options.itemName(h)).join('、')}`;
      procurementList.append(teaItem);
    }

    const inputTotals = new Map<string, { units: number; price: number | null }>();
    for (const { side, flow } of externalStrategyFlows(assessed.candidate)) {
      if (side !== 'input' || !flow.market || flow.unitPrice === null || flow.unitsPerHour <= 0) continue;
      const current = inputTotals.get(flow.itemHrid) ?? { units: 0, price: flow.unitPrice };
      current.units += flow.unitsPerHour * currentHours;
      inputTotals.set(flow.itemHrid, current);
    }

    if (inputTotals.size === 0) {
      const noneItem = element('li');
      noneItem.textContent = '此策略無需從市場採購原料（自給自足或單純採集）';
      procurementList.append(noneItem);
    } else {
      for (const [hrid, { units, price }] of inputTotals) {
        const item = element('li');
        const costStr = price !== null ? ` ｜ 預估花費 ${money(units * price)}` : '';
        item.innerHTML = `採購 <strong>${options.itemName(hrid)}</strong>：${quantity(units)} 件${costStr}`;
        procurementList.append(item);
      }
    }

    // 效益小結
    const summaryItem = element('li');
    summaryItem.style.marginTop = '4px';
    summaryItem.style.paddingTop = '4px';
    summaryItem.style.borderTop = '1px dashed var(--color-line)';
    const estProfit = (assessed.liquidity.realizableProfitPerDay ?? assessed.candidate.profitPerDay) * (currentHours / 24);
    summaryItem.innerHTML = `預計 <strong>${currentHours} 小時</strong> 實質獲利：<strong style="color: #34d399;">~${metric(estProfit)}</strong>`;
    procurementList.append(summaryItem);
  };

  for (const h of hoursOptions) {
    const btn = element('button', 'strategy-hours-pill');
    btn.type = 'button';
    btn.dataset.hours = String(h);
    btn.textContent = `${h} 小時`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      update(h);
    });
    nav.append(btn);
  }

  header.append(title, nav);
  card.append(header, grid);

  update(currentHours);
  return card;
}

function flowAssumption(
  flow: StrategyFlow,
  side: '投入' | '產出',
  options: StrategyViewOptions,
): string {
  const isTea = flow.itemHrid.endsWith('_tea');
  const tag = isTea ? ' (理論最佳茶)' : '';
  const price = flow.unitPrice === null ? '內部流轉' : `單價 ${money(flow.unitPrice)}`;
  return `${side} ${options.itemName(flow.itemHrid)}${tag} ${quantity(flow.unitsPerHour)}/h・${price}`;
}

function stepAssumptions(step: StrategyStepResult, options: StrategyViewOptions): HTMLElement {
  const wrapper = element('div', 'strategy-step-item');
  const headline = element('p', 'strategy-step-title');
  const actionName = ACTION_LABELS[step.action] ?? step.action;
  headline.textContent = `${actionName}: ${options.itemName(step.outputHrid)}・${quantity(step.actionsPerHour)} 次/h`;
  const economics = element('p', 'strategy-step-metrics');
  economics.textContent = `成本 ${metric(step.costPerHour, '/h')}・收入 ${metric(step.incomePerHour, '/h')}・利潤 ${metric(step.profitPerHour, '/h')}`;
  const flows = element('ul', 'strategy-step-flows');
  for (const flow of step.inputs) {
    const item = element('li');
    item.textContent = flowAssumption(flow, '投入', options);
    flows.append(item);
  }
  for (const flow of step.outputs) {
    const item = element('li');
    item.textContent = flowAssumption(flow, '產出', options);
    flows.append(item);
  }
  wrapper.append(headline, economics, flows);
  return wrapper;
}

interface StrategyFilterContext {
  selectedSkill: StrategyFilterSkill;
  searchQuery: string;
  sortMode?: 'safe' | 'theoretical';
}

function renderResults(
  result: StrategyCandidateResult,
  pinned: Set<string>,
  options: StrategyViewOptions,
  snapshots: readonly Snapshot[],
  data: NormalizedStrategyGameData,
  profile: PlayerProfile,
  latestSnapshotAgeMs: number,
  initialFilter: StrategyFilterContext = {
    selectedSkill: 'all', searchQuery: '', sortMode: 'safe',
  },
  signalCache = new Map<string, AssessedSignal>(),
  priceBookCache = new Map<number, ReturnType<typeof createStrategyPriceBook>>(),
): void {
  options.target.replaceChildren();

  const header = element('header', 'strategy-header');
  const heading = element('h2');
  heading.textContent = '策略推薦';
  const warning = element('p', 'strategy-warning');
  warning.textContent = latestSnapshotAgeMs > 180 * 60_000
    ? '市場快照已超過 180 分鐘：資料嚴重過期，請留意價格變動。'
    : '主排名採 3D／7D 成交量容量折算收益；買料用賣一、出售用買一並扣 5% 稅，點金免稅。Exporter v1 不含材料數量，因此目前不以裝備 inventoryMap 抵扣原料成本。';
  header.append(heading, warning);

  // ── 機制完整度門禁 (Mechanics Completeness Gate) ──
  if (profile.mechanicsCompleteness === 'incomplete') {
    const gateAlert = element('div', 'strategy-gate-alert');
    gateAlert.dataset.strategyGate = 'incomplete';
    gateAlert.style.padding = '12px 16px';
    gateAlert.style.marginTop = '12px';
    gateAlert.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
    gateAlert.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    gateAlert.style.borderRadius = '6px';
    gateAlert.innerHTML = '<strong>⛔ 角色快照資料不完整（安全門禁已啟動）</strong>：檢測到神龕等級或社群 Buff 等基礎機制缺失，推薦策略已被暫停呈現，以防計算失真。請點擊上方<strong>「角色快照」</strong>完成資料設定。';
    header.append(gateAlert);
    options.target.append(header);
    return;
  }

  if (profile.mechanicsCompleteness === 'estimated') {
    const estBanner = element('div', 'strategy-gate-info');
    estBanner.dataset.strategyGate = 'estimated';
    estBanner.style.padding = '8px 12px';
    estBanner.style.marginTop = '12px';
    estBanner.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
    estBanner.style.border = '1px solid rgba(59, 130, 246, 0.3)';
    estBanner.style.borderRadius = '6px';
    estBanner.innerHTML = '<strong>ℹ️ 估算模式（Estimated）</strong>：目前配裝或茶飲包含理論自動推論，日利為理論極值/容量折算估算值。';
    header.append(estBanner);
  }

  options.target.append(header);

  const filterState: StrategyFilterContext = { ...initialFilter };

  // ── 工具列：模式切換 + 技能 + 物品搜尋 ──
  const toolbar = element('section', 'strategy-toolbar toolbar');

  const modeGroup = element('div', 'strategy-mode-group filter-control');
  const steadyBtn = element('button', 'toolbar-button');
  steadyBtn.type = 'button';
  steadyBtn.textContent = '🔥 常規日利';
  steadyBtn.dataset.strategyTab = 'steady';
  if (filterState.selectedSkill !== 'alpha') steadyBtn.classList.add('active');

  const alphaBtn = element('button', 'toolbar-button');
  alphaBtn.type = 'button';
  alphaBtn.textContent = '⚡ 突發短缺 / 暴利';
  alphaBtn.dataset.strategyTab = 'alpha';
  if (filterState.selectedSkill === 'alpha') alphaBtn.classList.add('active');

  modeGroup.append(steadyBtn, alphaBtn);

  const sortGroup = element('div', 'strategy-sort-group filter-control');
  const sortSafeBtn = element('button', 'toolbar-button');
  sortSafeBtn.type = 'button';
  sortSafeBtn.textContent = '🛡️ 安全日利';
  sortSafeBtn.title = '依市場容量折算後之安全日利排序（防止過量滯銷）';
  if ((filterState.sortMode ?? 'safe') === 'safe') sortSafeBtn.classList.add('active');

  const sortTheoBtn = element('button', 'toolbar-button');
  sortTheoBtn.type = 'button';
  sortTheoBtn.textContent = '⚡ 理論極值';
  sortTheoBtn.title = '依未折算理論最高日利排序（對標 Milkonomy，假定無限買盤）';
  if (filterState.sortMode === 'theoretical') sortTheoBtn.classList.add('active');

  sortSafeBtn.addEventListener('click', () => {
    if (filterState.sortMode !== 'safe') {
      filterState.sortMode = 'safe';
      sortSafeBtn.classList.add('active');
      sortTheoBtn.classList.remove('active');
      updateResults();
    }
  });

  sortTheoBtn.addEventListener('click', () => {
    if (filterState.sortMode !== 'theoretical') {
      filterState.sortMode = 'theoretical';
      sortTheoBtn.classList.add('active');
      sortSafeBtn.classList.remove('active');
      updateResults();
    }
  });

  sortGroup.append(sortSafeBtn, sortTheoBtn);

  const skillGroup = element('div', 'strategy-filter-group filter-control');
  const skillLabel = element('label', 'strategy-label');
  skillLabel.htmlFor = 'strategy-skill-select';
  skillLabel.textContent = '技能：';
  const skillSelect = element('select', 'strategy-select');
  skillSelect.id = 'strategy-skill-select';
  skillSelect.dataset.strategySkill = 'true';
  for (const { value, label } of STRATEGY_SKILL_OPTIONS) {
    const opt = element('option');
    opt.value = value;
    opt.textContent = label;
    if (value === filterState.selectedSkill) opt.selected = true;
    skillSelect.append(opt);
  }
  skillGroup.append(skillLabel, skillSelect);

  const searchGroup = element('div', 'strategy-search-group search-field');
  const searchInput = element('input', 'strategy-search-input');
  searchInput.type = 'search';
  searchInput.id = 'strategy-search-input';
  searchInput.dataset.strategySearch = 'true';
  searchInput.placeholder = '搜尋物品（如：海盜精煉碎片、哥布林火棍）…';
  searchInput.value = filterState.searchQuery;
  searchGroup.append(searchInput);

  toolbar.append(modeGroup, sortGroup, skillGroup, searchGroup);
  options.target.append(toolbar);

  const resultsContainer = element('div', 'strategy-results-container');
  options.target.append(resultsContainer);

  const baseAssessed = result.candidates
    .filter((candidate) => candidate.profitPerDay > 0)
    .map((candidate) => ({ candidate, liquidity: evaluateRealizableStrategy(candidate, snapshots) }));

  function getAssessedSignal(item: AssessedStrategy): AssessedSignal {
    let assessedSignal = signalCache.get(item.candidate.id);
    if (!assessedSignal) {
      const series = buildStrategyMarginSeries({
        strategyId: item.candidate.id,
        snapshots,
        candidateAtSnapshot: (snapshot) => {
          let prices = priceBookCache.get(snapshot.timestamp);
          if (!prices) {
            prices = createStrategyPriceBook(snapshot, data);
            priceBookCache.set(snapshot.timestamp, prices);
          }
          return repriceFixedCandidate(item.candidate, prices);
        },
      });
      const backtest = backtestStrategySignals(series, {
        signalAt: (prefix) => strategyTrendSignal(prefix),
      });
      assessedSignal = {
        signal: strategyTrendSignal(series, {
          backtest: backtest.summary,
          classification: item.liquidity.classification,
          latestSnapshotAgeMs,
        }),
        backtest,
        series,
      };
      signalCache.set(item.candidate.id, assessedSignal);
    }
    return assessedSignal;
  }

  function effectiveProfit(item: AssessedStrategy): number {
    if (filterState.sortMode === 'theoretical') {
      return item.candidate.profitPerDay;
    }
    // 安全日利模式：嚴格依可實現日利（realizableProfitPerDay）排序
    // 若為 null（資料不足/未經驗證），安全排序價值為 0，不可用未折算的理論日利充數！
    return item.liquidity.realizableProfitPerDay ?? 0;
  }

  function priorityWeight(priority: StrategyPriority): number {
    switch (priority) {
      case 'top': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  function riskRank(classification: LiquidityClassification): number {
    switch (classification) {
      case 'long-run': return 1;   // 低風險
      case 'small-test': return 2; // 中風險
      case 'limited': return 3;    // 高風險
      case 'reject': return 4;     // 極高風險
      case 'insufficient': return 5; // 資料不足
      default: return 99;
    }
  }

  function syncModeButtons(): void {
    if (filterState.selectedSkill === 'alpha') {
      alphaBtn.classList.add('active');
      steadyBtn.classList.remove('active');
    } else {
      steadyBtn.classList.add('active');
      alphaBtn.classList.remove('active');
    }
  }

  steadyBtn.addEventListener('click', () => {
    if (filterState.selectedSkill === 'alpha') {
      filterState.selectedSkill = 'all';
      skillSelect.value = 'all';
      syncModeButtons();
      updateResults();
    }
  });

  alphaBtn.addEventListener('click', () => {
    if (filterState.selectedSkill !== 'alpha') {
      filterState.selectedSkill = 'alpha';
      skillSelect.value = 'alpha';
      syncModeButtons();
      updateResults();
    }
  });

  function updateResults(): void {
    syncModeButtons();
    resultsContainer.replaceChildren();
    const isSearchActive = filterState.searchQuery.trim().length > 0;
    const assessed: AssessedStrategy[] = baseAssessed.map(({ candidate, liquidity }) => ({
      candidate,
      liquidity,
      decision: assessStrategyDecision({
        candidate,
        liquidity,
        profile,
        plannedHours: 24,
        mode: 'steady',
        latestSnapshotAgeMs,
      }),
    }));

    // ── 效能核心優化：未選擇 alpha 時，完全不對幾千個候選提前計算信號 ──
    let matched: AssessedStrategy[];
    if (filterState.selectedSkill === 'alpha') {
      const candidatesToScan = assessed.filter((item) => (
        isSearchActive
          ? matchesSearchQuery(item.candidate, filterState.searchQuery, options.itemName)
          : item.decision.actionable
      ));
      matched = candidatesToScan.filter((item) => {
        const s = getAssessedSignal(item);
        return s.signal.isAlphaOpportunity === true;
      });
      matched.sort((left, right) => {
        const leftScore = getAssessedSignal(left).signal.alphaScore ?? 0;
        const rightScore = getAssessedSignal(right).signal.alphaScore ?? 0;
        const scoreDiff = rightScore - leftScore;
        if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
        return effectiveProfit(right) - effectiveProfit(left);
      });
    } else {
      matched = assessed.filter(({ candidate, liquidity }) => {
        if (!matchesSkill(candidate, filterState.selectedSkill)) return false;
        if (isSearchActive) {
          return matchesSearchQuery(candidate, filterState.searchQuery, options.itemName);
        }
        // 理論日利 <= 0 者不顯示
        if (candidate.profitPerDay <= 0) return false;

        // 理論極值模式：放行所有正收益策略
        if (filterState.sortMode === 'theoretical') return true;

        // 常態模式：排除異常情形
        // 1. reject: 成交量個位數之冷門裝備（如翠綠護手）、價格異常插針
        if (liquidity.classification === 'reject') return false;

        // 2. 市場只有掛買沒有掛賣或相反（單邊無掛單，原料買不到或產品賣不掉）
        const flows = externalStrategyFlows(candidate);
        const hasMissingSide = flows.some((external) => {
          const cap = marketCapacity(`${external.flow.itemHrid}::${external.flow.enhancementLevel}` as MarketKey, snapshots);
          return external.side === 'input' ? !cap.askAvailable : !cap.bidAvailable;
        });
        if (hasMissingSide) return false;

        // 正常的原物料、大宗商品，即使吞吐佔比 > 5% 或歷史樣本未滿 72h，均正常顯示，
        // 由日產佔比顏色示警（黃/橘/紅）與優先級降評，絕不無故隱藏。
        return true;
      });

      // 常態排序：優先依折算後日利排序，99.9% 的情況下無需調用昂貴的信號回測！
      matched.sort((left, right) => {
        const profitDiff = effectiveProfit(right) - effectiveProfit(left);
        if (Math.abs(profitDiff) > 1e-6) return profitDiff;

        const leftSignal = getAssessedSignal(left);
        const rightSignal = getAssessedSignal(right);
        const priorityDiff = priorityWeight(rightSignal.signal.priority) - priorityWeight(leftSignal.signal.priority);
        if (priorityDiff !== 0) return priorityDiff;

        const riskDiff = riskRank(left.liquidity.classification) - riskRank(right.liquidity.classification);
        if (riskDiff !== 0) return riskDiff;

        return left.candidate.id.localeCompare(right.candidate.id);
      });
    }

    // 筆數限制：取前 50 筆最高折算日利
    const chosen = matched.slice(0, 50);

    if (!isSearchActive && chosen.length > 0) {
      const summary = element('section', 'strategy-decision-summary');
      summary.dataset.strategyDecisionSummary = 'true';
      const best = chosen[0]!;

      const leftContainer = element('div', 'strategy-decision-summary-left');
      const label = element('strong');
      label.textContent = filterState.selectedSkill === 'alpha'
        ? '⚡ 短缺套利首選'
        : (filterState.sortMode === 'theoretical' ? '⚡ 目前理論極值最佳' : '🛡️ 目前安全推薦最佳');
      const value = element('span', 'strategy-decision-summary-title');
      const bestPathName = formatSemanticPath(best.candidate, data, options.itemName);
      value.textContent = `${bestPathName}・預估日利 ${metric(effectiveProfit(best))}`;
      leftContainer.append(label, value);

      const note = element('span', 'strategy-decision-summary-note');
      note.textContent = filterState.selectedSkill === 'alpha'
        ? '依突發利潤爆發動能與 Alpha 評分排序，已嚴格過濾幽靈插針'
        : (filterState.sortMode === 'theoretical'
          ? '依理論最大日利（無窮大市場消化量）極值排序，對標 Milkonomy'
          : '依市場容量折算後安全日利、優先級與風險綜合排序');

      const radarBadge = element('span', 'strategy-radar-badge');
      if (filterState.selectedSkill === 'alpha') {
        radarBadge.textContent = '⚡ 模式：突發短缺暴利雷達（已剔除幽靈插針）';
      } else {
        radarBadge.textContent = '⚡ 短缺雷達：全市場供需平穩（無異常暴利）';
      }

      summary.append(leftContainer, note, radarBadge);
      resultsContainer.append(summary);
    }

    if (baseAssessed.length === 0) {
      const empty = element('p', 'strategy-no-result');
      empty.textContent = '目前價格下沒有資料完整且理論收益為正的策略。';
      resultsContainer.append(empty);
      return;
    }

    if (chosen.length === 0) {
      const empty = element('p', 'strategy-no-result');
      if (isSearchActive) {
        empty.textContent = `找不到與「${filterState.searchQuery.trim()}」相關的策略。`;
      } else if (filterState.selectedSkill === 'alpha') {
        empty.textContent = '目前全市場暫無突發短缺或異常利差暴利機會（各品類供需平穩健康）。';
      } else if (filterState.selectedSkill !== 'all') {
        const skillName = STRATEGY_SKILL_OPTIONS.find((s) => s.value === filterState.selectedSkill)?.label ?? '';
        empty.textContent = `在「${skillName}」技能下沒有符合條件的策略。`;
      } else {
        empty.textContent = '目前沒有符合條件的正收益策略。';
      }
      resultsContainer.append(empty);
      return;
    }

    const meta = element('p', 'strategy-meta');
    if (isSearchActive) {
      meta.textContent = `搜尋「${filterState.searchQuery.trim()}」：顯示前 ${chosen.length} 條（依折算後日利排序）`;
    } else if (filterState.selectedSkill === 'alpha') {
      meta.textContent = `⚡ 突發短缺／暴利專區：顯示前 ${chosen.length} 條；依短期動能（AlphaScore）排序，已剔除幽靈插針`;
    } else if (filterState.selectedSkill !== 'all') {
      const skillName = STRATEGY_SKILL_OPTIONS.find((s) => s.value === filterState.selectedSkill)?.label ?? '';
      meta.textContent = `技能「${skillName}」：顯示前 ${chosen.length} 條；依折算後日利、優先級與風險排序`;
    } else {
      meta.textContent = `顯示前 ${chosen.length} 條；依折算後日利、優先級與風險綜合排序，★ 不影響名次`;
    }
    resultsContainer.append(meta);
    const scroll = element('div', 'strategy-table-scroll');
    const table = element('table', 'strategy-table');
    const columnGroup = element('colgroup');
    for (const key of [
      'pin', 'step', 'path', 'profit', 'trend1d', 'trend3d', 'trend7d',
      'sparkline', 'marketShare', 'capital', 'classification', 'priority',
    ]) {
      const column = element('col');
      column.dataset.strategyColumn = key;
      columnGroup.append(column);
    }
    const head = element('thead');
    const headerRow = element('tr');
    for (const label of [
      '自選', '步驟', '路徑', '日利', '1D', '3D', '7D', '72H走勢',
      '日產佔比', '資金/D', '風險', '優先級',
    ]) {
      const cell = element('th');
      cell.textContent = label;
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = element('tbody');
    for (const assessedCandidate of chosen) {
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
          signal: strategyTrendSignal(series, {
            backtest: backtest.summary,
            classification: assessedCandidate.liquidity.classification,
            latestSnapshotAgeMs,
          }),
          backtest,
          series,
        };
        signalCache.set(assessedCandidate.candidate.id, assessedSignal);
      }
      const mainRow = strategyRow(assessedCandidate, assessedSignal, pinned, options, data, filterState.sortMode);
      const detail = detailRow(assessedCandidate, assessedSignal, options);
      detail.hidden = true;
      mainRow.addEventListener('click', (event) => {
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
    resultsContainer.append(scroll);
  }

  skillSelect.addEventListener('change', () => {
    filterState.selectedSkill = skillSelect.value as 'all' | SkillingAction;
    updateResults();
  });

  searchInput.addEventListener('input', () => {
    filterState.searchQuery = searchInput.value;
    updateResults();
  });

  updateResults();
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
        const now = options.now?.() ?? Date.now();
        renderResults(result, new Set(pins), options, snapshots, data, profile, Math.max(0, now - snapshot.timestamp));
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
