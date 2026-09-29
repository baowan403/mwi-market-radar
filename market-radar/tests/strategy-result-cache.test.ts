import {describe,expect,it} from 'vitest';
import {createMemoryStrategyResultCache} from '../src/strategy/result-cache';

describe('strategy result cache',()=>{
  it('keeps only the latest completed result',async()=>{
    const cache=createMemoryStrategyResultCache();
    const first={candidates:[],diagnostics:['first']};
    const second={candidates:[],diagnostics:['second']};
    await cache.set('first',first);
    await cache.set('second',second);
    await expect(cache.get('first')).resolves.toBeNull();
    await expect(cache.get('second')).resolves.toEqual(second);
  });
});

