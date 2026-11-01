/**
 * Simulated thermometers implementing the device side of each protocol, for unit tests.
 */
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import type { BleConnection, NotificationHandler, Unsubscribe, Uuid } from '../ble/types';
import { bytesToHex, hexToBytes } from '../lib/bytes';
import { MI_AUTH, PVVX, STOCK } from '../protocol/uuids';

type WriteHandler = (data: Uint8Array) => void;

/** Generic fake GATT server: tests register read/write handlers per characteristic. */
export class FakeConnection implements BleConnection {
  readonly id = 'fake-device';
  readonly name = 'LYWSD03MMC';
  connected = true;
  readonly writes: { char: Uuid; hex: string }[] = [];
  private readonly readers = new Map<Uuid, () => Uint8Array>();
  private readonly writers = new Map<Uuid, WriteHandler>();
  private readonly subs = new Map<Uuid, Set<NotificationHandler>>();

  constructor(private readonly services: Uuid[]) {}

  onRead(char: Uuid, fn: () => Uint8Array) {
    this.readers.set(char, fn);
  }
  onWrite(char: Uuid, fn: WriteHandler) {
    this.writers.set(char, fn);
  }

  /** Delivers a notification asynchronously, like a real BLE stack. */
  notify(char: Uuid, bytes: Uint8Array | string, delayMs = 0) {
    const data = typeof bytes === 'string' ? hexToBytes(bytes) : bytes;
    setTimeout(() => this.subs.get(char)?.forEach((h) => h(new DataView(data.slice().buffer))), delayMs);
  }
  subscriberCount(char: Uuid) {
    return this.subs.get(char)?.size ?? 0;
  }

  isConnected() {
    return this.connected;
  }
  async hasService(s: Uuid) {
    return this.services.includes(s);
  }
  async hasCharacteristic(s: Uuid, c: Uuid) {
    return this.services.includes(s) && (this.readers.has(c) || this.writers.has(c));
  }
  async read(_s: Uuid, c: Uuid) {
    const r = this.readers.get(c);
    if (!r) throw new Error(`read not supported: ${c}`);
    return new DataView(r().slice().buffer);
  }
  async write(_s: Uuid, c: Uuid, data: Uint8Array<ArrayBuffer>) {
    this.writes.push({ char: c, hex: bytesToHex(data) });
    this.writers.get(c)?.(data);
  }
  async subscribe(_s: Uuid, c: Uuid, h: NotificationHandler): Promise<Unsubscribe> {
    if (!this.subs.has(c)) this.subs.set(c, new Set());
    this.subs.get(c)!.add(h);
    return async () => {
      this.subs.get(c)?.delete(h);
    };
  }
  onDisconnect() {
    return () => undefined;
  }
  async disconnect() {
    this.connected = false;
  }
}

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

export interface StockRecordSpec {
  index: number;
  deviceTime: number;
  maxT: number;
  maxH: number;
  minT: number;
  minH: number;
}

export interface StockDeviceOptions {
  records: StockRecordSpec[];
  clock: number;
  newCount?: number;
  /** Delay before the first record is sent after RECORD_IDX is written. */
  firstDelayMs?: number;
  perRecordMs?: number;
  /** Device ignores non-zero start indices (sends nothing). */
  ignoresResume?: boolean;
  /** Stop streaming after this many records (simulates link trouble). */
  stopAfter?: number;
}

export function stockRecordBytes(r: StockRecordSpec): Uint8Array {
  const b = new Uint8Array(14);
  const v = new DataView(b.buffer);
  v.setUint32(0, r.index, true);
  v.setUint32(4, r.deviceTime, true);
  v.setInt16(8, Math.round(r.maxT * 10), true);
  v.setUint8(10, r.maxH);
  v.setInt16(11, Math.round(r.minT * 10), true);
  v.setUint8(13, r.minH);
  return b;
}

export function fakeStockDevice(opts: StockDeviceOptions) {
  const conn = new FakeConnection([STOCK.SERVICE]);
  const lastIndex = opts.records.length ? Math.max(...opts.records.map((r) => r.index)) : 0;
  conn.onRead(STOCK.NUM_RECORDS, () => new Uint8Array([...u32(lastIndex), ...u32(opts.newCount ?? 3)]));
  conn.onRead(STOCK.TIME, () => new Uint8Array([...u32(opts.clock), 0x03]));
  conn.onWrite(STOCK.RECORD_IDX, (data) => {
    const start = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
    if (start !== 0 && opts.ignoresResume) return;
    const toSend = opts.records.filter((r) => r.index >= start).slice(0, opts.stopAfter);
    toSend.forEach((r, i) =>
      conn.notify(STOCK.HISTORY, stockRecordBytes(r), (opts.firstDelayMs ?? 0) + i * (opts.perRecordMs ?? 1)),
    );
  });
  return conn;
}

/** pvvx firmware: log read-out on the command characteristic, newest record first. */
export function fakePvvxDevice(opts: {
  records: { deviceTime: number; temperature: number; humidity: number; mv: number }[];
  clock: number;
}) {
  const conn = new FakeConnection([PVVX.SERVICE]);
  let cancelled = false;
  conn.onWrite(PVVX.COMMAND, (data) => {
    const cmd = data[0];
    if (cmd === PVVX.CMD_TIME && data.length === 1) {
      conn.notify(PVVX.COMMAND, new Uint8Array([0x23, ...u32(opts.clock)]));
    } else if (cmd === PVVX.CMD_LOGGER) {
      const count = data[1]! | (data[2]! << 8);
      if (count === 0) {
        cancelled = true;
        return;
      }
      cancelled = false;
      const newestFirst = [...opts.records].sort((a, b) => b.deviceTime - a.deviceTime).slice(0, count);
      newestFirst.forEach((r, i) => {
        setTimeout(() => {
          if (cancelled) return;
          const b = new Uint8Array(13);
          const v = new DataView(b.buffer);
          v.setUint8(0, 0x35);
          v.setUint16(1, i + 1, true);
          v.setUint32(3, r.deviceTime, true);
          v.setInt16(7, Math.round(r.temperature * 100), true);
          v.setUint16(9, Math.round(r.humidity * 100), true);
          v.setUint16(11, r.mv, true);
          conn.notify(PVVX.COMMAND, b);
        }, i);
      });
      setTimeout(() => !cancelled && conn.notify(PVVX.COMMAND, '350000'), newestFirst.length + 1);
    }
  });
  return conn;
}

/**
 * Device side of the Mi registration, mirroring the exchange in TelinkFlasher.html.
 * It only confirms (0x11) once the AES-CCM-encrypted device ID decrypts under the key it
 * derived itself, so a passing test proves both sides agree on the bind key.
 */
export function fakeMiDevice({ alreadyActivated = false }: { alreadyActivated?: boolean } = {}) {
  const conn = new FakeConnection([MI_AUTH.SERVICE, STOCK.SERVICE]);
  const ecdh = createECDH('prime256v1');
  const devicePub = ecdh.generateKeys().toString('hex'); // 04 || X || Y
  const knownDid = '00626c742e332e31323976' + 'aabbccddeeff' + '415443';
  const state = {
    phase: 'init' as 'init' | 'await-key-ready' | 'receiving-key' | 'await-pub-ack' | 'await-did-announce' | 'receiving-did' | 'await-register',
    hostPub: '',
    encDid: '',
    bindKey: '',
    registered: false,
    decryptedDid: '',
  };
  const send = (hex: string) => conn.notify(MI_AUTH.DATA, hex);

  conn.onRead(MI_AUTH.FIRMWARE_VERSION, () => new Uint8Array([...Buffer.from('2.1.1_0159'), 0]));
  conn.onWrite(MI_AUTH.CONTROL, (data) => {
    const hex = bytesToHex(data);
    if (hex === 'a2000000') send(alreadyActivated ? '000000000200' : '000000000100');
    if (hex === '13000000' && state.phase === 'await-register') {
      try {
        const derived = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(Buffer.from(state.hostPub, 'hex')), Buffer.alloc(0), 'mible-setup-info', 64));
        const keyA = derived.subarray(28, 44);
        const enc = Buffer.from(state.encDid, 'hex');
        const d = createDecipheriv('aes-128-ccm', keyA, Buffer.from('101112131415161718191a1b', 'hex'), { authTagLength: 4 });
        d.setAuthTag(enc.subarray(enc.length - 4));
        d.setAAD(Buffer.from('devID'), { plaintextLength: enc.length - 4 });
        state.decryptedDid = Buffer.concat([d.update(enc.subarray(0, enc.length - 4)), d.final()]).toString('hex');
        state.bindKey = derived.subarray(12, 28).toString('hex');
        state.registered = true;
        conn.notify(MI_AUTH.CONTROL, '11000000');
      } catch {
        conn.notify(MI_AUTH.CONTROL, '12000000');
      }
    }
  });
  conn.onWrite(MI_AUTH.DATA, (data) => {
    const hex = bytesToHex(data);
    switch (state.phase) {
      case 'init':
        if (hex === '00000101') {
          if (alreadyActivated) {
            const id = '00000000' + knownDid; // 4-byte header the host strips
            send('0100' + id.substring(0, 36));
            send('0200' + id.substring(36));
          } else {
            send('010001000000');
          }
        } else if (hex === '000000030400') {
          state.phase = 'await-key-ready';
          send('00000101');
        }
        break;
      case 'await-key-ready':
      case 'receiving-key':
        if (/^0[1-4]00/.test(hex)) {
          state.hostPub = (hex.startsWith('0100') ? '04' : state.hostPub) + hex.substring(4);
          if (hex.startsWith('0400')) {
            state.phase = 'await-pub-ack';
            send('000000030400');
          }
        }
        break;
      case 'await-pub-ack':
        if (hex === '00000101') {
          const k = devicePub.substring(2);
          for (let i = 0; i < 4; i++) send(`0${i + 1}00` + k.substring(36 * i, 36 * (i + 1)));
          state.phase = 'await-did-announce';
        }
        break;
      case 'await-did-announce':
        if (hex === '000000000200') {
          state.phase = 'receiving-did';
          send('00000101');
        }
        break;
      case 'receiving-did':
        if (hex.startsWith('0100')) state.encDid = hex.substring(4);
        if (hex.startsWith('0200')) {
          state.encDid += hex.substring(4);
          state.phase = 'await-register';
          send('00000100');
        }
        break;
    }
  });
  return { conn, state, knownDid };
}
