import { describe, expect, it } from 'vitest';
import { resolveOriginRoute } from '../src/userscript/main';
import { normalizeDashboardOrigins, toUserscriptMatches } from '../src/userscript/origins';

describe('userscript dashboard origins', () => {
  it('normalizes dashboard origins and preserves path bases in metadata matches', () => {
    const origins = normalizeDashboardOrigins('https://example.github.io/radar,http://localhost:4173');

    expect(origins).toEqual(['https://example.github.io/radar', 'http://localhost:4173']);
    expect(toUserscriptMatches(origins)).toEqual([
      'https://example.github.io/radar/*',
      'http://localhost:4173/*',
    ]);
  });
});

describe('userscript origin router', () => {
  it('routes the MWI origin to the MWI branch', () => {
    expect(resolveOriginRoute('https://www.milkywayidle.com', ['http://localhost:4173'])).toBe('mwi');
  });

  it('routes an allowlisted dashboard origin to the dashboard branch', () => {
    expect(resolveOriginRoute('http://localhost:4173', ['http://localhost:4173'])).toBe('dashboard');
  });

  it('routes dashboard pages under an allowlisted base path only', () => {
    const allowedDashboardBase = ['https://example.github.io/radar'];

    expect(resolveOriginRoute('https://example.github.io/radar/index.html', allowedDashboardBase)).toBe('dashboard');
    expect(resolveOriginRoute(new URL('https://example.github.io/radar/index.html'), allowedDashboardBase)).toBe('dashboard');
    expect(resolveOriginRoute('https://example.github.io/other', allowedDashboardBase)).toBe('none');
    expect(resolveOriginRoute('https://example.github.io/radar-evil', allowedDashboardBase)).toBe('none');
  });

  it('does not start a route for an unknown origin', () => {
    expect(resolveOriginRoute('https://example.com', ['http://localhost:4173'])).toBe('none');
  });
});
