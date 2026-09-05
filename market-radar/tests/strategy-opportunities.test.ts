import { describe, expect, it } from 'vitest';
import { analyzeOpportunities } from '../src/strategy/opportunities';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import dataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import type { StrategyCandidate } from '../src/strategy/candidates';
import type { Snapshot } from '../src/core/types';
import type { PlayerProfile } from '../src/profile/types';
const H = 3600000;
const data = normalizeStrategyGameData(dataJson);
const profile = { id: 'test', materialInventoryMap: {} } as unknown as PlayerProfile;
function candidate(id: string): StrategyCandidate {
  return { id, title:id, kind:'manufacture', path:[`/items/in_${id}`,`/items/out_${id}`],
    profitPerHour:180,profitPerDay:4320,costPerHour:10,incomePerHour:190,workingCapital24h:240,verificationStatus:'unverified',
    steps:[{id,action:'crafting',actionHrid:id,outputHrid:`/items/out_${id}`,valid:true,actionsPerHour:1,experiencePerHour:1,
      costPerHour:10,incomePerHour:190,profitPerHour:180,
      inputs:[{itemHrid:`/items/in_${id}`,enhancementLevel:0,unitsPerHour:1,unitPrice:10,market:true}],
      outputs:[{itemHrid:`/items/out_${id}`,enhancementLevel:0,unitsPerHour:1,unitPrice:200,market:true}]}] };
}
function history(costFalling=false, baselineFaster=false): Snapshot[] {
  return Array.from({length:49},(_,i)=>({timestamp:i*H,quotes:{
    '/items/in_a::0':{a:10,b:9,p:10,v:1000}, '/items/out_a::0':{a:201,b:baselineFaster?140+i*1.25:200,p:200,v:1000},
    '/items/in_b::0':{a:costFalling?40-i*.625:10,b:9,p:10,v:1000},
    '/items/out_b::0':{a:199,b:costFalling?198:159.6+i*.8,p:198,v:1000},
  }}));
}
function analyze(snapshots=history(),budget:number|null=100000) {
  return analyzeOpportunities({candidates:[candidate('a'),candidate('b')],snapshots,data,profile,plannedHours:24,budget,now:48*H});
}
describe('opportunity observations',()=>{
  it('finds an improving challenger and limits preparation by duration and budget',()=>{
    const r=analyze(); expect(r.baseline?.candidate.id).toBe('a'); expect(r.opportunities).toHaveLength(1);
    const b=r.opportunities[0]!; expect(b.action).toBe('prepare'); expect(b.metrics.gapClosing6h).toBeGreaterThan(0);
    expect(b.preparation!.hours).toBeLessThanOrEqual(2); expect(b.preparation!.cash).toBeLessThanOrEqual(10000);
    expect(b.preparation!.items.every(x=>Number.isInteger(x.units))).toBe(true);
  });
  it('does not urge stocking up when cheaper inputs drive improving profit',()=>{
    const b=analyze(history(true)).opportunities[0]!;
    expect(b.action).toBe('watch'); expect(b.preparation).toBeNull(); expect(b.reasons.join('')).toContain('下跌');
  });
  it('requires an explicit affordable budget for preparation',()=>{
    expect(analyze(history(),null).opportunities[0]?.action).toBe('watch');
    expect(analyze(history(),1).opportunities[0]?.preparation).toBeNull();
  });
  it('does not recommend stocking when market volume is shrinking despite a low current share',()=>{
    const snapshots=history();
    for(const s of snapshots)if(s.timestamp>24*H)s.quotes['/items/out_b::0']!.v=100;
    const b=analyze(snapshots).opportunities[0]!;
    expect(b.action).toBe('watch'); expect(b.metrics.outputVolumeChangePct).toBeLessThan(-20);
    expect(b.reasons.join('')).toContain('成交量');
  });
  it('checks volume contraction of inputs other than the current bottleneck',()=>{
    const snapshots=history(); const b=candidate('b');
    b.steps[0]!.inputs.push({itemHrid:'/items/extra',enhancementLevel:0,unitsPerHour:.1,unitPrice:10,market:true});
    for(const s of snapshots)s.quotes['/items/extra::0']={a:10,b:9,p:10,v:s.timestamp>24*H?10000:100000};
    const item=analyzeOpportunities({candidates:[candidate('a'),b],snapshots,data,profile,plannedHours:24,budget:100000,now:48*H}).opportunities[0]!;
    expect(item.action).toBe('watch');expect(item.metrics.inputVolumeChangePct).toBe(-90);
  });
  it('does not mistake rising profit for catching a faster improving baseline',()=>{
    expect(analyze(history(false,true)).opportunities).toHaveLength(0);
  });
  it('never uses future prices to select opportunities',()=>{
    const base=history(); const future=structuredClone(base.at(-1)!); future.timestamp=60*H;
    future.quotes['/items/out_b::0']!.b=10000;
    expect(analyze([...base,future])).toEqual(analyze(base));
  });
  it('compares both strategies at the same historical endpoint when one quote is missing',()=>{
    const snapshots=history();delete snapshots[42]!.quotes['/items/out_a::0'];
    expect(analyze(snapshots).opportunities[0]!.metrics.gapClosing6h).toBeCloseTo(5.6*.95*24);
  });
  it('suppresses stale data and tolerates missing history without a fake recommendation',()=>{
    expect(analyzeOpportunities({candidates:[candidate('a'),candidate('b')],snapshots:history(),data,profile,plannedHours:24,budget:100000,now:52*H}).opportunities).toHaveLength(0);
    expect(analyze(history().slice(-3)).opportunities).toHaveLength(0);
  });
  it('deduplicates equivalent routes instead of filling cards with catalyst variants',()=>{
    const b=candidate('b'); const copy={...b,id:'variant'};
    const r=analyzeOpportunities({candidates:[candidate('a'),b,copy],snapshots:history(),data,profile,plannedHours:24,budget:100000,now:48*H});
    expect(r.opportunities).toHaveLength(1);
  });
  it('shows at most three different opportunities',()=>{
    const snapshots=history();const candidates=[candidate('a')];
    for(let i=1;i<=4;i++){
      const id=`b${i}`;candidates.push(candidate(id));
      for(const s of snapshots){s.quotes[`/items/in_${id}::0`]={...s.quotes['/items/in_b::0']!};
        s.quotes[`/items/out_${id}::0`]={...s.quotes['/items/out_b::0']!,b:s.quotes['/items/out_b::0']!.b!+i*.1};}
    }
    expect(analyzeOpportunities({candidates,snapshots,data,profile,plannedHours:24,budget:100000,now:48*H}).opportunities).toHaveLength(3);
  });
});
