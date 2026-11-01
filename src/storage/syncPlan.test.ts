import { beforeEach, describe, expect, it } from 'vitest';
import { syncPvvxHistory, type PvvxChannel } from '../protocol/pvvx';
import { parsePvvxPacket } from '../protocol/codec';
import { syncStockHistory } from '../protocol/stockHistory';
import { PVVX } from '../protocol/uuids';
import { fakePvvxDevice, fakeStockDevice, hourly, type FakeConnection, type StockDeviceOptions } from '../test/fakeDevices';
import { loadDeviceLog, saveDeviceLogTrimming, type DeviceLog } from './history';
import { applyPvvxResult, applyStockResult, pvvxRequest, stockRequest } from './syncPlan';

const FAST = { firstRecordTimeoutMs: 400, idleTimeoutMs: 150 };

async function syncStock(conn: FakeConnection, cache: DeviceLog | null) {
  const res = await syncStockHistory(conn, { ...FAST, ...stockRequest(cache) });
  return { res, cache: applyStockResult(cache, res) };
}

describe('stock sync across sessions', () => {
  it('keeps new records after the device resets to an empty log (review: empty reset)', async () => {
    // Session 1: a device that has been logging for a while (records 1..50, a week old).
    const device: StockDeviceOptions = { records: [], clock: 2_000_000 };
    device.records = hourly(1, 50, device.clock, 170);
    const conn = fakeStockDevice(device);
    let { cache } = await syncStock(conn, null);
    expect(cache.points).toHaveLength(50);
    expect(cache.lastIndex).toBe(50);

    // Battery swap: counter back to 0, clock restarted.
    device.records = [];
    device.clock = 600;
    let res;
    ({ res, cache } = await syncStock(conn, cache));
    expect(res.deviceReset).toBe(true);
    expect(cache.lastIndex).toBe(0);
    expect(cache.points).toHaveLength(50);
    expect(cache.points.every((p) => p.index === undefined)).toBe(true); // old indices released

    // Three hours later it has logged records 1..3 again: these must be kept, not deduplicated.
    device.clock = 4 * 3600 + 600;
    device.records = hourly(1, 3, device.clock);
    ({ res, cache } = await syncStock(conn, cache));
    expect(res.points.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(cache.points).toHaveLength(53);
    expect(cache.lastIndex).toBe(3);
  });

  it('detects a reset after which the counter already passed the cached index', async () => {
    const device: StockDeviceOptions = { records: [], clock: 2_000_000 };
    device.records = hourly(1, 10, device.clock, 300);
    const conn = fakeStockDevice(device);
    let { cache } = await syncStock(conn, null);

    // Reset, and by the next sync it has logged 20 new records: counter 20 > cached 10.
    device.clock = 21 * 3600 + 100;
    device.records = hourly(1, 20, device.clock);
    const after = await syncStock(conn, cache);
    cache = after.cache;
    expect(after.res.deviceReset).toBe(true);
    expect(after.res.points).toHaveLength(20); // full download, not just 11..20
    expect(cache.points).toHaveLength(30);
    expect(cache.lastIndex).toBe(20);
  });

  it('a record missed in one sync is fetched by the next (review: missed packet)', async () => {
    const device: StockDeviceOptions = { records: [], clock: 2_000_000, dropAlways: [5] };
    device.records = hourly(1, 10, device.clock);
    const conn = fakeStockDevice(device);
    let { cache } = await syncStock(conn, null);
    expect(cache.points).toHaveLength(9);
    expect(cache.lastIndex).toBe(4);

    device.dropAlways = [];
    ({ cache } = await syncStock(conn, cache));
    expect(cache.points.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cache.lastIndex).toBe(10);
  });

  it('does not duplicate records when a clock change is mistaken for a reset', async () => {
    const device: StockDeviceOptions = { records: [], clock: 2_000_000 };
    device.records = hourly(1, 10, device.clock);
    const conn = fakeStockDevice(device);
    let { cache } = await syncStock(conn, null);
    // Same records, but the epoch looks different (e.g. an app set the clock): full re-download.
    cache = { ...cache, deviceEpoch: (cache.deviceEpoch ?? 0) - 86_400_000 };
    const after = await syncStock(conn, cache);
    expect(after.res.deviceReset).toBe(true);
    expect(after.cache.points).toHaveLength(10);
  });
});

function channel(conn: FakeConnection): PvvxChannel {
  const handlers = new Set<Parameters<PvvxChannel['onPacket']>[0]>();
  void conn.subscribe(PVVX.SERVICE, PVVX.COMMAND, (v) => {
    const p = parsePvvxPacket(v);
    if (p) handlers.forEach((h) => h(p));
  });
  return {
    send: (b) => conn.write(PVVX.SERVICE, PVVX.COMMAND, b),
    onPacket: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
}

describe('pvvx sync across sessions', () => {
  it('fetches the older records after an interrupted read-out (review: pvvx resume)', async () => {
    const clock = 5_000_000;
    const records = Array.from({ length: 40 }, (_, i) => ({ deviceTime: clock - (40 - i) * 600, temperature: 20, humidity: 50, mv: 3000 }));
    const conn = fakePvvxDevice({ records, clock, stopAfterOnce: 15 });
    const ch = channel(conn);

    let res = await syncPvvxHistory(ch, { ...FAST, ...pvvxRequest(null) });
    let cache = applyPvvxResult(null, res);
    expect(res.complete).toBe(false);
    expect(cache).toMatchObject({ incomplete: true });
    expect(cache.points).toHaveLength(15); // only the newest part

    // Next sync must not stop at the cached (newest) records.
    expect(pvvxRequest(cache).newerThan).toBeUndefined();
    res = await syncPvvxHistory(ch, { ...FAST, ...pvvxRequest(cache) });
    cache = applyPvvxResult(cache, res);
    expect(res.complete).toBe(true);
    expect(cache.points).toHaveLength(40);
    expect(cache.incomplete).toBe(false);

    // Back to normal incremental syncs afterwards.
    expect(pvvxRequest(cache).newerThan).toBe(cache.points.at(-1)!.t);
  });
});

describe('saving with a full storage (review: unsaved cache)', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > 20_000) throw new DOMException('quota', 'QuotaExceededError');
        m.set(k, v);
      },
      removeItem: (k: string) => m.delete(k),
    };
  });

  const log = (n: number): DeviceLog => ({
    firmware: 'pvvx',
    points: Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + i * 600_000, temperature: 21.25, humidity: 45.5 })),
  });

  it('keeps the newest records when everything does not fit', () => {
    const kept = saveDeviceLogTrimming('dev', log(1000));
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(1000);
    const saved = loadDeviceLog('dev')!;
    expect(saved.points).toHaveLength(kept);
    expect(saved.points.at(-1)!.t).toBe(log(1000).points.at(-1)!.t);
  });

  it('reports 0 when nothing can be saved', () => {
    (globalThis.localStorage as unknown as { setItem: () => void }).setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    expect(saveDeviceLogTrimming('dev', log(10))).toBe(0);
  });
});
