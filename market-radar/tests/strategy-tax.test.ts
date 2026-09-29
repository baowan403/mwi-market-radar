import {describe,expect,it} from 'vitest';
import {marketTaxFactor,STANDARD_MARKET_TAX_RATE,STANDARD_SELL_TAX_FACTOR} from '../src/strategy/tax';

describe('current MWI market tax',()=>{
  it('uses the current four-percent sell tax while keeping coin exempt',()=>{
    expect(STANDARD_MARKET_TAX_RATE).toBe(0.04);
    expect(STANDARD_SELL_TAX_FACTOR).toBe(0.96);
    expect(marketTaxFactor('/items/example')).toBe(0.96);
    expect(marketTaxFactor('/items/coin')).toBe(1);
  });
});

