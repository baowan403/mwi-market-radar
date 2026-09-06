import {buildStrategyCandidates,type StrategyCandidateResult} from './candidates';
import {createStrategyPriceBook} from './price-book';
import type {PlayerProfile} from '../profile/types';
import type {Snapshot} from '../core/types';
import type {NormalizedStrategyGameData} from './game-data';

export interface CandidateRequest {profile:PlayerProfile;data:NormalizedStrategyGameData;snapshot:Snapshot}
interface WorkerPort {
  postMessage(value:CandidateRequest):void; terminate():void;
  onmessage:((event:MessageEvent<{result?:StrategyCandidateResult;error?:boolean}>)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
}
export async function runCandidateScan(options:CandidateRequest & {signal?:AbortSignal},factory?:()=>WorkerPort):Promise<StrategyCandidateResult>{
  if(options.signal?.aborted)throw new DOMException('已取消','AbortError');
  if(!factory&&typeof Worker==='undefined')return buildStrategyCandidates({...options,prices:createStrategyPriceBook(options.snapshot,options.data)});
  return new Promise((resolve,reject)=>{
    const worker:WorkerPort=factory?factory():new Worker(new URL('./candidate-worker.ts',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(error:unknown,result?:StrategyCandidateResult)=>{
      if(settled)return;settled=true;
      options.signal?.removeEventListener('abort',abort);
      worker.onmessage=null;worker.onerror=null;worker.terminate();
      if(error)reject(error);else resolve(result!);
    };
    const abort=()=>finish(new DOMException('已取消','AbortError'));
    options.signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>event.data.result?finish(null,event.data.result):finish(new Error('策略計算失敗'));
    worker.onerror=()=>finish(new Error('策略背景計算失敗'));
    try{worker.postMessage({profile:options.profile,data:options.data,snapshot:options.snapshot});}
    catch(error){finish(error);}
  });
}
