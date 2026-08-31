import { DEFAULT_DASHBOARD_ORIGINS } from './origins';

declare const __MWI_RADAR_DASHBOARD_ORIGINS__: readonly string[];

const MWI_ORIGIN = 'https://www.milkywayidle.com';
const dashboardOrigins: readonly string[] =
  typeof __MWI_RADAR_DASHBOARD_ORIGINS__ === 'undefined'
    ? DEFAULT_DASHBOARD_ORIGINS
    : __MWI_RADAR_DASHBOARD_ORIGINS__;

export type OriginRoute = 'mwi' | 'dashboard' | 'none';

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

function startMwiRoute(): void {
  // Reserved for the read-only MWI collector integration.
}

function startDashboardRoute(): void {
  // Reserved for the dashboard-side bridge.
}

export function startForCurrentOrigin(
  locationReference: string | URL = typeof window === 'undefined' ? '' : window.location.href,
): OriginRoute {
  const route = resolveOriginRoute(locationReference, dashboardOrigins);

  if (route === 'mwi') {
    startMwiRoute();
  } else if (route === 'dashboard') {
    startDashboardRoute();
  }

  return route;
}

if (typeof window !== 'undefined') {
  startForCurrentOrigin();
}
