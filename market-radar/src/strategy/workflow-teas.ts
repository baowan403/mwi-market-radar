import type { StrategyCandidate } from './candidates';
import type { PlayerProfile } from '../profile/types';
import type { NormalizedStrategyGameData } from './game-data';
import type { MarketPriceBook } from './price-book';
import type { StrategyStepResult } from './types';
import { calculateDecompose, calculateCoinify } from './alchemy';
import { calculateTransmute } from './transmute';
import { calculateManufactureAction, calculateGatherAction } from './manufacture-adapter';
import { calculateConnectedWorkflow, type WorkflowResult, type WorkflowConnection } from './workflow';
import { createTeaBuffLookup, getLegalTeaCombinations } from './tea-optimizer';
import { isTeaManual } from './optimal-loadout';
import { marketTaxFactor } from './tax';

/** Exhaustive tea choice for a discovered two-step route; no standalone-profit pruning. */
export function bestTwoStepTeaWorkflow(left: StrategyStepResult[], right: StrategyStepResult[], links: WorkflowConnection[]): WorkflowResult | null {
  const link = links[0];
  if (links.length !== 1 || link?.from !== 0 || link.to !== 1) return null;
  // Same net-flow arithmetic as workflow.ts, but no maps/ledger allocations per pair.
  const keys = [...new Set([...left,...right].flatMap(s=>[...s.inputs,...s.outputs].map(f=>`${f.itemHrid}::${f.enhancementLevel}`)))];
  const index = new Map(keys.map((k,i)=>[k,i]));
  const ask = Array(keys.length).fill(0), bid = Array(keys.length).fill(0);
  const prepare = (s:StrategyStepResult, output:boolean) => {
    const net = Array(keys.length).fill(0);
    for(const f of s.inputs){const i=index.get(`${f.itemHrid}::${f.enhancementLevel}`)!;net[i]-=f.unitsPerHour;ask[i]=f.unitPrice??NaN;}
    for(const f of s.outputs){const i=index.get(`${f.itemHrid}::${f.enhancementLevel}`)!;net[i]+=f.unitsPerHour;bid[i]=(f.unitPrice??NaN)*(f.market?marketTaxFactor(f.itemHrid):1);}
    return {s,net,rate:(output?s.outputs:s.inputs).filter(f=>f.itemHrid===link.itemHrid).reduce((n,f)=>n+f.unitsPerHour,0)};
  };
  const aa=left.map(s=>prepare(s,true)),bb=right.map(s=>prepare(s,false));
  let bestPair:StrategyStepResult[]|null=null,bestProfit=-Infinity;
  for(const a of aa)for(const b of bb){
    if(!(a.rate>0&&b.rate>0))continue;
    const total=a.rate+b.rate,fa=b.rate/total,fb=a.rate/total;
    let profit=0;
    for(let i=0;i<keys.length;i++){const n=a.net[i]*fa+b.net[i]*fb;profit+=Math.abs(n)<1e-10?0:n*(n>0?bid[i]:ask[i]);}
    if(Number.isFinite(profit)&&profit>bestProfit){bestProfit=profit;bestPair=[a.s,b.s];}
  }
  if(!bestPair)return null;
  try{return calculateConnectedWorkflow(bestPair,links);}catch{return null;}
}

export function createTwoStepTeaOptimizer(profile: PlayerProfile, data: NormalizedStrategyGameData, prices: MarketPriceBook) {
  const cache = new Map<string, StrategyStepResult[]>();
  const buffs = createTeaBuffLookup(profile,data);
  function variants(step: StrategyStepResult): StrategyStepResult[] {
    const cached = cache.get(step.id); if (cached) return cached;
    const action = step.action;
    const combos = isTeaManual(profile,action) ? [profile.actions[action].teas] : getLegalTeaCombinations(action);
    const result: StrategyStepResult[] = [];
    for (const teas of combos) {
      if (teas.some(t => (data.itemsByHrid.get(t) as any)?.consumableDetail?.usableInActionTypeMap?.[`/action_types/${action}`] !== true)) continue;
      const p: PlayerProfile = {...profile, teaMode:'manual', actions:{...profile.actions,[action]:{...profile.actions[action],teaMode:'manual',teas}}};
      try {
        let s: StrategyStepResult;
        if (action === 'alchemy') {
          const kind = step.actionHrid.split('/').at(-1);
          const fn = kind === 'decompose' ? calculateDecompose : kind === 'coinify' ? calculateCoinify : kind === 'transmute' ? calculateTransmute : null;
          if (!fn) continue;
          s = fn({itemHrid:step.inputs[0]!.itemHrid,catalystRank:Number(step.id.match(/:c([012])$/)?.[1] ?? 0) as 0|1|2,
            enhancementLevel:step.inputs[0]!.enhancementLevel,profile:p,data,prices,buffs:buffs(action,teas)});
        } else {
          const fn = ['milking','foraging','woodcutting'].includes(action) ? calculateGatherAction : calculateManufactureAction;
          s = fn({actionHrid:step.actionHrid,profile:p,data,prices,buffs:buffs(action,teas)});
        }
        if (s.valid) result.push(s);
      } catch { /* Tea may put a recipe below its level requirement. */ }
    }
    cache.set(step.id,result);return result;
  }
  return (candidate: StrategyCandidate): StrategyCandidate => {
    if (candidate.steps.length !== 2) return candidate;
    const [a,b] = candidate.steps;
    const links = candidate.connections ?? [{from:0,to:1,itemHrid:a!.outputHrid}];
    const best = bestTwoStepTeaWorkflow(variants(a!),variants(b!),links);
    if (!best) return candidate;
    return {...candidate,steps:best.steps,profitPerHour:best.profitPerHour!,profitPerDay:best.profitPerHour!*24,
      costPerHour:best.costPerHour!,incomePerHour:best.incomePerHour!,workingCapital24h:best.costPerHour!*24};
  };
}

