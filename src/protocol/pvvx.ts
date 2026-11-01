/**
 * pvvx custom firmware (github.com/pvvx/ATC_MiThermometer): live readings and flash log.
 *
 * Everything goes through one command characteristic (0x1f1f). Verified against the firmware
 * source (cmd_parser.c / ble.c send_memo_blk) and pvvx's GraphMemo.html:
 *   [0x23]                     -> [0x23, u32 device time]
 *   [0x33, 1]                  -> stream of [0x33, u16 mV, s16 T/100, s16 H/100, ...]
 *   [0x35, cnt16, start16]     -> cnt records newest-first [0x35, u16 n, u32 time, s16 T, u16 H, u16 mV],
 *                                 then [0x35, 0, 0]
 *   [0x35, 0, 0]               -> stop the read-out
 * The previous app expected records under command 0x36 in a 9-byte layout. 0x36 is the
 * firmware's "clear log" command, so that code path could never receive anything.
 */
import { deferred, throwIfAborted, withTimeout } from '../lib/async';
import { isPlausibleTime, readAnchor, toWallTime, type ClockAnchor } from './clock';
import { pvvxLoggerRequest, pvvxLoggerStop, type PvvxPacket } from './codec';
import { waitForStream } from './stream';
import type { HistoryPoint, SyncOptions, SyncResult } from './types';
import { PVVX } from './uuids';

/** The command characteristic, abstracted so one subscription can serve several consumers. */
export interface PvvxChannel {
  send(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  onPacket(handler: (packet: PvvxPacket) => void): () => void;
}

export async function readPvvxClock(channel: PvvxChannel, timeoutMs = 5000): Promise<ClockAnchor> {
  return readAnchor(async () => {
    const reply = deferred<number>();
    const off = channel.onPacket((p) => p.kind === 'time' && reply.resolve(p.deviceTime));
    try {
      await channel.send(new Uint8Array([PVVX.CMD_TIME]));
      return await withTimeout(reply.promise, timeoutMs, 'Reading device clock');
    } finally {
      off();
    }
  });
}

export interface PvvxSyncOptions extends SyncOptions {
  /** Wall time (ms) of the newest record already stored; the read-out stops when it reaches it. */
  newerThan?: number;
  maxRecords?: number;
  firstRecordTimeoutMs?: number;
  idleTimeoutMs?: number;
}

/** Tolerance when deciding that a record is one we already have (clock jitter between syncs). */
export const PVVX_SAME_RECORD_MS = 30_000;

export async function syncPvvxHistory(channel: PvvxChannel, opts: PvvxSyncOptions = {}): Promise<SyncResult> {
  const log = opts.log ?? (() => undefined);
  throwIfAborted(opts.signal);

  const anchor = await readPvvxClock(channel);
  log('Device clock', { deviceSeconds: anchor.deviceSeconds });

  const points: HistoryPoint[] = [];
  const done = deferred<void>();
  let lastActivity: number | null = null;
  let reachedKnown = false;
  let received = 0;
  let skipped = 0;

  const off = channel.onPacket((p) => {
    if (done.settled) return;
    if (p.kind === 'memo-end') return done.resolve();
    if (p.kind !== 'memo') return;
    lastActivity = Date.now();
    const t = toWallTime(anchor, p.deviceTime);
    if (opts.newerThan !== undefined && t <= opts.newerThan + PVVX_SAME_RECORD_MS) {
      // Records arrive newest first, so everything from here on is already stored.
      reachedKnown = true;
      void channel.send(pvvxLoggerStop()).catch(() => undefined);
      return done.resolve();
    }
    received++;
    opts.onProgress?.({ received });
    if (!isPlausibleTime(t)) return void skipped++;
    points.push({ t, temperature: p.temperature, humidity: p.humidity, voltage: p.voltage });
  });

  let end: 'done' | 'idle';
  try {
    log('Requesting flash log');
    await channel.send(pvvxLoggerRequest(opts.maxRecords ?? 0xffff));
    end = await waitForStream({
      done,
      signal: opts.signal,
      lastActivity: () => lastActivity,
      firstPacketTimeoutMs: opts.firstRecordTimeoutMs ?? 15_000,
      idleTimeoutMs: opts.idleTimeoutMs ?? 5_000,
    });
  } catch (err) {
    await channel.send(pvvxLoggerStop()).catch(() => undefined);
    throw err;
  } finally {
    off();
  }

  points.sort((a, b) => a.t - b.t);
  if (skipped) log(`Skipped ${skipped} records with impossible timestamps (device clock was changed)`);
  log(reachedKnown ? `Received ${points.length} new records` : `Received ${points.length} records`);
  return { points, complete: end === 'done' };
}
