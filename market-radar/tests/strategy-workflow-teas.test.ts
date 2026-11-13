import { describe, expect, it } from 'vitest';
import { bestTwoStepTeaWorkflow } from '../src/strategy/workflow-teas';
import { getLegalTeaCombinations } from '../src/strategy/tea-optimizer';
import { calculateWorkflow } from '../src/strategy/workflow';
import type { StrategyStepResult } from '../src/strategy/types';

function step(id:string,rate:number):StrategyStepResult {
 return {id,action:'alchemy',actionHrid:'/actions/alchemy/decompose',outputHrid:'/items/essence',valid:true,
 actionsPerHour:rate,costPerHour:rate*10,incomePerHour:rate*8,profitPerHour:-rate*2,experiencePerHour:rate,
 inputs:[{itemHrid:'/items/raw',enhancementLevel:0,unitsPerHour:rate,unitPrice:10,market:true}],
 outputs:[{itemHrid:'/items/essence',enhancementLevel:0,unitsPerHour:rate,unitPrice:8,market:true}]};
}
describe('whole-chain tea selection',()=>{
 it('matches exhaustive workflow accounting with tea costs, byproducts and bid/ask spread',()=>{
  const left=Array.from({length:7},(_,i)=>{const s=step(`a${i}`,5+i);s.inputs.push({itemHrid:'/items/tea',enhancementLevel:0,unitsPerHour:12,unitPrice:i+1,market:true});return s;});
  // Fixed quotes within a market snapshot; variants alter throughput and quantities only.
  left.forEach((s,i)=>{s.inputs[1]!.unitPrice=3;s.inputs[1]!.unitsPerHour=10+i*i;});
  const right=Array.from({length:9},(_,i)=>({...step(`b${i}`,4+i),outputHrid:'/items/coin',
   inputs:[{itemHrid:'/items/essence',enhancementLevel:0,unitsPerHour:4+i,unitPrice:9,market:true}],
   outputs:[{itemHrid:'/items/coin',enhancementLevel:0,unitsPerHour:100+i*9,unitPrice:1,market:false},
    {itemHrid:'/items/rare',enhancementLevel:0,unitsPerHour:i/10,unitPrice:17,market:true}]}));
  const exhaustive=left.flatMap(a=>right.map(b=>calculateWorkflow([a,b]))).sort((a,b)=>b.profitPerHour!-a.profitPerHour!)[0]!;
  const best=bestTwoStepTeaWorkflow(left,right,[{from:0,to:1,itemHrid:'/items/essence'}])!;
  expect(best.profitPerHour).toBeCloseTo(exhaustive.profitPerHour!,10);
  expect(best.steps.map(s=>s.id)).toEqual(exhaustive.steps.map(s=>s.id));
 });
 it('never proposes artisan tea for alchemy',()=>{
  expect(getLegalTeaCombinations('alchemy').flat()).not.toContain('/items/artisan_tea');
  expect(getLegalTeaCombinations('crafting').flat()).toContain('/items/artisan_tea');
 });
 it('chooses a faster loss-making first step when it improves whole-chain profit',()=>{
  const slow=step('slow',5),fast=step('fast',10);
  const coin:StrategyStepResult={...step('coin',10),outputHrid:'/items/coin',
   inputs:[{itemHrid:'/items/essence',enhancementLevel:0,unitsPerHour:10,unitPrice:9,market:true}],
   outputs:[{itemHrid:'/items/coin',enhancementLevel:0,unitsPerHour:200,unitPrice:1,market:false}]};
  expect(slow.profitPerHour!).toBeGreaterThan(fast.profitPerHour!);
  const best=bestTwoStepTeaWorkflow([slow,fast],[coin],[{from:0,to:1,itemHrid:'/items/essence'}])!;
  expect(best.steps[0]!.id).toBe('fast');
  expect(best.profitPerHour).toBe(50);
  expect(best.profitPerHour!).toBeGreaterThan(calculateWorkflow([slow,coin]).profitPerHour!);
  expect(best.inputs.some(f=>f.itemHrid==='/items/essence')).toBe(false);
  expect(best.outputs.some(f=>f.itemHrid==='/items/essence')).toBe(false);
 });
});

