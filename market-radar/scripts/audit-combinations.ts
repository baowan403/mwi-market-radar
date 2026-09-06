import {readFileSync} from 'node:fs';
import {createCloudClient} from '../src/dashboard/cloud-client';
import {normalizeStrategyGameData} from '../src/strategy/game-data';
import {validatePlayerProfile} from '../src/profile/import';
import {buildStrategyCandidates} from '../src/strategy/candidates';
import {createStrategyPriceBook} from '../src/strategy/price-book';
import {createMarketCapacityLookup} from '../src/strategy/liquidity';
import {evaluateRealizableStrategy} from '../src/strategy/realizable';
import {estimateStrategySession} from '../src/strategy/session';
const profile=validatePlayerProfile(JSON.parse(readFileSync('tests/fixtures/jotaro99-profile.json','utf8')));
const data=normalizeStrategyGameData(JSON.parse(readFileSync('scripts/vendor/milkonomy/strategy-data.json','utf8')));
const market=await createCloudClient('https://baowan403.github.io/mwi-market-radar/data/').load();
const snapshots=market.snapshots,latest=snapshots.at(-1)!;
const prices=createStrategyPriceBook(latest,data),lookup=createMarketCapacityLookup(snapshots);
let originalIds=new Set<string>();
for(const includeCombinations of [false,true]){
  const started=performance.now();
  const result=buildStrategyCandidates({profile,data,prices,includeCombinations});
  if(!includeCombinations)originalIds=new Set(result.candidates.map(c=>c.id));
  const rows=result.candidates.map(c=>({c,session:estimateStrategySession({candidate:c,liquidity:evaluateRealizableStrategy(c,snapshots,lookup),profile,plannedHours:24,latestSnapshotAgeMs:Date.now()-latest.timestamp})}))
    .filter(r=>r.session.rankValue!==null).sort((a,b)=>b.session.rankValue!-a.session.rankValue!);
  console.log(JSON.stringify({fixture:'jotaro99-profile.json',market:new Date(latest.timestamp).toISOString(),includeCombinations,ms:performance.now()-started,candidates:result.candidates.length,
    newCombinations:result.candidates.filter(c=>c.connections&&!originalIds.has(c.id)).length,top:rows.slice(0,5).map(({c,session})=>({id:c.id,profit24h:session.rankValue,path:c.path})),
    bestNew:rows.filter(r=>r.c.connections&&!originalIds.has(r.c.id)).slice(0,3).map(({c,session})=>({id:c.id,profit24h:session.rankValue,path:c.path}))}));
}
