import type { Quote } from './types';

export type PriceQuality = 'official' | 'midpoint' | 'ask-only' | 'bid-only' | 'missing';

export interface PriceBasis {
  value: number | null;
  quality: PriceQuality;
}

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function safeMidpoint(ask: number, bid: number): number | null {
  const midpoint = ask / 2 + bid / 2;
  return Number.isFinite(midpoint) ? midpoint : null;
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
    const midpoint = safeMidpoint(ask, bid);
    return midpoint === null
      ? { value: null, quality: 'missing' }
      : { value: midpoint, quality: 'midpoint' };
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

  const midpoint = safeMidpoint(quote.a, quote.b);
  if (midpoint === null || midpoint <= 0) {
    return null;
  }

  const difference = quote.a - quote.b;
  if (!Number.isFinite(difference)) {
    return null;
  }

  const spread = (difference / midpoint) * 100;
  return Number.isFinite(spread) ? spread : null;
}
