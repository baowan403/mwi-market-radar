import { DEFAULT_DASHBOARD_ORIGINS } from './origins';
import { startGameCollector as defaultStartGameCollector, type GameCollectorHandle } from './game-collector';

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
}

function isPathWithinDashboardBase(pathname: string, basePathname: string): boolean {
  const basePath = basePathname.replace(/\/+$/, '');

  return basePath === '' || pathname === basePath || pathname.startsWith(`${basePath}/`);
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

  for (const dashboardBase of allowedDashboardOrigins) {
    try {
      const dashboardUrl = new URL(dashboardBase);

      if (
        currentUrl.origin === dashboardUrl.origin &&
        isPathWithinDashboardBase(currentUrl.pathname, dashboardUrl.pathname)
      ) {
        return 'dashboard';
      }
    } catch {
      // Ignore malformed configured dashboard bases.
    }
  }

  return 'none';
}

function startDashboardRoute(): void {
  // Reserved for the dashboard-side bridge.
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
    startDashboardRoute();
  }

  return route;
}

const autoStartDisabled = (globalThis as typeof globalThis & {
  __MWI_RADAR_DISABLE_AUTO_START__?: boolean;
}).__MWI_RADAR_DISABLE_AUTO_START__ === true;

if (typeof window !== 'undefined' && !autoStartDisabled) {
  startForCurrentOrigin();
}
