import type { MarketKey, Snapshot } from '../core/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SAFE_SHARE = 0.05;
const MIN_DAILY_COVERAGE_HOURS = 12;
const MIN_ROLLING_24H_COVERAGE_HOURS = 12;
export const MIN_VOLUME_FLOOR = 5;
export const MAX_PRICE_DEVIATION_RATIO = 2.5;

export interface MarketCapacity {
  key: MarketKey;
  /** Estimated traded units during a normalized rolling 24-hour window. */
  volume24h: number | null;
  /** Raw sum of observed hourly `v` values in the rolling window. */
  observedVolume24h: number | null;
  /** Distinct quote-covered hours in the rolling 24-hour window. */
  coverageHours24h: number;
  volume24hSufficient: boolean;
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

interface RollingVolume24h {
  volume24h: number | null;
  observedVolume24h: number | null;
  coverageHours24h: number;
  sufficient: boolean;
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
 * marketplace.json `v` is hourly traded volume, not visible order-book depth.
 * Quotes with v=null are covered hours with zero observed trades. Missing quotes
 * remain uncovered rather than being silently treated as zero.
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

/**
 * Directly answers the product question: how many units traded in the latest 24h?
 * If 12-23 hourly samples are present, normalize the observed sum to 24h instead
 * of declaring the entire strategy unusable. Duplicate samples in the same hour
 * are collapsed to the newest snapshot.
 */
function rollingVolume24h(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
): RollingVolume24h {
  const latestByHour = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.timestamp > latestTimestamp) continue;
    const ageMs = latestTimestamp - snapshot.timestamp;
    if (ageMs < 0 || ageMs >= DAY_MS) continue;
    const hourBucket = Math.floor(snapshot.timestamp / HOUR_MS);
    const current = latestByHour.get(hourBucket);
    if (!current || snapshot.timestamp > current.timestamp) latestByHour.set(hourBucket, snapshot);
  }

  let observedVolume = 0;
  let coverageHours = 0;
  for (const snapshot of latestByHour.values()) {
    const quote = snapshot.quotes[key];
    if (!quote) continue;
    coverageHours += 1;
    if (typeof quote.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0) {
      observedVolume += quote.v;
    }
  }

  const sufficient = coverageHours >= MIN_ROLLING_24H_COVERAGE_HOURS;
  return {
    observedVolume24h: coverageHours > 0 ? observedVolume : null,
    volume24h: coverageHours >= 4 ? observedVolume * 24 / coverageHours : null,
    coverageHours24h: coverageHours,
    sufficient,
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
      const quote = snapshot.quotes[key];
      return quote?.p ?? quote?.b ?? quote?.a;
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
      volume24h: null,
      observedVolume24h: null,
      coverageHours24h: 0,
      volume24hSufficient: false,
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

  const rolling24h = rollingVolume24h(key, snapshots, latest.timestamp);
  const daily3d = dailyVolumes(key, snapshots, latest.timestamp, 3);
  const daily7d = dailyVolumes(key, snapshots, latest.timestamp, 7);
  const prices7d = pricesInWindow(key, snapshots, latest.timestamp, 168);
  const median3d = median(daily3d.totals);
  const median7d = median(daily7d.totals);
  const medianPrice7d = median(prices7d);
  const sufficient = daily3d.totals.length >= 2
    && daily7d.totals.length >= 3
    && median3d !== null
    && median7d !== null;

  // Capacity mode remains conservative, but the visible 24h share always uses
  // the direct rolling-24h volume above. This avoids one spike inflating a batch.
  const capacityBaselines: number[] = [];
  if (rolling24h.sufficient && rolling24h.volume24h !== null) capacityBaselines.push(rolling24h.volume24h);
  if (sufficient && median3d !== null && median7d !== null) {
    capacityBaselines.push(median3d, median7d);
  }
  const safeUnitsPerDay = capacityBaselines.length > 0
    ? SAFE_SHARE * Math.min(...capacityBaselines)
    : null;
  const quote = latest.quotes[key];
  const latestHourlyVolume = typeof quote?.v === 'number' && Number.isFinite(quote.v) && quote.v >= 0
    ? quote.v
    : null;
  const referenceVolume = rolling24h.volume24h ?? median7d;

  return {
    key,
    volume24h: rolling24h.volume24h,
    observedVolume24h: rolling24h.observedVolume24h,
    coverageHours24h: rolling24h.coverageHours24h,
    volume24hSufficient: rolling24h.sufficient,
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
    isGhostLiquidity: referenceVolume !== null && referenceVolume < MIN_VOLUME_FLOOR * 24,
    askAvailable: typeof quote?.a === 'number' && Number.isFinite(quote.a) && quote.a >= 0,
    bidAvailable: typeof quote?.b === 'number' && Number.isFinite(quote.b) && quote.b >= 0,
  };
}
