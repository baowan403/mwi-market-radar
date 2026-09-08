import {describe,it,expect} from 'vitest';
import raw from '../scripts/vendor/milkonomy/strategy-data.json';
import exporter from './fixtures/profile-export-v1.json';
import {normalizeStrategyGameData} from '../src/strategy/game-data';
import {importPlayerProfile} from '../src/profile/import';
import {buildStrategyCandidates} from '../src/strategy/candidates';
import {createStrategyPriceBook} from '../src/strategy/price-book';
import {recalculateUpgradeReference} from '../src/strategy/upgrade-evaluation';
import {enrichProfileWithBestLoadout} from '../src/strategy/optimal-loadout';

it('fixed-reference recomputation matches a complete rescan for the same recipe and gear',()=>{
  const data=normalizeStrategyGameData(raw);
  const profile=enrichProfileWithBestLoadout(importPlayerProfile(JSON.stringify(exporter),0),data);profile.loadoutMode='manual';profile.teaMode='manual';
  const prices=createStrategyPriceBook({timestamp:0,quotes:Object.fromEntries([...data.itemsByHrid.keys()].map(h=>[`${h}::0`,{a:200,b:180,p:190,v:100000}]))},data);
  const before=buildStrategyCandidates({profile,data,prices,actions:['crafting'],includeCombinations:false}).candidates;
  profile.actions.crafting.tool={itemHrid:'/items/celestial_chisel',enhancementLevel:10};
  const after=buildStrategyCandidates({profile,data,prices,actions:['crafting'],includeCombinations:false}).candidates;
  let checked=0;
  for(const ref of before.slice(0,5)){
    const expected=after.find(c=>c.id===ref.id);if(!expected)continue;
    const quick=recalculateUpgradeReference(ref,profile,data,prices)!;
    expect(quick.profitPerHour).toBeCloseTo(expected.profitPerHour,6);
    expect(quick.steps.map(s=>s.experiencePerHour)).toEqual(expected.steps.map(s=>s.experiencePerHour));checked++;
  }
  expect(checked).toBeGreaterThan(0);
});
