import { SerialQueue, sleep, withTimeout } from '../lib/async';
import { copyView } from '../lib/bytes';
import { ALL_SERVICES, NAME_PREFIXES } from '../protocol/uuids';
import type { Availability, BleConnection, BleTransport, NotificationHandler, Unsubscribe, Uuid } from './types';

const OP_TIMEOUT = 10_000;
const CONNECT_TIMEOUT = 20_000;
const CONNECT_ATTEMPTS = 3;

/** Browser transport (Chrome/Edge/Opera on desktop and Android). */
export class WebBluetoothTransport implements BleTransport {
  readonly kind = 'web' as const;

  async availability(): Promise<Availability> {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      return { available: false, reason: "Your browser doesn't support Web Bluetooth API." };
    }
    if (!window.isSecureContext) {
      return { available: false, reason: 'Web Bluetooth needs a secure context (HTTPS or localhost).' };
    }
    try {
      if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) {
        return { available: false, reason: 'No Bluetooth adapter is available on this device.' };
      }
    } catch {
      // getAvailability is optional; assume available.
    }
    return { available: true };
  }

  async requestDevice(): Promise<BleConnection> {
    const device = await navigator.bluetooth.requestDevice({
      filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      optionalServices: ALL_SERVICES,
    });
    return WebConnection.open(device);
  }
}

class WebConnection implements BleConnection {
  private readonly queue = new SerialQueue();
  private readonly services = new Map<Uuid, Promise<BluetoothRemoteGATTService | null>>();
  private readonly chars = new Map<string, Promise<BluetoothRemoteGATTCharacteristic | null>>();
  private readonly disconnectCallbacks = new Set<() => void>();
  private intentionalDisconnect = false;

  private constructor(private readonly device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);
  }

  static async open(device: BluetoothDevice): Promise<WebConnection> {
    const conn = new WebConnection(device);
    let lastError: unknown;
    // Chrome's first GATT connect to a sleepy sensor fails surprisingly often; retry a few times.
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        await withTimeout(device.gatt!.connect(), CONNECT_TIMEOUT, 'GATT connect');
        return conn;
      } catch (err) {
        lastError = err;
        if (attempt < CONNECT_ATTEMPTS) await sleep(500 * attempt);
      }
    }
    device.removeEventListener('gattserverdisconnected', conn.handleDisconnect);
    throw lastError;
  }

  get id() {
    return this.device.id;
  }

  get name() {
    return this.device.name ?? null;
  }

  isConnected() {
    return !!this.device.gatt?.connected;
  }

  private handleDisconnect = () => {
    this.services.clear();
    this.chars.clear();
    if (this.intentionalDisconnect) return;
    this.disconnectCallbacks.forEach((cb) => cb());
  };

  private service(uuid: Uuid) {
    let p = this.services.get(uuid);
    if (!p) {
      p = this.queue
        .run(() => withTimeout(this.device.gatt!.getPrimaryService(uuid), OP_TIMEOUT, 'Service discovery'))
        .catch(() => null);
      this.services.set(uuid, p);
    }
    return p;
  }

  private characteristic(service: Uuid, characteristic: Uuid) {
    const key = `${service}/${characteristic}`;
    let p = this.chars.get(key);
    if (!p) {
      p = this.service(service).then((s) =>
        s
          ? this.queue
              .run(() => withTimeout(s.getCharacteristic(characteristic), OP_TIMEOUT, 'Characteristic discovery'))
              .catch(() => null)
          : null,
      );
      this.chars.set(key, p);
    }
    return p;
  }

  private async require(service: Uuid, characteristic: Uuid) {
    const c = await this.characteristic(service, characteristic);
    if (!c) throw new Error(`Characteristic ${characteristic} not found`);
    return c;
  }

  async hasService(service: Uuid) {
    return (await this.service(service)) !== null;
  }

  async hasCharacteristic(service: Uuid, characteristic: Uuid) {
    return (await this.characteristic(service, characteristic)) !== null;
  }

  async read(service: Uuid, characteristic: Uuid) {
    const c = await this.require(service, characteristic);
    return copyView(await this.queue.run(() => withTimeout(c.readValue(), OP_TIMEOUT, 'Read')));
  }

  async write(service: Uuid, characteristic: Uuid, data: Uint8Array<ArrayBuffer>) {
    const c = await this.require(service, characteristic);
    const op = c.properties.write ? () => c.writeValueWithResponse(data) : () => c.writeValueWithoutResponse(data);
    await this.queue.run(() => withTimeout(op(), OP_TIMEOUT, 'Write'));
  }

  async subscribe(service: Uuid, characteristic: Uuid, handler: NotificationHandler): Promise<Unsubscribe> {
    const c = await this.require(service, characteristic);
    const listener = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) handler(copyView(value));
    };
    // Attach before enabling so nothing sent right after the CCCD write is lost.
    c.addEventListener('characteristicvaluechanged', listener);
    try {
      await this.queue.run(() => withTimeout(c.startNotifications(), OP_TIMEOUT, 'Enable notifications'));
    } catch (err) {
      c.removeEventListener('characteristicvaluechanged', listener);
      throw err;
    }
    return async () => {
      c.removeEventListener('characteristicvaluechanged', listener);
      if (!this.isConnected()) return;
      await this.queue
        .run(() => withTimeout(c.stopNotifications(), OP_TIMEOUT, 'Disable notifications'))
        .catch(() => undefined);
    };
  }

  onDisconnect(callback: () => void) {
    this.disconnectCallbacks.add(callback);
    return () => this.disconnectCallbacks.delete(callback);
  }

  async disconnect() {
    this.intentionalDisconnect = true;
    this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.services.clear();
    this.chars.clear();
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }
}
