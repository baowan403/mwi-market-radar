import {describe,it,expect,vi} from 'vitest';
import {runCandidateScan} from '../src/strategy/candidate-runner';
const input={profile:{},data:{},snapshot:{timestamp:1,quotes:{}}} as unknown as Parameters<typeof runCandidateScan>[0];
const fake=()=>({postMessage:vi.fn(),terminate:vi.fn(),onmessage:null as ((e:any)=>void)|null,onerror:null as ((e:any)=>void)|null});
describe('candidate worker',()=>{
  it('returns the full candidate result and frees its worker',async()=>{
    const worker=fake(),result={candidates:[],diagnostics:['test']};
    const promise=runCandidateScan(input,()=>worker);
    expect(worker.postMessage).toHaveBeenCalledWith(input);
    worker.onmessage!({data:{result}});
    await expect(promise).resolves.toBe(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('cancels obsolete scans and does not send AbortSignal to the worker',async()=>{
    const worker=fake(),controller=new AbortController();
    const promise=runCandidateScan({...input,signal:controller.signal},()=>worker);
    expect(worker.postMessage.mock.calls[0]![0]).not.toHaveProperty('signal');
    controller.abort();
    await expect(promise).rejects.toMatchObject({name:'AbortError'});
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
