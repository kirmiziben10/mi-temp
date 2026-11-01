/**
 * History download for the stock Xiaomi firmware.
 *
 * Protocol (verified against h4/lywsd02, uduncanu/lywsd03mmc and pvvx GraphMemoOriginal.html):
 *   1. read  NUM_RECORDS -> lastIndex (index of the newest hourly record), newCount
 *   2. read  TIME        -> device clock, used as the anchor for record timestamps
 *   3. enable notifications on HISTORY
 *   4. write RECORD_IDX = start index (0 = everything still stored)
 *   5. the device streams 14-byte records, oldest first, ending with idx == lastIndex
 *
 * What the previous implementation got wrong, and what is done here instead:
 *   - It stopped after `newCount` records ("current records"). That is the number of records
 *     added since the last read-out, not the number stored, so it usually cut the download
 *     short. Here completion is "the record with idx == lastIndex arrived".
 *   - It gave up after 3 s of silence, but this device is slow: the reference client waits 15 s.
 *     Here: up to 20 s for the first record, then 10 s of silence between records.
 *   - It always downloaded everything. Here a sync resumes after the last index already
 *     downloaded, falling back to a full download if the device was reset (counter went
 *     backwards) or ignores the resume index.
 *   - Records are keyed by index, so duplicates from re-sends are dropped.
 */
import { deferred, throwIfAborted } from '../lib/async';
import { u32le } from '../lib/bytes';
import type { BleConnection } from '../ble/types';
import { isPlausibleTime, readAnchor, toWallTime, type ClockAnchor } from './clock';
import { parseDeviceClock, parseRecordCount, parseStockRecord, type StockRecord } from './codec';
import { waitForStream } from './stream';
import type { HistoryPoint, SyncOptions, SyncResult } from './types';
import { STOCK } from './uuids';

export interface StockSyncOptions extends SyncOptions {
  /** Index of the newest record already downloaded; the sync fetches only records after it. */
  afterIndex?: number;
  firstRecordTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface StockSyncResult extends SyncResult {
  /** Newest record index reported by the device. */
  lastIndex: number;
  /** The device's record counter went backwards (battery change / reset). */
  deviceReset: boolean;
}

export async function syncStockHistory(conn: BleConnection, opts: StockSyncOptions = {}): Promise<StockSyncResult> {
  const log = opts.log ?? (() => undefined);
  throwIfAborted(opts.signal);

  const count = parseRecordCount(await conn.read(STOCK.SERVICE, STOCK.NUM_RECORDS));
  if (!count) throw new Error('Unexpected record counter format');
  log('Record counter', { newestIndex: count.lastIndex, newSinceLastReadout: count.newCount });

  if (count.lastIndex === 0) {
    log('The device has not logged any hourly records yet (first record appears after one hour)');
    return { points: [], complete: true, lastIndex: 0, deviceReset: false };
  }

  let start = 0;
  let deviceReset = false;
  if (opts.afterIndex !== undefined) {
    if (opts.afterIndex > count.lastIndex) {
      deviceReset = true;
      log('Record counter went backwards — device was reset; downloading everything');
    } else if (opts.afterIndex === count.lastIndex) {
      log('Already up to date');
      return { points: [], complete: true, lastIndex: count.lastIndex, deviceReset: false };
    } else {
      start = opts.afterIndex + 1;
    }
  }

  const anchor = await readAnchor(async () => {
    const seconds = parseDeviceClock(await conn.read(STOCK.SERVICE, STOCK.TIME));
    if (seconds === null) throw new Error('Unexpected device clock format');
    return seconds;
  });
  log('Device clock', { deviceSeconds: anchor.deviceSeconds });

  const records = new Map<number, HistoryPoint>();
  const done = deferred<void>();
  let lastActivity: number | null = null;
  let firstIndex: number | null = null;
  let acceptFrom = start;

  const unsubscribe = await conn.subscribe(STOCK.SERVICE, STOCK.HISTORY, (value) => {
    const record = parseStockRecord(value);
    if (!record || record.index < acceptFrom) return;
    lastActivity = Date.now();
    firstIndex = firstIndex === null ? record.index : Math.min(firstIndex, record.index);
    records.set(record.index, toPoint(record, anchor));
    opts.onProgress?.({ received: records.size, expected: count.lastIndex - firstIndex + 1 });
    if (record.index >= count.lastIndex) done.resolve();
  });

  let end: 'done' | 'idle';
  try {
    await conn.setHighThroughput?.(true);
    log(start === 0 ? 'Requesting all stored records' : `Requesting records from #${start}`);
    await conn.write(STOCK.SERVICE, STOCK.RECORD_IDX, u32le(start));
    end = await waitForStream({
      done,
      signal: opts.signal,
      lastActivity: () => lastActivity,
      firstPacketTimeoutMs: opts.firstRecordTimeoutMs ?? 20_000,
      idleTimeoutMs: opts.idleTimeoutMs ?? 10_000,
      onFirstPacketTimeout:
        start > 0
          ? async () => {
              log('No records after resume request; falling back to a full download');
              acceptFrom = 0;
              await conn.write(STOCK.SERVICE, STOCK.RECORD_IDX, u32le(0));
              return true;
            }
          : undefined,
    });
  } finally {
    await unsubscribe();
    await conn.setHighThroughput?.(false);
  }

  const all = [...records.values()];
  const points = all.filter((p) => isPlausibleTime(p.t)).sort((a, b) => a.t - b.t);
  if (points.length < all.length) {
    log(`Skipped ${all.length - points.length} records with impossible timestamps (device clock was changed)`);
  }
  const complete = end === 'done';
  log(complete ? `Received ${points.length} records` : `Stream stopped early: ${points.length} records`);
  return { points, complete, lastIndex: count.lastIndex, deviceReset };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function toPoint(r: StockRecord, anchor: ClockAnchor): HistoryPoint {
  return {
    t: toWallTime(anchor, r.deviceTime),
    index: r.index,
    temperature: round1((r.minTemperature + r.maxTemperature) / 2),
    humidity: round1((r.minHumidity + r.maxHumidity) / 2),
    minTemperature: r.minTemperature,
    maxTemperature: r.maxTemperature,
    minHumidity: r.minHumidity,
    maxHumidity: r.maxHumidity,
  };
}
