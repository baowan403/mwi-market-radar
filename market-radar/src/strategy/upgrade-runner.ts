import {analyzeUpgradeTargets,type UpgradeAnalysis,type UpgradeProgress} from './upgrades';
type Options=Parameters<typeof analyzeUpgradeTargets>[0];
export type UpgradeWorkerRequest=Pick<Options,'profile'|'data'|'snapshots'|'action'|'hoursPerDay'|'now'>;
export type UpgradeWorkerReply={type:'progress';progress:UpgradeProgress}|{type:'result';result:UpgradeAnalysis}|{type:'error'};
interface WorkerPort {
  postMessage(value:UpgradeWorkerRequest):void; terminate():void;
  onmessage:((event:MessageEvent<UpgradeWorkerReply>)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
}
export function runUpgradeAnalysis(options:Options,createWorker?:()=>WorkerPort):Promise<UpgradeAnalysis>{
  if(options.signal?.aborted)return Promise.reject(new DOMException('已取消','AbortError'));
  if(options.calculate||(!createWorker&&typeof Worker==='undefined'))return analyzeUpgradeTargets(options);
  return new Promise((resolve,reject)=>{
    let worker:WorkerPort;
    try{worker=createWorker?createWorker():new Worker(new URL('./upgrade-worker.ts',import.meta.url),{type:'module'});}
    catch(error){reject(error);return;}
    let settled=false;
    const finish=(error:unknown,result?:UpgradeAnalysis)=>{
      if(settled)return;settled=true;options.signal?.removeEventListener('abort',abort);
      worker.onmessage=null;worker.onerror=null;worker.terminate();
      if(error)reject(error);else resolve(result!);
    };
    const abort=()=>finish(new DOMException('已取消','AbortError'));
    options.signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{
      if(event.data.type==='progress')options.onProgress?.(event.data.progress);
      else if(event.data.type==='result')finish(null,event.data.result);
      else finish(new Error('升級分析失敗'));
    };
    worker.onerror=()=>finish(new Error('背景升級分析失敗'));
    try{worker.postMessage({profile:options.profile,data:options.data,snapshots:options.snapshots,action:options.action,hoursPerDay:options.hoursPerDay,now:options.now});}
    catch(error){finish(error);}
  });
}
