import type { Snapshot } from '../core/types';
import { formatCompactNumber } from '../core/format-number';
import type { PlayerProfile } from '../profile/types';
import type { StrategyCandidate } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { analyzeOpportunities, type Opportunity } from './opportunities';
import { makeOpportunityObservation, evaluateOpportunityOutcome, type OpportunityJournal, type OpportunityOutcome } from './opportunity-journal';

interface Options {
  candidates: readonly StrategyCandidate[]; snapshots: readonly Snapshot[]; data: NormalizedStrategyGameData;
  profile: PlayerProfile; getHours(): number; itemName(hrid: string): string; journal: OpportunityJournal;
  now?: ()=>number; analyze?: typeof analyzeOpportunities; signal?: AbortSignal;
  onSummary?: (text:string,tone:'neutral'|'prepare'|'watch'|'unavailable')=>void;
}
const money=(n:number)=>formatCompactNumber(n);
const pct=(n:number|null)=>n===null?'—':`${n>=0?'+':''}${n.toFixed(1)}%`;
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K] {
  const e=document.createElement(tag); e.textContent=text; if(className)e.className=className; return e;
}
function outcomeText(value:OpportunityOutcome):string {
  if(value.state==='pending')return '待到期';
  if(value.state==='missing')return '缺少對應行情';
  return `較原基準${value.extraProfit!>=0?'+':''}${money(value.extraProfit!)}；最多相對落後${money(value.maxRelativeShortfall??0)}`;
}
function card(item:Opportunity,baselineReturn:number,options:Options):HTMLElement {
  const article=node('details','','opportunity-card');
  article.dataset.opportunityAction=item.action;
  const summary=node('summary','','opportunity-card-summary');
  summary.append(node('span',item.action==='prepare'?'可小批備料':'僅觀察','opportunity-badge'));
  summary.append(node('strong',item.candidate.path.map(options.itemName).join(' → ')));
  summary.append(node('span',`${money(item.session.rankValue!)} · 仍低於首選${money(Math.max(0,baselineReturn-item.session.rankValue!))}`,'opportunity-return'));
  summary.append(node('small',item.preparation?`備料上限${money(item.preparation.cash)} · 點開明細`:'暫不操作 · 點開原因'));
  article.append(summary);
  const detail=node('div','','opportunity-card-detail');
  detail.append(node('p',`收益動能：6H ${pct(item.metrics.profit6hPct)}／24H ${pct(item.metrics.profit24hPct)}`));
  detail.append(node('p',`6H成本 ${pct(item.metrics.cost6hPct)}／收入 ${pct(item.metrics.income6hPct)}`));
  detail.append(node('p',`成交量較前24H：原料 ${pct(item.metrics.inputVolumeChangePct)}／成品 ${pct(item.metrics.outputVolumeChangePct)}`));
  detail.append(node('p',item.reasons.join(' '),'opportunity-reasons'));
  if(item.preparation) {
    const prep=item.preparation;
    detail.append(node('p',`最多備${money(prep.hours)}H，需約${money(prep.cash)}（全部補購、含茶與動作金幣）`));
    const materials=node('details'); materials.append(node('summary','備料清單'));
    const list=node('ul');
    for(const f of prep.items)list.append(node('li',`${options.itemName(f.itemHrid)} × ${money(f.units)}，參考買價${money(f.price)}`));
    materials.append(list);detail.append(materials);
  }
  const invalidation=node('details'); invalidation.append(node('summary','何時重新評估'));
  invalidation.append(node('p',`每小時總成本高於${money(item.invalidation.maxCostPerHour)}，或收入低於${money(item.invalidation.minIncomePerHour)}；原料／成品占比超過5%，或行情超過3H。`));
  detail.append(invalidation);article.append(detail); return article;
}

/** Explicit analysis action keeps market-table filtering fast and leaves the current ranking intact. */
export function createOpportunityPanel(options:Options):{element:HTMLElement;invalidate():void} {
  const section=node('section','','opportunity-panel'); section.dataset.opportunityPanel='true';
  const controls=node('div','','opportunity-controls');
  controls.append(node('h3','機會雷達'));
  const budgetLabel=node('label','備料預算（M）：');
  const budget=node('input');budget.type='number';budget.min='0';budget.step='0.1';budget.placeholder='未設定';
  budget.setAttribute('aria-label','備料預算（M）');budgetLabel.append(budget);
  const button=node('button','分析機會','toolbar-button');button.type='button';button.dataset.opportunityAnalyze='true';
  controls.append(budgetLabel,button);
  const content=node('div','','opportunity-content');
  const hint=()=>`依${options.getHours()}H情境，從全技能找出正在追近基準的策略。每項備料最多2H、預算10%；未填預算只觀察。`;
  content.append(node('p','未填預算只觀察；分析後再決定是否需要備料。'));section.append(controls,content);
  let revision=0;
  const active=(id:number)=>id===revision&&!options.signal?.aborted;
  button.addEventListener('click',()=>{void(async()=>{
    if(budget.value!==''&&(!budget.checkValidity()||!Number.isFinite(budget.valueAsNumber))) {
      budget.reportValidity();return;
    }
    const id=++revision;button.disabled=true;button.textContent='分析中…';
    // Yield so the busy state paints; analysis is never performed on each keystroke.
    await new Promise(resolve=>setTimeout(resolve,0));
    if(!active(id))return;
    const now=options.now?.()??Date.now();
    try {
      const result=(options.analyze??analyzeOpportunities)({...options,plannedHours:options.getHours(),
        budget:budget.value===''?null:budget.valueAsNumber*1000000,now});
      if(!active(id))return;
      const fragment=document.createDocumentFragment();
      const displayed=[...result.opportunities].sort((a,b)=>Number(b.action==='prepare'&&!!b.preparation)-Number(a.action==='prepare'&&!!a.preparation)).slice(0,3);
      const ready=displayed.filter(item=>item.action==='prepare'&&item.preparation);
      const watching=displayed.filter(item=>!ready.includes(item));
      const verdictText=!result.baseline?result.reason:ready.length
        ? `有${ready.length}項可小批備料；目前仍未優於收益首選。`
        : '目前沒有備料建議；先依收益榜選擇，不必切換。';
      const tone=!result.baseline?'unavailable':ready.length?'prepare':'watch';
      const verdict=node('p',verdictText,'opportunity-verdict');verdict.dataset.tone=tone;fragment.append(verdict);
      options.onSummary?.(verdictText,tone);
      if(result.baseline)fragment.append(node('p',`${options.getHours()}H首選基準：${result.baseline.candidate.path.map(options.itemName).join(' → ')} · ${money(result.baseline.session.rankValue!)}`,'opportunity-note'));
      const cards=node('div','','opportunity-cards');
      for(const item of ready)cards.append(card(item,result.baseline!.session.rankValue!,options));
      fragment.append(cards);
      if(watching.length){
        const watch=node('details','','opportunity-watch-list');watch.append(node('summary',`僅觀察 ${watching.length}項 · 暫不操作`));
        for(const item of watching)watch.append(card(item,result.baseline!.session.rankValue!,options));
        fragment.append(watch);
      }
      const method=node('details','','opportunity-method');method.append(node('summary','判斷口徑'));
      method.append(node('p',`${hint()} 本次檢查${result.considered}條不同路徑；趨勢不是未來價格保證。`));fragment.append(method);
      const status=node('p','','opportunity-note');fragment.append(status);
      content.replaceChildren(fragment);
      try {
        for(const item of displayed) {
          if(!active(id))return;
          const input={profileId:options.profile.id,issuedAt:now,savedAt:now,sourceTimestamp:result.issuedAt,
            plannedHours:options.getHours(),action:item.action,candidate:item.candidate,baseline:result.baseline!.candidate};
          await options.journal.add(await makeOpportunityObservation(input));
        }
        const records=(await options.journal.list(options.profile.id)).slice(0,10);
        if(!active(id))return;
        status.textContent=displayed.length
          ? '本機已記錄；下次分析時，用後續6H／24H行情比較是否超過當時基準。'
          : '目前沒有新增紀錄；既有紀錄會依後續行情更新比較。';
        if(records.length){
          const history=node('details','','opportunity-history');history.append(node('summary','上次機會後來如何'));
          history.append(node('p','模型比較，不是實際成交紀錄；相對落後不是帳戶虧損。'));
          for(const record of records){
            const item=node('div','','opportunity-history-item');
            item.append(node('strong',`${new Date(record.issuedAt).toLocaleString()}・${record.candidate.path.map(options.itemName).join(' → ')}`));
            for(const h of [6,24] as const){
              if(!active(id))return;
              const cached=await options.journal.getOutcome(record.id,h);
              const outcome=cached??evaluateOpportunityOutcome(record,options.snapshots,options.data,h);
              if(!cached&&outcome.state==='evaluated')await options.journal.saveOutcome(record.id,outcome);
              item.append(node('p',`${h}H：${outcomeText(outcome)}`));
            }
            if(!active(id))return;
            history.append(item);
          }
          if(active(id))content.append(history);
        }
      } catch {if(active(id))status.textContent='未能保存本機紀錄，以上觀察仍可閱讀。';}
    } catch {if(active(id)){content.replaceChildren(node('p','機會資料暫時無法計算，請稍後重試。'));options.onSummary?.('機會暫時無法判斷，請稍後重試。','unavailable');}}
    finally {if(active(id)){button.disabled=false;button.textContent='分析機會';}}
  })();});
  return {element:section,invalidate(){revision++;button.disabled=false;button.textContent='分析機會';
    options.onSummary?.('條件已變更，機會需要重新分析。','neutral');
    content.replaceChildren(node('p','條件已變更，請重新分析。'));}};
}
