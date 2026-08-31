import { DEFAULT_DASHBOARD_ORIGINS } from './origins';

declare const __MWI_RADAR_DASHBOARD_ORIGINS__: readonly string[];

const MWI_ORIGIN = 'https://www.milkywayidle.com';
const dashboardOrigins: readonly string[] =
  typeof __MWI_RADAR_DASHBOARD_ORIGINS__ === 'undefined'
    ? DEFAULT_DASHBOARD_ORIGINS
    : __MWI_RADAR_DASHBOARD_ORIGINS__;

export type OriginRoute = 'mwi' | 'dashboard' | 'none';

export function resolveOriginRoute(origin: string, allowedDashboardOrigins: readonly string[]): OriginRoute {
  if (origin === MWI_ORIGIN) {
    return 'mwi';
  }

  if (allowedDashboardOrigins.includes(origin)) {
    return 'dashboard';
  }

  return 'none';
}

function startMwiRoute(): void {
  // Reserved for the read-only MWI collector integration.
}

function startDashboardRoute(): void {
  // Reserved for the dashboard-side bridge.
}

export function startForCurrentOrigin(origin = typeof window === 'undefined' ? '' : window.location.origin): OriginRoute {
  const route = resolveOriginRoute(origin, dashboardOrigins);

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
