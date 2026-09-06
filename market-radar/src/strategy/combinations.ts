import type {StrategyCandidate} from './candidates';
import type {NormalizedStrategyGameData} from './game-data';
import type {MarketPriceBook} from './price-book';
import type {StrategyStepResult,StrategyFlow} from './types';
import {expandStrategyLiquidation} from './liquidation';
import {calculateConnectedWorkflow,type WorkflowConnection} from './workflow';

export function prepareCombinationStep(step:StrategyStepResult,data:NormalizedStrategyGameData,prices:MarketPriceBook):StrategyStepResult|null {
  const inputs=step.inputs.map(f=>data.itemsByHrid.get(f.itemHrid)?.isTradable===false?{...f,market:false}:f);
  if(step.valid||step.outputs.length>0)return {...step,inputs};
  const physical=step.ledger?.physical;if(!physical)return null;
  const quantities={...physical.outputUnitsPerHour};
  if(step.action==='alchemy')for(const [hrid,n] of Object.entries(physical.rareAndEssenceUnitsPerHour))quantities[hrid]=(quantities[hrid]??0)+n;
  const outputs:StrategyFlow[]=[];
  for(const [itemHrid,unitsPerHour] of Object.entries(quantities)){
    const item=data.itemsByHrid.get(itemHrid);
    if(item&&item.isTradable!==true&&item.categoryHrid!=='/item_categories/currency'&&!data.openableLootDropMap[itemHrid]){
      outputs.push({itemHrid,unitsPerHour,enhancementLevel:0,unitPrice:null,market:false});continue;
    }
    const result=expandStrategyLiquidation({itemHrid,unitsPerHour,data,prices,allowUnpricedFlows:true});
    if(!result.complete)return null;
    outputs.push(...result.flows);
  }
  return outputs.length?{...step,inputs,outputs}:null;
}

function mainOutputs(step:StrategyStepResult):string[]{
  const physical=step.ledger?.physical;
  return physical?.outputUnitsPerSuccess?Object.keys(physical.outputUnitsPerSuccess):step.outputs.map(f=>f.itemHrid);
}
function feedInputs(step:StrategyStepResult):string[]{
  if(step.action==='alchemy')return step.inputs[0]?[step.inputs[0].itemHrid]:[];
  const materials=step.ledger?.physical.inputUnitsPerHour;
  return step.inputs.filter(f=>f.itemHrid!=='/items/coin'&&f.unitsPerHour>0&&(materials?(materials[f.itemHrid]??0)>0:!f.itemHrid.endsWith('_tea'))).map(f=>f.itemHrid);
}

/** Budgeted two/three-action trees alongside legacy long chains; not a global optimum. */
export function discoverCombinations(source:readonly StrategyStepResult[],data:NormalizedStrategyGameData,prices:MarketPriceBook):StrategyCandidate[]{
  const steps=source.map(s=>prepareCombinationStep(s,data,prices)).filter((s):s is StrategyStepResult=>!!s);
  const byInput=new Map<string,StrategyStepResult[]>();
  for(const s of steps)for(const input of new Set(feedInputs(s))){const list=byInput.get(input)??[];list.push(s);byInput.set(input,list);}
  const results:StrategyCandidate[]=[];
  const seen=new Set<string>();
  let evaluated=0;
  let local:StrategyCandidate[]=[];
  function walk(path:StrategyStepResult[],connections:WorkflowConnection[]):void {
    if(path.length>1){
      if(evaluated++>=120)return;
      let workflow;
      try{workflow=calculateConnectedWorkflow(path,connections);}catch{return;}
      const legacy=path.every(s=>s.valid&&s.action!=='alchemy')&&connections.every(c=>c.from===c.to-1&&c.itemHrid===path[c.from]!.outputHrid);
      if(!legacy&&workflow.valid&&workflow.profitPerHour!==null&&workflow.profitPerHour>0&&!seen.has(workflow.id)){
        seen.add(workflow.id);
        const primarySet=new Set(path.flatMap(mainOutputs));
        const primaryOutputHrids=[...new Set(workflow.outputs.filter(f=>primarySet.has(f.itemHrid)).map(f=>f.itemHrid))];
        const first=feedInputs(path[0]!)[0];
        const itemPath=[...(first?[first]:[]),...path.map(s=>s.outputHrid),...connections.map(c=>c.itemHrid)];
        const legacyCoinify=path.length===2&&path[0]!.actionHrid.endsWith('/decompose')&&path[1]!.actionHrid.endsWith('/coinify')&&connections[0]!.itemHrid===path[0]!.outputHrid;
        local.push({id:legacyCoinify?`workflow:${path.map(s=>s.id).join('|')}`:workflow.id,kind:legacyCoinify?'decompose-coinify':'workflow',title:data.itemsByHrid.get(path.at(-1)!.outputHrid)?.name??path.at(-1)!.outputHrid,
          path:[...new Set(itemPath)],steps:workflow.steps,connections:[...connections],primaryOutputHrids,
          profitPerHour:workflow.profitPerHour,profitPerDay:workflow.profitPerHour*24,costPerHour:workflow.costPerHour!,incomePerHour:workflow.incomePerHour!,workingCapital24h:workflow.costPerHour!*24,verificationStatus:'unverified'});
        local.sort((a,b)=>b.profitPerHour-a.profitPerHour||a.workingCapital24h-b.workingCapital24h||a.id.localeCompare(b.id));
        if(local.length>8)local.length=8;
      }
    }
    if(path.length===3)return;
    for(let from=0;from<path.length;from++)for(const itemHrid of new Set(mainOutputs(path[from]!))){
      if(evaluated>=120)return;
      if(itemHrid==='/items/coin'||connections.some(c=>c.from===from&&c.itemHrid===itemHrid))continue;
      for(const next of byInput.get(itemHrid)??[]){
        if(path.some(s=>s.id===next.id))continue;
        // Canonical sibling ordering avoids visiting the same split twice.
        if(from===0&&path.length===2&&connections[0]?.from===0&&next.id<path[1]!.id)continue;
        walk([...path,next],[...connections,{from,to:path.length,itemHrid}]);
      }
    }
  }
  for(const root of steps){
    if(root.inputs.some(f=>f.unitsPerHour>0&&f.unitPrice===null))continue;
    evaluated=0;local=[];seen.clear();
    walk([root],[]);
    results.push(...local);
  }
  return results;
}
