import { describe,expect,it } from 'vitest';
import { analyzeUpgradeTargets } from '../src/strategy/upgrades';
import { importPlayerProfile } from '../src/profile/import';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { actionBuffs } from '../src/strategy/buffs';
import dataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import exporter from './fixtures/profile-export-v1.json';
import type { Snapshot } from '../src/core/types';
import type { buildStrategyCandidates } from '../src/strategy/candidates';
const data=normalizeStrategyGameData(dataJson);
const profile=()=>{const p=importPlayerProfile(JSON.stringify(exporter),0);p.loadoutMode='manual';return p;};
const history=(volume=1e9):Snapshot[]=>Array.from({length:48},(_,i)=>({timestamp:i*3600000,quotes:{
  '/items/in::0':{a:10,b:9,p:10,v:volume},'/items/out::0':{a:101,b:100,p:100,v:volume},
  '/items/celestial_alembic::5':{a:500000000,b:450000000,p:490000000,v:1},
  '/items/celestial_alembic::7':{a:800000000,b:700000000,p:790000000,v:1},
}}));
const calculate:typeof buildStrategyCandidates=({profile:p,actions})=>{
  const rate=100*(1+actionBuffs(p,'alchemy',data).Speed);
  return {diagnostics:[],candidates:[{id:'test',kind:'decompose',title:'test',path:['/items/in','/items/out'],profitPerHour:rate*85,profitPerDay:rate*85*24,costPerHour:rate*10,incomePerHour:rate*95,workingCapital24h:rate*10*24,verificationStatus:'unverified',steps:[{
    id:'s',action:actions?.[0]??'alchemy',actionHrid:'s',outputHrid:'/items/out',valid:true,actionsPerHour:rate,costPerHour:rate*10,incomePerHour:rate*95,profitPerHour:rate*85,experiencePerHour:rate,
    inputs:[{itemHrid:'/items/in',enhancementLevel:0,unitsPerHour:rate,unitPrice:10,market:true}],outputs:[{itemHrid:'/items/out',enhancementLevel:0,unitsPerHour:rate,unitPrice:100,market:true}],
  }]}]};
};
async function run(p=profile(),volume=1e9){return analyzeUpgradeTargets({profile:p,data,snapshots:history(volume),action:'alchemy',hoursPerDay:24,calculate,now:47*3600000});}
describe('upgrade goal board',()=>{
  it('retains unaffordable and unquoted targets without reading a wallet or mutating the profile',async()=>{
    const p=profile();const before=JSON.stringify(p);const r=await run(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(r.rows.find(x=>x.itemHrid==='/items/celestial_alembic'&&x.enhancementLevel===5)?.price).toBe(500000000);
    expect(r.rows.some(x=>x.price===null)).toBe(true);
    expect(r.rows.some(x=>x.itemHrid==='/items/alchemists_bottoms')).toBe(true);
    expect((await run({...p,cash:0} as typeof p)).rows).toEqual((await run({...p,cash:1e15} as typeof p)).rows);
  });
  it('does not treat missing prices as free and preserves known unmet equipment goals',async()=>{
    const p=profile();p.actions.alchemy.playerLevel=60;
    const r=await run(p);const goal=r.rows.find(x=>x.itemHrid==='/items/celestial_alembic'&&x.enhancementLevel===5)!;
    expect(goal.eligibility).toBe('unmet');expect(goal.after).toBeNull();expect(goal.price).toBe(500000000);
    expect(r.rows.filter(x=>x.price===null).every(x=>x.paybackDays===null)).toBe(true);
  });
  it('treats unknown total level as unknown, not as a false pass or a wallet failure',async()=>{
    const p=profile();delete p.specialEquipment.pouch;delete p.inventoryMap['/items/guzzling_pouch'];p.skillLevels={};
    const row=(await run(p)).rows.find(x=>x.itemHrid==='/items/guzzling_pouch'&&x.enhancementLevel===5)!;
    expect(row.eligibility).toBe('unknown');expect(row.priority).toBe('門檻待確認');
  });
  it('marks exactly-owned gear as a free equipment change, not a new purchase',async()=>{
    const p=profile();p.inventoryMap['/items/alchemists_top']=7;p.equipmentOwnership!['/items/alchemists_top']='owned';p.actions.alchemy.body=null;
    const row=(await run(p)).rows.find(x=>x.itemHrid==='/items/alchemists_top'&&x.enhancementLevel===7)!;
    expect(row.owned).toBe(true);expect(row.price).toBe(0);
  });
  it('does not invent income uplift from speed when market capacity already limits sales',async()=>{
    const r=await run(profile(),1000);
    const row=r.rows.find(x=>x.itemHrid==='/items/celestial_alembic'&&x.enhancementLevel===7)!;
    expect(Math.abs(row.delta!)).toBeLessThan(1e-6);
  });
  it('uses real recalculation, full purchase price for payback, and no automatic resale credit',async()=>{
    const r=await run(); const row=r.rows.find(x=>x.itemHrid==='/items/celestial_alembic'&&x.enhancementLevel===7)!;
    expect(row.delta).toBeGreaterThan(0);expect(row.delta).toBeCloseTo(row.after!.profit-r.baseline!.profit);
    expect(row.paybackDays).toBeCloseTo(800000000/row.delta!);
  });
  it('can cancel without returning a partial completed ranking',async()=>{
    const controller=new AbortController();controller.abort();
    await expect(analyzeUpgradeTargets({profile:profile(),data,snapshots:history(),action:'alchemy',hoursPerDay:24,calculate,signal:controller.signal})).rejects.toThrow();
  });
});
