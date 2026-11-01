/**
 * Pure decoders for every packet the app understands. No I/O here, so it is all unit-tested.
 */
import { PVVX } from './uuids';

export interface Reading {
  temperature: number; // °C
  humidity: number; // %
  voltage?: number; // V
}

/** Stock firmware live reading (ebe0ccc1): <hBh  temperature/100, humidity %, battery mV. */
export function parseStockReading(v: DataView): Reading | null {
  if (v.byteLength < 3) return null;
  return {
    // Real signed int16. The old code masked the sign bit and subtracted 32767, which is
    // off by 0.01 °C below zero.
    temperature: v.getInt16(0, true) / 100,
    humidity: v.getUint8(2),
    voltage: v.byteLength >= 5 ? v.getUint16(3, true) / 1000 : undefined,
  };
}

export interface StockRecord {
  index: number;
  /** Seconds on the device clock (see clock.ts). */
  deviceTime: number;
  maxTemperature: number;
  maxHumidity: number;
  minTemperature: number;
  minHumidity: number;
}

/** Stock history record (ebe0ccbc): <IIhBhB  idx, time, max T/10, max H, min T/10, min H. */
export function parseStockRecord(v: DataView): StockRecord | null {
  if (v.byteLength < 14) return null;
  return {
    index: v.getUint32(0, true),
    deviceTime: v.getUint32(4, true),
    maxTemperature: v.getInt16(8, true) / 10,
    maxHumidity: v.getUint8(10),
    minTemperature: v.getInt16(11, true) / 10,
    minHumidity: v.getUint8(13),
  };
}

export interface RecordCount {
  /** Index of the newest stored record; the stream is complete once this index arrives. */
  lastIndex: number;
  /**
   * Records added since the last read-out. The previous app treated this as "records stored"
   * and stopped the download after that many records, which truncated the history.
   */
  newCount: number;
}

/** Stock record counter (ebe0ccb9): <II. */
export function parseRecordCount(v: DataView): RecordCount | null {
  if (v.byteLength < 8) return null;
  return { lastIndex: v.getUint32(0, true), newCount: v.getUint32(4, true) };
}

/** Stock device clock (ebe0ccb7): u32 seconds [+ i8 timezone]. */
export function parseDeviceClock(v: DataView): number | null {
  return v.byteLength >= 4 ? v.getUint32(0, true) : null;
}

export type PvvxPacket =
  | { kind: 'measure'; reading: Reading }
  | { kind: 'time'; deviceTime: number }
  | { kind: 'memo'; index: number; deviceTime: number; temperature: number; humidity: number; voltage: number }
  | { kind: 'memo-end' }
  | { kind: 'other'; command: number };

/** Decodes a notification from the pvvx command characteristic (0x1f1f). */
export function parsePvvxPacket(v: DataView): PvvxPacket | null {
  if (v.byteLength < 1) return null;
  const command = v.getUint8(0);
  switch (command) {
    case PVVX.CMD_MEASURE:
      // [0x33, u16 mV, s16 T/100, s16 H/100, ...]; a 2-byte packet is just the command ack.
      if (v.byteLength < 7) return { kind: 'other', command };
      return {
        kind: 'measure',
        reading: {
          voltage: v.getUint16(1, true) / 1000,
          temperature: v.getInt16(3, true) / 100,
          humidity: v.getInt16(5, true) / 100,
        },
      };
    case PVVX.CMD_TIME:
      if (v.byteLength < 5) return { kind: 'other', command };
      return { kind: 'time', deviceTime: v.getUint32(1, true) };
    case PVVX.CMD_LOGGER:
      // [0x35, u16 n, u32 time, s16 T/100, u16 H/100, u16 mV]; [0x35, 0, 0] ends the stream.
      if (v.byteLength >= 13) {
        return {
          kind: 'memo',
          index: v.getUint16(1, true),
          deviceTime: v.getUint32(3, true),
          temperature: v.getInt16(7, true) / 100,
          humidity: v.getUint16(9, true) / 100,
          voltage: v.getUint16(11, true) / 1000,
        };
      }
      if (v.byteLength >= 3) return { kind: 'memo-end' };
      return { kind: 'other', command };
    default:
      return { kind: 'other', command };
  }
}

/** Request `count` log records, newest first (pvvx). */
export const pvvxLoggerRequest = (count: number) =>
  new Uint8Array([PVVX.CMD_LOGGER, count & 0xff, (count >> 8) & 0xff, 0, 0]);

/** Count 0 tells pvvx firmware to stop an ongoing log read-out. */
export const pvvxLoggerStop = () => new Uint8Array([PVVX.CMD_LOGGER, 0, 0]);

/**
 * Battery estimate for a CR2032 from the cell voltage: 3.1 V+ → 100 %, 2.1 V → 0 %
 * (same linear model as the lywsd03mmc reference client).
 */
export function batteryFromVoltage(volts: number): number {
  return Math.max(0, Math.min(100, Math.round((volts - 2.1) * 100)));
}
