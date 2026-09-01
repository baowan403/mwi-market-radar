import type { MarketKey, Quote, Snapshot } from '../core/types';
import type { StockmarketHistoryPoint } from './stockmarket-schema';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;
const SAFE_ITEM_NAME = /^[a-z0-9_]+$/;
const CANONICAL_KEY = /^\/items\/([a-z0-9_]+)::(0|[1-9]\d*)$/;
const compareStrings = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export interface BackfillGates {
  minimumHours: number;
  minimumQuotes: number;
}

function fail(message: string): never {
  throw new Error(`Stockmarket backfill ${message}`);
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DATE_TIMESTAMP;
}

function validQuote(value: unknown): value is Quote {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const quote = value as Record<string, unknown>;
  return ['a', 'b', 'p', 'v'].every((field) => {
    const fieldValue = quote[field];
    return fieldValue === null || (typeof fieldValue === 'number' && Number.isFinite(fieldValue) && fieldValue >= 0);
  });
}

function validateSnapshot(snapshot: Snapshot, label: string): void {
  if (!snapshot || typeof snapshot !== 'object' || !validTimestamp(snapshot.timestamp)) fail(`${label} timestamp is invalid`);
  if (!snapshot.quotes || typeof snapshot.quotes !== 'object' || Array.isArray(snapshot.quotes)
    || (Object.getPrototypeOf(snapshot.quotes) !== Object.prototype && Object.getPrototypeOf(snapshot.quotes) !== null)) {
    fail(`${label} quotes are invalid`);
  }
  for (const key of Object.keys(snapshot.quotes)) {
    const match = CANONICAL_KEY.exec(key);
    if (!match || !Number.isSafeInteger(Number(match[2]))) fail(`${label} key is invalid`);
    if (!validQuote(snapshot.quotes[key as MarketKey])) fail(`${label} quote is invalid`);
  }
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

  for (const [mapItem, rows] of [...rowsByItem.entries()].sort(([a], [b]) => compareStrings(a, b))) {
    if (!SAFE_ITEM_NAME.test(mapItem)) fail('item name is invalid');
    const copiedRows = [...rows].sort((left, right) => left.timestamp - right.timestamp || left.level - right.level);
    for (const row of copiedRows) {
      if (row.itemName !== mapItem || !SAFE_ITEM_NAME.test(row.itemName)) fail('item name mismatch');
      if (!validTimestamp(row.timestamp)) fail('row timestamp is invalid');
      if (!Number.isSafeInteger(row.level) || row.level < 0) fail('row level is invalid');
      for (const value of [row.a, row.b, row.p, row.v]) {
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('quote value is invalid');
      }
      if (row.timestamp > latestOfficialTimestamp) fail('history contains future data');
      if (row.timestamp < cutoff) continue;
      const key = `/items/${mapItem}::${row.level}` as MarketKey;
      const quotes = byTimestamp.get(row.timestamp) ?? new Map<MarketKey, Quote>();
      const incoming = cloneQuote(row);
      const existing = quotes.get(key);
      if (existing && (existing.a !== incoming.a || existing.b !== incoming.b || existing.p !== incoming.p || existing.v !== incoming.v)) fail('duplicate row conflict');
      if (!existing) quotes.set(key, incoming);
      byTimestamp.set(row.timestamp, quotes);
    }
  }

  const eligible = [...byTimestamp.entries()].sort(([a], [b]) => a - b);
  const buckets = new Set<number>();
  for (const [timestamp] of eligible) {
    const bucket = Math.floor(timestamp / HOUR_MS);
    if (buckets.has(bucket)) fail('multiple timestamps in the same UTC hour');
    buckets.add(bucket);
  }
  const retained = eligible.slice(-168);
  if (retained.length < gates.minimumHours || (retained.length > 0 && retained.at(-1)![0] - retained[0]![0] < (gates.minimumHours - 1) * HOUR_MS)) {
    fail(`requires at least ${gates.minimumHours} hours of hourly span`);
  }
  const snapshots = retained.map(([timestamp, quoteMap]) => {
    if (quoteMap.size < gates.minimumQuotes) fail(`requires at least ${gates.minimumQuotes} quotes per snapshot`);
    const quotes: Record<MarketKey, Quote> = {};
    for (const [key, quote] of [...quoteMap.entries()].sort(([a], [b]) => compareStrings(a, b))) quotes[key] = cloneQuote(quote);
    return { timestamp, quotes };
  });
  if (snapshots.length < gates.minimumHours) fail(`requires at least ${gates.minimumHours} hours`);
  return snapshots;
}

export interface OfficialOverlapResult {
  snapshots: Snapshot[];
  /** Counts each individual ask or bid field where timestamp+key overlap and both values are non-null. */
  comparisons: number;
}

export function validateOfficialOverlap(imported: readonly Snapshot[], official: readonly Snapshot[]): OfficialOverlapResult {
  const officialByTimestamp = new Map<number, Snapshot>();
  for (const snapshot of official) {
    validateSnapshot(snapshot, 'official snapshot');
    if (officialByTimestamp.has(snapshot.timestamp)) fail('official snapshots contain duplicate timestamp');
    officialByTimestamp.set(snapshot.timestamp, snapshot);
  }
  let comparisons = 0;
  const importedTimestamps = new Set<number>();
  const snapshots = imported.map((candidate) => {
    validateSnapshot(candidate, 'imported snapshot');
    if (importedTimestamps.has(candidate.timestamp)) fail('imported snapshots contain duplicate timestamp');
    importedTimestamps.add(candidate.timestamp);
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
