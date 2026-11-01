/**
 * Persistence for both history sources.
 *
 * Local log: samples the app records while connected. The old app stored *every* notification
 * (one every ~6 s) and kept 1000 of them, so the "Local" chart only ever covered ~1.5 hours and
 * rewrote localStorage six times a minute. Now it keeps one sample per minute for 14 days.
 *
 * Device log: records downloaded from the thermometer, cached per device, so the chart survives
 * reloads and later syncs only fetch what's new.
 */
import type { Firmware, HistoryPoint } from '../protocol/types';
import { storage } from './storage';

export const LOCAL_SAMPLE_INTERVAL_MS = 60_000;
export const LOCAL_MAX_POINTS = 14 * 24 * 60;
export const DEVICE_MAX_POINTS = 25_000;

const LOCAL_KEY = 'miTemp.v2.localLog';
const LEGACY_LOCAL_KEY = 'mi_temp_history';
const deviceKey = (id: string) => `miTemp.v2.device.${id}`;

// Compact tuples keep the JSON ~3x smaller than objects.
type LocalTuple = [t: number, temperature: number, humidity: number];
type DeviceTuple = [
  t: number,
  temperature: number,
  humidity: number,
  minT: number | null,
  maxT: number | null,
  minH: number | null,
  maxH: number | null,
  voltage: number | null,
  index: number | null,
];

export function loadLocalLog(): HistoryPoint[] {
  const saved = storage.get<{ v: 2; points: LocalTuple[] }>(LOCAL_KEY);
  if (saved?.v === 2 && Array.isArray(saved.points)) {
    return saved.points.map(([t, temperature, humidity]) => ({ t, temperature, humidity }));
  }
  // One-time migration from the previous app's format.
  const legacy = storage.get<{ timestamp: number; temperature: number; humidity: number }[]>(LEGACY_LOCAL_KEY);
  if (Array.isArray(legacy)) {
    const points = legacy
      .filter((p) => Number.isFinite(p?.timestamp) && Number.isFinite(p?.temperature))
      .map((p) => ({ t: p.timestamp, temperature: p.temperature, humidity: p.humidity }));
    const thinned = thinToInterval(points, LOCAL_SAMPLE_INTERVAL_MS);
    if (saveLocalLog(thinned)) storage.remove(LEGACY_LOCAL_KEY);
    return thinned;
  }
  return [];
}

export function saveLocalLog(points: HistoryPoint[]): boolean {
  const tuples: LocalTuple[] = points.slice(-LOCAL_MAX_POINTS).map((p) => [p.t, p.temperature, p.humidity]);
  return storage.set(LOCAL_KEY, { v: 2, points: tuples });
}

/** Appends `sample` unless the previous point is less than the sample interval old. */
export function appendLocalSample(points: HistoryPoint[], sample: HistoryPoint): HistoryPoint[] {
  const last = points[points.length - 1];
  if (last && sample.t - last.t < LOCAL_SAMPLE_INTERVAL_MS) return points;
  const next = points.length >= LOCAL_MAX_POINTS ? points.slice(points.length - LOCAL_MAX_POINTS + 1) : points.slice();
  next.push(sample);
  return next;
}

function thinToInterval(points: HistoryPoint[], interval: number): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (!last || p.t - last.t >= interval) out.push(p);
  }
  return out.slice(-LOCAL_MAX_POINTS);
}

export interface DeviceLog {
  firmware: Firmware;
  points: HistoryPoint[];
  /** Stock: resume point — every record up to this index has been downloaded. */
  lastIndex?: number;
  /** Stock: host time at which the device clock read zero; a jump means the device was reset. */
  deviceEpoch?: number;
  /** pvvx: the last read-out stopped early, so the next one must not stop at known records. */
  incomplete?: boolean;
  lastSync?: number;
}

export function loadDeviceLog(deviceId: string): DeviceLog | null {
  const saved = storage.get<{
    v: 2;
    firmware: Firmware;
    lastIndex?: number;
    deviceEpoch?: number;
    incomplete?: boolean;
    lastSync?: number;
    points: DeviceTuple[];
  }>(
    deviceKey(deviceId),
  );
  if (saved?.v !== 2 || !Array.isArray(saved.points)) return null;
  return {
    firmware: saved.firmware,
    lastIndex: saved.lastIndex,
    deviceEpoch: saved.deviceEpoch,
    incomplete: saved.incomplete,
    lastSync: saved.lastSync,
    points: saved.points.map(([t, temperature, humidity, minT, maxT, minH, maxH, voltage, index]) => ({
      t,
      temperature,
      humidity,
      ...(minT !== null && { minTemperature: minT }),
      ...(maxT !== null && { maxTemperature: maxT }),
      ...(minH !== null && { minHumidity: minH }),
      ...(maxH !== null && { maxHumidity: maxH }),
      ...(voltage !== null && { voltage }),
      ...(index !== null && { index }),
    })),
  };
}

export function saveDeviceLog(deviceId: string, log: DeviceLog): boolean {
  const tuples: DeviceTuple[] = log.points
    .slice(-DEVICE_MAX_POINTS)
    .map((p) => [
      p.t,
      p.temperature,
      p.humidity,
      p.minTemperature ?? null,
      p.maxTemperature ?? null,
      p.minHumidity ?? null,
      p.maxHumidity ?? null,
      p.voltage ?? null,
      p.index ?? null,
    ]);
  return storage.set(deviceKey(deviceId), {
    v: 2,
    firmware: log.firmware,
    lastIndex: log.lastIndex,
    deviceEpoch: log.deviceEpoch,
    incomplete: log.incomplete,
    lastSync: log.lastSync,
    points: tuples,
  });
}

export function clearDeviceLog(deviceId: string) {
  storage.remove(deviceKey(deviceId));
}

/**
 * Merges freshly downloaded points into the cache.
 *
 * Stock records are matched by record index, and the cached copy wins. Its timestamp was
 * computed closest to when the record was made, so it carries the least clock-drift error.
 * On a device reset the indices restart, so indices on the old points are dropped first. Points
 * without an index (pvvx, or stock records from before a reset) are matched by time within
 * `toleranceMs`. That also stops a false-positive reset from duplicating records.
 */
export function mergeDeviceLog(
  existing: HistoryPoint[],
  incoming: HistoryPoint[],
  { deviceReset = false, toleranceMs = 30_000 }: { deviceReset?: boolean; toleranceMs?: number } = {},
): HistoryPoint[] {
  const base: HistoryPoint[] = deviceReset ? existing.map(({ index: _index, ...p }) => p) : existing;
  const byIndex = new Set(base.flatMap((p) => (p.index === undefined ? [] : [p.index])));
  const unindexedTimes = base.filter((p) => p.index === undefined).map((p) => p.t).sort((a, b) => a - b);

  const added = incoming.filter((p) => {
    if (p.index !== undefined && byIndex.has(p.index)) return false;
    return !hasNear(unindexedTimes, p.t, toleranceMs);
  });
  return [...base, ...added].sort((a, b) => a.t - b.t).slice(-DEVICE_MAX_POINTS);
}

/** Stock logs one record per hour, so anything within 10 minutes is the same record. */
export const STOCK_SAME_RECORD_MS = 10 * 60_000;

/**
 * Saves the log, dropping the oldest half if storage is full. Returns how many points were kept
 * (0 if nothing could be saved).
 */
export function saveDeviceLogTrimming(deviceId: string, log: DeviceLog): number {
  let points = log.points.slice(-DEVICE_MAX_POINTS);
  for (let attempt = 0; attempt < 3 && points.length > 0; attempt++) {
    if (saveDeviceLog(deviceId, { ...log, points })) return points.length;
    points = points.slice(Math.floor(points.length / 2));
  }
  return 0;
}

function hasNear(sorted: number[], t: number, tolerance: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  const after = sorted[lo];
  const before = sorted[lo - 1];
  return (after !== undefined && after - t <= tolerance) || (before !== undefined && t - before <= tolerance);
}
