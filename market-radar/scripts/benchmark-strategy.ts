import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeStrategyGameData} from '../src/strategy/game-data';
import {importPlayerProfile} from '../src/profile/import';
import {buildStrategyCandidates} from '../src/strategy/candidates';
import {createStrategyPriceBook} from '../src/strategy/price-book';
import {buildStrategyMarginSeries,repriceFixedCandidate} from '../src/strategy/margin-series';
import {analyzeUpgradeTargets} from '../src/strategy/upgrades';
import type {Snapshot} from '../src/core/types';
import {createMarketCapacityHistory} from '../src/strategy/liquidity';

const data=normalizeStrategyGameData(JSON.parse(readFileSync('scripts/vendor/milkonomy/strategy-data.json','utf8')));
const profile=importPlayerProfile(readFileSync('tests/fixtures/profile-export-v1.json','utf8'),0);
const quotes=Object.fromEntries([...data.itemsByHrid.keys()].map(hrid=>[`${hrid}::0`,{a:200,b:180,p:190,v:1e7}]));
const snapshots:Snapshot[]=Array.from({length:168},(_,i)=>({timestamp:i*3600000,quotes}));
const prices=createStrategyPriceBook(snapshots.at(-1)!,data);
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,16);
let start=performance.now();
const candidates=buildStrategyCandidates({profile,data,prices}).candidates;
console.log(JSON.stringify({stage:'candidates',ms:performance.now()-start,count:candidates.length,hash:hash(candidates)}));
if(process.argv.includes('--scan-only'))process.exit(0);
start=performance.now();
const capacityAtSnapshot=createMarketCapacityHistory(snapshots);
const series=candidates.slice(0,12).map(candidate=>buildStrategyMarginSeries({strategyId:candidate.id,snapshots,
  capacityAtSnapshot,
  candidateAtSnapshot:s=>repriceFixedCandidate(candidate,createStrategyPriceBook(s,data))}));
console.log(JSON.stringify({stage:'history12',ms:performance.now()-start,hash:hash(series)}));
start=performance.now();
const upgrades=await analyzeUpgradeTargets({profile,data,snapshots,action:'crafting',hoursPerDay:24,now:snapshots.at(-1)!.timestamp});
const positive=upgrades.rows.filter(r=>r.eligibility!=='unmet'&&(r.delta??0)>0).map(({itemHrid,enhancementLevel,after,delta,price})=>({itemHrid,enhancementLevel,after,delta,price}));
console.log(JSON.stringify({stage:'upgrades',ms:performance.now()-start,count:upgrades.testedVariants,positive:positive.length,hash:hash(positive),baseline:upgrades.baseline}));
