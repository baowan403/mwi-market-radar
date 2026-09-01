import { describe, expect, it } from 'vitest';
import type { MarketKey, Snapshot } from '../src/core/types';
import { encodeCompressedJson } from '../src/core/storage-codec';
import { aggregateDailySummary } from '../src/cloud/daily-summary';
import {
  createDailyHistoryPack,
  dailyHistorySnapshots,
  decodeDailyHistoryPack,
  encodeDailyHistoryPack,
  upsertDailySummary,
} from '../src/cloud/daily-history';

const DAY = 86_400_000;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const KEY = '/items/test::0' as MarketKey;

function snapshot(timestamp: number, price: number): Snapshot {
  return { timestamp, quotes: { [KEY]: { a: price + 1, b: price - 1, p: price, v: 24 } } };
}

function summary(day: number, price = day): ReturnType<typeof aggregateDailySummary> {
  return aggregateDailySummary([snapshot(START + day * DAY, price)]);
}

describe('compressed 180-day daily history pack', () => {
  it('round trips a strict daily pack through the shared bounded codec', async () => {
    const pack = createDailyHistoryPack([summary(0, 100), summary(1, 110)], '2026-01-02T01:00:00.000Z');
    await expect(decodeDailyHistoryPack(await encodeDailyHistoryPack(pack))).resolves.toEqual(pack);
  });

  it('retains the exact 180-day boundary and replaces the same date', () => {
    let pack = createDailyHistoryPack([summary(0), summary(1)], '2026-01-02T01:00:00.000Z');
    pack = upsertDailySummary(pack, summary(180, 999), '2026-06-30T01:00:00.000Z');
    expect(pack.summaries.map((value) => value.date)).toEqual(['2026-01-01', '2026-01-02', '2026-06-30']);

    pack = upsertDailySummary(pack, summary(181, 1_001), '2026-07-01T01:00:00.000Z');
    expect(pack.summaries.map((value) => value.date)).toEqual(['2026-01-02', '2026-06-30', '2026-07-01']);

    pack = upsertDailySummary(pack, summary(181, 1_234), '2026-07-01T02:00:00.000Z');
    expect(pack.summaries.at(-1)?.quotes[KEY]?.c).toBe(1_234);
    expect(pack.summaries).toHaveLength(3);
  });

  it('converts only days older than the hourly window to strategy snapshots', () => {
    const pack = createDailyHistoryPack([summary(0, 100), summary(1, 110), summary(2, 120)], '2026-01-03T01:00:00.000Z');
    const values = dailyHistorySnapshots(pack, START + 2 * DAY);
    expect(values.map((value) => value.timestamp)).toEqual([START, START + DAY]);
    expect(values.map((value) => value.quotes[KEY]?.p)).toEqual([100, 110]);
  });

  it('rejects malformed decoded daily history instead of inventing summaries', async () => {
    const encoded = await encodeCompressedJson({
      schemaVersion: 1,
      generatedAt: 'not-an-instant',
      summaries: [],
    });
    await expect(decodeDailyHistoryPack(encoded)).rejects.toThrow(/daily|history|invalid/i);
  });
});
