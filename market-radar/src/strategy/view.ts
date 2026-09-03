import type { Snapshot } from '../core/types';
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

export const STRATEGY_SKILL_OPTIONS: Array<{ value: 'all' | SkillingAction; label: string }> = [
  { value: 'all', label: '全部技能' },
  { value: 'milking', label: '擠奶' },
  { value: 'foraging', label: '採摘' },
  { value: 'woodcutting', label: '伐木' },
  { value: 'cheesesmithing', label: '鍛造' },
  { value: 'crafting', label: '製作' },
  { value: 'tailoring', label: '裁縫' },
  { value: 'cooking', label: '烹飪' },
  { value: 'brewing', label: '沖泡' },
  { value: 'alchemy', label: '煉金' },
  { value: 'enhancing', label: '強化' },
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

function matchesSkill(candidate: StrategyCandidate, selectedSkill: 'all' | SkillingAction): boolean {
  if (selectedSkill === 'all') return true;
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
  pathCell.textContent = candidate.path.map(options.itemName).join(' → ');
  row.append(pathCell);

  const profitCell = element('td', 'strategy-profit');
  const mainProfit = element('div', 'strategy-profit-main');
  mainProfit.textContent = money(candidate.profitPerDay);
  profitCell.append(mainProfit);
  if (
    liquidity.realizableProfitPerDay !== null
    && Number.isFinite(liquidity.realizableProfitPerDay)
    && liquidity.realizableProfitPerDay < candidate.profitPerDay * 0.98
  ) {
    const subProfit = element('div', 'strategy-profit-sub');
    subProfit.textContent = `折算 ~${money(liquidity.realizableProfitPerDay)}`;
    subProfit.title = `市場容量限制：每日安全折算為 ${money(liquidity.realizableProfitPerDay)}`;
    profitCell.append(subProfit);
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
    `理論日利 ${money(candidate.profitPerDay)}`,
    `容量折算日利 ${metric(liquidity.realizableProfitPerDay)}`,
    `安全執行 ${metric(liquidity.safeHoursPerDay, '小時')}`,
    `建議本批 ${metric(decision.recommendedBatchUnits, '件')}`,
    bottleneck,
    `${quantity(decision.executionHours)}h 本批利潤 ${metric(decision.batchProfit)}`,
    `本批現金 ${money(decision.funding.cashRequired)}`,
    `24h 流動資金 ${money(candidate.workingCapital24h)}`,
    decision.funding.inventoryReplacementValue > 0
      ? `材料庫存按買入替代價抵現金 ${money(decision.funding.inventoryReplacementValue)}`
      : '材料庫存數量未提供，未抵扣現金',
    `經濟投入 ${money(decision.funding.grossInputValue)}`,
    `售罄估計 ${metric(liquidity.sellThroughDays, '天')}`,
    `回測 3D ${assessedSignal.backtest.byHorizon['3d'].samples} 筆／7D ${assessedSignal.backtest.byHorizon['7d'].samples} 筆`,
    `訊號 ${SIGNAL_LABELS[assessedSignal.signal.action]}／信心 ${CONFIDENCE_LABELS[assessedSignal.signal.confidence]}`,
  ];
  for (const detail of details) {
    const item = element('span');
    item.textContent = detail;
    decisionSummary.append(item);
  }
  content.append(heading, decisionSummary);
  const rationale = element('p', 'strategy-detail-rationale');
  rationale.textContent = `原因：${assessedSignal.signal.reasons.join('；')}。失效：${assessedSignal.signal.invalidation.join('；')}`;
  content.append(rationale);
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
  selectedSkill: 'all' | SkillingAction;
  searchQuery: string;
  scope: StrategyScope;
  mode: StrategyDecisionMode;
  plannedHours: number;
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
    selectedSkill: 'all', searchQuery: '', scope: 'actionable', mode: 'steady', plannedHours: 8,
  },
  signalCache = new Map<string, AssessedSignal>(),
  priceBookCache = new Map<number, ReturnType<typeof createStrategyPriceBook>>(),
): void {
  options.target.replaceChildren();

  const header = element('header', 'strategy-header');
  const heading = element('h2');
  heading.textContent = '策略推薦';
  const warning = element('p', 'strategy-warning');
  warning.textContent = latestSnapshotAgeMs > 60 * 60_000
    ? '市場快照已超過 60 分鐘：停止產生可執行建議，等待新資料。'
    : '主排名採 3D／7D 成交量容量折算收益；買料用賣一、出售用買一並扣 5% 稅，點金免稅。Exporter v1 不含材料數量，因此目前不以裝備 inventoryMap 抵扣原料成本。';
  header.append(heading, warning);
  options.target.append(header);

  const filterState: StrategyFilterContext = { ...initialFilter };

  // ── 工具列：決策模式 + 執行時段 + 技能 + 物品搜尋 ──
  const toolbar = element('section', 'strategy-toolbar toolbar');

  const modeGroup = element('div', 'strategy-mode-group');
  for (const [value, label] of [['steady', '穩健'], ['short', '短線']] as const) {
    const button = element('button', 'strategy-mode-button');
    button.type = 'button';
    button.dataset.strategyMode = value;
    button.setAttribute('aria-pressed', String(filterState.mode === value));
    button.textContent = label;
    modeGroup.append(button);
  }

  const hoursGroup = element('div', 'strategy-filter-group filter-control');
  const hoursLabel = element('label', 'strategy-label');
  hoursLabel.htmlFor = 'strategy-hours-select';
  hoursLabel.textContent = '預計執行：';
  const hoursSelect = element('select', 'strategy-select');
  hoursSelect.id = 'strategy-hours-select';
  hoursSelect.dataset.strategyHours = 'true';
  for (const hours of [1, 4, 8, 24]) {
    const opt = element('option');
    opt.value = String(hours);
    opt.textContent = `${hours} 小時`;
    opt.selected = hours === filterState.plannedHours;
    hoursSelect.append(opt);
  }
  hoursGroup.append(hoursLabel, hoursSelect);

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

  toolbar.append(modeGroup, hoursGroup, skillGroup, searchGroup);
  options.target.append(toolbar);

  const resultsContainer = element('div', 'strategy-results-container');
  options.target.append(resultsContainer);

  const baseAssessed = result.candidates
    .filter((candidate) => candidate.profitPerDay > 0)
    .map((candidate) => ({ candidate, liquidity: evaluateRealizableStrategy(candidate, snapshots) }));

  function updateResults(): void {
    resultsContainer.replaceChildren();
    const isSearchActive = filterState.searchQuery.trim().length > 0;
    const assessed: AssessedStrategy[] = baseAssessed.map(({ candidate, liquidity }) => ({
      candidate,
      liquidity,
      decision: assessStrategyDecision({
        candidate,
        liquidity,
        profile,
        plannedHours: filterState.plannedHours,
        mode: filterState.mode,
        latestSnapshotAgeMs,
      }),
    }));

    // 計算各 scope 總數以維持 scopeNav 徽章正確
    const skillFilteredAssessed = assessed.filter(({ candidate }) => (
      matchesSkill(candidate, filterState.selectedSkill)
    ));
    const actionableCount = skillFilteredAssessed.filter(({ decision }) => decision.actionable).length;
    const limitedCount = skillFilteredAssessed.length - actionableCount;

    // 篩選
    const matched = assessed.filter(({ candidate, decision }) => {
      if (!matchesSkill(candidate, filterState.selectedSkill)) return false;

      if (isSearchActive) {
        // 主動搜尋物品時：破例包含資料不足或不建議項目
        return matchesSearchQuery(candidate, filterState.searchQuery, options.itemName);
      }

      // 未搜尋物品時（一般瀏覽或技能分類）：
      if (filterState.scope === 'actionable') {
        return decision.actionable;
      }
      return !decision.actionable;
    });

    // 釘選只代表監控，不改變客觀名次。
    matched.sort((left, right) => {
      if (!isSearchActive && filterState.scope === 'limited' && left.liquidity.classification !== right.liquidity.classification) {
        return CLASSIFICATION_OBSERVE_ORDER[left.liquidity.classification]
          - CLASSIFICATION_OBSERVE_ORDER[right.liquidity.classification];
      }
      const leftProfit = left.decision.rankValue ?? left.liquidity.realizableProfitPerDay ?? Number.NEGATIVE_INFINITY;
      const rightProfit = right.decision.rankValue ?? right.liquidity.realizableProfitPerDay ?? Number.NEGATIVE_INFINITY;
      return rightProfit - leftProfit || left.candidate.id.localeCompare(right.candidate.id);
    });

    // 筆數限制：一般模式取前 50 筆最高日利
    const chosen = matched.slice(0, 50);

    if (!isSearchActive && filterState.scope === 'actionable' && chosen.length > 0) {
      const summary = element('section', 'strategy-decision-summary');
      summary.dataset.strategyDecisionSummary = 'true';
      const best = chosen[0]!;
      const label = element('strong');
      label.textContent = filterState.mode === 'steady' ? '目前穩健最佳' : '目前短線最佳';
      const value = element('span');
      value.textContent = `${best.candidate.title}・${quantity(best.decision.executionHours)}h 預估 ${metric(best.decision.batchProfit)}`;
      const note = element('span');
      note.textContent = filterState.mode === 'steady'
        ? `僅排名可覆蓋 ${filterState.plannedHours} 小時者`
        : `依 ${filterState.plannedHours} 小時內安全批次總利潤排名`;
      summary.append(label, value, note);
      resultsContainer.append(summary);
    }

    // 未搜尋時渲染 scope 分類切換鈕
    if (!isSearchActive) {
      const scopeNav = element('nav', 'strategy-scopes');
      scopeNav.setAttribute('aria-label', '策略承接分類');
      for (const [key, label, count] of [
        ['actionable', '可執行', actionableCount],
        ['limited', '觀察／排除', limitedCount],
      ] as const) {
        const button = element('button', 'strategy-scope-button');
        button.type = 'button';
        button.dataset.strategyScope = key;
        button.setAttribute('aria-pressed', String(filterState.scope === key));
        button.textContent = `${label} ${count}`;
        button.addEventListener('click', () => {
          filterState.scope = key;
          updateResults();
        });
        scopeNav.append(button);
      }
      resultsContainer.append(scopeNav);
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
      } else if (filterState.selectedSkill !== 'all') {
        const skillName = STRATEGY_SKILL_OPTIONS.find((s) => s.value === filterState.selectedSkill)?.label ?? '';
        empty.textContent = `在「${skillName}」技能下沒有符合條件的策略。`;
      } else {
        empty.textContent = filterState.scope === 'actionable'
          ? '目前沒有通過成交量承接門檻的正收益策略；請查看「觀察／排除」了解資料不足或不建議的原因。'
          : '目前沒有資料不足或超過安全市占的策略。';
      }
      resultsContainer.append(empty);
      return;
    }

    const meta = element('p', 'strategy-meta');
    if (isSearchActive) {
      meta.textContent = `搜尋「${filterState.searchQuery.trim()}」：顯示前 ${chosen.length} 條（依日利排序，含特例查詢項目）`;
    } else if (filterState.selectedSkill !== 'all') {
      const skillName = STRATEGY_SKILL_OPTIONS.find((s) => s.value === filterState.selectedSkill)?.label ?? '';
      meta.textContent = `技能「${skillName}」：顯示前 ${chosen.length} 條；依本次可實現總利潤排序`;
    } else {
      meta.textContent = filterState.scope === 'actionable'
        ? `顯示前 ${chosen.length} 條；依 ${filterState.plannedHours} 小時內可實現總利潤排序，★ 不影響名次`
        : `顯示前 ${chosen.length} / ${matched.length} 條觀察與資料不足項目`;
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
      const mainRow = strategyRow(assessedCandidate, assessedSignal, pinned, options);
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

  for (const button of modeGroup.querySelectorAll<HTMLButtonElement>('[data-strategy-mode]')) {
    button.addEventListener('click', () => {
      filterState.mode = button.dataset.strategyMode as StrategyDecisionMode;
      filterState.scope = 'actionable';
      for (const peer of modeGroup.querySelectorAll<HTMLButtonElement>('[data-strategy-mode]')) {
        peer.setAttribute('aria-pressed', String(peer === button));
      }
      updateResults();
    });
  }

  hoursSelect.addEventListener('change', () => {
    filterState.plannedHours = Number(hoursSelect.value);
    filterState.scope = 'actionable';
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
