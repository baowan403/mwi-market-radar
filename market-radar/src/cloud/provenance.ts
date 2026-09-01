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

function isStrictIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, timezone] = match;
  if (
    yearText === undefined
    || monthText === undefined
    || dayText === undefined
    || hourText === undefined
    || minuteText === undefined
    || secondText === undefined
    || timezone === undefined
  ) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
  ) return false;
  if (timezone !== 'Z') {
    const offsetHour = Number(timezone.slice(1, 3));
    const offsetMinute = Number(timezone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
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
    || !isStrictIsoInstant(value.fetchedAt)
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
