import { describe, expect, it } from 'vitest';
import { resolveOriginRoute } from '../src/userscript/main';

describe('userscript origin router', () => {
  it('routes the MWI origin to the MWI branch', () => {
    expect(resolveOriginRoute('https://www.milkywayidle.com', ['http://localhost:4173'])).toBe('mwi');
  });

  it('routes an allowlisted dashboard origin to the dashboard branch', () => {
    expect(resolveOriginRoute('http://localhost:4173', ['http://localhost:4173'])).toBe('dashboard');
  });

  it('does not start a route for an unknown origin', () => {
    expect(resolveOriginRoute('https://example.com', ['http://localhost:4173'])).toBe('none');
  });
});
