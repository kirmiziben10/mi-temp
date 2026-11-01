import type { HistoryPoint } from '../protocol/types';

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const defined = (xs: (number | undefined)[]) => xs.filter((x): x is number => x !== undefined);

/**
 * Reduces a series to at most `maxPoints` time buckets so long ranges stay fast to render.
 * Averages the means, and keeps the extremes: bucket min/max come from the min/max fields
 * when present, else from the raw values.
 */
export function downsample(points: HistoryPoint[], maxPoints: number): HistoryPoint[] {
  if (points.length <= maxPoints) return points;
  const first = points[0]!.t;
  const span = points[points.length - 1]!.t - first || 1;
  const buckets: HistoryPoint[][] = [];
  for (const p of points) {
    const i = Math.min(maxPoints - 1, Math.floor(((p.t - first) / span) * maxPoints));
    (buckets[i] ??= []).push(p);
  }
  return buckets
    .filter((b) => b && b.length)
    .map((b) => {
      const minT = Math.min(...defined(b.map((p) => p.minTemperature ?? p.temperature)));
      const maxT = Math.max(...defined(b.map((p) => p.maxTemperature ?? p.temperature)));
      const minH = Math.min(...defined(b.map((p) => p.minHumidity ?? p.humidity)));
      const maxH = Math.max(...defined(b.map((p) => p.maxHumidity ?? p.humidity)));
      return {
        t: Math.round(avg(b.map((p) => p.t))),
        temperature: Math.round(avg(b.map((p) => p.temperature)) * 100) / 100,
        humidity: Math.round(avg(b.map((p) => p.humidity)) * 10) / 10,
        minTemperature: minT,
        maxTemperature: maxT,
        minHumidity: minH,
        maxHumidity: maxH,
      };
    });
}
