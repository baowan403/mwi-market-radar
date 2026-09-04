import type { MarketKey, Snapshot } from '../core/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SAFE_SHARE = 0.05;
const MIN_DAILY_COVERAGE_HOURS = 12;
export const MIN_VOLUME_FLOOR = 5;
export const MAX_PRICE_DEVIATION_RATIO = 2.5;

export interface MarketCapacity {
  key: MarketKey;
  /** Median traded units per day across usable days in the last 3 days. */
  median3d: number | null;
  /** Median traded units per day across usable days in the last 7 days. */
  median7d: number | null;
  medianPrice7d: number | null;
  /** Quote-covered hourly samples, independent of whether v is null. */
  samples3d: number;
  samples7d: number;
  usableDays3d: number;
  usableDays7d: number;
  latestHourlyVolume: number | null;
  safeUnitsPerHour: number | null;
  safeUnitsPerDay: number | null;
  sufficient: boolean;
  isGhostLiquidity: boolean;
  askAvailable: boolean;
  bidAvailable: boolean;
}

interface DailyVolumeBucket {
  volume: number;
  coverageHours: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * marketplace.json `v` is hourly traded volume, not order-book depth.
 * Aggregate it into rolling 24h buckets before comparing against a 24h strategy.
 * A present quote with v=null is a covered hour with zero observed trades; a missing
 * quote is not silently treated as zero because history coverage is unknown.
 */
function dailyVolumes(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
  days: number,
): { totals: number[]; coverageHours: number } {
  const buckets = Array.from({ length: days }, (): DailyVolumeBucket => ({ volume: 0, coverageHours: 0 }));
  let coverageHours = 0;
  for (const snapshot of snapshots) {
    if (snapshot.timestamp > latestTimestamp) continue;
    const ageMs = latestTimestamp - snapshot.timestamp;
    if (ageMs < 0 || ageMs >= days * DAY_MS) continue;
    const quote = snapshot.quotes[key];
    if (!quote) continue;
    const bucketIndex = Math.floor(ageMs / DAY_MS);
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    bucket.coverageHours += 1;
    coverageHours += 1;
    if (typeof quote.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0) {
      bucket.volume += quote.v;
    }
  }
  return {
    totals: buckets
      .filter((bucket) => bucket.coverageHours >= MIN_DAILY_COVERAGE_HOURS)
      .map((bucket) => bucket.volume),
    coverageHours,
  };
}

function pricesInWindow(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
  hours: number,
): number[] {
  const cutoff = latestTimestamp - (hours - 1) * HOUR_MS;
  return snapshots
    .filter((snapshot) => snapshot.timestamp >= cutoff && snapshot.timestamp <= latestTimestamp)
    .map((snapshot) => {
      const q = snapshot.quotes[key];
      return q?.p ?? q?.b ?? q?.a;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

export function marketCapacity(key: MarketKey, snapshots: readonly Snapshot[]): MarketCapacity {
  const latest = snapshots.reduce<Snapshot | null>((current, snapshot) => (
    current === null || snapshot.timestamp > current.timestamp ? snapshot : current
  ), null);
  if (!latest) {
    return {
      key,
      median3d: null,
      median7d: null,
      medianPrice7d: null,
      samples3d: 0,
      samples7d: 0,
      usableDays3d: 0,
      usableDays7d: 0,
      latestHourlyVolume: null,
      safeUnitsPerHour: null,
      safeUnitsPerDay: null,
      sufficient: false,
      isGhostLiquidity: false,
      askAvailable: false,
      bidAvailable: false,
    };
  }

  const daily3d = dailyVolumes(key, snapshots, latest.timestamp, 3);
  const daily7d = dailyVolumes(key, snapshots, latest.timestamp, 7);
  const prices7d = pricesInWindow(key, snapshots, latest.timestamp, 168);
  const median3d = median(daily3d.totals);
  const median7d = median(daily7d.totals);
  const medianPrice7d = median(prices7d);
  // Preserve the previous ~72h readiness contract while keeping units daily.
  const sufficient = daily3d.totals.length >= 2
    && daily7d.totals.length >= 3
    && median3d !== null
    && median7d !== null;
  const safeUnitsPerDay = sufficient ? SAFE_SHARE * Math.min(median3d, median7d) : null;
  const quote = latest.quotes[key];
  const latestHourlyVolume = typeof quote?.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0
    ? quote.v
    : null;

  return {
    key,
    median3d,
    median7d,
    medianPrice7d,
    samples3d: daily3d.coverageHours,
    samples7d: daily7d.coverageHours,
    usableDays3d: daily3d.totals.length,
    usableDays7d: daily7d.totals.length,
    latestHourlyVolume,
    safeUnitsPerHour: safeUnitsPerDay === null ? null : safeUnitsPerDay / 24,
    safeUnitsPerDay,
    sufficient,
    isGhostLiquidity: median7d !== null && median7d < MIN_VOLUME_FLOOR * 24,
    askAvailable: typeof quote?.a === 'number' && Number.isFinite(quote.a) && quote.a >= 0,
    bidAvailable: typeof quote?.b === 'number' && Number.isFinite(quote.b) && quote.b >= 0,
  };
}
