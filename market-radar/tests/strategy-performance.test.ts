import {describe,it,expect} from 'vitest';
import {marketCapacity,createMarketCapacityLookup,createMarketCapacityHistory} from '../src/strategy/liquidity';
import {createTeaBuffLookup,getLegalTeaCombinations} from '../src/strategy/tea-optimizer';
import {actionBuffs} from '../src/strategy/buffs';
import {normalizeStrategyGameData} from '../src/strategy/game-data';
import {importPlayerProfile} from '../src/profile/import';
import raw from '../scripts/vendor/milkonomy/strategy-data.json';
import exporter from './fixtures/profile-export-v1.json';
import type {Snapshot} from '../src/core/types';

describe('computation scoped performance caches',()=>{
  const key='/items/test::0' as const;
  const snapshots:Snapshot[]=Array.from({length:168},(_,i)=>({timestamp:i*3600000,quotes:{[key]:{a:100,b:90,p:95,v:1000+i}}}));
  it('reuses a market result and resets on a new scope without changing values',()=>{
    const lookup=createMarketCapacityLookup(snapshots);
    expect(lookup(key)).toEqual(marketCapacity(key,snapshots));
    expect(lookup(key)).toBe(lookup(key));
    const next=structuredClone(snapshots);next.at(-1)!.quotes[key]!.b=null;
    expect(createMarketCapacityLookup(next)(key).bidAvailable).toBe(false);
    expect(lookup(key).bidAvailable).toBe(true);
  });
  it('shares history prefixes but never includes future volume or prices',()=>{
    const at=createMarketCapacityHistory(snapshots);
    for(const index of [0,25,72,167]){
      expect(at(snapshots[index]!.timestamp)(key)).toEqual(marketCapacity(key,snapshots.slice(0,index+1)));
      expect(at(snapshots[index]!.timestamp)).toBe(at(snapshots[index]!.timestamp));
    }
  });
  it('reuses tea buffs across recipes but not across gear changes',()=>{
    const data=normalizeStrategyGameData(raw),profile=importPlayerProfile(JSON.stringify(exporter),0);
    const lookup=createTeaBuffLookup(profile,data);
    for(const teas of getLegalTeaCombinations('crafting')){
      const p=structuredClone(profile);p.actions.crafting.teas=teas;
      expect(lookup('crafting',teas)).toEqual(actionBuffs(p,'crafting',data));
      expect(lookup('crafting',teas)).toBe(lookup('crafting',[...teas]));
    }
    const next=structuredClone(profile);next.actions.crafting.playerLevel+=10;
    expect(createTeaBuffLookup(next,data)('crafting',[]).Level).toBe(lookup('crafting',[]).Level+10);
  });
});
