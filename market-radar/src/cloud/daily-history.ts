import type { Snapshot } from '../core/types';
import { decodeCompressedJsonLimited, encodeCompressedJson } from '../core/storage-codec';
import { dailySummaryToSnapshot, type DailyMarketSummary, type DailyQuoteSummary } from './daily-summary';

const DAY_MS = 86_400_000;
const RETENTION_MS = 180 * DAY_MS;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;

export interface DailyHistoryPack {
  schemaVersion: 1;
  generatedAt: string;
  summaries: DailyMarketSummary[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validNumber(value: unknown, integer = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value));
}

function validNullableNumber(value: unknown): value is number | null {
  return value === null || validNumber(value);
}

function validGeneratedAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validQuote(value: unknown): value is DailyQuoteSummary {
  const item = record(value);
  if (!item) return false;
  const quality = record(item.quality);
  return validNullableNumber(item.o)
    && validNullableNumber(item.h)
    && validNullableNumber(item.l)
    && validNullableNumber(item.c)
    && validNullableNumber(item.a)
    && validNullableNumber(item.b)
    && validNumber(item.v)
    && validNumber(item.samples, true)
    && validNumber(item.priceSamples, true)
    && validNumber(item.askSamples, true)
    && validNumber(item.bidSamples, true)
    && quality !== null
    && ['official', 'midpoint', 'ask-only', 'bid-only', 'missing'].every((key) => validNumber(quality[key], true));
}

function validSummary(value: unknown): value is DailyMarketSummary {
  const item = record(value);
  const quotes = record(item?.quotes);
  if (
    item?.schemaVersion !== 1
    || typeof item.date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
    || !validNumber(item.timestamp, true)
    || new Date(item.timestamp).toISOString().slice(0, 10) !== item.date
    || quotes === null
  ) return false;
  return Object.values(quotes).every(validQuote);
}

function normalize(
  summaries: readonly DailyMarketSummary[],
  generatedAt: string,
): DailyHistoryPack {
  if (!validGeneratedAt(generatedAt)) throw new Error('Invalid daily history generatedAt');
  if (!Array.isArray(summaries) || !summaries.every(validSummary)) throw new Error('Invalid daily history summary');
  const byDate = new Map<string, DailyMarketSummary>();
  for (const summary of summaries) byDate.set(summary.date, summary);
  const ordered = [...byDate.values()].sort((left, right) => left.timestamp - right.timestamp);
  const latest = ordered.at(-1)?.timestamp ?? null;
  const retained = latest === null ? ordered : ordered.filter((summary) => summary.timestamp >= latest - RETENTION_MS);
  return { schemaVersion: 1, generatedAt, summaries: retained };
}

export function createDailyHistoryPack(
  summaries: readonly DailyMarketSummary[],
  generatedAt: string,
): DailyHistoryPack {
  return normalize(summaries, generatedAt);
}

export function upsertDailySummary(
  pack: DailyHistoryPack,
  summary: DailyMarketSummary,
  generatedAt: string,
): DailyHistoryPack {
  if (pack.schemaVersion !== 1) throw new Error('Invalid daily history schema');
  return normalize([...pack.summaries.filter((value) => value.date !== summary.date), summary], generatedAt);
}

export function dailyHistorySnapshots(pack: DailyHistoryPack, hourlyStart: number): Snapshot[] {
  if (!validNumber(hourlyStart, true)) throw new Error('Invalid hourly history boundary');
  return normalize(pack.summaries, pack.generatedAt).summaries
    .filter((summary) => summary.timestamp < hourlyStart)
    .map(dailySummaryToSnapshot);
}

export async function encodeDailyHistoryPack(pack: DailyHistoryPack): Promise<string> {
  return encodeCompressedJson(normalize(pack.summaries, pack.generatedAt));
}

export async function decodeDailyHistoryPack(value: string): Promise<DailyHistoryPack> {
  const decoded = record(await decodeCompressedJsonLimited(value, MAX_DECODED_BYTES));
  if (decoded?.schemaVersion !== 1 || !validGeneratedAt(decoded.generatedAt) || !Array.isArray(decoded.summaries)) {
    throw new Error('Invalid daily history pack');
  }
  return normalize(decoded.summaries as DailyMarketSummary[], decoded.generatedAt);
}

export const DAILY_HISTORY_RETENTION_MS = RETENTION_MS;
