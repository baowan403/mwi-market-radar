import { formatCompactNumber } from '../core/format-number';
import type { Snapshot } from '../core/types';
import type { PlayerProfile, SkillingAction } from '../profile/types';
import type { NormalizedStrategyGameData } from './game-data';
import {
  analyzeUpgradeTargets,
  type UpgradeAnalysis,
  type UpgradeRow,
  type UpgradeObjective,
} from './upgrades';
import {runUpgradeAnalysis} from './upgrade-runner';
import {formatSemanticPath} from './semantic-path';

type UpgradeSkill = Exclude<SkillingAction, 'enhancing'>;
type UpgradeSort = 'gain' | 'efficiency';

const UPGRADE_SKILLS: readonly UpgradeSkill[] = [
  'milking', 'foraging', 'woodcutting', 'cheesesmithing', 'crafting',
  'tailoring', 'cooking', 'brewing', 'alchemy',
];

const SKILL_LABELS: Record<UpgradeSkill, string> = {
  milking: '擠奶',
  foraging: '採摘',
  woodcutting: '伐木',
  cheesesmithing: '鍛造',
  crafting: '製作',
  tailoring: '裁縫',
  cooking: '烹飪',
  brewing: '沖泡',
  alchemy: '煉金',
};

export interface UpgradePanelOptions {
  /** Highest current executable 24h return across all skills; never a wallet. */
  dailyProfit24h?: number | null;
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  snapshots: readonly Snapshot[];
  itemName(hrid: string): string;
  signal?: AbortSignal;
  now?: () => number;
  analyze?: typeof analyzeUpgradeTargets;
}

export interface UpgradePanel {
  element: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : formatCompactNumber(value);
}

function signedMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${money(value)}`;
}

function days(value: number | null): string {
  return value === null || !Number.isFinite(value) || value < 0 ? '—' : `${value.toFixed(1)}天`;
}

function skillLevel(profile: PlayerProfile, skill: UpgradeSkill): number {
  const level = profile.actions?.[skill]?.playerLevel;
  return typeof level === 'number' && Number.isFinite(level) ? level : -1;
}

function strongestSkill(profile: PlayerProfile): UpgradeSkill {
  return UPGRADE_SKILLS.reduce((best, skill) => (
    skillLevel(profile, skill) > skillLevel(profile, best) ? skill : best
  ), UPGRADE_SKILLS[0]!);
}

function rowKey(row: UpgradeRow): string {
  return `${row.itemHrid}::${row.enhancementLevel}`;
}

function efficiency(row: UpgradeRow, objective:UpgradeObjective='profit'): number | null {
  const gain=objective==='experience'?row.xpDelta:row.delta;
  if(row.priority==='已有更高強化'||row.eligibility!=='met')return null;
  if (row.price === null || row.price <= 0 || gain === null || gain === undefined || gain <= 0) return null;
  const value = gain / row.price;
  return Number.isFinite(value) ? value : null;
}

function sortRows(rows: readonly UpgradeRow[], sort: UpgradeSort, objective:UpgradeObjective='profit'): UpgradeRow[] {
  return rows
    .map((row, index) => ({ row, index, value: sort === 'gain' ? (objective==='experience'?row.xpDelta??null:row.delta) : efficiency(row,objective) }))
    .sort((left, right) => {
      if(sort==='efficiency'){
        const lf=left.row.owned&&left.row.eligibility==='met'&&(left.row.delta??0)>0,rf=right.row.owned&&right.row.eligibility==='met'&&(right.row.delta??0)>0;
        if(lf!==rf)return lf?-1:1;
      }
      const leftKnown = left.value !== null && Number.isFinite(left.value);
      const rightKnown = right.value !== null && Number.isFinite(right.value);
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
      if (leftKnown && rightKnown && left.value !== right.value) return right.value! - left.value!;
      return left.index - right.index || rowKey(left.row).localeCompare(rowKey(right.row));
    })
    .map(({ row }) => row);
}

function eligibilityLabel(row: UpgradeRow): string {
  if (row.eligibility === 'met') return '可用';
  if (row.eligibility === 'unmet') return '條件不足';
  return '待確認';
}

function routeLabel(route: readonly string[] | undefined, itemName: (hrid: string) => string): string {
  return route && route.length > 0 ? route.map(itemName).join(' → ') : '—';
}

function renderDetail(row: UpgradeRow, options: UpgradePanelOptions, objective:UpgradeObjective='profit', precision:'quick'|'verify'='quick'): HTMLTableRowElement {
  const detailRow = element('tr', 'upgrade-detail-row');
  detailRow.dataset.upgradeDetailFor = rowKey(row);
  const cell = element('td');
  cell.colSpan = 9;
  const details = element('details', 'upgrade-detail');
  details.dataset.upgradeDetail = 'true';
  const summary = element('summary');
  summary.textContent = '查看最佳路線、條件與收益預覽';
  details.append(summary);

  const content = element('div', 'upgrade-detail-content');
  const route = element('p');
  route.textContent = precision==='verify'?`最佳路線：${row.after?.candidate?formatSemanticPath(row.after.candidate,options.data,options.itemName):routeLabel(row.after?.route, options.itemName)}`:`參考項目：${row.after?.route.map(options.itemName).join('、')??'—'}`;
  content.append(route);

  const requirements = element('p');
  requirements.textContent = row.requirements.length > 0
    ? `資格要求：${row.requirements.join('；')}`
    : `資格要求：${eligibilityLabel(row)}`;
  content.append(requirements);

  const preview = element('p');
  if (row.after !== null && row.eligibility === 'met') {
    preview.textContent = `換裝後收益預覽：${money(row.after.profit)}（理論值 ${money(row.after.theoreticalProfit)}；模型比較）`;
  } else if (row.eligibility === 'unmet') {
    preview.textContent = '換裝後收益預覽：條件不足，暫不視為可執行收益。';
  } else if(row.after!==null&&row.eligibility==='unknown') {
    preview.textContent=`* 假設符合穿戴條件的靜態換裝預览：${money(row.after.profit)}；未計達標升級的額外收益，不能視為目前可用。`;
  } else {
    preview.textContent = '換裝後收益預覽：資格或報價尚未確認，暫不視為可執行收益。';
  }
  content.append(preview);
  if(objective==='experience'){const xp=element('p');xp.textContent=`換裝後經驗：${money(row.after?.xpPerHour)} XP/h；經驗增益：${signedMoney(row.xpDelta??null)} XP/h。`;content.append(xp);}

  if (row.marginal && objective==='profit') {
    const marginal = element('p');
    marginal.textContent = `相鄰比較：+${row.marginal.lowerEnhancement} → +${row.enhancementLevel}；` +
      `增額成本 ${money(row.marginal.extraCost)}；增額收益 ${signedMoney(row.marginal.extraGain)}；` +
      `回本 ${days(row.marginal.paybackDays)}`;
    content.append(marginal);
  }

  const note = element('p', 'upgrade-detail-note');
  note.textContent = '單件比較不可直接相加；不假設出售舊裝。市場報價僅作參考，不保證成交深度。';
  content.append(note);
  details.append(content);
  cell.append(details);
  detailRow.append(cell);
  return detailRow;
}

function renderRow(row: UpgradeRow, options: UpgradePanelOptions, objective:UpgradeObjective='profit'): HTMLTableRowElement {
  const tableRow = element('tr');
  tableRow.dataset.upgradeRow = rowKey(row);
  tableRow.dataset.upgradeEligibility = row.eligibility;

  const equipment = element('td', 'upgrade-equipment');
  const title = element('strong');
  title.textContent = `${options.itemName(row.itemHrid)} +${row.enhancementLevel}`;
  equipment.append(title);
  tableRow.append(equipment);

  const slot = element('td', 'upgrade-slot');
  const slotNames:Record<string,string>={tool:'工具',body:'上衣',legs:'下裝',back:'背飾',charm:'護符',head:'帽子',hands:'手套',feet:'鞋子',off_hand:'副手',pouch:'袋子',neck:'項鍊',earrings:'耳環',ring:'戒指',trinket:'徽章'};
  slot.textContent = slotNames[row.slot]??'裝備';
  tableRow.append(slot);

  const price = element('td', 'upgrade-price');
  price.textContent = money(row.price);
  tableRow.append(price);

  const saving = element('td', 'upgrade-saving');
  const daily = options.dailyProfit24h;
  saving.textContent = row.owned ? '已持有' : row.price !== null && daily !== null && daily !== undefined && Number.isFinite(daily) && daily > 0
    ? days(row.price / daily) : '—';
  tableRow.append(saving);

  const delta = element('td', 'upgrade-delta');
  const gain=objective==='experience'?row.xpDelta??null:row.delta;
  delta.textContent = signedMoney(gain);
  if(row.eligibility==='unknown'&&row.delta!==null)delta.textContent+='*';
  delta.dataset.sign=(gain??0)>0?'positive':(gain??0)<0?'negative':'neutral';
  tableRow.append(delta);

  const after = element('td', 'upgrade-after');
  after.textContent = row.after === null ? '—' : money(objective==='experience'?row.after.xpPerHour:row.after.profit);
  if(row.eligibility==='unknown'&&row.after!==null)after.textContent+='*';
  tableRow.append(after);

  const payback = element('td', 'upgrade-payback');
  payback.textContent = row.owned ? '已持有' : row.price === null ? '—' : days(row.paybackDays);
  if(objective==='experience')payback.textContent=row.price!==null&&row.price>0&&gain!==null&&gain>0?money(gain/row.price*1000000):'—';
  tableRow.append(payback);

  const priority = element('td', 'upgrade-priority');
  priority.textContent = row.priority;
  priority.dataset.upgradePriority=row.priority;
  tableRow.append(priority);
  const notes = element('td', 'upgrade-notes');
  notes.textContent = [row.owned?'已持有，免購買':'', ...row.requirements.map(r=>r.split('（')[0]), row.eligibility==='unknown'?'門檻待確認':''].filter(Boolean).join('；');
  tableRow.append(notes);
  return tableRow;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function createUpgradePanel(options: UpgradePanelOptions): UpgradePanel {
  const section = element('section', 'upgrade-panel');
  section.dataset.upgradePanel = 'true';

  const controls = element('div', 'upgrade-controls');
  const heading = element('h3');
  heading.textContent = '升級目標榜';
  controls.append(heading);

  let selectedSkill = strongestSkill(options.profile);
  const skillLabel = element('label');
  skillLabel.textContent = '生活技能';
  const skillSelect = element('select');
  skillSelect.dataset.upgradeSkill = 'true';
  for (const skill of UPGRADE_SKILLS) {
    const option = element('option');
    option.value = skill;
    option.textContent = SKILL_LABELS[skill];
    option.selected = skill === selectedSkill;
    skillSelect.append(option);
  }
  skillLabel.append(skillSelect);
  controls.append(skillLabel);

  let objective:UpgradeObjective='profit';
  const objectiveLabel=element('label');objectiveLabel.textContent='目標';
  const objectiveSelect=element('select');objectiveSelect.dataset.upgradeObjective='true';
  for(const [value,label] of [['profit','賺錢'],['experience','衝等']] as const){const o=element('option');o.value=value;o.textContent=label;objectiveSelect.append(o);}
  objectiveLabel.append(objectiveSelect);controls.append(objectiveLabel);
  let topN=3;
  const topLabel=element('label');topLabel.textContent='參考項目';
  const topSelect=element('select');topSelect.dataset.upgradeTopN='true';
  for(const n of [1,3,5]){const o=element('option');o.value=String(n);o.textContent=String(n);o.selected=n===3;topSelect.append(o);}
  topLabel.append(topSelect);controls.append(topLabel);

  let hoursPerDay = 24;
  let customDuration = false;
  const hoursLabel = element('label');
  hoursLabel.textContent = '每日使用時數';
  const hoursSelect = element('select');
  hoursSelect.dataset.upgradeHours = 'true';
  for (const [value, label] of [['6', '6H'], ['12', '12H'], ['24', '24H'], ['custom', '自訂']] as const) {
    const option = element('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === '24';
    hoursSelect.append(option);
  }
  hoursLabel.append(hoursSelect);
  controls.append(hoursLabel);

  const customHours = element('input');
  customHours.type = 'number';
  customHours.min = '0.5';
  customHours.max = '24';
  customHours.step = 'any';
  customHours.value = '24';
  customHours.hidden = true;
  customHours.dataset.upgradeCustomHours = 'true';
  customHours.setAttribute('aria-label', '自訂每日使用時數');
  controls.append(customHours);

  let sortMode: UpgradeSort = 'gain';
  const sortLabel = element('label');
  sortLabel.textContent = '排序';
  const sortSelect = element('select');
  sortSelect.dataset.upgradeSort = 'true';
  for (const [value, label] of [['gain', '提升最大'], ['efficiency', '投資效率']] as const) {
    const option = element('option');
    option.value = value;
    option.textContent = label;
    sortSelect.append(option);
  }
  sortLabel.append(sortSelect);
  controls.append(sortLabel);

  const analyzeButton = element('button', 'toolbar-button');
  analyzeButton.type = 'button';
  analyzeButton.textContent = '分析升級目標';
  analyzeButton.dataset.upgradeAnalyze = 'true';
  controls.append(analyzeButton);
  const verifyButton=element('button','toolbar-button');verifyButton.type='button';verifyButton.textContent='精算前6項';verifyButton.dataset.upgradeVerify='true';verifyButton.disabled=true;controls.append(verifyButton);
  let showAll=false,showPending=false;
  const allLabel=element('label'),pendingLabel=element('label');
  const allCheck=element('input'),pendingCheck=element('input');allCheck.type='checkbox';pendingCheck.type='checkbox';
  allCheck.dataset.upgradeAll='true';pendingCheck.dataset.upgradePending='true';
  allLabel.append(allCheck,document.createTextNode('全部候選'));pendingLabel.append(pendingCheck,document.createTextNode('待確認'));
  controls.append(allLabel,pendingLabel);
  section.append(controls);

  const progress = element('progress', 'upgrade-progress');
  progress.max = 1;
  progress.value = 0;
  progress.dataset.upgradeProgress = 'true';
  progress.hidden = true;
  section.append(progress);
  const status = element('p', 'upgrade-status');
  status.dataset.upgradeStatus = 'true';
  status.textContent = '選擇技能與使用時數後按「分析升級目標」。';
  section.append(status);

  const content = element('div', 'upgrade-content');
  section.append(content);

  let currentAnalysis: UpgradeAnalysis | null = null;
  let revision = 0;
  let running: { id: number; controller: AbortController } | null = null;

  const markStale = (): void => {
    if (running) {
      running.controller.abort();
      running = null;
      analyzeButton.textContent = '分析升級目標';
      progress.hidden = true;
    }
    currentAnalysis = null;
    verifyButton.disabled=true;
    content.replaceChildren();
    status.textContent = '條件已變更，請重新分析升級目標。';
  };

  const renderAnalysis = (analysis: UpgradeAnalysis): void => {
    content.replaceChildren();
    const disclaimer = element('p', 'upgrade-disclaimer');
    disclaimer.textContent = '模型收益比較，不是實際資產或成交保證；單件升級不可把多列收益直接相加。';
    content.append(disclaimer);

    const baseline = element('p', 'upgrade-baseline');
    baseline.textContent = analysis.baseline
      ? `${analysis.precision==='verify'?'精算基準':'參考均值'}：${analysis.precision==='verify'?(analysis.baseline.candidate?formatSemanticPath(analysis.baseline.candidate,options.data,options.itemName):routeLabel(analysis.baseline.route, options.itemName)):analysis.baseline.route.map(options.itemName).join('、')} · ${objective==='experience'?`${money(analysis.baseline.xpPerHour)} XP/h`:`每日預估收益 ${money(analysis.baseline.profit)}`}`
      : '目前沒有可用的基準收益，保留候選供確認。';
    content.append(baseline);

    const savingReference = element('p', 'upgrade-saving-reference');
    savingReference.textContent = `存錢參考：全技能最高24H預估收益 ${money(options.dailyProfit24h)}／日；從零存起，不扣現金。`;
    content.append(savingReference);

    if (analysis.warnings.length > 0) {
      const warnings = element('p', 'upgrade-warning');
      warnings.textContent = analysis.warnings.join('；');
      content.append(warnings);
    }

    const table = element('table', 'upgrade-table');
    const columns = element('colgroup');
    for (const width of [200,60,90,90,100,100,95,95,200]) {
      const col = element('col');col.style.width=`${width}px`;columns.append(col);
    }
    table.append(columns);
    const head = element('thead');
    const headerRow = element('tr');
    for (const label of ['裝備', '部位', '價格', '存錢天數', objective==='experience'?'經驗增益/h':'每日增益', objective==='experience'?'換裝後經驗/h':'換裝後收益', objective==='experience'?'每1M經驗增益/h':'回本天數', '優先級', '備註']) {
      const cell = element('th');
      cell.textContent = label;
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = element('tbody');
    const ready=analysis.rows.filter(r=>r.eligibility==='met'&&r.price!==null&&r.after!==null);
    let shown=ready;
    if(!showAll){
      const leaders=new Set<UpgradeRow>();
      for(const slot of new Set(ready.map(r=>r.slot))){const group=ready.filter(r=>r.slot===slot);for(const mode of ['gain','efficiency'] as const){const first=sortRows(group,mode,objective)[0];if(first)leaders.add(first);}}
      shown=[...leaders];
    }
    if(showPending)shown=shown.concat(analysis.rows.filter(r=>!ready.includes(r)));
    for (const row of sortRows(shown, sortMode,objective)) {
      const main=renderRow(row,options,objective),detail=renderDetail(row,options,objective,analysis.precision??'quick');
      detail.hidden=true;main.tabIndex=0;main.setAttribute('aria-expanded','false');
      main.title='點擊查看比較明細';
      const toggle=()=>{detail.hidden=!detail.hidden;main.setAttribute('aria-expanded',String(!detail.hidden));detail.querySelector('details')!.open=!detail.hidden;};
      main.addEventListener('click',toggle);
      main.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}});
      body.append(main,detail);
    }
    table.append(head, body);
    const tableScroll = element('div', 'upgrade-table-scroll');
    tableScroll.append(table);
    content.append(tableScroll);
    status.textContent = `${analysis.precision==='verify'?'精算完成':'快速比較完成'}：比較 ${analysis.testedVariants} 項，顯示 ${shown.length} 項${showAll?'':'（各部位最佳）'}。`;
  };

  skillSelect.addEventListener('change', () => {
    selectedSkill = skillSelect.value as UpgradeSkill;
    markStale();
  });
  hoursSelect.addEventListener('change', () => {
    customDuration = hoursSelect.value === 'custom';
    customHours.hidden = !customDuration;
    if (!customDuration) {
      hoursPerDay = Number(hoursSelect.value);
      customHours.value = String(hoursPerDay);
      markStale();
    } else {
      status.textContent = '請輸入 0.5–24H 後按「分析升級目標」。';
    }
  });
  customHours.addEventListener('change', () => {
    if (!customHours.checkValidity() || !Number.isFinite(customHours.valueAsNumber)) {
      status.textContent = '每日使用時數必須介於 0.5–24H。';
      return;
    }
    hoursPerDay = customHours.valueAsNumber;
    markStale();
  });
  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value as UpgradeSort;
    if (currentAnalysis) renderAnalysis(currentAnalysis);
  });
  objectiveSelect.addEventListener('change',()=>{objective=objectiveSelect.value as UpgradeObjective;markStale();});
  topSelect.addEventListener('change',()=>{topN=Number(topSelect.value);markStale();});
  allCheck.addEventListener('change',()=>{showAll=allCheck.checked;if(currentAnalysis)renderAnalysis(currentAnalysis);});
  pendingCheck.addEventListener('change',()=>{showPending=pendingCheck.checked;if(currentAnalysis)renderAnalysis(currentAnalysis);});

  const startAnalysis=(precision:'quick'|'verify') => {
    if (running) {
      running.controller.abort();
      status.textContent = '正在取消升級分析…';
      return;
    }
    if (customDuration && (!customHours.checkValidity() || !Number.isFinite(customHours.valueAsNumber))) {
      customHours.reportValidity();
      return;
    }

    const id = ++revision;
    const controller = new AbortController();
    running = { id, controller };
    if(precision==='quick'){currentAnalysis = null;content.replaceChildren();}
    verifyButton.disabled=true;
    const onParentAbort = (): void => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onParentAbort, { once: true });
    analyzeButton.textContent = '取消分析';
    progress.hidden = false;
    progress.max = 1;
    progress.value = 0;
    status.textContent = '正在分析升級目標…';

    void (async () => {
      try {
        const analysis = await (options.analyze ?? runUpgradeAnalysis)({
          profile: options.profile,
          data: options.data,
          snapshots: options.snapshots,
          action: selectedSkill,
          hoursPerDay,
          objective,topN,precision,
          onProgress: ({ done, total, phase }) => {
            if (running?.id !== id) return;
            progress.max = Math.max(1, total);
            progress.value = Math.min(progress.max, Math.max(0, done));
            status.textContent = `${phase==='verify'?'正在精算':'正在快速比較'}… ${done}/${total}`;
          },
          signal: controller.signal,
          now: options.now?.(),
        });
        if (controller.signal.aborted || running?.id !== id) {
          if (running?.id === id) status.textContent = '升級分析已取消。';
          return;
        }
        currentAnalysis = analysis;
        renderAnalysis(analysis);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          if (running?.id === id) status.textContent = '升級分析已取消。';
        } else if (running?.id === id) {
          content.replaceChildren();
          status.textContent = '升級資料暫時無法計算，請稍後重試。';
        }
      } finally {
        options.signal?.removeEventListener('abort', onParentAbort);
        if (running?.id === id) {
          running = null;
          analyzeButton.textContent = '分析升級目標';
          progress.hidden = true;
          verifyButton.disabled=currentAnalysis===null;
        }
      }
    })();
  };
  analyzeButton.addEventListener('click',()=>startAnalysis('quick'));
  verifyButton.addEventListener('click',()=>startAnalysis('verify'));

  return { element: section };
}
