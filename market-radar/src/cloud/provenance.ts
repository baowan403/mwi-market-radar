export const HISTORY_PROVENANCE_FILE = 'history-provenance.json';
export const HISTORY_PROVENANCE_MAX_BYTES = 64 * 1024;

export interface HistoryProvenance {
  schemaVersion: 1;
  sourceId: 'stockmarket-xin';
  sourceLabel: '牛牛股市';
  sourceUrl: 'https://www.stockmarket.xin';
  permission: 'owner-confirmed';
  fetchedAt: string;
  fromTimestamp: number;
  toTimestamp: number;
  snapshotCount: number;
  overlapComparisons: number;
  liveSource: 'mwi-official';
}

export type HistoryProvenanceInput = Pick<
  HistoryProvenance,
  'fetchedAt' | 'fromTimestamp' | 'toTimestamp' | 'snapshotCount' | 'overlapComparisons'
>;

const MAX_DATE_MS = 8_640_000_000_000_000;
const KEYS: readonly (keyof HistoryProvenance)[] = [
  'schemaVersion',
  'sourceId',
  'sourceLabel',
  'sourceUrl',
  'permission',
  'fetchedAt',
  'fromTimestamp',
  'toTimestamp',
  'snapshotCount',
  'overlapComparisons',
  'liveSource',
];

function invalid(): never {
  throw new Error('Invalid history provenance');
}

function isDateTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_DATE_MS;
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse a complete, exact-key provenance record without retaining caller-owned data. */
export function parseHistoryProvenance(value: unknown): HistoryProvenance {
  if (!isObject(value)) invalid();
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || KEYS.some((key) => !Object.hasOwn(value, key))) invalid();
  if (
    value.schemaVersion !== 1
    || value.sourceId !== 'stockmarket-xin'
    || value.sourceLabel !== '牛牛股市'
    || value.sourceUrl !== 'https://www.stockmarket.xin'
    || value.permission !== 'owner-confirmed'
    || value.liveSource !== 'mwi-official'
    || !isCanonicalIsoDate(value.fetchedAt)
    || !isDateTimestamp(value.fromTimestamp)
    || !isDateTimestamp(value.toTimestamp)
    || value.fromTimestamp > value.toTimestamp
    || typeof value.snapshotCount !== 'number'
    || !Number.isSafeInteger(value.snapshotCount)
    || value.snapshotCount < 1
    || value.snapshotCount > 168
    || typeof value.overlapComparisons !== 'number'
    || !Number.isSafeInteger(value.overlapComparisons)
    || value.overlapComparisons < 0
  ) invalid();

  return {
    schemaVersion: 1,
    sourceId: 'stockmarket-xin',
    sourceLabel: '牛牛股市',
    sourceUrl: 'https://www.stockmarket.xin',
    permission: 'owner-confirmed',
    fetchedAt: value.fetchedAt,
    fromTimestamp: value.fromTimestamp,
    toTimestamp: value.toTimestamp,
    snapshotCount: value.snapshotCount,
    overlapComparisons: value.overlapComparisons,
    liveSource: 'mwi-official',
  };
}

export function createHistoryProvenance(input: HistoryProvenanceInput): HistoryProvenance {
  return parseHistoryProvenance({
    schemaVersion: 1,
    sourceId: 'stockmarket-xin',
    sourceLabel: '牛牛股市',
    sourceUrl: 'https://www.stockmarket.xin',
    permission: 'owner-confirmed',
    fetchedAt: input.fetchedAt,
    fromTimestamp: input.fromTimestamp,
    toTimestamp: input.toTimestamp,
    snapshotCount: input.snapshotCount,
    overlapComparisons: input.overlapComparisons,
    liveSource: 'mwi-official',
  });
}
