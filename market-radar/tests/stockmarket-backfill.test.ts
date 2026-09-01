import { describe, expect, it } from 'vitest';
import type { Quote, Snapshot } from '../src/core/types';
import type { StockmarketHistoryPoint } from '../src/backfill/stockmarket-schema';
import { buildBackfillSnapshots, validateOfficialOverlap } from '../src/backfill/stockmarket-backfill';

const HOUR = 3_600_000;
const latest = 1_000_000_000_000;
function row(itemName: string, level: number, timestamp: number, values: Partial<StockmarketHistoryPoint> = {}): StockmarketHistoryPoint {
  return { itemName, level, timestamp, a: 10, b: 9, p: 9.5, v: 2, ...values };
}
function makeRows(hours: number, quotes = 2, start = latest - (hours - 1) * HOUR): ReadonlyMap<string, readonly StockmarketHistoryPoint[]> {
  const rows: StockmarketHistoryPoint[] = [];
  for (let h = 0; h < hours; h += 1) for (let q = 0; q < quotes; q += 1) rows.push(row(`item_${String(q).padStart(4, '0')}`, 0, start + h * HOUR));
  return new Map([['item_0000', rows.filter((r) => r.itemName === 'item_0000')], ...Array.from({ length: quotes - 1 }, (_, q) => [`item_${String(q + 1).padStart(4, '0')}`, rows.filter((r) => r.itemName === `item_${String(q + 1).padStart(4, '0')}`)] as const)]);
}
function snapshot(timestamp: number, quote: Quote = { a: 10, b: 9, p: 8, v: 7 }): Snapshot {
  return { timestamp, quotes: { '/items/wood::0': quote } };
}

describe('stockmarket backfill aggregation', () => {
  it('aggregates unsorted item levels into sorted market keys at exact timestamps', () => {
    const result = buildBackfillSnapshots(new Map([
      ['zeta', [row('zeta', 2, latest), row('zeta', 1, latest)]],
      ['alpha', [row('alpha', 0, latest)]],
    ]), latest, { minimumHours: 1, minimumQuotes: 3 });
    expect(result).toEqual([{ timestamp: latest, quotes: {
      '/items/alpha::0': { a: 10, b: 9, p: 9.5, v: 2 },
      '/items/zeta::1': { a: 10, b: 9, p: 9.5, v: 2 },
      '/items/zeta::2': { a: 10, b: 9, p: 9.5, v: 2 },
    } }]);
  });

  it('keeps the inclusive seven-day boundary and preserves millisecond timestamps', () => {
    const cutoff = latest - 7 * 24 * HOUR;
    const result = buildBackfillSnapshots(new Map([['a', [row('a', 0, cutoff), row('a', 1, cutoff - 1), row('a', 2, latest - 1234)]]]), latest, { minimumHours: 2, minimumQuotes: 1 });
    expect(result.map((s) => s.timestamp)).toEqual([cutoff, latest - 1234]);
  });

  it('rejects future rows and invalid latest timestamps', () => {
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest + 1)]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/future/i);
    expect(() => buildBackfillSnapshots(new Map(), Number.NaN, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/timestamp/i);
    expect(() => buildBackfillSnapshots(new Map(), Number.MAX_SAFE_INTEGER + 1, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/timestamp/i);
  });

  it('rejects sparse snapshots and invalid gates', () => {
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest)]]]), latest)).toThrow(/hours/i);
    expect(() => buildBackfillSnapshots(new Map([['a', [row('a', 0, latest)]]]), latest, { minimumHours: 1, minimumQuotes: 2 })).toThrow(/quotes/i);
    expect(() => buildBackfillSnapshots(new Map(), latest, { minimumHours: 0, minimumQuotes: 1 })).toThrow(/gate/i);
    expect(() => buildBackfillSnapshots(new Map(), latest, { minimumHours: 1.5, minimumQuotes: 1 })).toThrow(/gate/i);
    expect(() => buildBackfillSnapshots(new Map(), latest, { minimumHours: 1, minimumQuotes: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/gate/i);
  });

  it('rejects conflicting duplicate rows but accepts exact duplicates', () => {
    const duplicate = row('a', 0, latest);
    expect(buildBackfillSnapshots(new Map([['a', [duplicate, { ...duplicate }]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toHaveLength(1);
    expect(() => buildBackfillSnapshots(new Map([['a', [duplicate, { ...duplicate, a: 11 }]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/duplicate|conflict/i);
    expect(() => buildBackfillSnapshots(new Map([['wrong', [row('a', 0, latest)]]]), latest, { minimumHours: 1, minimumQuotes: 1 })).toThrow(/item/i);
  });

  it('is deterministic regardless of map and row order', () => {
    const first = makeRows(2, 3);
    const entries = [...first].reverse().map(([key, values]) => [key, [...values].reverse()] as const);
    expect(buildBackfillSnapshots(first, latest, { minimumHours: 2, minimumQuotes: 3 })).toEqual(buildBackfillSnapshots(new Map(entries), latest, { minimumHours: 2, minimumQuotes: 3 }));
  });
});

describe('official overlap validation', () => {
  it('lets exact overlap succeed, counts fields, and makes official snapshot authoritative', () => {
    const imported = snapshot(latest, { a: 10, b: 9, p: 1, v: 2 });
    const official = snapshot(latest, { a: 10, b: 9, p: 99, v: 88 });
    const result = validateOfficialOverlap([snapshot(latest - HOUR), imported], [official]);
    expect(result.comparisons).toBe(2);
    expect(result.snapshots).toEqual([snapshot(latest - HOUR), official]);
    expect(result.snapshots[1]).not.toBe(official);
  });

  it('accepts null/missing tolerance and rejects ask or bid mismatches', () => {
    expect(() => validateOfficialOverlap([snapshot(latest, { a: null, b: 9, p: null, v: null })], [snapshot(latest, { a: 10, b: 9, p: 2, v: 3 })])).not.toThrow();
    expect(() => validateOfficialOverlap([snapshot(latest, { a: 11, b: null, p: null, v: null })], [snapshot(latest, { a: 10, b: 9, p: 2, v: 3 })])).toThrow(/ask/i);
    expect(() => validateOfficialOverlap([snapshot(latest, { a: null, b: 8, p: null, v: null })], [snapshot(latest, { a: 10, b: 9, p: 2, v: 3 })])).toThrow(/bid/i);
  });

  it('rejects duplicate official timestamps and does not mutate input', () => {
    const imported = [snapshot(latest - HOUR), snapshot(latest)];
    const official = [snapshot(latest), snapshot(latest)];
    expect(() => validateOfficialOverlap(imported, official)).toThrow(/duplicate.*timestamp/i);
    const before = JSON.stringify(imported);
    validateOfficialOverlap(imported, [snapshot(latest)]);
    expect(JSON.stringify(imported)).toBe(before);
  });
});
