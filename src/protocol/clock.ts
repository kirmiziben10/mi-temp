/**
 * Mapping device-clock seconds to wall-clock time.
 *
 * Neither firmware has a trustworthy wall clock. On stock firmware the clock counts seconds
 * since the battery was inserted, unless an app set it. On pvvx it is whatever was last
 * written, in whatever timezone the writer used. What is reliable is the difference between two
 * device timestamps. So we read the device clock once per session (the "anchor") and place
 * every record relative to it:
 *
 *     wallTime(record) = anchor.hostMs - (anchor.deviceSeconds - record.deviceSeconds) * 1000
 *
 * This is what the reference implementations do (lywsd03mmc `start_time`, pvvx GraphMemoOriginal).
 */
export interface ClockAnchor {
  deviceSeconds: number;
  hostMs: number;
}

export function toWallTime(anchor: ClockAnchor, deviceSeconds: number): number {
  return anchor.hostMs - (anchor.deviceSeconds - deviceSeconds) * 1000;
}

/**
 * Reads the device clock and timestamps it at the midpoint of the request, which halves the
 * error from BLE round-trip latency (typically 30–500 ms).
 */
export async function readAnchor(readDeviceSeconds: () => Promise<number>, now = () => Date.now()): Promise<ClockAnchor> {
  const before = now();
  const deviceSeconds = await readDeviceSeconds();
  const after = now();
  return { deviceSeconds, hostMs: Math.round((before + after) / 2) };
}

/** Oldest/newest wall time a log record can plausibly have. */
const MAX_AGE_MS = 2 * 365 * 24 * 3600_000;
const MAX_FUTURE_MS = 3600_000;

/**
 * False for timestamps that cannot be right. This happens for records written before the device
 * clock was set or changed (e.g. by Mi Home or a battery swap): they are on a different time base
 * than the anchor, and would otherwise land decades away and wreck the chart axis.
 */
export function isPlausibleTime(t: number, now = Date.now()): boolean {
  return t <= now + MAX_FUTURE_MS && t >= now - MAX_AGE_MS;
}
