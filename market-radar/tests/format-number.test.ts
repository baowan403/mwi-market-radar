import { describe, expect, it } from 'vitest';
import { formatCompactNumber } from '../src/core/format-number';

describe('formatCompactNumber', () => {
  it.each([
    [null, '—'],
    [Number.NaN, '—'],
    [Number.POSITIVE_INFINITY, '—'],
    [0, '0'],
    [999, '999'],
    [1_000, '1K'],
    [1_234, '1.23K'],
    [12_300, '12.3K'],
    [999_999, '1,000K'],
    [1_000_000, '1M'],
    [1_234_567, '1.23M'],
    [1_000_000_000, '1,000M'],
    [-2_500_000, '-2.5M'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatCompactNumber(value)).toBe(expected);
  });

  it('never emits a billion suffix', () => {
    expect(formatCompactNumber(9_876_543_210)).not.toContain('B');
  });
});
