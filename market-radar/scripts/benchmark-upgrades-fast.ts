import {readFileSync} from 'node:fs';
import {createCloudClient} from '../src/dashboard/cloud-client';
import {normalizeStrategyGameData} from '../src/strategy/game-data';
import {validatePlayerProfile} from '../src/profile/import';
import {analyzeUpgradeTargets} from '../src/strategy/upgrades';
const profile=validatePlayerProfile(JSON.parse(readFileSync('tests/fixtures/jotaro99-profile.json','utf8')));
const data=normalizeStrategyGameData(JSON.parse(readFileSync('scripts/vendor/milkonomy/strategy-data.json','utf8')));
const market=await createCloudClient('https://baowan403.github.io/mwi-market-radar/data/').load();
const now=market.snapshots.at(-1)!.timestamp;
for(const objective of ['profit','experience'] as const){
  const start=performance.now();
  const result=await analyzeUpgradeTargets({profile,data,snapshots:market.snapshots,action:'alchemy',hoursPerDay:24,now,objective});
  console.log(JSON.stringify({fixture:'jotaro99-profile.json',market:new Date(now).toISOString(),objective,elapsedMs:performance.now()-start,targets:result.testedVariants,positive:result.rows.filter(r=>r.after!==null).length,referenceCount:result.referenceCount,baseline:result.baseline,
    top:result.rows.slice(0,3).map(r=>({item:r.itemHrid,grade:r.enhancementLevel,gain:r.delta,xpGain:r.xpDelta,price:r.price}))}));
}
