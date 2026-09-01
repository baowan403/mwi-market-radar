import { priceBasis, type PriceQuality } from '../core/price';
import type { MarketKey, Quote, Snapshot } from '../core/types';

export interface DailyQuoteSummary {
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  a: number | null;
  b: number | null;
  v: number;
  samples: number;
  priceSamples: number;
  askSamples: number;
  bidSamples: number;
  quality: Record<PriceQuality, number>;
}

export interface DailyMarketSummary {
  schemaVersion: 1;
  date: string;
  timestamp: number;
  quotes: Partial<Record<MarketKey, DailyQuoteSummary>>;
}

function utcDate(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid daily summary date');
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function emptyQuality(): Record<PriceQuality, number> {
  return { official: 0, midpoint: 0, 'ask-only': 0, 'bid-only': 0, missing: 0 };
}

function emptyQuote(): DailyQuoteSummary {
  return {
    o: null, h: null, l: null, c: null, a: null, b: null, v: 0,
    samples: 0, priceSamples: 0, askSamples: 0, bidSamples: 0,
    quality: emptyQuality(),
  };
}

function updateQuote(current: DailyQuoteSummary, quote: Quote): DailyQuoteSummary {
  const next: DailyQuoteSummary = {
    ...current,
    quality: { ...current.quality },
    samples: current.samples + 1,
    a: validValue(quote.a) ? quote.a : null,
    b: validValue(quote.b) ? quote.b : null,
    v: current.v + (validValue(quote.v) ? quote.v : 0),
    askSamples: current.askSamples + (validValue(quote.a) ? 1 : 0),
    bidSamples: current.bidSamples + (validValue(quote.b) ? 1 : 0),
  };
  const basis = priceBasis(quote);
  next.quality[basis.quality] += 1;
  if (basis.value !== null) {
    next.o ??= basis.value;
    next.h = next.h === null ? basis.value : Math.max(next.h, basis.value);
    next.l = next.l === null ? basis.value : Math.min(next.l, basis.value);
    next.c = basis.value;
    next.priceSamples += 1;
  }
  return next;
}

function appendSnapshot(summary: DailyMarketSummary, snapshot: Snapshot): DailyMarketSummary {
  if (utcDate(snapshot.timestamp) !== summary.date) throw new Error('Snapshot belongs to a different UTC date');
  if (snapshot.timestamp < summary.timestamp) throw new Error('Daily summary snapshots must be chronological');
  const quotes: DailyMarketSummary['quotes'] = { ...summary.quotes };
  for (const [rawKey, quote] of Object.entries(snapshot.quotes)) {
    const key = rawKey as MarketKey;
    quotes[key] = updateQuote(quotes[key] ?? emptyQuote(), quote);
  }
  return { ...summary, timestamp: snapshot.timestamp, quotes };
}

export function aggregateDailySummary(snapshots: readonly Snapshot[]): DailyMarketSummary {
  const ordered = [...snapshots].sort((left, right) => left.timestamp - right.timestamp);
  const first = ordered[0];
  if (!first) throw new Error('Daily summary requires at least one snapshot');
  let summary: DailyMarketSummary = {
    schemaVersion: 1,
    date: utcDate(first.timestamp),
    timestamp: first.timestamp,
    quotes: {},
  };
  for (const snapshot of ordered) summary = appendSnapshot(summary, snapshot);
  return summary;
}

export function mergeDailySummary(summary: DailyMarketSummary, snapshot: Snapshot): DailyMarketSummary {
  return appendSnapshot(summary, snapshot);
}

export function dailySummaryToSnapshot(summary: DailyMarketSummary): Snapshot {
  const quotes: Snapshot['quotes'] = {};
  for (const [rawKey, value] of Object.entries(summary.quotes)) {
    if (!value) continue;
    quotes[rawKey as MarketKey] = {
      a: value.a,
      b: value.b,
      p: value.c,
      v: value.samples > 0 ? value.v / value.samples : null,
    };
  }
  return { timestamp: summary.timestamp, quotes };
}
