import type { Snapshot } from '../core/types';
import { SKILLING_ACTIONS, type PlayerProfile, type ProfileEquipment, type SkillingAction } from '../profile/types';
import { actionBuffs } from './buffs';
import { buildStrategyCandidates } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { enrichProfileWithBestLoadout, isItemOwnedByPlayer } from './optimal-loadout';
import { createStrategyPriceBook } from './price-book';
import { evaluateRealizableStrategy } from './realizable';
import { estimateStrategySession } from './session';
import { createMarketCapacityLookup } from './liquidity';
import { candidateExperience, recalculateUpgradeReference } from './upgrade-evaluation';
import type { StrategyCandidate } from './candidates';

export type UpgradeObjective='profit'|'experience';
export interface UpgradeEvaluation { profit:number; route:string[]; theoreticalProfit:number; xpPerHour?:number }
export interface UpgradeRow {
  itemHrid:string; enhancementLevel:number; slot:string; price:number|null; owned:boolean;
  eligibility:'met'|'unmet'|'unknown'; requirements:string[];
  after:UpgradeEvaluation|null; delta:number|null; paybackDays:number|null; priority:string;
  xpDelta?:number|null;
  marginal?:{lowerEnhancement:number;extraCost:number|null;extraGain:number|null;paybackDays:number|null};
}
export interface UpgradeAnalysis {
  action:SkillingAction; hoursPerDay:number; baseline:UpgradeEvaluation|null;
  rows:UpgradeRow[]; testedVariants:number; warnings:string[];
  objective?:UpgradeObjective; precision?:'quick'|'verify'; referenceCount?:number;
}
export interface UpgradeProgress {done:number;total:number}
const ACTION_SLOTS=new Set(['tool','body','legs','back','charm']);
const SPECIAL_SLOTS=new Set(['head','hands','feet','off_hand','pouch','neck','ring','earrings','trinket']);
const NAMES:Record<string,string>={alchemy:'煉金',crafting:'製作',cheesesmithing:'鍛造',tailoring:'裁縫',cooking:'烹飪',brewing:'沖泡',
  milking:'擠奶',foraging:'採摘',woodcutting:'伐木',enhancing:'強化',total_level:'總等級',intelligence:'智力',stamina:'耐力',attack:'攻擊',defense:'防禦',melee:'近戰',ranged:'遠程',magic:'魔法'};
function equipmentAt(profile:PlayerProfile,action:SkillingAction,slot:string):ProfileEquipment|null {
  return (ACTION_SLOTS.has(slot)?profile.actions[action][slot as 'tool'|'body'|'legs'|'back'|'charm']:profile.specialEquipment[slot])??null;
}
function putEquipment(profile:PlayerProfile,action:SkillingAction,slot:string,equipment:ProfileEquipment):void {
  if(ACTION_SLOTS.has(slot))profile.actions[action][slot as 'tool'|'body'|'legs'|'back'|'charm']=equipment;
  else profile.specialEquipment[slot]=equipment;
}
function relevant(property:string,action:SkillingAction):boolean {
  return property.startsWith(action)||property.startsWith('skilling')||property==='drinkConcentration'
    || (property==='gatheringQuantity'&&['milking','foraging','woodcutting'].includes(action));
}
function requirementState(profile:PlayerProfile,raw:unknown,currentSameItem:boolean):Pick<UpgradeRow,'eligibility'|'requirements'> {
  if(!Array.isArray(raw))return {eligibility:'unknown',requirements:['穿戴需求資料缺失']};
  let unknown=false,unmet=false;const requirements:string[]=[];
  for(const requirement of raw){
    const skill=String(requirement?.skillHrid??'').replace('/skills/','');
    const required=requirement?.level;
    if(typeof required!=='number'||!Number.isFinite(required)||required<0){unknown=true;requirements.push('穿戴需求資料不完整');continue;}
    let level=SKILLING_ACTIONS.includes(skill as SkillingAction)?profile.actions[skill as SkillingAction]?.playerLevel:profile.skillLevels?.[`/skills/${skill}`];
    if(skill==='total_level'&&level===undefined){
      // Known skills/achievements are lower bounds, never a fabricated total.
      const levels={...profile.skillLevels};delete levels['/skills/total_level'];
      for(const action of SKILLING_ACTIONS)levels[`/skills/${action}`]=profile.actions[action]?.playerLevel??0;
      const lower=Object.values(levels).reduce((sum,n)=>sum+n,0);
      const milestone=Object.entries(profile.achievements??{}).reduce((best,[key,done])=>{
        const match=key.match(/\/achievements\/total_level_(\d+)$/);return done&&match?Math.max(best,Number(match[1])):best;
      },0);
      if(Math.max(lower,milestone)>=required)level=required;
    }
    if(level===undefined){if(!currentSameItem)unknown=true;}
    else if(level<required)unmet=true;
    requirements.push(`${NAMES[skill]??skill}≥${required}（${level===undefined?(currentSameItem?'目前已配戴同款':'快照未提供'):level}）`);
  }
  return {eligibility:unmet?'unmet':unknown?'unknown':'met',requirements};
}

export async function analyzeUpgradeTargets(options:{
  profile:PlayerProfile;data:NormalizedStrategyGameData;snapshots:readonly Snapshot[];action:SkillingAction;
  hoursPerDay:number;onProgress?:(progress:UpgradeProgress)=>void;signal?:AbortSignal;now?:number;
  objective?:UpgradeObjective; topN?:number; precision?:'quick'|'verify';
  calculate?:typeof buildStrategyCandidates;
}):Promise<UpgradeAnalysis> {
  const cancelled=()=>{if(options.signal?.aborted)throw new DOMException('已取消','AbortError');};
  cancelled();
  if(options.action==='enhancing')throw new Error('本版不含強化投資');
  const {data,action}=options;
  const objective=options.objective??'profit',precision=options.precision??'quick';
  const topN=Math.max(1,Math.min(5,Math.round(options.topN??3)));
  const hoursPerDay=Number.isFinite(options.hoursPerDay)?Math.max(.5,Math.min(24,options.hoursPerDay)):24;
  const now=options.now??Date.now();
  const snapshots=[...new Map(options.snapshots.filter(s=>s.timestamp<=now).map(s=>[s.timestamp,s])).values()].sort((a,b)=>a.timestamp-b.timestamp);
  const latest=snapshots.at(-1);const fresh=!!latest&&now-latest.timestamp<=3*3600000;
  const prices=createStrategyPriceBook(latest??{timestamp:0,quotes:{}},data);
  const base=structuredClone(enrichProfileWithBestLoadout(options.profile,data));
  base.loadoutMode='manual'; // Freeze all other equipment; never mutate real profile/ownership.
  const warnings=['比較單件換裝；各列增益不可相加，未計舊裝轉售。'];
  warnings.push(precision==='quick'?'快速比較固定參考路線的平均增益；精算才重新搜尋路線。':'精算初選前6項，含涉及所選技能的跨技能組合。');
  if(objective==='experience')warnings.push('以高收益路線比較經驗；XP/h依所選時數與市場容量估算，沿用目前配茶政策。');
  warnings.push(base.teaMode==='manual'||base.actions[action].teaMode==='manual'?'兩邊皆使用快照指定的茶飲。':'兩邊皆依同一自動配茶政策重算。');
  if(latest)warnings.push(`行情時間：${new Date(latest.timestamp).toLocaleString()}`);
  if(!fresh)warnings.push('市場行情不足或超過3H，收益比較暫停；裝備目標仍保留。');
  const rows:UpgradeRow[]=[];
  const quotedGrades=new Map<string,number[]>();
  for(const [key,quote] of Object.entries(latest?.quotes??{})){
    const at=key.lastIndexOf('::'),grade=Number(key.slice(at+2));
    if(at<0||!Number.isInteger(grade)||grade<0||data.enhancementLevelTotalBonusMultiplierTable[grade]===undefined||!(quote.a!==null&&quote.a>0))continue;
    const hrid=key.slice(0,at),grades=quotedGrades.get(hrid)??[];grades.push(grade);quotedGrades.set(hrid,grades);
  }
  for(const [itemHrid,item] of data.itemsByHrid){
    const detail=item.equipmentDetail;if(!detail||item.isTradable!==true)continue;
    const rawType=String(detail.type??'').replace('/equipment_types/','');
    const slot=rawType===`${action}_tool`?'tool':rawType;
    if(!ACTION_SLOTS.has(slot)&&!SPECIAL_SLOTS.has(slot))continue;
    const stats=(detail.noncombatStats??{}) as Record<string,number>;
    const bonuses=(detail.noncombatEnhancementBonuses??{}) as Record<string,number>;
    if(!Object.keys({...stats,...bonuses}).some(key=>relevant(key,action)&&(Number(stats[key])>0||Number(bonuses[key])>0)))continue;
    const current=equipmentAt(base,action,slot);
    const gate=requirementState(base,detail.levelRequirements,current?.itemHrid===itemHrid);
    if(gate.eligibility==='unmet')continue;
    for(const enhancementLevel of [...new Set([0,...(quotedGrades.get(itemHrid)??[])])].sort((a,b)=>a-b)){
      if(current?.itemHrid===itemHrid&&current.enhancementLevel>=enhancementLevel)continue;
      if(isItemOwnedByPlayer(itemHrid,base)&&(base.inventoryMap[itemHrid]??-1)>=enhancementLevel)continue;
      const owned=isItemOwnedByPlayer(itemHrid,base)&&base.inventoryMap[itemHrid]===enhancementLevel;
      const ask=prices.ask(itemHrid,enhancementLevel);
      rows.push({itemHrid,enhancementLevel,slot,owned,price:owned?0:ask!==null&&ask>0?ask:null,...gate,
        after:null,delta:null,paybackDays:null,priority:'待評估'});
    }
  }
  const cache=new Map<string,UpgradeEvaluation|null>();
  const capacityFor=createMarketCapacityLookup(snapshots);
  const scan=options.calculate??buildStrategyCandidates;
  const blocked=['market-unavailable','no-ask','no-bid','price-anomaly','insufficient-primary-data','insufficient-input-data'];
  const measure=(candidate:StrategyCandidate,profile:PlayerProfile):UpgradeEvaluation|null=>{
      const liquidity=evaluateRealizableStrategy(candidate,snapshots,capacityFor);
      const session=estimateStrategySession({candidate,liquidity,profile,plannedHours:hoursPerDay,latestSnapshotAgeMs:now-latest!.timestamp});
      if(blocked.includes(liquidity.riskCode)||session.executionHours<=0)return null;
      return {profit:session.batchProfit??0,route:[...candidate.path],theoreticalProfit:candidate.profitPerHour*hoursPerDay,xpPerHour:candidateExperience(candidate,action)*session.executionHours/hoursPerDay};
  };
  const score=(v:UpgradeEvaluation)=>objective==='experience'?(v.xpPerHour??0):v.profit;
  const references:StrategyCandidate[]=[];
  if(fresh){
    const source=scan({profile:base,data,prices,actions:[action],includeCombinations:false}).candidates;
    const seen=new Set<string>();
    const ordered=source.map(c=>({c,value:measure(c,base)})).filter(r=>r.value!==null&&r.value.profit>0).sort((a,b)=>b.value!.profit-a.value!.profit);
    for(const {c} of ordered){const key=c.path.join('|');if(seen.has(key))continue;seen.add(key);references.push(c);if(references.length===topN)break;}
  }
  const average=(values:UpgradeEvaluation[]):UpgradeEvaluation|null=>values.length?{
    profit:values.reduce((s,v)=>s+v.profit,0)/values.length,theoreticalProfit:values.reduce((s,v)=>s+v.theoreticalProfit,0)/values.length,
    xpPerHour:values.reduce((s,v)=>s+(v.xpPerHour??0),0)/values.length,route:references.map(c=>c.path.at(-1)??c.title),
  }:null;
  let baseline=average(references.map(c=>measure(c,base)!));
  const quick=(profile:PlayerProfile):UpgradeEvaluation|null=>{
    const signature=JSON.stringify(actionBuffs(profile,action,data));
    if(cache.has(signature))return cache.get(signature)!;
    const custom=options.calculate?scan({profile,data,prices,actions:[action],includeCombinations:false}).candidates:null;
    const values:UpgradeEvaluation[]=[];
    for(const ref of references){
      const c=custom?custom.find(c=>c.id===ref.id):recalculateUpgradeReference(ref,profile,data,prices);
      const value=c?measure(c,profile):null;if(!value){cache.set(signature,null);return null;}values.push(value);
    }
    const value=average(values);cache.set(signature,value);return value;
  };
  const assign=(row:UpgradeRow,value:UpgradeEvaluation|null)=>{
    row.after=value;row.delta=value&&baseline?value.profit-baseline.profit:null;
    row.xpDelta=value&&baseline?(value.xpPerHour??0)-(baseline.xpPerHour??0):null;
    if(row.delta!==null&&Math.abs(row.delta)<1e-6)row.delta=0;
    row.paybackDays=row.delta!==null&&row.delta>0&&row.price!==null?row.price/row.delta:null;
  };
  const scenarioFor=(row:UpgradeRow)=>{const p=structuredClone(base);putEquipment(p,action,row.slot,{itemHrid:row.itemHrid,enhancementLevel:row.enhancementLevel});return p;};
  let lastYield=performance.now();
  for(let i=0;i<rows.length;i++){
    cancelled();const row=rows[i]!;
    if(row.eligibility==='met'&&row.price!==null&&baseline!==null)assign(row,quick(scenarioFor(row)));
    options.onProgress?.({done:i+1,total:rows.length});
    // Yield by time, not for each cheap/cache-hit target (Windows timer floor).
    if(performance.now()-lastYield>40){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
  }
  cancelled();
  const metric=(r:UpgradeRow)=>objective==='experience'?(r.xpDelta??0):(r.delta??0);
  if(precision==='verify'&&baseline){
    const eligible=rows.filter(r=>r.eligibility==='met'&&r.price!==null&&metric(r)>0);
    const byGain=[...eligible].sort((a,b)=>metric(b)-metric(a));
    const byEfficiency=[...eligible].sort((a,b)=>metric(b)/b.price!-metric(a)/a.price!);
    const selected=[...new Set([...byGain.slice(0,3),...byEfficiency.slice(0,3)])].slice(0,6);
    const full=(profile:PlayerProfile):UpgradeEvaluation|null=>{
      const candidates=scan({profile,data,prices}).candidates.filter(c=>c.steps.some(s=>s.action===action));
      let best:UpgradeEvaluation|null=null;
      for(const c of candidates){const value=measure(c,profile);if(value&&value.profit>0&&(!best||score(value)>score(best)))best=value;}
      return best;
    };
    baseline=full(base);
    for(let i=0;i<selected.length;i++){cancelled();assign(selected[i]!,full(scenarioFor(selected[i]!)));options.onProgress?.({done:i+1,total:selected.length});await new Promise(r=>setTimeout(r,0));}
    rows.splice(0,rows.length,...selected);
  }
  const higherOwned=(row:UpgradeRow)=>isItemOwnedByPlayer(row.itemHrid,base)&&(base.inventoryMap[row.itemHrid]??-1)>row.enhancementLevel;
  const comparable=rows.filter(r=>r.eligibility==='met'&&r.price!==null&&metric(r)>0&&!higherOwned(r));
  const largest=Math.max(0,...comparable.map(metric));
  const fastest=Math.min(Infinity,...comparable.filter(r=>!r.owned).map(r=>r.price!/metric(r)));
  for(const row of rows){
    row.priority=row.eligibility==='unmet'?'需達標':row.eligibility==='unknown'?'門檻待確認':row.price===null?'待報價':row.delta===null?'行情待確認'
      :metric(row)<=0?'無提升':metric(row)>=largest-.000001?'提升優先':row.price!/metric(row)===fastest?'效率優先':'可考慮';
    const lower=rows.filter(r=>r.itemHrid===row.itemHrid&&r.enhancementLevel<row.enhancementLevel).sort((a,b)=>b.enhancementLevel-a.enhancementLevel)[0];
    if(lower){
      const extraCost=row.price!==null&&lower.price!==null&&!row.owned&&!lower.owned?row.price-lower.price:null;
      const extraGain=row.delta!==null&&lower.delta!==null?row.delta-lower.delta:null;
      row.marginal={lowerEnhancement:lower.enhancementLevel,extraCost,extraGain,paybackDays:extraCost!==null&&extraCost>=0&&extraGain!==null&&extraGain>0?extraCost/extraGain:null};
    }
  }
  const positiveRows=rows.filter(row=>row.delta===null||metric(row)>0);
  positiveRows.sort((a,b)=>metric(b)-metric(a)||(a.price??Infinity)-(b.price??Infinity)||a.itemHrid.localeCompare(b.itemHrid)||a.enhancementLevel-b.enhancementLevel);
  return {action,hoursPerDay,baseline,rows:positiveRows,testedVariants:rows.length,warnings,objective,precision,referenceCount:references.length};
}
