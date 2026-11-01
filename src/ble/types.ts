/**
 * Transport-neutral BLE interface.
 *
 * The protocol code (src/protocol) only talks to `BleConnection`, so the same logic runs on
 * Web Bluetooth (browser) and on the native Android Bluetooth stack (Capacitor plugin), and
 * can be unit-tested against a simulated device.
 *
 * All UUIDs are full 128-bit, lowercase strings.
 */

export type Uuid = string;

export type NotificationHandler = (value: DataView) => void;
export type Unsubscribe = () => Promise<void>;

export interface BleConnection {
  readonly id: string;
  readonly name: string | null;
  isConnected(): boolean;
  hasService(service: Uuid): Promise<boolean>;
  hasCharacteristic(service: Uuid, characteristic: Uuid): Promise<boolean>;
  read(service: Uuid, characteristic: Uuid): Promise<DataView>;
  write(service: Uuid, characteristic: Uuid, data: Uint8Array<ArrayBuffer>): Promise<void>;
  subscribe(service: Uuid, characteristic: Uuid, handler: NotificationHandler): Promise<Unsubscribe>;
  /** Hint to the OS that a bulk transfer is about to happen (Android only; no-op elsewhere). */
  setHighThroughput?(enabled: boolean): Promise<void>;
  /** Registers a callback for an unexpected link loss. Returns a function that removes it. */
  onDisconnect(callback: () => void): () => void;
  disconnect(): Promise<void>;
}

export interface FoundDevice {
  id: string;
  name: string | null;
  rssi?: number;
}

export interface Availability {
  available: boolean;
  reason?: string;
}

export interface BleTransport {
  readonly kind: 'web' | 'native';
  availability(): Promise<Availability>;
  /**
   * Web: opens the browser's device chooser and connects.
   * Native: not used — the app shows its own picker fed by `scan`.
   */
  requestDevice?(): Promise<BleConnection>;
  scan?(onDevice: (device: FoundDevice) => void): Promise<Unsubscribe>;
  connect?(device: FoundDevice): Promise<BleConnection>;
}

export const uuid16 = (short: number): Uuid =>
  `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const normalizeUuid = (uuid: string | number): Uuid =>
  typeof uuid === 'number' ? uuid16(uuid) : uuid.length === 4 ? uuid16(parseInt(uuid, 16)) : uuid.toLowerCase();
