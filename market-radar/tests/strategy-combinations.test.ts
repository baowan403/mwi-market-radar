import {describe,it,expect} from 'vitest';
import {discoverCombinations,prepareCombinationStep} from '../src/strategy/combinations';
import type {StrategyStepResult} from '../src/strategy/types';
import {repriceFixedCandidate} from '../src/strategy/margin-series';
import {externalStrategyFlows} from '../src/strategy/realizable';
const flow=(itemHrid:string,unitsPerHour:number,unitPrice:number|null)=>({itemHrid,unitsPerHour,unitPrice,enhancementLevel:0,market:true});
const step=(id:string,input:string,output:string,action='alchemy'):StrategyStepResult=>({id,action:action as never,actionHrid:`/actions/${action}/${id}`,outputHrid:output,valid:false,actionsPerHour:1,costPerHour:null,incomePerHour:null,profitPerHour:null,experiencePerHour:0,inputs:[flow(input,1,10)],outputs:[flow(output,1,100)]});
const data={itemsByHrid:new Map()} as never,prices={} as never;
describe('cross-skill combination discovery',()=>{
  it('consumes crafted nontradable intermediates without inventing a market price or liquidity demand',()=>{
    const a=step('badge','/items/a','/items/badge','crafting');a.outputs=[];
    a.ledger={physical:{outputUnitsPerHour:{'/items/badge':1},rareAndEssenceUnitsPerHour:{}}} as never;
    const b=step('decompose','/items/badge','/items/essence');b.inputs[0]!.unitPrice=null;
    const d={itemsByHrid:new Map([['/items/badge',{isTradable:false,categoryHrid:'/item_categories/equipment'}]]),openableLootDropMap:{}} as never;
    const r=discoverCombinations([a,b],d,{bid:()=>null} as never)[0]!;
    expect(r).toBeDefined();expect(r.profitPerHour).toBeCloseTo((100*.95-10)/2);
    expect(externalStrategyFlows(r).some(f=>f.flow.itemHrid==='/items/badge')).toBe(false);
  });
  it('recovers physical intermediate quantities without fabricating their absent selling price',()=>{
    const a=step('make','/items/a','/items/b','crafting');a.outputs=[];
    a.ledger={physical:{outputUnitsPerHour:{'/items/b':2},rareAndEssenceUnitsPerHour:{}},economic:{}} as never;
    const d={itemsByHrid:new Map([['/items/b',{isTradable:true}]]),openableLootDropMap:{}} as never;
    expect(prepareCombinationStep(a,d,{bid:()=>null} as never)?.outputs).toEqual([flow('/items/b',2,null)]);
  });
  it('finds a losing manufacturing action followed by profitable alchemy with no intermediate quotes',()=>{
    const a=step('manufacture','/items/a','/items/b','crafting'),b=step('decompose','/items/b','/items/c'),c=step('coinify','/items/c','/items/d');
    a.outputs[0]!.unitPrice=null;b.inputs[0]!.unitPrice=null;b.outputs[0]!.unitPrice=null;c.inputs[0]!.unitPrice=null;
    const results=discoverCombinations([a,b,c],data,prices);
    const result=results.find(r=>r.steps.length===3)!;
    expect(result).toBeDefined();expect(result.profitPerHour).toBeCloseTo((100*.95-10)/3);
    expect(result.steps.reduce((sum,s)=>sum+(s as any).workFraction,0)).toBeCloseTo(1);
    const repriced=repriceFixedCandidate(result,{ask:h=>h==='/items/a'?10:null,bid:h=>h==='/items/d'?100:null,average:()=>null,volume:()=>null,timestamp:1});
    expect(repriced?.profitPerHour).toBeCloseTo(result.profitPerHour);
  });
  it('discovers co-product branches and preserves both terminal products',()=>{
    const a=step('split','/items/a','/items/b'),b=step('b','/items/b','/items/d'),c=step('c','/items/c','/items/e');
    a.outputs.push(flow('/items/c',1,5));
    const results=discoverCombinations([a,b,c],data,prices);
    const branch=results.find(r=>r.connections?.some(link=>link.from===0&&link.to===2));
    expect(branch?.primaryOutputHrids?.sort()).toEqual(['/items/d','/items/e']);
    expect(branch?.profitPerHour).toBeCloseTo((200*.95-10)/3);
    expect(results.every(r=>r.steps.length<=3)).toBe(true);
  });
});
