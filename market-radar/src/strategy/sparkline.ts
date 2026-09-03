import type { StrategyMarginPoint } from './margin-series';

export interface SparklineOptions {
  width?: number;
  height?: number;
  strokeWidth?: number;
}

/**
 * 依據利潤時間序列生成超輕量級 SVG Sparkline 折線圖。
 * 若最新利潤高於起點呈現上漲綠，若低於起點呈現下跌紅。
 */
export function generateSparklineSvg(
  points: readonly StrategyMarginPoint[],
  options: SparklineOptions = {},
): string {
  const width = options.width ?? 76;
  const height = options.height ?? 22;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const paddingY = 3;

  if (!points || points.length < 2) {
    return `<svg class="strategy-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--color-muted)" stroke-dasharray="2 2" stroke-width="1"/></svg>`;
  }

  // 取得數值陣列（優先取 realizableProfitPerDay，若無則取 theoreticalProfitPerHour * 24）
  const values = points.map((p) => {
    if (typeof p.realizableProfitPerDay === 'number' && Number.isFinite(p.realizableProfitPerDay)) {
      return p.realizableProfitPerDay;
    }
    if (typeof p.theoreticalProfitPerHour === 'number' && Number.isFinite(p.theoreticalProfitPerHour)) {
      return p.theoreticalProfitPerHour * 24;
    }
    return 0;
  });

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const innerHeight = height - paddingY * 2;
  const stepX = width / (values.length - 1);

  const coords = values.map((val, idx) => {
    const x = Math.round(idx * stepX * 10) / 10;
    const normalizedY = range > 1e-6 ? (val - min) / range : 0.5;
    // SVG Y 軸向下增加，因此 1 - normalizedY
    const y = Math.round((paddingY + (1 - normalizedY) * innerHeight) * 10) / 10;
    return { x, y };
  });

  const pathD = coords.reduce((acc, pt, idx) => {
    return `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`;
  }, '');

  const firstVal = values[0] ?? 0;
  const lastVal = values[values.length - 1] ?? 0;
  const isUp = lastVal >= firstVal;
  const strokeColor = isUp ? '#34d399' : '#f87171';
  const lastCoord = coords[coords.length - 1] ?? { x: width, y: height / 2 };

  return `<svg class="strategy-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lastCoord.x}" cy="${lastCoord.y}" r="2" fill="${strokeColor}"/></svg>`;
}
