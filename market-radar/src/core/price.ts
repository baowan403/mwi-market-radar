import type { Quote } from './types';

export type PriceQuality = 'official' | 'midpoint' | 'ask-only' | 'bid-only' | 'missing';

export interface PriceBasis {
  value: number | null;
  quality: PriceQuality;
}

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function priceBasis(quote: Quote): PriceBasis {
  if (isValidPrice(quote.p)) {
    return { value: quote.p, quality: 'official' };
  }

  const ask = quote.a;
  const bid = quote.b;
  const hasAsk = isValidPrice(ask);
  const hasBid = isValidPrice(bid);

  if (hasAsk && hasBid) {
    return { value: (ask + bid) / 2, quality: 'midpoint' };
  }
  if (hasAsk) {
    return { value: ask, quality: 'ask-only' };
  }
  if (hasBid) {
    return { value: bid, quality: 'bid-only' };
  }
  return { value: null, quality: 'missing' };
}

export function spreadPct(quote: Quote): number | null {
  if (!isValidPrice(quote.a) || !isValidPrice(quote.b)) {
    return null;
  }

  const midpoint = (quote.a + quote.b) / 2;
  if (!Number.isFinite(midpoint) || midpoint <= 0) {
    return null;
  }

  return ((quote.a - quote.b) / midpoint) * 100;
}
