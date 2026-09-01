import type { MarketKey, Snapshot } from '../core/types';

const HOUR_MS = 3_600_000;
const SAFE_SHARE = 0.05;

export interface MarketCapacity {
  key: MarketKey;
  median3d: number | null;
  median7d: number | null;
  samples3d: number;
  samples7d: number;
  safeUnitsPerHour: number | null;
  sufficient: boolean;
  askAvailable: boolean;
  bidAvailable: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function valuesInWindow(
  key: MarketKey,
  snapshots: readonly Snapshot[],
  latestTimestamp: number,
  hours: number,
): number[] {
  const cutoff = latestTimestamp - (hours - 1) * HOUR_MS;
  return snapshots
    .filter((snapshot) => snapshot.timestamp >= cutoff && snapshot.timestamp <= latestTimestamp)
    .map((snapshot) => snapshot.quotes[key]?.v)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

export function marketCapacity(key: MarketKey, snapshots: readonly Snapshot[]): MarketCapacity {
  const latest = snapshots.reduce<Snapshot | null>((current, snapshot) => (
    current === null || snapshot.timestamp > current.timestamp ? snapshot : current
  ), null);
  if (!latest) {
    return {
      key, median3d: null, median7d: null, samples3d: 0, samples7d: 0,
      safeUnitsPerHour: null, sufficient: false, askAvailable: false, bidAvailable: false,
    };
  }
  const volumes3d = valuesInWindow(key, snapshots, latest.timestamp, 72);
  const volumes7d = valuesInWindow(key, snapshots, latest.timestamp, 168);
  const median3d = median(volumes3d);
  const median7d = median(volumes7d);
  const sufficient = volumes3d.length >= 24
    && volumes7d.length >= 72
    && median3d !== null
    && median7d !== null;
  const quote = latest.quotes[key];
  return {
    key,
    median3d,
    median7d,
    samples3d: volumes3d.length,
    samples7d: volumes7d.length,
    safeUnitsPerHour: sufficient ? SAFE_SHARE * Math.min(median3d, median7d) : null,
    sufficient,
    askAvailable: typeof quote?.a === 'number' && Number.isFinite(quote.a) && quote.a >= 0,
    bidAvailable: typeof quote?.b === 'number' && Number.isFinite(quote.b) && quote.b >= 0,
  };
}
