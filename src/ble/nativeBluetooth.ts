import { BleClient, ConnectionPriority, type BleService } from '@capacitor-community/bluetooth-le';
import { SerialQueue, withTimeout } from '../lib/async';
import { copyView } from '../lib/bytes';
import { NAME_PREFIXES } from '../protocol/uuids';
import type { Availability, BleConnection, BleTransport, FoundDevice, NotificationHandler, Unsubscribe, Uuid } from './types';

const OP_TIMEOUT = 10_000;
const CONNECT_TIMEOUT = 20_000;

/** Native Android transport via @capacitor-community/bluetooth-le. */
export class NativeBluetoothTransport implements BleTransport {
  readonly kind = 'native' as const;
  private initialized: Promise<void> | null = null;

  private init() {
    // neverForLocation: we only need BLE scanning, not the user's location (Android 12+).
    this.initialized ??= BleClient.initialize({ androidNeverForLocation: true }).catch((err) => {
      this.initialized = null;
      throw err;
    });
    return this.initialized;
  }

  async availability(): Promise<Availability> {
    try {
      await this.init();
      return { available: true };
    } catch (err) {
      return { available: false, reason: describe(err, 'Bluetooth is not available on this device.') };
    }
  }

  async scan(onDevice: (device: FoundDevice) => void): Promise<Unsubscribe> {
    await this.init();
    if (!(await BleClient.isEnabled())) {
      try {
        await BleClient.requestEnable();
      } catch {
        throw new Error('Bluetooth is turned off. Turn it on and try again.');
      }
    }
    await BleClient.requestLEScan({ allowDuplicates: true }, (result) => {
      const name = result.localName ?? result.device.name ?? null;
      if (!name || !NAME_PREFIXES.some((p) => name.startsWith(p))) return;
      onDevice({ id: result.device.deviceId, name, rssi: result.rssi });
    });
    return () => BleClient.stopLEScan().catch(() => undefined);
  }

  async connect(device: FoundDevice): Promise<BleConnection> {
    await this.init();
    const conn = new NativeConnection(device);
    await conn.open();
    return conn;
  }
}

class NativeConnection implements BleConnection {
  private readonly queue = new SerialQueue();
  private readonly disconnectCallbacks = new Set<() => void>();
  private services: BleService[] = [];
  private connected = false;
  private intentionalDisconnect = false;

  constructor(private readonly device: FoundDevice) {}

  get id() {
    return this.device.id;
  }

  get name() {
    return this.device.name;
  }

  async open() {
    await BleClient.connect(this.id, () => this.handleDisconnect(), { timeout: CONNECT_TIMEOUT });
    this.connected = true;
    this.services = await BleClient.getServices(this.id);
  }

  private handleDisconnect() {
    this.connected = false;
    if (!this.intentionalDisconnect) this.disconnectCallbacks.forEach((cb) => cb());
  }

  isConnected() {
    return this.connected;
  }

  private findChar(service: Uuid, characteristic: Uuid) {
    return this.services
      .find((s) => s.uuid.toLowerCase() === service)
      ?.characteristics.find((c) => c.uuid.toLowerCase() === characteristic);
  }

  async hasService(service: Uuid) {
    return this.services.some((s) => s.uuid.toLowerCase() === service);
  }

  async hasCharacteristic(service: Uuid, characteristic: Uuid) {
    return !!this.findChar(service, characteristic);
  }

  async read(service: Uuid, characteristic: Uuid) {
    const value = await this.queue.run(() =>
      BleClient.read(this.id, service, characteristic, { timeout: OP_TIMEOUT }),
    );
    return copyView(value);
  }

  async write(service: Uuid, characteristic: Uuid, data: Uint8Array<ArrayBuffer>) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const props = this.findChar(service, characteristic)?.properties;
    const withResponse = !props || props.write || !props.writeWithoutResponse;
    await this.queue.run(() =>
      withResponse
        ? BleClient.write(this.id, service, characteristic, view, { timeout: OP_TIMEOUT })
        : BleClient.writeWithoutResponse(this.id, service, characteristic, view, { timeout: OP_TIMEOUT }),
    );
  }

  async subscribe(service: Uuid, characteristic: Uuid, handler: NotificationHandler): Promise<Unsubscribe> {
    await this.queue.run(() =>
      BleClient.startNotifications(this.id, service, characteristic, (v) => handler(copyView(v)), {
        timeout: OP_TIMEOUT,
      }),
    );
    return async () => {
      if (!this.connected) return;
      await this.queue
        .run(() => withTimeout(BleClient.stopNotifications(this.id, service, characteristic), OP_TIMEOUT, 'Stop'))
        .catch(() => undefined);
    };
  }

  async setHighThroughput(enabled: boolean) {
    await BleClient.requestConnectionPriority(
      this.id,
      enabled ? ConnectionPriority.CONNECTION_PRIORITY_HIGH : ConnectionPriority.CONNECTION_PRIORITY_BALANCED,
    ).catch(() => undefined);
  }

  onDisconnect(callback: () => void) {
    this.disconnectCallbacks.add(callback);
    return () => this.disconnectCallbacks.delete(callback);
  }

  async disconnect() {
    this.intentionalDisconnect = true;
    this.connected = false;
    await BleClient.disconnect(this.id).catch(() => undefined);
  }
}

function describe(err: unknown, fallback: string) {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg || fallback;
}
