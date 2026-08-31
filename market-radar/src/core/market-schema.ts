import type { MarketKey, Quote, Snapshot } from './types';

const MILLISECOND_TIMESTAMP_THRESHOLD = 1_000_000_000_000;
const MAX_REASONABLE_TIMESTAMP_MS = 1_000_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error('Invalid timestamp');
  }

  if (value < MILLISECOND_TIMESTAMP_THRESHOLD) {
    const timestamp = value * 1000;
    if (!Number.isSafeInteger(timestamp)) {
      throw new Error('Invalid timestamp');
    }
    return timestamp;
  }

  if (value < MAX_REASONABLE_TIMESTAMP_MS && Number.isSafeInteger(value)) {
    return value;
  }

  throw new Error('Invalid timestamp');
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseOfficialSnapshot(raw: unknown): Snapshot {
  if (!isRecord(raw)) {
    throw new Error('Invalid snapshot');
  }

  const timestamp = normalizeTimestamp(raw.timestamp);
  if (!isRecord(raw.marketData)) {
    throw new Error('Invalid marketData');
  }

  const quotes: Record<MarketKey, Quote> = {};
  for (const [hrid, levels] of Object.entries(raw.marketData)) {
    if (!hrid.startsWith('/items/') || !isRecord(levels)) {
      continue;
    }

    for (const [levelText, value] of Object.entries(levels)) {
      if (!/^\d+$/.test(levelText)) {
        continue;
      }

      const level = Number(levelText);
      if (!Number.isSafeInteger(level) || !isRecord(value)) {
        continue;
      }

      quotes[`${hrid}::${level}`] = {
        a: finiteOrNull(value.a),
        b: finiteOrNull(value.b),
        p: finiteOrNull(value.p),
        v: finiteOrNull(value.v),
      };
    }
  }

  if (Object.keys(quotes).length === 0) {
    throw new Error('Snapshot contains no quotes');
  }

  return { timestamp, quotes };
}
