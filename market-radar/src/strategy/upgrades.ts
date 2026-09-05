import type { Snapshot } from '../core/types';
import { SKILLING_ACTIONS, type PlayerProfile, type ProfileEquipment, type SkillingAction } from '../profile/types';
import { actionBuffs } from './buffs';
import { buildStrategyCandidates } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { enrichProfileWithBestLoadout, isItemOwnedByPlayer } from './optimal-loadout';
import { createStrategyPriceBook } from './price-book';
import { evaluateRealizableStrategy } from './realizable';
import { estimateStrategySession } from './session';

export interface UpgradeEvaluation { profit:number; route:string[]; theoreticalProfit:number }
export interface UpgradeRow {
  itemHrid:string; enhancementLevel:number; slot:string; price:number|null; owned:boolean;
  eligibility:'met'|'unmet'|'unknown'; requirements:string[];
  after:UpgradeEvaluation|null; delta:number|null; paybackDays:number|null; priority:string;
  marginal?:{lowerEnhancement:number;extraCost:number|null;extraGain:number|null;paybackDays:number|null};
}
export interface UpgradeAnalysis {
  action:SkillingAction; hoursPerDay:number; baseline:UpgradeEvaluation|null;
  rows:UpgradeRow[]; testedVariants:number; warnings:string[];
}
export interface UpgradeProgress {done:number;total:number}
const GRADES=[0,5,7,10];
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
  calculate?:typeof buildStrategyCandidates;
}):Promise<UpgradeAnalysis> {
  const cancelled=()=>{if(options.signal?.aborted)throw new DOMException('已取消','AbortError');};
  cancelled();
  if(options.action==='enhancing')throw new Error('本版不含強化投資');
  const {data,action}=options;
  const hoursPerDay=Number.isFinite(options.hoursPerDay)?Math.max(.5,Math.min(24,options.hoursPerDay)):24;
  const now=options.now??Date.now();
  const snapshots=[...new Map(options.snapshots.filter(s=>s.timestamp<=now).map(s=>[s.timestamp,s])).values()].sort((a,b)=>a.timestamp-b.timestamp);
  const latest=snapshots.at(-1);const fresh=!!latest&&now-latest.timestamp<=3*3600000;
  const prices=createStrategyPriceBook(latest??{timestamp:0,quotes:{}},data);
  const base=structuredClone(enrichProfileWithBestLoadout(options.profile,data));
  base.loadoutMode='manual'; // Freeze all other equipment; never mutate real profile/ownership.
  const warnings=['比較單件換裝，不可把各列增益相加；購買後應重新評估。','只比較所選技能及同技能多步；未計跨技能流程、練級收益或舊裝轉售。'];
  warnings.push(base.teaMode==='manual'||base.actions[action].teaMode==='manual'?'兩邊皆使用快照指定的茶飲。':'兩邊皆依同一自動配茶政策重算。');
  if(latest)warnings.push(`行情時間：${new Date(latest.timestamp).toLocaleString()}`);
  if(!fresh)warnings.push('市場行情不足或超過3H，收益比較暫停；裝備目標仍保留。');
  const rows:UpgradeRow[]=[];
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
    for(const enhancementLevel of GRADES){
      if(current?.itemHrid===itemHrid&&current.enhancementLevel===enhancementLevel)continue;
      const owned=isItemOwnedByPlayer(itemHrid,base)&&base.inventoryMap[itemHrid]===enhancementLevel;
      const ask=prices.ask(itemHrid,enhancementLevel);
      rows.push({itemHrid,enhancementLevel,slot,owned,price:owned?0:ask!==null&&ask>0?ask:null,...gate,
        after:null,delta:null,paybackDays:null,priority:'待評估'});
    }
  }
  const cache=new Map<string,UpgradeEvaluation|null>();
  const evaluate=(profile:PlayerProfile):UpgradeEvaluation|null=>{
    if(!fresh)return null;
    const signature=JSON.stringify(actionBuffs(profile,action,data));
    if(cache.has(signature))return cache.get(signature)!;
    const candidates=(options.calculate??buildStrategyCandidates)({profile,data,prices,actions:[action]}).candidates;
    let best:UpgradeEvaluation|null=null,hasComparable=false;
    for(const candidate of candidates){
      const liquidity=evaluateRealizableStrategy(candidate,snapshots);
      const session=estimateStrategySession({candidate,liquidity,profile,plannedHours:hoursPerDay,latestSnapshotAgeMs:now-latest!.timestamp});
      if(liquidity.safeHoursPerDay!==null&&liquidity.safeHoursPerDay>0&&!['market-unavailable','no-ask','no-bid','price-anomaly','insufficient-primary-data','insufficient-input-data'].includes(liquidity.riskCode))hasComparable=true;
      if(session.rankValue!==null&&(!best||session.rankValue>best.profit))best={profit:session.rankValue,route:[...candidate.path],theoreticalProfit:candidate.profitPerHour*hoursPerDay};
    }
    if(!best&&hasComparable)best={profit:0,route:[],theoreticalProfit:0};
    cache.set(signature,best);return best;
  };
  const baseline=evaluate(base);
  for(let i=0;i<rows.length;i++){
    cancelled();const row=rows[i]!;
    if(row.eligibility!=='unmet'&&baseline!==null){
      const scenario=structuredClone(base);
      putEquipment(scenario,action,row.slot,{itemHrid:row.itemHrid,enhancementLevel:row.enhancementLevel});
      row.after=evaluate(scenario);
      if(row.after){row.delta=row.after.profit-baseline.profit;if(Math.abs(row.delta)<1e-6)row.delta=0;}
      if(row.delta!==null&&row.delta>0&&row.price!==null)row.paybackDays=row.price/row.delta;
    }
    options.onProgress?.({done:i+1,total:rows.length});
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  cancelled();
  const higherOwned=(row:UpgradeRow)=>isItemOwnedByPlayer(row.itemHrid,base)&&(base.inventoryMap[row.itemHrid]??-1)>row.enhancementLevel;
  const comparable=rows.filter(r=>r.eligibility==='met'&&r.price!==null&&(r.delta??0)>0&&!higherOwned(r));
  const largest=Math.max(0,...comparable.map(r=>r.delta!));
  const fastest=Math.min(Infinity,...comparable.filter(r=>!r.owned).map(r=>r.paybackDays!));
  for(const row of rows){
    row.priority=row.eligibility==='unmet'?'需達標':row.eligibility==='unknown'?'門檻待確認':row.delta===null?'行情待確認'
      :higherOwned(row)?'已有更高強化':row.delta<=0?'無提升':row.owned?'已持有，可換上':row.price===null?'待報價'
      :row.delta>=largest-.000001?'提升優先':row.paybackDays===fastest?'效率優先':'可考慮';
    const lower=rows.filter(r=>r.itemHrid===row.itemHrid&&r.enhancementLevel<row.enhancementLevel).sort((a,b)=>b.enhancementLevel-a.enhancementLevel)[0];
    if(lower){
      const extraCost=row.price!==null&&lower.price!==null&&!row.owned&&!lower.owned?row.price-lower.price:null;
      const extraGain=row.delta!==null&&lower.delta!==null?row.delta-lower.delta:null;
      row.marginal={lowerEnhancement:lower.enhancementLevel,extraCost,extraGain,paybackDays:extraCost!==null&&extraCost>=0&&extraGain!==null&&extraGain>0?extraCost/extraGain:null};
    }
  }
  rows.sort((a,b)=>(b.delta??-Infinity)-(a.delta??-Infinity)||(a.price??Infinity)-(b.price??Infinity)||a.itemHrid.localeCompare(b.itemHrid)||a.enhancementLevel-b.enhancementLevel);
  return {action,hoursPerDay,baseline,rows,testedVariants:rows.length,warnings};
}
