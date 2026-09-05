import {analyzeUpgradeTargets} from './upgrades';
import type {UpgradeWorkerRequest,UpgradeWorkerReply} from './upgrade-runner';
const scope=self as unknown as {onmessage:((event:MessageEvent<UpgradeWorkerRequest>)=>void)|null;postMessage(value:UpgradeWorkerReply):void};
scope.onmessage=event=>{void analyzeUpgradeTargets({...event.data,onProgress:progress=>scope.postMessage({type:'progress',progress})})
  .then(result=>scope.postMessage({type:'result',result}))
  .catch(()=>scope.postMessage({type:'error'}));};
