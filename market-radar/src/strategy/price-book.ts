import type { MarketKey, Snapshot } from '../core/types';

export interface MarketPriceBook {
  ask(hrid: string, level?: number): number | null;
  bid(hrid: string, level?: number): number | null;
  average(hrid: string, level?: number): number | null;
  volume(hrid: string, level?: number): number | null;
  timestamp: number;
}

function marketValue(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
}

export function createMarketPriceBook(snapshot: Snapshot): MarketPriceBook {
  const quote = (hrid: string, level = 0) => (
    snapshot.quotes[`${hrid}::${level}` as MarketKey]
  );

  return {
    timestamp: snapshot.timestamp,
    ask: (hrid, level = 0) => marketValue(quote(hrid, level)?.a),
    bid: (hrid, level = 0) => marketValue(quote(hrid, level)?.b),
    average: (hrid, level = 0) => marketValue(quote(hrid, level)?.p),
    volume: (hrid, level = 0) => marketValue(quote(hrid, level)?.v),
  };
}
