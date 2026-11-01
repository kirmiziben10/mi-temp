/**
 * Pure bookkeeping between the device-log cache and a history sync: what to ask the device for,
 * and what to store afterwards. Kept out of the React hook so every edge case is unit-tested.
 */
import type { PvvxSyncOptions } from '../protocol/pvvx';
import type { StockSyncOptions, StockSyncResult } from '../protocol/stockHistory';
import type { Firmware, HistoryPoint, SyncResult } from '../protocol/types';
import { mergeDeviceLog, STOCK_SAME_RECORD_MS, type DeviceLog } from './history';

/** The cached log, if it belongs to the same firmware (a reflash invalidates it). */
export function usableCache(cached: DeviceLog | null, firmware: Firmware): DeviceLog | null {
  return cached && cached.firmware === firmware ? cached : null;
}

export function stockRequest(cache: DeviceLog | null): Pick<StockSyncOptions, 'afterIndex' | 'expectedEpoch'> {
  return { afterIndex: cache?.lastIndex, expectedEpoch: cache?.deviceEpoch };
}

export function applyStockResult(cache: DeviceLog | null, res: StockSyncResult): DeviceLog {
  return {
    firmware: 'stock',
    points: mergeDeviceLog(cache?.points ?? [], res.points, {
      deviceReset: res.deviceReset,
      toleranceMs: STOCK_SAME_RECORD_MS,
    }),
    // Never past a gap (see stockHistory.ts), so missed records are retried next time.
    lastIndex: res.resumeAfter,
    deviceEpoch: res.deviceEpoch,
  };
}

/**
 * pvvx streams newest-first, so a sync normally stops at the newest cached record. After an
 * interrupted read-out only the newest part is cached, and stopping there would never reach the
 * older records. In that case read everything and let the merge drop duplicates.
 */
export function pvvxRequest(cache: DeviceLog | null): Pick<PvvxSyncOptions, 'newerThan'> {
  if (!cache || cache.incomplete) return { newerThan: undefined };
  return { newerThan: cache.points.at(-1)?.t };
}

export function applyPvvxResult(cache: DeviceLog | null, res: SyncResult): DeviceLog {
  return { firmware: 'pvvx', points: mergeDeviceLog(cache?.points ?? [], res.points), incomplete: !res.complete };
}

export const countAdded = (before: HistoryPoint[] | undefined, after: HistoryPoint[]) =>
  Math.max(0, after.length - (before?.length ?? 0));
