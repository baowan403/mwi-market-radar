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
  '/items/celestial_alembic::6':{a:600000000,b:500000000,p:590000000,v:1},
  '/items/alchemists_top::10':{a:100000000,b:90000000,p:99000000,v:1},
  '/items/alchemists_bottoms::10':{a:100000000,b:90000000,p:99000000,v:1},
  '/items/guzzling_pouch::5':{a:400000000,b:390000000,p:395000000,v:1},
  '/items/necklace_of_wisdom::0':{a:1000000,b:900000,p:950000,v:1},
}}));
const calculate:typeof buildStrategyCandidates=({profile:p,actions})=>{
  const buffs=actionBuffs(p,'alchemy',data);
  const rate=100*(1+buffs.Speed)*(1+buffs.Efficiency)*(1+buffs.Success)*(1+buffs.EssenceFind)*(1+buffs.drinkConcentration);
  return {diagnostics:[],candidates:[{id:'test',kind:'decompose',title:'test',path:['/items/in','/items/out'],profitPerHour:rate*85,profitPerDay:rate*85*24,costPerHour:rate*10,incomePerHour:rate*95,workingCapital24h:rate*10*24,verificationStatus:'unverified',steps:[{
    id:'s',action:actions?.[0]??'alchemy',actionHrid:'s',outputHrid:'/items/out',valid:true,actionsPerHour:rate,costPerHour:rate*10,incomePerHour:rate*95,profitPerHour:rate*85,experiencePerHour:rate*(1+buffs.Experience),
    inputs:[{itemHrid:'/items/in',enhancementLevel:0,unitsPerHour:rate,unitPrice:10,market:true}],outputs:[{itemHrid:'/items/out',enhancementLevel:0,unitsPerHour:rate,unitPrice:100,market:true}],
  }]}]};
};
async function run(p=profile(),volume=1e9){return analyzeUpgradeTargets({profile:p,data,snapshots:history(volume),action:'alchemy',hoursPerDay:24,calculate,now:47*3600000});}
describe('upgrade goal board',()=>{
  it('verifies only the shortlist and uses the verified baseline for every delta',async()=>{
    let fullCalls=0;
    const wrapped:typeof calculate=opts=>{if(!opts.actions)fullCalls++;return calculate(opts);};
    const r=await analyzeUpgradeTargets({profile:profile(),data,snapshots:history(),action:'alchemy',hoursPerDay:24,calculate:wrapped,now:47*3600000,precision:'verify'});
    expect(r.precision).toBe('verify');expect(r.rows.length).toBeLessThanOrEqual(6);
    expect(fullCalls).toBeGreaterThan(1);expect(fullCalls).toBeLessThanOrEqual(7);
    for(const row of r.rows)expect(row.delta).toBeCloseTo(row.after!.profit-r.baseline!.profit);
  });
  it('uses profitable references for XP comparison instead of high-loss XP farms',async()=>{
    const wrapped:typeof calculate=opts=>{const r=calculate(opts),c=r.candidates[0]!;return {...r,candidates:[c,{...c,id:'loss',path:['loss'],profitPerHour:-1e9,profitPerDay:-24e9,steps:c.steps.map(s=>({...s,experiencePerHour:1e9}))}]};};
    const r=await analyzeUpgradeTargets({profile:profile(),data,snapshots:history(),action:'alchemy',hoursPerDay:24,calculate:wrapped,now:47*3600000,objective:'experience'});
    expect(r.baseline!.profit).toBeGreaterThan(0);expect(r.baseline!.xpPerHour).toBeLessThan(1e9);
  });
  it('includes actual market +6 and keeps pure experience upgrades in XP mode',async()=>{
    const p=profile();delete p.specialEquipment.neck;
    const r=await analyzeUpgradeTargets({profile:p,data,snapshots:history(),action:'alchemy',hoursPerDay:24,calculate,now:47*3600000,objective:'experience'});
    expect(r.rows.some(row=>row.itemHrid==='/items/celestial_alembic'&&row.enhancementLevel===6)).toBe(true);
    const xp=r.rows.find(row=>row.itemHrid==='/items/necklace_of_wisdom')!;
    expect(xp.xpDelta).toBeGreaterThan(0);expect(xp.delta).toBe(0);expect(xp.paybackDays).toBeNull();
  });
  it('counts equipped speed necklace +3 in baseline and excludes owned lower grades',async()=>{
    const p=profile();p.specialEquipment.neck={itemHrid:'/items/necklace_of_speed',enhancementLevel:3};
    p.inventoryMap['/items/necklace_of_speed']=3;p.equipmentOwnership!['/items/necklace_of_speed']='owned';
    const noNeck=structuredClone(p);delete noNeck.specialEquipment.neck;
    const withNeck=await run(p),without=await run(noNeck);
    expect(withNeck.baseline!.profit).toBeGreaterThan(without.baseline!.profit);
    expect(withNeck.rows.some(r=>r.itemHrid==='/items/necklace_of_speed'&&r.enhancementLevel===0)).toBe(false);
  });
  it('never offers the exact equipped off-hand or body as a new income upgrade',async()=>{
    const p=profile();p.specialEquipment.off_hand={itemHrid:'/items/eye_watch',enhancementLevel:10};
    p.actions.alchemy.body={itemHrid:'/items/alchemists_top',enhancementLevel:7};
    p.inventoryMap['/items/eye_watch']=10;p.inventoryMap['/items/alchemists_top']=7;
    const r=await run(p);
    expect(r.rows.some(row=>row.itemHrid==='/items/eye_watch'&&row.enhancementLevel===10)).toBe(false);
    expect(r.rows.some(row=>row.itemHrid==='/items/alchemists_top'&&row.enhancementLevel===7)).toBe(false);
  });
  it('retains unaffordable and unquoted targets without reading a wallet or mutating the profile',async()=>{
    const p=profile();const before=JSON.stringify(p);const r=await run(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(r.rows.find(x=>x.itemHrid==='/items/celestial_alembic'&&x.enhancementLevel===5)?.price).toBe(500000000);
    expect(r.rows.some(x=>x.price===null)).toBe(true);
    expect(r.rows.some(x=>x.itemHrid==='/items/alchemists_bottoms')).toBe(true);
    expect((await run({...p,cash:0} as typeof p)).rows).toEqual((await run({...p,cash:1e15} as typeof p)).rows);
  });
  it('skips known unmet goals before evaluating and keeps unknown prices distinct from free',async()=>{
    const p=profile();p.actions.alchemy.playerLevel=60;
    const r=await run(p);
    expect(r.rows.some(x=>x.eligibility==='unmet')).toBe(false);
    expect(r.rows.some(x=>x.itemHrid==='/items/celestial_alembic')).toBe(false);
    expect(r.rows.filter(x=>x.price===null).every(x=>x.paybackDays===null)).toBe(true);
  });
  it('treats unknown total level as unknown, not as a false pass or a wallet failure',async()=>{
    const p=profile();delete p.specialEquipment.pouch;delete p.inventoryMap['/items/guzzling_pouch'];p.skillLevels={};
    const row=(await run(p)).rows.find(x=>x.itemHrid==='/items/guzzling_pouch'&&x.enhancementLevel===5)!;
    expect(row.eligibility).toBe('unknown');expect(row.priority).toBe('門檻待確認');
  });
  it('excludes owned grades and lower grades instead of offering a duplicate purchase',async()=>{
    const p=profile();p.inventoryMap['/items/alchemists_top']=7;p.equipmentOwnership!['/items/alchemists_top']='owned';p.actions.alchemy.body=null;
    const rows=(await run(p)).rows.filter(x=>x.itemHrid==='/items/alchemists_top');
    expect(rows.some(x=>x.enhancementLevel<=7)).toBe(false);
    expect(rows.some(x=>x.enhancementLevel===10)).toBe(true);
  });
  it('does not recommend buying a weaker grade when a better same-item grade is already owned',async()=>{
    const p=profile();p.inventoryMap['/items/celestial_alembic']=10;p.equipmentOwnership!['/items/celestial_alembic']='owned';
    const rows=(await run(p)).rows;
    expect(rows.some(r=>r.itemHrid==='/items/celestial_alembic'&&r.enhancementLevel<=10)).toBe(false);
  });
  it('does not invent income uplift from speed when market capacity already limits sales',async()=>{
    const r=await run(profile(),1000);
    expect(r.rows.some(x=>x.itemHrid==='/items/celestial_alembic'&&x.enhancementLevel===7)).toBe(false);
    expect(r.rows.every(x=>x.delta===null||x.delta>0)).toBe(true);
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
