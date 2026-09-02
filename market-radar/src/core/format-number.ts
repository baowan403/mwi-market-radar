const DISPLAY = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatCompactNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${DISPLAY.format(value / 1_000_000)}M`;
  if (magnitude >= 1_000) return `${DISPLAY.format(value / 1_000)}K`;
  return DISPLAY.format(value);
}
