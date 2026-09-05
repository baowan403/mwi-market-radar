import {describe,it,expect,vi} from 'vitest';
import {runUpgradeAnalysis} from '../src/strategy/upgrade-runner';
const options={profile:{},data:{},snapshots:[],action:'alchemy',hoursPerDay:24} as unknown as Parameters<typeof runUpgradeAnalysis>[0];
function fake(){return {postMessage:vi.fn(),terminate:vi.fn(),onmessage:null as ((e:any)=>void)|null,onerror:null as ((e:any)=>void)|null};}
describe('background upgrade runner',()=>{
  it('sends serializable inputs, forwards progress and terminates on completion',async()=>{
    const w=fake(),progress=vi.fn();const result={rows:[],baseline:null};
    const promise=runUpgradeAnalysis({...options,onProgress:progress},()=>w);
    expect(w.postMessage.mock.calls[0]![0]).not.toHaveProperty('onProgress');
    w.onmessage!({data:{type:'progress',progress:{done:1,total:2}}});expect(progress).toHaveBeenCalledWith({done:1,total:2});
    w.onmessage!({data:{type:'result',result}});await expect(promise).resolves.toBe(result);expect(w.terminate).toHaveBeenCalledOnce();
  });
  it('terminates promptly when cancelled',async()=>{
    const w=fake(),controller=new AbortController();
    const promise=runUpgradeAnalysis({...options,signal:controller.signal},()=>w);
    controller.abort();await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(w.terminate).toHaveBeenCalledOnce();
  });
});
