export const DEFAULT_DASHBOARD_ORIGINS = ['http://localhost:4173'] as const;

export function normalizeDashboardOrigins(value = DEFAULT_DASHBOARD_ORIGINS.join(',')): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function toUserscriptMatches(origins: readonly string[]): string[] {
  return origins.map((origin) => `${origin.replace(/\/+$/, '')}/*`);
}
