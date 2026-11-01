import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    getServices: vi.fn(async () => {
      throw new Error('discovery failed');
    }),
    disconnect: vi.fn(async () => undefined),
  },
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1, CONNECTION_PRIORITY_BALANCED: 0 },
}));

import { BleClient } from '@capacitor-community/bluetooth-le';
import { NativeBluetoothTransport } from './nativeBluetooth';
import { WebConnection } from './webBluetooth';

const SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';

/** Minimal BluetoothDevice whose GATT behaviour each test scripts. */
function fakeDevice(gatt: { connected?: boolean } & Partial<Omit<BluetoothRemoteGATTServer, 'connected'>>) {
  const device = new EventTarget() as BluetoothDevice;
  gatt.connected ??= false;
  Object.assign(device, { id: 'dev', name: 'LYWSD03MMC', gatt }); // same object: tests mutate it
  return device;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebConnection.open (review: timed-out connects)', () => {
  it('cancels a hung connect and waits for it before retrying', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let rejectFirst!: (e: unknown) => void;
    let calls = 0;
    const gatt = {
      connected: false,
      connect: vi.fn(() => {
        calls++;
        events.push(`connect#${calls}`);
        if (calls === 1) return new Promise<BluetoothRemoteGATTServer>((_, rej) => (rejectFirst = rej)); // hangs
        gatt.connected = true;
        return Promise.resolve(gatt as unknown as BluetoothRemoteGATTServer);
      }),
      disconnect: vi.fn(() => {
        events.push('disconnect');
        // Per spec, disconnect() aborts a pending connect.
        rejectFirst?.(new DOMException('aborted', 'AbortError'));
      }),
    };
    const opening = WebConnection.open(fakeDevice(gatt));
    await vi.advanceTimersByTimeAsync(25_000);
    const conn = await opening;
    expect(conn.isConnected()).toBe(true);
    expect(events).toEqual(['connect#1', 'disconnect', 'connect#2']);
  });

  it('tears down a connect that succeeds after the final failure', async () => {
    vi.useFakeTimers();
    const resolvers: (() => void)[] = [];
    const gatt = {
      connected: false,
      connect: vi.fn(
        () =>
          new Promise<BluetoothRemoteGATTServer>((res) =>
            resolvers.push(() => {
              gatt.connected = true;
              res(gatt as unknown as BluetoothRemoteGATTServer);
            }),
          ),
      ),
      disconnect: vi.fn(() => {
        gatt.connected = false;
      }), // a non-compliant stack that does NOT abort the pending connect
    };
    const opening = WebConnection.open(fakeDevice(gatt)).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await opening).toBeInstanceOf(Error);
    const disconnectsBefore = gatt.disconnect.mock.calls.length;
    resolvers.forEach((r) => r()); // the abandoned attempts finally connect...
    await vi.advanceTimersByTimeAsync(10);
    expect(gatt.disconnect.mock.calls.length).toBeGreaterThan(disconnectsBefore); // ...and are closed
    expect(gatt.connected).toBe(false);
  });
});

describe('WebConnection discovery (review: discovery errors)', () => {
  async function connected(getPrimaryService: BluetoothRemoteGATTServer['getPrimaryService']) {
    const gatt = { connected: false, connect: vi.fn(async () => gatt as never), getPrimaryService };
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true;
      return gatt as never;
    });
    return WebConnection.open(fakeDevice(gatt as never));
  }

  it('reports a missing service as absent and caches that', async () => {
    const get = vi.fn(async () => {
      throw new DOMException('No Services matching UUID found in Device.', 'NotFoundError');
    });
    const conn = await connected(get);
    expect(await conn.hasService(SERVICE)).toBe(false);
    expect(await conn.hasService(SERVICE)).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('surfaces a transient failure instead of caching it as absent, and retries', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('GATT Server is disconnected.', 'NetworkError'))
      .mockResolvedValue({ uuid: SERVICE, getCharacteristic: vi.fn() });
    const conn = await connected(get);
    await expect(conn.hasService(SERVICE)).rejects.toThrow(/disconnected/);
    expect(await conn.hasService(SERVICE)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('NativeBluetoothTransport.connect (review: failed Android connects)', () => {
  it('closes the link when service discovery fails after connecting', async () => {
    const transport = new NativeBluetoothTransport();
    await expect(transport.connect({ id: 'AA:BB', name: 'LYWSD03MMC' })).rejects.toThrow('discovery failed');
    expect(BleClient.connect).toHaveBeenCalledTimes(1);
    expect(BleClient.disconnect).toHaveBeenCalledWith('AA:BB');
  });
});
