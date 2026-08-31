import { describe, expect, it } from 'vitest';
import { priceBasis, spreadPct } from '../src/core/price';

describe('price basis', () => {
  it('prefers a valid official price over both sides', () => {
    expect(priceBasis({ a: 110, b: 90, p: 105, v: 2 })).toEqual({
      value: 105,
      quality: 'official',
    });
  });

  it('falls back to the midpoint when official price is absent', () => {
    expect(priceBasis({ a: 110, b: 90, p: null, v: 2 })).toEqual({
      value: 100,
      quality: 'midpoint',
    });
  });

  it('keeps zero as a valid price and reports one-sided quotes', () => {
    expect(priceBasis({ a: 0, b: null, p: null, v: null })).toEqual({
      value: 0,
      quality: 'ask-only',
    });
    expect(priceBasis({ a: null, b: 0, p: null, v: null })).toEqual({
      value: 0,
      quality: 'bid-only',
    });
  });

  it('reports missing when all price fields are absent or invalid', () => {
    expect(priceBasis({ a: null, b: null, p: null, v: null })).toEqual({
      value: null,
      quality: 'missing',
    });
    expect(priceBasis({ a: -1, b: -1, p: -1, v: null })).toEqual({
      value: null,
      quality: 'missing',
    });
  });
});

describe('spread percentage', () => {
  it('calculates a signed spread from ask and bid', () => {
    expect(spreadPct({ a: 110, b: 90, p: null, v: 2 })).toBeCloseTo(20);
    expect(spreadPct({ a: 90, b: 110, p: null, v: 2 })).toBeCloseTo(-20);
  });

  it('returns null when either side is absent or midpoint is not positive', () => {
    expect(spreadPct({ a: 110, b: null, p: null, v: null })).toBeNull();
    expect(spreadPct({ a: null, b: 90, p: null, v: null })).toBeNull();
    expect(spreadPct({ a: 0, b: 0, p: null, v: null })).toBeNull();
  });
});
