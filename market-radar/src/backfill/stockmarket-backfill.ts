import type { MarketKey, Quote, Snapshot } from '../core/types';
import type { StockmarketHistoryPoint } from './stockmarket-schema';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const SAFE_ITEM_NAME = /^[a-z0-9_]+$/;

export interface BackfillGates {
  minimumHours: number;
  minimumQuotes: number;
}

function fail(message: string): never {
  throw new Error(`Stockmarket backfill ${message}`);
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validGates(gates: BackfillGates): void {
  if (!gates || !Number.isSafeInteger(gates.minimumHours) || gates.minimumHours <= 0
    || !Number.isSafeInteger(gates.minimumQuotes) || gates.minimumQuotes <= 0) {
    fail('gates must be positive safe integers');
  }
}

function cloneQuote(quote: Quote): Quote {
  return { a: quote.a, b: quote.b, p: quote.p, v: quote.v };
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  const quotes: Record<MarketKey, Quote> = {};
  for (const key of Object.keys(snapshot.quotes).sort()) quotes[key as MarketKey] = cloneQuote(snapshot.quotes[key as MarketKey] as Quote);
  return { timestamp: snapshot.timestamp, quotes };
}

export function buildBackfillSnapshots(
  rowsByItem: ReadonlyMap<string, readonly StockmarketHistoryPoint[]>,
  latestOfficialTimestamp: number,
  gates: BackfillGates = { minimumHours: 150, minimumQuotes: 1_000 },
): Snapshot[] {
  if (!validTimestamp(latestOfficialTimestamp)) fail('latest official timestamp is invalid');
  validGates(gates);
  const cutoff = latestOfficialTimestamp - SEVEN_DAYS_MS;
  const byTimestamp = new Map<number, Map<MarketKey, Quote>>();

  for (const [mapItem, rows] of [...rowsByItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!SAFE_ITEM_NAME.test(mapItem)) fail('item name is invalid');
    for (const row of rows) {
      if (row.itemName !== mapItem || !SAFE_ITEM_NAME.test(row.itemName)) fail('item name mismatch');
      if (!validTimestamp(row.timestamp)) fail('row timestamp is invalid');
      if (!Number.isSafeInteger(row.level) || row.level < 0) fail('row level is invalid');
      if (row.timestamp > latestOfficialTimestamp) fail('history contains future data');
      if (row.timestamp < cutoff) continue;
      const key = `/items/${mapItem}::${row.level}` as MarketKey;
      const quotes = byTimestamp.get(row.timestamp) ?? new Map<MarketKey, Quote>();
      const incoming = cloneQuote(row);
      const existing = quotes.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(incoming)) fail('duplicate row conflict');
      if (!existing) quotes.set(key, incoming);
      byTimestamp.set(row.timestamp, quotes);
    }
  }

  const snapshots = [...byTimestamp.entries()].sort(([a], [b]) => a - b).map(([timestamp, quoteMap]) => {
    if (quoteMap.size < gates.minimumQuotes) fail(`requires at least ${gates.minimumQuotes} quotes per snapshot`);
    const quotes: Record<MarketKey, Quote> = {};
    for (const [key, quote] of [...quoteMap.entries()].sort(([a], [b]) => a.localeCompare(b))) quotes[key] = cloneQuote(quote);
    return { timestamp, quotes };
  });
  if (snapshots.length < gates.minimumHours) fail(`requires at least ${gates.minimumHours} hours`);
  return snapshots;
}

export interface OfficialOverlapResult {
  snapshots: Snapshot[];
  comparisons: number;
}

export function validateOfficialOverlap(imported: readonly Snapshot[], official: readonly Snapshot[]): OfficialOverlapResult {
  const officialByTimestamp = new Map<number, Snapshot>();
  for (const snapshot of official) {
    if (officialByTimestamp.has(snapshot.timestamp)) fail('official snapshots contain duplicate timestamp');
    officialByTimestamp.set(snapshot.timestamp, snapshot);
  }
  let comparisons = 0;
  const snapshots = imported.map((candidate) => {
    const authority = officialByTimestamp.get(candidate.timestamp);
    if (!authority) return cloneSnapshot(candidate);
    for (const [key, quote] of Object.entries(candidate.quotes)) {
      const expected = authority.quotes[key as MarketKey];
      if (!expected) continue;
      if (quote.a !== null && expected.a !== null) {
        comparisons += 1;
        if (quote.a !== expected.a) fail('overlap ask mismatch');
      }
      if (quote.b !== null && expected.b !== null) {
        comparisons += 1;
        if (quote.b !== expected.b) fail('overlap bid mismatch');
      }
    }
    return cloneSnapshot(authority);
  });
  return { snapshots: snapshots.sort((a, b) => a.timestamp - b.timestamp), comparisons };
}
