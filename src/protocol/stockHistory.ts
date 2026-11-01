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
  /** `deviceEpoch` from the previous sync, used to notice a reset the counter alone can't show. */
  expectedEpoch?: number;
  firstRecordTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface StockSyncResult extends SyncResult {
  /** Newest record index reported by the device. */
  lastIndex: number;
  /** The device was reset (battery change): its counter went backwards or its clock restarted. */
  deviceReset: boolean;
  /**
   * Where the next sync should continue from: the newest index such that every record up to it
   * (within what the device still holds) has been received. Never skips past a gap.
   * Undefined when nothing usable is known (e.g. reset and nothing received).
   */
  resumeAfter: number | undefined;
  /** Host time (ms) at which the device clock read zero — stable across syncs until a reset. */
  deviceEpoch: number;
  /** Indices that were still missing after the retry. */
  missing: number[];
}

/**
 * How far the device's boot time may move between syncs before we call it a reset. Clock drift on
 * these sensors is seconds per day; a battery swap moves it by at least the time it was out.
 */
const EPOCH_TOLERANCE_MS = 3600_000;

export async function syncStockHistory(conn: BleConnection, opts: StockSyncOptions = {}): Promise<StockSyncResult> {
  const log = opts.log ?? (() => undefined);
  throwIfAborted(opts.signal);

  const count = parseRecordCount(await conn.read(STOCK.SERVICE, STOCK.NUM_RECORDS));
  if (!count) throw new Error('Unexpected record counter format');
  log('Record counter', { newestIndex: count.lastIndex, newSinceLastReadout: count.newCount });

  const anchor = await readAnchor(async () => {
    const seconds = parseDeviceClock(await conn.read(STOCK.SERVICE, STOCK.TIME));
    if (seconds === null) throw new Error('Unexpected device clock format');
    return seconds;
  });
  const deviceEpoch = anchor.hostMs - anchor.deviceSeconds * 1000;
  log('Device clock', { deviceSeconds: anchor.deviceSeconds });

  // A reset shows up as the record counter going backwards (including down to an empty log), or
  // as the device clock having restarted even if the counter has already climbed past our index.
  const counterWentBack = opts.afterIndex !== undefined && opts.afterIndex > count.lastIndex;
  const clockRestarted =
    opts.expectedEpoch !== undefined && Math.abs(deviceEpoch - opts.expectedEpoch) > EPOCH_TOLERANCE_MS;
  const deviceReset = counterWentBack || clockRestarted;
  if (deviceReset) {
    log(
      counterWentBack
        ? 'Record counter went backwards — device was reset; downloading everything'
        : 'Device clock restarted — device was reset; downloading everything',
    );
  }
  const base = { lastIndex: count.lastIndex, deviceReset, deviceEpoch, missing: [] as number[] };

  if (count.lastIndex === 0) {
    log('The device has not logged any hourly records yet (first record appears after one hour)');
    return { ...base, points: [], complete: true, resumeAfter: 0 };
  }
  if (!deviceReset && opts.afterIndex === count.lastIndex) {
    log('Already up to date');
    return { ...base, points: [], complete: true, resumeAfter: count.lastIndex };
  }
  const start = !deviceReset && opts.afterIndex !== undefined ? opts.afterIndex + 1 : 0;

  const records = new Map<number, HistoryPoint>();
  let done = deferred<void>();
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

  // Indices the device should have sent but didn't. Anything below the oldest record received
  // has expired from the device's ring buffer and is not a gap.
  const findMissing = () => {
    const missing: number[] = [];
    if (firstIndex === null) return missing;
    for (let i = Math.max(acceptFrom, firstIndex); i <= count.lastIndex; i++) if (!records.has(i)) missing.push(i);
    return missing;
  };

  const stream = (fromIndex: number) => {
    lastActivity = null;
    return waitForStream({
      done,
      signal: opts.signal,
      lastActivity: () => lastActivity,
      firstPacketTimeoutMs: opts.firstRecordTimeoutMs ?? 20_000,
      idleTimeoutMs: opts.idleTimeoutMs ?? 10_000,
      onFirstPacketTimeout:
        fromIndex > 0 && records.size === 0
          ? async () => {
              log('No records after resume request; falling back to a full download');
              acceptFrom = 0;
              await conn.write(STOCK.SERVICE, STOCK.RECORD_IDX, u32le(0));
              return true;
            }
          : undefined,
    });
  };

  let end: 'done' | 'idle';
  let missing: number[];
  try {
    await conn.setHighThroughput?.(true);
    log(start === 0 ? 'Requesting all stored records' : `Requesting records from #${start}`);
    await conn.write(STOCK.SERVICE, STOCK.RECORD_IDX, u32le(start));
    end = await stream(start);

    // A notification can be dropped (e.g. a full Android notification queue). Ask once more from
    // the first gap; the re-sent records are de-duplicated by index.
    missing = findMissing();
    if (missing.length > 0) {
      log(`Missing ${missing.length} record(s), re-requesting from #${missing[0]}`);
      done = deferred<void>();
      await conn.write(STOCK.SERVICE, STOCK.RECORD_IDX, u32le(missing[0]!));
      end = await stream(missing[0]!).catch((err) => {
        if (opts.signal?.aborted) throw err; // a cancel still cancels
        return 'idle' as const; // otherwise keep what we have and report the gap
      });
      missing = findMissing();
    }
  } finally {
    await unsubscribe();
    await conn.setHighThroughput?.(false);
  }

  const all = [...records.values()];
  const points = all.filter((p) => isPlausibleTime(p.t)).sort((a, b) => a.t - b.t);
  if (points.length < all.length) {
    log(`Skipped ${all.length - points.length} records with impossible timestamps (device clock was changed)`);
  }
  const complete = end === 'done' && missing.length === 0;

  // Resume point: never past the first gap, never past the last record actually received.
  let resumeAfter: number | undefined;
  if (firstIndex === null) {
    resumeAfter = deviceReset ? undefined : opts.afterIndex;
  } else {
    resumeAfter = Math.max(acceptFrom, firstIndex) - 1;
    while (records.has(resumeAfter + 1)) resumeAfter++;
    if (missing.length > 0) resumeAfter = Math.min(resumeAfter, missing[0]! - 1);
  }

  log(
    complete
      ? `Received ${points.length} records`
      : missing.length
        ? `Received ${points.length} records; ${missing.length} still missing — the next sync retries them`
        : `Stream stopped early: ${points.length} records`,
  );
  return { points, complete, lastIndex: count.lastIndex, deviceReset, resumeAfter, deviceEpoch, missing };
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
