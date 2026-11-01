/** A point on a history chart. Times are epoch milliseconds. */
export interface HistoryPoint {
  t: number;
  temperature: number;
  humidity: number;
  /** Stock firmware logs hourly min/max aggregates; `temperature`/`humidity` hold the midpoint. */
  minTemperature?: number;
  maxTemperature?: number;
  minHumidity?: number;
  maxHumidity?: number;
  voltage?: number;
  /** Stock firmware record index (stable identity for incremental syncs). */
  index?: number;
}

export type Firmware = 'stock' | 'pvvx';

export interface SyncProgress {
  received: number;
  /** Unknown for pvvx (the firmware does not report a count up front). */
  expected?: number;
}

export type LogFn = (message: string, data?: unknown) => void;

export interface SyncOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
  log?: LogFn;
}

export interface SyncResult {
  points: HistoryPoint[];
  /** False when the stream stopped (timeout/cancel) before the newest record arrived. */
  complete: boolean;
}
