import { describe, expect, it } from 'vitest';
import type { CloudManifest, CloudSnapshotEntry } from '../src/cloud/types';
import {
  CLOUD_RETENTION_MS,
  createManifest,
  parseManifest,
} from '../src/cloud/manifest';

const DAY = 24 * 60 * 60 * 1_000;
const LATEST = Date.parse('2026-09-01T12:08:00.000Z');
const GENERATED_AT = '2026-09-01T12:09:00.000Z';

function entry(timestamp: number, bytes = 128): CloudSnapshotEntry {
  return {
    timestamp,
    file: `snapshots/${timestamp}.txt`,
    bytes,
  };
}

function validManifest(overrides: Partial<CloudManifest> = {}): CloudManifest {
  return {
    schema: 1,
    generatedAt: GENERATED_AT,
    latest: LATEST,
    snapshots: [entry(LATEST - DAY), entry(LATEST)],
    ...overrides,
  };
}

describe('cloud manifest creation', () => {
  it('sorts unsorted entries, keeps the exact retention boundary, and sets latest to the final entry', () => {
    const boundary = LATEST - CLOUD_RETENTION_MS;
    const manifest = createManifest([
      entry(LATEST),
      entry(boundary, 64),
      entry(boundary - 1, 32),
      entry(LATEST - DAY, 96),
    ], GENERATED_AT);

    expect(manifest).toEqual({
      schema: 1,
      generatedAt: GENERATED_AT,
      latest: LATEST,
      snapshots: [entry(boundary, 64), entry(LATEST - DAY, 96), entry(LATEST)],
    });
  });

  it('creates and parses an empty manifest with a null latest timestamp', () => {
    const manifest = createManifest([], GENERATED_AT);

    expect(manifest).toEqual({
      schema: 1,
      generatedAt: GENERATED_AT,
      latest: null,
      snapshots: [],
    });
    expect(parseManifest(manifest)).toEqual(manifest);
  });

  it('rejects duplicate timestamps even when their files differ', () => {
    expect(() => createManifest([
      entry(LATEST),
      entry(LATEST, 64),
    ], GENERATED_AT)).toThrow(/duplicate|timestamp/i);
  });

  it.each([
    'snapshots/../private.txt',
    'snapshots\\2026.txt',
    `snapshots/${LATEST + 1}.txt`,
    'other/2026.txt',
  ])('rejects an unsafe or mismatched snapshot file path: %s', (file) => {
    expect(() => createManifest([{ ...entry(LATEST), file }], GENERATED_AT)).toThrow(/file|path|snapshot/i);
  });
});

describe('cloud manifest parsing', () => {
  it('accepts a valid strict manifest and preserves exact bytes', () => {
    const manifest = validManifest({ snapshots: [entry(LATEST - DAY, 0), entry(LATEST, 9_007_199_254_740_990)] });

    expect(parseManifest(manifest)).toEqual(manifest);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe timestamp: %s',
    (timestamp) => {
      expect(() => parseManifest(validManifest({
        latest: timestamp,
        snapshots: [entry(timestamp)],
      }))).toThrow(/timestamp|latest/i);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe bytes: %s',
    (bytes) => {
      expect(() => parseManifest(validManifest({ snapshots: [entry(LATEST - DAY, bytes), entry(LATEST)] }))).toThrow(/bytes/i);
    },
  );

  it.each(['', 'yesterday', '2026-09-01', '2026-99-99T12:00:00.000Z'])('rejects a non-ISO generatedAt value: %s', (generatedAt) => {
    expect(() => parseManifest(validManifest({ generatedAt }))).toThrow(/generatedAt|ISO/i);
  });

  it('requires latest to be null for empty snapshots and equal to the final snapshot otherwise', () => {
    expect(() => parseManifest(validManifest({ latest: null }))).toThrow(/latest/i);
    expect(() => parseManifest(validManifest({ latest: LATEST }))).not.toThrow();
    expect(() => parseManifest(validManifest({ latest: LATEST - DAY }))).toThrow(/latest/i);
    expect(() => parseManifest(validManifest({ latest: LATEST - DAY - 1 }))).toThrow(/latest/i);
    expect(() => parseManifest(validManifest({ latest: null, snapshots: [] }))).not.toThrow();
    expect(() => parseManifest(validManifest({ latest: LATEST, snapshots: [] }))).toThrow(/latest/i);
  });

  it('rejects schema mismatches, extra root fields, and extra entry fields', () => {
    expect(() => parseManifest({ ...validManifest(), schema: 2 })).toThrow(/schema/i);
    expect(() => parseManifest({ ...validManifest(), schema: '1' })).toThrow(/schema/i);
    expect(() => parseManifest({ ...validManifest(), extra: true } as unknown as CloudManifest)).toThrow(/field|manifest|extra/i);
    expect(() => parseManifest({
      ...validManifest(),
      snapshots: [{ ...entry(LATEST - DAY), extra: true }, entry(LATEST)],
    } as unknown as CloudManifest)).toThrow(/field|entry|extra/i);
  });

  it('rejects duplicate, descending, and over-retention entries', () => {
    expect(() => parseManifest(validManifest({
      snapshots: [entry(LATEST), entry(LATEST)],
    }))).toThrow(/duplicate|ascending|timestamp/i);
    expect(() => parseManifest(validManifest({
      snapshots: [entry(LATEST), entry(LATEST - DAY)],
    }))).toThrow(/ascending|order|timestamp/i);
    const old = entry(LATEST - CLOUD_RETENTION_MS - 1);
    expect(() => parseManifest(validManifest({ snapshots: [old, entry(LATEST)], latest: LATEST }))).toThrow(/retention|old|8.?day/i);
  });
});
