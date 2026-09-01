import { createGMKeyValueStore, MarketStore, type KeyValueStore } from '../collector/market-store';
import {
  installDashboardBridge,
  type DashboardBridgeCleanup,
  type DashboardBridgeOptions,
} from './dashboard-bridge';
import type { BridgeMessageTarget } from '../dashboard/client';
import { startGameCollector as defaultStartGameCollector, type GameCollectorHandle } from './game-collector';
import { DEFAULT_DASHBOARD_ORIGINS, isAllowedDashboardUrl } from './origins';

declare const __MWI_RADAR_DASHBOARD_ORIGINS__: readonly string[];

const MWI_ORIGIN = 'https://www.milkywayidle.com';
const dashboardOrigins: readonly string[] =
  typeof __MWI_RADAR_DASHBOARD_ORIGINS__ === 'undefined'
    ? DEFAULT_DASHBOARD_ORIGINS
    : __MWI_RADAR_DASHBOARD_ORIGINS__;

export type OriginRoute = 'mwi' | 'dashboard' | 'none';

export type StartupErrorCode = 'gm-unavailable' | 'bridge-install' | 'collector-start' | 'unknown';

export interface StartupMarkerTarget {
  documentElement?: {
    dataset?: { [key: string]: string | undefined };
  } | null;
}

export interface OriginStartupOptions {
  allowedDashboardOrigins?: readonly string[];
  /** Injected for tests; production uses the real MWI collector. */
  startGameCollector?: () => GameCollectorHandle | void;
  /** Injected for tests; production installs the real dashboard bridge. */
  startDashboardBridge?: (options: DashboardBridgeOptions) => DashboardBridgeCleanup | void;
  createGMKeyValueStore?: () => KeyValueStore;
  createMarketStore?: (storage: KeyValueStore) => MarketStore;
  dashboardTarget?: BridgeMessageTarget;
}

function defaultStartupMarkerTarget(): StartupMarkerTarget | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

function setStartupMarker(target: StartupMarkerTarget | null | undefined, key: string, value: string): void {
  const dataset = target?.documentElement?.dataset;
  if (dataset) dataset[key] = value;
}

class StartupFailure extends Error {
  constructor(readonly code: StartupErrorCode) {
    super(code);
    this.name = 'StartupFailure';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function startupErrorCode(route: OriginRoute, error: unknown): StartupErrorCode {
  if (error instanceof StartupFailure) return error.code;
  if (route === 'mwi') return 'collector-start';
  if (route === 'dashboard') {
    const name = error !== null && typeof error === 'object' && 'name' in error
      ? (error as { name?: unknown }).name
      : undefined;
    return name === 'ReferenceError' ? 'gm-unavailable' : 'bridge-install';
  }
  return 'unknown';
}

function markStartupError(
  target: StartupMarkerTarget | null | undefined,
  route: OriginRoute,
  error: unknown,
): void {
  const code = startupErrorCode(route, error);
  setStartupMarker(target, 'mwiRadarState', 'error');
  setStartupMarker(target, 'mwiRadarErrorCode', code);
  console.error(`[MWI Market Radar] startup error ${code}`);
}

export function resolveOriginRoute(locationReference: string | URL, allowedDashboardOrigins: readonly string[]): OriginRoute {
  let currentUrl: URL;

  try {
    currentUrl = typeof locationReference === 'string' ? new URL(locationReference) : locationReference;
  } catch {
    return 'none';
  }

  if (currentUrl.origin === MWI_ORIGIN) {
    return 'mwi';
  }

  if (isAllowedDashboardUrl(currentUrl, allowedDashboardOrigins)) return 'dashboard';

  return 'none';
}

function startDashboardRoute(
  currentUrl: string | URL,
  allowedBaseUrls: readonly string[],
  options: OriginStartupOptions,
): void {
  let storage: KeyValueStore;
  try {
    storage = (options.createGMKeyValueStore ?? createGMKeyValueStore)();
  } catch {
    throw new StartupFailure('gm-unavailable');
  }
  const store = (options.createMarketStore ?? ((adapter: KeyValueStore) => new MarketStore(adapter)))(storage);
  const target = options.dashboardTarget
    ?? ((typeof window === 'undefined' ? globalThis : window) as BridgeMessageTarget);
  const install = options.startDashboardBridge ?? installDashboardBridge;

  install({ target, currentUrl, allowedBaseUrls, store });
}

export function startForCurrentOrigin(
  locationReference: string | URL = typeof window === 'undefined' ? '' : window.location.href,
  options: OriginStartupOptions = {},
  markerTarget: StartupMarkerTarget | null | undefined = defaultStartupMarkerTarget(),
): OriginRoute {
  const route = resolveOriginRoute(
    locationReference,
    options.allowedDashboardOrigins ?? dashboardOrigins,
  );

  setStartupMarker(markerTarget, 'mwiRadarRoute', route);

  try {
    if (route === 'mwi') {
      (options.startGameCollector ?? defaultStartGameCollector)();
    } else if (route === 'dashboard') {
      startDashboardRoute(
        locationReference,
        options.allowedDashboardOrigins ?? dashboardOrigins,
        options,
      );
    }
  } catch (error) {
    markStartupError(markerTarget, route, error);
    return route;
  }

  setStartupMarker(markerTarget, 'mwiRadarState', 'started');
  return route;
}

export function bootstrapUserscript(
  locationReference: string | URL = typeof window === 'undefined' ? '' : window.location.href,
  options: OriginStartupOptions = {},
  markerTarget: StartupMarkerTarget | null | undefined = defaultStartupMarkerTarget(),
): OriginRoute {
  setStartupMarker(markerTarget, 'mwiRadarScript', 'loaded');
  return startForCurrentOrigin(locationReference, options, markerTarget);
}

export function autoStartUserscript(
  locationReference: string | URL = typeof window === 'undefined' ? '' : window.location.href,
  options: OriginStartupOptions = {},
  markerTarget: StartupMarkerTarget | null | undefined = defaultStartupMarkerTarget(),
): OriginRoute | null {
  const disabled = (globalThis as typeof globalThis & {
    __MWI_RADAR_DISABLE_AUTO_START__?: boolean;
  }).__MWI_RADAR_DISABLE_AUTO_START__ === true;

  if (disabled) return null;
  return bootstrapUserscript(locationReference, options, markerTarget);
}

if (typeof window !== 'undefined') {
  autoStartUserscript();
}
