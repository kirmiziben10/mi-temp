/**
 * A connected thermometer: firmware detection, live readings, battery, history and activation.
 */
import type { BleConnection, Unsubscribe } from '../ble/types';
import { bytesToHex } from '../lib/bytes';
import { batteryFromVoltage, parsePvvxPacket, parseStockReading, type PvvxPacket, type Reading } from './codec';
import { activateDevice, type ActivationResult } from './miActivation';
import { syncPvvxHistory, type PvvxChannel, type PvvxSyncOptions } from './pvvx';
import { syncStockHistory, type StockSyncOptions } from './stockHistory';
import type { Firmware, LogFn, SyncResult } from './types';
import { BATTERY, MI_AUTH, PVVX, STOCK } from './uuids';

export interface LiveUpdate {
  reading: Reading;
  raw: string; // hex
}

export interface SessionCallbacks {
  onReading(update: LiveUpdate): void;
  onBattery(percent: number, source: 'service' | 'voltage'): void;
  log: LogFn;
}

export class DeviceSession {
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly pvvxHandlers = new Set<(p: PvvxPacket) => void>();
  private pvvxSubscribed: Promise<void> | null = null;
  private hasBatteryService = false;

  private constructor(
    readonly conn: BleConnection,
    readonly firmware: Firmware,
    readonly supportsActivation: boolean,
    private readonly cb: SessionCallbacks,
  ) {}

  static async start(conn: BleConnection, cb: SessionCallbacks): Promise<DeviceSession> {
    // pvvx firmware exposes the 0x1f10 command service; the stock firmware does not.
    const firmware: Firmware | null = (await conn.hasService(PVVX.SERVICE))
      ? 'pvvx'
      : (await conn.hasService(STOCK.SERVICE))
        ? 'stock'
        : null;
    if (!firmware) throw new Error('This does not look like a supported thermometer (no known services).');
    const supportsActivation = firmware === 'stock' && (await conn.hasService(MI_AUTH.SERVICE));
    cb.log('Firmware detected', firmware === 'stock' ? 'Xiaomi stock' : 'pvvx custom');

    const session = new DeviceSession(conn, firmware, supportsActivation, cb);
    await session.startBattery();
    await session.startLive();
    return session;
  }

  private emitReading(reading: Reading, raw: DataView) {
    this.cb.onReading({ reading, raw: bytesToHex(raw, ' ') });
    // Without a battery service, estimate the charge from the voltage in the reading.
    if (!this.hasBatteryService && reading.voltage !== undefined) {
      this.cb.onBattery(batteryFromVoltage(reading.voltage), 'voltage');
    }
  }

  private async startLive() {
    if (this.firmware === 'stock') {
      const handler = (v: DataView) => {
        const reading = parseStockReading(v);
        if (reading) this.emitReading(reading, v);
      };
      this.unsubscribes.push(await this.conn.subscribe(STOCK.SERVICE, STOCK.READING, handler));
      // The stock firmware only notifies every ~6 s; read once so the UI fills immediately.
      try {
        handler(await this.conn.read(STOCK.SERVICE, STOCK.READING));
      } catch {
        this.cb.log('Initial read failed; waiting for the first notification');
      }
    } else {
      // Measurement packets are handled inside pvvxChannel(); this just turns them on.
      const channel = await this.pvvxChannel();
      await channel.send(new Uint8Array([PVVX.CMD_MEASURE, 1]));
    }
  }

  private async startBattery() {
    if (!(await this.conn.hasCharacteristic(BATTERY.SERVICE, BATTERY.LEVEL))) return;
    try {
      const handler = (v: DataView) => v.byteLength && this.cb.onBattery(v.getUint8(0), 'service');
      handler(await this.conn.read(BATTERY.SERVICE, BATTERY.LEVEL));
      this.hasBatteryService = true;
      this.unsubscribes.push(await this.conn.subscribe(BATTERY.SERVICE, BATTERY.LEVEL, handler));
    } catch (err) {
      this.cb.log('Battery service unavailable (non-fatal)', String(err));
    }
  }

  /** One subscription on the pvvx command characteristic, fanned out to every consumer. */
  async pvvxChannel(): Promise<PvvxChannel> {
    this.pvvxSubscribed ??= this.conn
      .subscribe(PVVX.SERVICE, PVVX.COMMAND, (v) => {
        const packet = parsePvvxPacket(v);
        if (!packet) return;
        if (packet.kind === 'measure') return this.emitReading(packet.reading, v);
        this.pvvxHandlers.forEach((h) => h(packet));
      })
      .then((off) => {
        this.unsubscribes.push(off);
      });
    await this.pvvxSubscribed;
    return {
      send: (bytes) => this.conn.write(PVVX.SERVICE, PVVX.COMMAND, bytes),
      onPacket: (handler) => {
        this.pvvxHandlers.add(handler);
        return () => this.pvvxHandlers.delete(handler);
      },
    };
  }

  syncStock(opts: StockSyncOptions) {
    return syncStockHistory(this.conn, { ...opts, log: opts.log ?? this.cb.log });
  }

  async syncPvvx(opts: PvvxSyncOptions): Promise<SyncResult> {
    return syncPvvxHistory(await this.pvvxChannel(), { ...opts, log: opts.log ?? this.cb.log });
  }

  activate(signal?: AbortSignal): Promise<ActivationResult> {
    return activateDevice(this.conn, this.cb.log, signal);
  }

  async close() {
    for (const off of this.unsubscribes.splice(0)) await off().catch(() => undefined);
    await this.conn.disconnect();
  }
}
