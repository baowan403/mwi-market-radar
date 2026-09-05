// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createOpportunityPanel } from '../src/strategy/opportunity-view';
import { createMemoryOpportunityJournal } from '../src/strategy/opportunity-journal';
import type { OpportunityAnalysis } from '../src/strategy/opportunities';
import type { PlayerProfile } from '../src/profile/types';
import type { StrategyCandidate } from '../src/strategy/candidates';
const c: StrategyCandidate={id:'c',title:'test',kind:'manufacture',path:['/items/a','/items/b'],profitPerHour:1,profitPerDay:24,costPerHour:1,incomePerHour:2,workingCapital24h:24,
  steps:[{id:'s',action:'crafting',actionHrid:'/actions/crafting/s',outputHrid:'/items/b',valid:true,actionsPerHour:1,experiencePerHour:1,costPerHour:1,incomePerHour:2,profitPerHour:1,
    inputs:[{itemHrid:'/items/a',enhancementLevel:0,unitsPerHour:1,unitPrice:1,market:true}],
    outputs:[{itemHrid:'/items/b',enhancementLevel:0,unitsPerHour:1,unitPrice:2,market:true}]}],verificationStatus:'unverified'};
const base={...c,id:'base'};
const metrics={profit6hPct:2,profit24hPct:5,cost6hPct:-1,cost24hPct:-2,income6hPct:0,income24hPct:0,gapClosing6h:1,gapClosing24h:2,inputVolumeChangePct:0,outputVolumeChangePct:0};
describe('opportunity observation panel',()=>{
  it('runs only on demand, labels watch vs preparation and records actual issue time',async()=>{
    const journal=createMemoryOpportunityJournal();
    let hours=24;
    const analysis={issuedAt:3600000,baseline:{candidate:base,session:{rankValue:24}},opportunities:[{
      candidate:c,session:{rankValue:23,plannedHours:24},action:'watch',metrics,preparation:null,reasons:['成本下跌，先觀察'],
      invalidation:{maxCostPerHour:2,minIncomePerHour:1},
    }],considered:2,reason:''} as unknown as OpportunityAnalysis;
    const analyze=vi.fn(()=>analysis);
    const panel=createOpportunityPanel({candidates:[c,base],snapshots:[],data:{} as never,
      profile:{id:'test'} as PlayerProfile,getHours:()=>hours,itemName:h=>h,journal,now:()=>7200000,analyze});
    document.body.append(panel.element);
    expect(analyze).not.toHaveBeenCalled();
    (panel.element.querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(()=>expect(panel.element.textContent).toContain('本機已記錄'));
    expect(panel.element.textContent).toContain('觀察');
    expect(panel.element.textContent).toContain('成本下跌');
    expect(panel.element.textContent).not.toContain('一定反超');
    const records=await journal.list('test');
    expect(records).toHaveLength(1);
    expect(records[0]!.issuedAt).toBe(7200000);
    hours=6; panel.invalidate();
    expect(panel.element.textContent).toContain('重新分析');
    panel.element.remove(); journal.close();
  });
  it('keeps result cards visible when browser storage fails',async()=>{
    const analysis={issuedAt:0,baseline:null,opportunities:[],considered:0,reason:'目前没有機會'} as OpportunityAnalysis;
    const panel=createOpportunityPanel({candidates:[],snapshots:[],data:{} as never,profile:{id:'test'} as PlayerProfile,
      getHours:()=>24,itemName:h=>h,now:()=>1000,analyze:()=>analysis,
      journal:{list:async()=>{throw Error('storage');},add:async()=>{},getOutcome:async()=>null,saveOutcome:async()=>{},close(){}}});
    (panel.element.querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(()=>expect(panel.element.textContent).toContain('未能保存'));
    expect(panel.element.textContent).toContain('目前没有機會');
  });
});
