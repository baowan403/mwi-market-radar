export const DEFAULT_DASHBOARD_ORIGINS = ['http://localhost:4173'] as const;

function isPathWithinDashboardBase(pathname: string, basePathname: string): boolean {
  const basePath = basePathname.replace(/\/+$/, '');
  return basePath === '' || pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function normalizeDashboardOrigins(value = DEFAULT_DASHBOARD_ORIGINS.join(',')): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function toUserscriptMatches(origins: readonly string[]): string[] {
  return origins.map((origin) => `${origin.replace(/\/+$/, '')}/*`);
}

/** Check a complete URL against an exact origin and path base allowlist. */
export function isAllowedDashboardUrl(
  locationReference: string | URL,
  allowedBaseUrls: readonly string[],
): boolean {
  let currentUrl: URL;
  try {
    currentUrl = typeof locationReference === 'string' ? new URL(locationReference) : locationReference;
  } catch {
    return false;
  }

  return allowedBaseUrls.some((baseUrl) => {
    try {
      const dashboardUrl = new URL(baseUrl);
      return currentUrl.origin === dashboardUrl.origin
        && isPathWithinDashboardBase(currentUrl.pathname, dashboardUrl.pathname);
    } catch {
      return false;
    }
  });
}
