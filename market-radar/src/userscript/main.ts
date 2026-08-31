import { createGMKeyValueStore, MarketStore, type KeyValueStore } from '../collector/market-store';
import {
  installDashboardBridge,
  type DashboardBridgeCleanup,
  type DashboardBridgeOptions,
} from './dashboard-bridge';
import { startGameCollector as defaultStartGameCollector, type GameCollectorHandle } from './game-collector';
import { DEFAULT_DASHBOARD_ORIGINS, isAllowedDashboardUrl } from './origins';

declare const __MWI_RADAR_DASHBOARD_ORIGINS__: readonly string[];

const MWI_ORIGIN = 'https://www.milkywayidle.com';
const dashboardOrigins: readonly string[] =
  typeof __MWI_RADAR_DASHBOARD_ORIGINS__ === 'undefined'
    ? DEFAULT_DASHBOARD_ORIGINS
    : __MWI_RADAR_DASHBOARD_ORIGINS__;

export type OriginRoute = 'mwi' | 'dashboard' | 'none';

export interface OriginStartupOptions {
  allowedDashboardOrigins?: readonly string[];
  /** Injected for tests; production uses the real MWI collector. */
  startGameCollector?: () => GameCollectorHandle | void;
  /** Injected for tests; production installs the real dashboard bridge. */
  startDashboardBridge?: (options: DashboardBridgeOptions) => DashboardBridgeCleanup | void;
  createGMKeyValueStore?: () => KeyValueStore;
  createMarketStore?: (storage: KeyValueStore) => MarketStore;
  dashboardTarget?: EventTarget;
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
  const storage = (options.createGMKeyValueStore ?? createGMKeyValueStore)();
  const store = (options.createMarketStore ?? ((adapter: KeyValueStore) => new MarketStore(adapter)))(storage);
  const target = options.dashboardTarget ?? (typeof window === 'undefined' ? globalThis : window);
  const install = options.startDashboardBridge ?? installDashboardBridge;

  install({ target, currentUrl, allowedBaseUrls, store });
}

export function startForCurrentOrigin(
  locationReference: string | URL = typeof window === 'undefined' ? '' : window.location.href,
  options: OriginStartupOptions = {},
): OriginRoute {
  const route = resolveOriginRoute(
    locationReference,
    options.allowedDashboardOrigins ?? dashboardOrigins,
  );

  if (route === 'mwi') {
    (options.startGameCollector ?? defaultStartGameCollector)();
  } else if (route === 'dashboard') {
    startDashboardRoute(
      locationReference,
      options.allowedDashboardOrigins ?? dashboardOrigins,
      options,
    );
  }

  return route;
}

const autoStartDisabled = (globalThis as typeof globalThis & {
  __MWI_RADAR_DISABLE_AUTO_START__?: boolean;
}).__MWI_RADAR_DISABLE_AUTO_START__ === true;

if (typeof window !== 'undefined' && !autoStartDisabled) {
  startForCurrentOrigin();
}
