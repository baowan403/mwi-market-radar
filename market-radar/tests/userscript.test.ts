import { describe, expect, it, vi } from 'vitest';
import {
  autoStartUserscript,
  bootstrapUserscript,
  resolveOriginRoute,
  startForCurrentOrigin,
} from '../src/userscript/main';
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

  it('starts the collector only for the official MWI route', () => {
    const startGameCollector = vi.fn();
    const startDashboardBridge = vi.fn();
    const options = {
      allowedDashboardOrigins: ['http://localhost:4173'],
      startGameCollector,
      startDashboardBridge,
    };

    expect(startForCurrentOrigin('https://www.milkywayidle.com/game', options)).toBe('mwi');
    expect(startGameCollector).toHaveBeenCalledTimes(1);

    startGameCollector.mockClear();
    expect(startForCurrentOrigin('http://localhost:4173', options)).toBe('dashboard');
    expect(startGameCollector).not.toHaveBeenCalled();
    expect(startDashboardBridge).toHaveBeenCalledTimes(1);

    expect(startForCurrentOrigin('https://example.com', options)).toBe('none');
    expect(startGameCollector).not.toHaveBeenCalled();
    expect(startDashboardBridge).toHaveBeenCalledTimes(1);
  });
});

function markerTarget(): { documentElement: { dataset: Record<string, string> } } {
  return { documentElement: { dataset: {} } };
}

describe('userscript startup diagnostics', () => {
  it('marks the MWI route as loaded and started without exposing page data', () => {
    const target = markerTarget();
    const startGameCollector = vi.fn();

    expect(bootstrapUserscript('https://www.milkywayidle.com/game', {
      startGameCollector,
    }, target)).toBe('mwi');

    expect(target.documentElement.dataset).toEqual({
      mwiRadarScript: 'loaded',
      mwiRadarVersion: '0.1.3',
      mwiRadarTransport: 'dom-event',
      mwiRadarRoute: 'mwi',
      mwiRadarState: 'started',
    });
    expect(startGameCollector).toHaveBeenCalledTimes(1);
  });

  it('marks an allowlisted dashboard route as loaded and started', () => {
    const target = markerTarget();
    const startDashboardBridge = vi.fn();

    expect(bootstrapUserscript('http://localhost:4173/', {
      allowedDashboardOrigins: ['http://localhost:4173'],
      createGMKeyValueStore: () => ({
        get: async <T>(_key: string, fallback: T): Promise<T> => fallback,
        set: async <T>(_key: string, _value: T): Promise<void> => undefined,
        delete: async (_key: string): Promise<void> => undefined,
        keys: async (): Promise<string[]> => [],
      }),
      startDashboardBridge,
    }, target)).toBe('dashboard');

    expect(target.documentElement.dataset).toEqual({
      mwiRadarScript: 'loaded',
      mwiRadarVersion: '0.1.3',
      mwiRadarTransport: 'dom-event',
      mwiRadarRoute: 'dashboard',
      mwiRadarState: 'started',
    });
    expect(startDashboardBridge).toHaveBeenCalledTimes(1);
  });

  it('sanitizes synchronous startup failures and does not rethrow raw errors', () => {
    const target = markerTarget();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'account=private; response body should never be logged';

    expect(bootstrapUserscript('https://www.milkywayidle.com/game', {
      startGameCollector: () => {
        throw new Error(secret);
      },
    }, target)).toBe('mwi');

    expect(target.documentElement.dataset).toEqual({
      mwiRadarScript: 'loaded',
      mwiRadarVersion: '0.1.3',
      mwiRadarTransport: 'dom-event',
      mwiRadarRoute: 'mwi',
      mwiRadarState: 'error',
      mwiRadarErrorCode: 'collector-start',
    });
    expect(consoleError).toHaveBeenCalledWith('[MWI Market Radar] startup error collector-start');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    consoleError.mockRestore();
  });

  it('does not write markers when automatic startup is disabled', () => {
    const target = markerTarget();
    vi.stubGlobal('__MWI_RADAR_DISABLE_AUTO_START__', true);

    expect(autoStartUserscript('https://www.milkywayidle.com/game', {
      startGameCollector: vi.fn(),
    }, target)).toBeNull();
    expect(target.documentElement.dataset).toEqual({});

    vi.unstubAllGlobals();
  });
});
