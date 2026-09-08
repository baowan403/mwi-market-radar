import type {PlayerProfile,SkillingAction} from '../profile/types';
import type {StrategyCandidate} from './candidates';
import type {NormalizedStrategyGameData} from './game-data';
import type {MarketPriceBook} from './price-book';
import {calculateManufactureAction,calculateGatherAction} from './manufacture-adapter';
import {calculateDecompose,calculateCoinify,type CatalystRank} from './alchemy';
import {calculateTransmute} from './transmute';
import {findOptimalTeasForAlchemy,createTeaBuffLookup} from './tea-optimizer';
import {isTeaManual} from './optimal-loadout';
import {calculateWorkflow,calculateConnectedWorkflow} from './workflow';

export const candidateExperience=(candidate:StrategyCandidate,action:SkillingAction):number=>
  candidate.steps.filter(s=>s.action===action).reduce((sum,s)=>sum+s.experiencePerHour,0);

/** Recompute a fixed reference path, never regenerate a whole candidate pool. */
export function recalculateUpgradeReference(template:StrategyCandidate,profile:PlayerProfile,data:NormalizedStrategyGameData,prices:MarketPriceBook):StrategyCandidate|null {
  const teaBuffs=createTeaBuffLookup(profile,data);
  try{
    const steps=template.steps.map(step=>{
      if(step.action!=='alchemy')return ['milking','foraging','woodcutting'].includes(step.action)
        ? calculateGatherAction({actionHrid:step.actionHrid,profile,data,prices,teaBuffs})
        : calculateManufactureAction({actionHrid:step.actionHrid,profile,data,prices,teaBuffs});
      const itemHrid=step.inputs[0]!.itemHrid;
      const catalystRank=Number(step.id.match(/:c(\d+)$/)?.[1]??0) as CatalystRank;
      const enhancementLevel=Number(step.id.match(/:(\d+):c\d+$/)?.[1]??0);
      const kind=step.actionHrid.endsWith('/decompose')?'decompose':step.actionHrid.endsWith('/coinify')?'coinify':'transmute';
      const calculate=kind==='decompose'?calculateDecompose:kind==='coinify'?calculateCoinify:calculateTransmute;
      const opts={itemHrid,catalystRank,enhancementLevel,profile,data,prices};
      let result=calculate(opts);
      if(!isTeaManual(profile,'alchemy')){
        const opt=findOptimalTeasForAlchemy({...opts,kind,calculateFn:calculate,teaBuffs});
        if(opt.profitPerHour!==null&&opt.profitPerHour>(result.profitPerHour??-Infinity)){
          const changed={...profile,actions:{...profile.actions,alchemy:{...profile.actions.alchemy,teas:opt.teas}}};
          result=calculate({...opts,profile:changed,buffs:opt.buffs});
        }
      }
      return result;
    });
    const result=steps.length===1?steps[0]!:template.connections?calculateConnectedWorkflow(steps,template.connections):calculateWorkflow(steps);
    if(!result.valid||result.profitPerHour===null||result.incomePerHour===null||result.costPerHour===null)return null;
    return {...template,steps:'steps' in result?result.steps:steps,profitPerHour:result.profitPerHour,profitPerDay:result.profitPerHour*24,
      incomePerHour:result.incomePerHour,costPerHour:result.costPerHour,workingCapital24h:result.costPerHour*24};
  }catch{return null;}
}
