import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '../lib/bytes';
import { fakeMiDevice, fakePvvxDevice, fakeStockDevice, type StockRecordSpec } from '../test/fakeDevices';
import { toWallTime } from './clock';
import { batteryFromVoltage, parsePvvxPacket, parseStockReading, parseStockRecord } from './codec';
import { activateDevice } from './miActivation';
import { syncPvvxHistory, type PvvxChannel } from './pvvx';
import { DeviceSession } from './session';
import { syncStockHistory } from './stockHistory';
import { parsePvvxPacket as parse } from './codec';
import { PVVX, STOCK } from './uuids';
import type { FakeConnection } from '../test/fakeDevices';

const view = (hex: string) => new DataView(hexToBytes(hex).buffer);
const FAST = { firstRecordTimeoutMs: 400, idleTimeoutMs: 150 };

/** Hourly records ending at device time `clock`, indices first..last. */
function hourly(first: number, last: number, clock: number): StockRecordSpec[] {
  if (clock < (last - first + 2) * 3600) throw new Error('fixture: device clock younger than its log');
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const index = first + i;
    return { index, deviceTime: clock - (last - index + 1) * 3600, maxT: 24 + (index % 3), maxH: 50, minT: 21.5, minH: 40 };
  });
}

describe('codec', () => {
  it('decodes stock readings as signed int16 (negative temperatures)', () => {
    // -5.25 °C = 0xFDF3, 61 %, 2950 mV
    expect(parseStockReading(view('f3fd3d860b'))).toEqual({ temperature: -5.25, humidity: 61, voltage: 2.95 });
    expect(parseStockReading(view('f3fd3d'))?.voltage).toBeUndefined();
  });

  it('decodes stock history records (<IIhBhB, °C/10)', () => {
    expect(parseStockRecord(view('2a00000010270000ea00320bffe1'))).toEqual({
      index: 42,
      deviceTime: 10000,
      maxTemperature: 23.4,
      maxHumidity: 50,
      minTemperature: -24.5,
      minHumidity: 225,
    });
  });

  it('decodes pvvx packets', () => {
    expect(parse(view('33860bf308a817'))).toEqual({
      kind: 'measure',
      reading: { voltage: 2.95, temperature: 22.91, humidity: 60.56 },
    });
    expect(parsePvvxPacket(view('3301'))).toEqual({ kind: 'other', command: 0x33 });
    expect(parsePvvxPacket(view('350000'))).toEqual({ kind: 'memo-end' });
    expect(parsePvvxPacket(view('2378563412'))).toEqual({ kind: 'time', deviceTime: 0x12345678 });
  });

  it('estimates battery from voltage', () => {
    expect(batteryFromVoltage(3.3)).toBe(100);
    expect(batteryFromVoltage(2.6)).toBe(50);
    expect(batteryFromVoltage(1.9)).toBe(0);
  });

  it('places device-clock times relative to the anchor', () => {
    expect(toWallTime({ deviceSeconds: 1000, hostMs: 5_000_000 }, 400)).toBe(5_000_000 - 600_000);
  });
});

describe('stock history sync', () => {
  it('downloads every stored record even when "new" count is small (old bug: stopped after newCount)', async () => {
    const clock = 500_000;
    const conn = fakeStockDevice({ records: hourly(1, 120, clock), clock, newCount: 3 });
    const res = await syncStockHistory(conn, FAST);
    expect(res.complete).toBe(true);
    expect(res.points).toHaveLength(120);
    expect(res.lastIndex).toBe(120);
    expect(conn.writes.find((w) => w.char === STOCK.RECORD_IDX)?.hex).toBe('00000000');
    expect(conn.subscriberCount(STOCK.HISTORY)).toBe(0); // unsubscribed afterwards
  });

  it('maps record times through the device clock and keeps min/max', async () => {
    const clock = 7200;
    const conn = fakeStockDevice({ records: hourly(1, 1, clock), clock });
    const before = Date.now();
    const { points } = await syncStockHistory(conn, FAST);
    const p = points[0]!;
    // record at device time 3600, clock now 7200 -> one hour ago
    expect(p.t).toBeGreaterThanOrEqual(before - 3600_000 - 50);
    expect(p.t).toBeLessThanOrEqual(Date.now() - 3600_000 + 50);
    expect(p).toMatchObject({ index: 1, minTemperature: 21.5, maxTemperature: 25, temperature: 23.3, humidity: 45 });
  });

  it('waits for a slow device instead of giving up after a short silence', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 5, clock), clock, firstDelayMs: 250, perRecordMs: 60 });
    const res = await syncStockHistory(conn, { firstRecordTimeoutMs: 1000, idleTimeoutMs: 300 });
    expect(res.complete).toBe(true);
    expect(res.points).toHaveLength(5);
  });

  it('resumes after the last downloaded index', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 20, clock), clock });
    const res = await syncStockHistory(conn, { ...FAST, afterIndex: 15 });
    expect(res.points.map((p) => p.index)).toEqual([16, 17, 18, 19, 20]);
    expect(conn.writes.find((w) => w.char === STOCK.RECORD_IDX)?.hex).toBe(bytesToHex(new Uint8Array([16, 0, 0, 0])));
  });

  it('does not stream when already up to date', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 20, clock), clock });
    const res = await syncStockHistory(conn, { ...FAST, afterIndex: 20 });
    expect(res).toMatchObject({ points: [], complete: true });
    expect(conn.writes).toHaveLength(0);
  });

  it('detects a device reset (counter went backwards) and downloads everything', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 8, clock), clock });
    const res = await syncStockHistory(conn, { ...FAST, afterIndex: 300 });
    expect(res.deviceReset).toBe(true);
    expect(res.points).toHaveLength(8);
  });

  it('falls back to a full download if the device ignores the resume index', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 10, clock), clock, ignoresResume: true });
    const res = await syncStockHistory(conn, { ...FAST, afterIndex: 6 });
    expect(res.complete).toBe(true);
    expect(res.points).toHaveLength(10);
  });

  it('only keeps records from the ring buffer that still exist', async () => {
    const clock = 900_000;
    const conn = fakeStockDevice({ records: hourly(400, 567, clock), clock });
    const progress: number[] = [];
    const res = await syncStockHistory(conn, { ...FAST, onProgress: (p) => progress.push(p.expected!) });
    expect(res.points).toHaveLength(168);
    expect(progress.at(-1)).toBe(168);
  });

  it('returns partial data when the stream stops early', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 30, clock), clock, stopAfter: 12 });
    const res = await syncStockHistory(conn, FAST);
    expect(res.complete).toBe(false);
    expect(res.points).toHaveLength(12);
  });

  it('reports an error when nothing ever arrives', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 3, clock), clock, firstDelayMs: 5000 });
    await expect(syncStockHistory(conn, FAST)).rejects.toThrow(/timed out/);
  });

  it('can be cancelled', async () => {
    const clock = 1_000_000;
    const conn = fakeStockDevice({ records: hourly(1, 50, clock), clock, perRecordMs: 20 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await expect(syncStockHistory(conn, { ...FAST, signal: ac.signal })).rejects.toThrow(/Cancelled|abort/i);
    expect(conn.subscriberCount(STOCK.HISTORY)).toBe(0);
  });

  it('drops records whose time base differs from the anchor (clock was set later)', async () => {
    const clock = 1_000_000;
    const records = hourly(1, 10, clock);
    records[0]!.deviceTime = 4_000_000_000; // would map ~126 years into the future
    const conn = fakeStockDevice({ records, clock });
    const res = await syncStockHistory(conn, FAST);
    expect(res.points).toHaveLength(9);
    expect(res.complete).toBe(true);
  });

  it('handles an empty log', async () => {
    const conn = fakeStockDevice({ records: [], clock: 100 });
    expect(await syncStockHistory(conn, FAST)).toMatchObject({ points: [], complete: true });
  });
});

function pvvxChannel(conn: FakeConnection): PvvxChannel {
  const handlers = new Set<(p: ReturnType<typeof parse> & object) => void>();
  void conn.subscribe(PVVX.SERVICE, PVVX.COMMAND, (v) => {
    const p = parse(v);
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

describe('pvvx history sync', () => {
  const clock = 1_000_000;
  const records = Array.from({ length: 30 }, (_, i) => ({
    deviceTime: clock - (30 - i) * 600,
    temperature: 20 + i / 10,
    humidity: 45.5,
    mv: 2900,
  }));

  it('reads the whole log (0x35 request, 13-byte records, end marker) oldest-first', async () => {
    const conn = fakePvvxDevice({ records, clock });
    const res = await syncPvvxHistory(pvvxChannel(conn), FAST);
    expect(res.complete).toBe(true);
    expect(res.points).toHaveLength(30);
    expect(res.points[0]!.temperature).toBe(20);
    expect(res.points.at(-1)!.temperature).toBeCloseTo(22.9);
    expect(res.points.at(-1)!.voltage).toBe(2.9);
    expect(conn.writes.map((w) => w.hex)).toEqual(['23', '35ffff0000']);
    expect(conn.writes.some((w) => w.hex.startsWith('36'))).toBe(false); // never "clear log"
  });

  it('stops at records it already has', async () => {
    const conn = fakePvvxDevice({ records, clock });
    const first = await syncPvvxHistory(pvvxChannel(conn), FAST);
    const newest = first.points[24]!.t; // pretend we have up to record 25
    const res = await syncPvvxHistory(pvvxChannel(conn), { ...FAST, newerThan: newest });
    expect(res.points).toHaveLength(5);
    expect(conn.writes.at(-1)?.hex).toBe('350000'); // stop command
  });
});

describe('device session', () => {
  it('detects stock firmware and emits readings with voltage-based battery', async () => {
    const conn = fakeStockDevice({ records: [], clock: 1 });
    conn.onRead(STOCK.READING, () => hexToBytes('2c093d860b'));
    const readings: number[] = [];
    const battery: number[] = [];
    const s = await DeviceSession.start(conn, {
      onReading: (u) => readings.push(u.reading.temperature),
      onBattery: (b) => battery.push(b),
      log: () => undefined,
    });
    expect(s.firmware).toBe('stock');
    expect(readings).toEqual([23.48]);
    expect(battery).toEqual([85]);
    conn.notify(STOCK.READING, 'f3fd3d860b');
    await new Promise((r) => setTimeout(r, 5));
    expect(readings).toEqual([23.48, -5.25]);
  });

  it('detects pvvx firmware and enables measurement notifications', async () => {
    const conn = fakePvvxDevice({ records: [], clock: 1 });
    const readings: number[] = [];
    const s = await DeviceSession.start(conn, { onReading: (u) => readings.push(u.reading.humidity), onBattery: () => undefined, log: () => undefined });
    expect(s.firmware).toBe('pvvx');
    expect(conn.writes.map((w) => w.hex)).toContain('3301');
    conn.notify(PVVX.COMMAND, '33860bf308a817');
    await new Promise((r) => setTimeout(r, 5));
    expect(readings).toEqual([60.56]);
  });
});

describe('Mi activation', () => {
  it('completes registration and returns the key the device actually stored', async () => {
    const { conn, state } = fakeMiDevice();
    const res = await activateDevice(conn);
    expect(state.registered).toBe(true);
    expect(res.bindKey).toBe(state.bindKey);
    expect(res.bindKey).toMatch(/^[0-9a-f]{32}$/);
    expect(res.firmwareVersion).toBe('2.1.1_0159');
    expect(state.decryptedDid).toMatch(/^00626c742e332e31323976[0-9a-f]{12}415443$/);
    expect(conn.writes.at(-1)).toEqual({ char: expect.any(String), hex: '13000000' });
  });

  it('re-binds an already activated device keeping its known device ID', async () => {
    const { conn, state, knownDid } = fakeMiDevice({ alreadyActivated: true });
    const res = await activateDevice(conn);
    expect(res.wasActivated).toBe(true);
    expect(res.bindKey).toBe(state.bindKey);
    expect(state.decryptedDid).toBe(knownDid);
  });
});
