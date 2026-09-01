import { describe, expect, it } from 'vitest';
import {
  createHistoryProvenance,
  HISTORY_PROVENANCE_FILE,
  HISTORY_PROVENANCE_MAX_BYTES,
  parseHistoryProvenance,
} from '../src/cloud/provenance';

const VALID = {
  fetchedAt: '2026-09-01T12:09:00.000Z',
  fromTimestamp: Date.parse('2026-08-25T00:00:00.000Z'),
  toTimestamp: Date.parse('2026-09-01T00:00:00.000Z'),
  snapshotCount: 7,
  overlapComparisons: 3,
};

function provenance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sourceId: 'stockmarket-xin',
    sourceLabel: '牛牛股市',
    sourceUrl: 'https://www.stockmarket.xin',
    permission: 'owner-confirmed',
    liveSource: 'mwi-official',
    ...VALID,
    ...overrides,
  };
}

describe('history provenance', () => {
  it('creates and parses a canonical cloned provenance record', () => {
    const source = provenance();
    const created = createHistoryProvenance(VALID);
    const parsed = parseHistoryProvenance(source);

    expect(HISTORY_PROVENANCE_FILE).toBe('history-provenance.json');
    expect(HISTORY_PROVENANCE_MAX_BYTES).toBeLessThanOrEqual(64 * 1024);
    expect(created).toEqual(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(source).toEqual(provenance());
  });

  it('rejects missing or additional keys', () => {
    const missing = provenance();
    delete missing.permission;

    expect(() => parseHistoryProvenance(missing)).toThrow();
    expect(() => parseHistoryProvenance({ ...provenance(), unexpected: true })).toThrow();
  });

  it('rejects changed fixed literals', () => {
    for (const [key, value] of Object.entries({
      schemaVersion: 2,
      sourceId: 'other-source',
      sourceLabel: 'Other',
      sourceUrl: 'https://example.test',
      permission: 'unknown',
      liveSource: 'other-live-source',
    })) {
      expect(() => parseHistoryProvenance(provenance({ [key]: value }))).toThrow();
    }
  });

  it.each([
    '2026-09-01T12:09:00Z',
    '2026-09-01T20:09:00+08:00',
    '2026-09-01T07:09:00-05:00',
    '2024-02-29T12:09:00.5Z',
  ])('accepts a strict ISO-8601 instant with a timezone: %s', (fetchedAt) => {
    expect(parseHistoryProvenance(provenance({ fetchedAt })).fetchedAt).toBe(fetchedAt);
  });

  it.each([
    [{ fetchedAt: 'not-an-iso-date' }],
    [{ fetchedAt: '2026-02-30T12:09:00Z' }],
    [{ fetchedAt: '2026-09-01T12:09:00' }],
    [{ fetchedAt: 'September 1, 2026 12:09:00 UTC' }],
    [{ fetchedAt: '2026-09-01T24:09:00Z' }],
    [{ fetchedAt: '2026-09-01T12:09:00+24:00' }],
    [{ fetchedAt: '2026-09-01T12:09:00+08:60' }],
    [{ fromTimestamp: -1 }],
    [{ toTimestamp: Number.MAX_SAFE_INTEGER }],
    [{ fromTimestamp: VALID.toTimestamp, toTimestamp: VALID.fromTimestamp }],
    [{ snapshotCount: 0 }],
    [{ snapshotCount: 169 }],
    [{ snapshotCount: 1.5 }],
    [{ overlapComparisons: -1 }],
    [{ overlapComparisons: 1.5 }],
  ])('rejects invalid date, range, and count values: %o', (overrides) => {
    expect(() => parseHistoryProvenance(provenance(overrides))).toThrow();
  });

  it('never mutates the caller input or returns caller-owned nested state', () => {
    const source = provenance();
    const before = structuredClone(source);
    const parsed = parseHistoryProvenance(source);
    (parsed as { sourceLabel: string }).sourceLabel = 'mutated result';

    expect(source).toEqual(before);
    expect(source.sourceLabel).toBe('牛牛股市');
  });
});
