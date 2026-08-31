import type { MarketKey, Period, Quote, Snapshot } from './types';
import { priceBasis, type PriceQuality } from './price';

const HOUR_MS = 3_600_000;

export const PERIOD_HOURS = {
  '1d': 24,
  '3d': 72,
  '7d': 168,
} as const satisfies Record<Period, number>;

export function periodHours(period: Period): number {
  return PERIOD_HOURS[period];
}

export interface ChangeResult {
  pct: number | null;
  elapsedHours: number | null;
  samples: number;
  latestTimestamp: number | null;
  baseTimestamp: number | null;
  latestQuality: PriceQuality | null;
  baseQuality: PriceQuality | null;
}

interface PricePoint {
  timestamp: number;
  price: number;
  quality: Exclude<PriceQuality, 'missing'>;
}

const QUALITY_PRIORITY: Record<PriceQuality, number> = {
  missing: 0,
  'bid-only': 1,
  'ask-only': 2,
  midpoint: 3,
  official: 4,
};

const EMPTY_QUOTE: Quote = { a: null, b: null, p: null, v: null };

function quoteFor(snapshot: Snapshot, key: MarketKey): Quote {
  return snapshot.quotes[key] ?? EMPTY_QUOTE;
}

function quoteKey(quote: Quote): string {
  return JSON.stringify([quote.a, quote.b, quote.p, quote.v], (_key, value) => {
    return typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value;
  });
}

function shouldReplaceDuplicate(
  candidate: Snapshot,
  current: Snapshot,
  key: MarketKey,
): boolean {
  const candidateQuote = quoteFor(candidate, key);
  const currentQuote = quoteFor(current, key);
  const candidateBasis = priceBasis(candidateQuote);
  const currentBasis = priceBasis(currentQuote);
  const candidatePriority = QUALITY_PRIORITY[candidateBasis.quality];
  const currentPriority = QUALITY_PRIORITY[currentBasis.quality];

  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  return quoteKey(candidateQuote) < quoteKey(currentQuote);
}

function deduplicateSnapshots(
  key: MarketKey,
  snapshots: readonly Snapshot[],
): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();

  for (const snapshot of snapshots) {
    if (!Number.isFinite(snapshot.timestamp)) {
      continue;
    }

    const current = byTimestamp.get(snapshot.timestamp);
    if (!current || shouldReplaceDuplicate(snapshot, current, key)) {
      byTimestamp.set(snapshot.timestamp, snapshot);
    }
  }

  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function pricePoints(key: MarketKey, snapshots: readonly Snapshot[]): PricePoint[] {
  const points: PricePoint[] = [];

  for (const snapshot of deduplicateSnapshots(key, snapshots)) {
    const basis = priceBasis(quoteFor(snapshot, key));
    if (basis.value === null || basis.quality === 'missing') {
      continue;
    }
    points.push({ timestamp: snapshot.timestamp, price: basis.value, quality: basis.quality });
  }

  return points;
}

function emptyChangeResult(samples = 0): ChangeResult {
  return {
    pct: null,
    elapsedHours: null,
    samples,
    latestTimestamp: null,
    baseTimestamp: null,
    latestQuality: null,
    baseQuality: null,
  };
}

export function calculateChange(
  key: MarketKey,
  targetHours: number,
  snapshots: readonly Snapshot[],
): ChangeResult {
  const points = pricePoints(key, snapshots);
  const latest = points.at(-1);
  if (!latest) {
    return emptyChangeResult();
  }

  const latestResult = {
    latestTimestamp: latest.timestamp,
    latestQuality: latest.quality,
  };
  const oldPoints = points.slice(0, -1);
  if (oldPoints.length === 0) {
    return {
      ...emptyChangeResult(points.length),
      ...latestResult,
    };
  }

  const targetTimestamp = latest.timestamp - targetHours * HOUR_MS;
  const base = oldPoints.reduce((closest, point) => {
    const pointDistance = Math.abs(point.timestamp - targetTimestamp);
    const closestDistance = Math.abs(closest.timestamp - targetTimestamp);
    if (pointDistance < closestDistance) {
      return point;
    }
    if (pointDistance === closestDistance && point.timestamp < closest.timestamp) {
      return point;
    }
    return closest;
  });
  const elapsedHours = (latest.timestamp - base.timestamp) / HOUR_MS;
  const minimumElapsed = targetHours * 0.75;
  const maximumElapsed = targetHours * 1.25;
  const inWindow =
    Number.isFinite(targetHours) &&
    targetHours > 0 &&
    elapsedHours >= minimumElapsed &&
    elapsedHours <= maximumElapsed;
  const pct = inWindow && base.price !== 0 ? ((latest.price - base.price) / base.price) * 100 : null;

  return {
    pct,
    elapsedHours,
    samples: points.length,
    latestTimestamp: latest.timestamp,
    baseTimestamp: base.timestamp,
    latestQuality: latest.quality,
    baseQuality: base.quality,
  };
}

export function calculateVolatilityPct(
  key: MarketKey,
  snapshots: readonly Snapshot[],
): number | null {
  const positivePrices = pricePoints(key, snapshots).filter((point) => point.price > 0);
  if (positivePrices.length < 3) {
    return null;
  }

  const returns: number[] = [];
  for (let index = 1; index < positivePrices.length; index += 1) {
    const previous = positivePrices[index - 1];
    const current = positivePrices[index];
    if (!previous || !current) {
      continue;
    }
    returns.push(Math.log(current.price / previous.price));
  }

  if (returns.length < 2) {
    return null;
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const squaredDistance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squaredDistance / (returns.length - 1)) * 100;
}

export function volumeMultiple(
  current: number | null,
  baseline: readonly (number | null)[],
): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current) || current < 0) {
    return null;
  }

  const positiveBaseline = baseline.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (positiveBaseline.length === 0) {
    return null;
  }

  positiveBaseline.sort((left, right) => left - right);
  const middle = Math.floor(positiveBaseline.length / 2);
  const median =
    positiveBaseline.length % 2 === 1
      ? positiveBaseline[middle]
      : ((positiveBaseline[middle - 1] ?? 0) + (positiveBaseline[middle] ?? 0)) / 2;

  if (median === undefined || median <= 0) {
    return null;
  }
  return current / median;
}
