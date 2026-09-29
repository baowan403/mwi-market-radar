import {decodeCompressedJsonLimited,encodeCompressedJson} from '../core/storage-codec';
import type {StrategyCandidateResult} from './candidates';
import type {NormalizedStrategyGameData} from './game-data';

const CACHE_NAME='mwi-radar-strategy-result-v1';
const MAX_DECODED_BYTES=128*1024*1024;

export interface StrategyResultCache {
  get(key:string):Promise<StrategyCandidateResult|null>;
  set(key:string,result:StrategyCandidateResult):Promise<void>;
}

function hashText(value:string):string {
  let first=0x811c9dc5,second=0x9e3779b9;
  for(let index=0;index<value.length;index+=1){
    const code=value.charCodeAt(index);
    first=Math.imul(first^code,0x01000193)>>>0;
    second=Math.imul(second^code,0x85ebca6b)>>>0;
  }
  return `${first.toString(16).padStart(8,'0')}${second.toString(16).padStart(8,'0')}`;
}

export function strategyResultCacheKey(
  profileSignature:string,
  snapshotTimestamp:number,
  data:NormalizedStrategyGameData,
):string {
  return hashText(JSON.stringify([
    data.gameVersion,data.versionTimestamp,snapshotTimestamp,profileSignature,
  ]));
}

function validResult(value:unknown):value is StrategyCandidateResult {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const record=value as Record<string,unknown>;
  return Array.isArray(record.candidates)&&Array.isArray(record.diagnostics)
    &&record.candidates.every(candidate=>candidate!==null&&typeof candidate==='object'
      &&typeof (candidate as Record<string,unknown>).id==='string'
      &&Array.isArray((candidate as Record<string,unknown>).steps));
}

export function createMemoryStrategyResultCache():StrategyResultCache {
  let current:{key:string;result:StrategyCandidateResult}|null=null;
  return {
    async get(key){return current?.key===key?current.result:null;},
    async set(key,result){current={key,result};},
  };
}

export function createBrowserStrategyResultCache():StrategyResultCache|null {
  if(typeof globalThis.caches==='undefined'||typeof document==='undefined')return null;
  const requestFor=(key:string)=>new Request(new URL(`./.strategy-result/${key}`,document.baseURI));
  return {
    async get(key){
      try{
        const cache=await globalThis.caches.open(CACHE_NAME);
        const response=await cache.match(requestFor(key));
        if(!response)return null;
        const decoded=await decodeCompressedJsonLimited(await response.text(),MAX_DECODED_BYTES);
        return validResult(decoded)?decoded:null;
      }catch{return null;}
    },
    async set(key,result){
      try{
        const cache=await globalThis.caches.open(CACHE_NAME);
        const request=requestFor(key);
        const encoded=await encodeCompressedJson(result);
        for(const existing of await cache.keys())if(existing.url!==request.url)await cache.delete(existing);
        await cache.put(request,new Response(encoded,{headers:{'content-type':'text/plain;charset=utf-8'}}));
      }catch{/* Cache is an optimization; failures never block recommendations. */}
    },
  };
}

