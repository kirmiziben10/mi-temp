import { Capacitor } from '@capacitor/core';
import { NativeBluetoothTransport } from './nativeBluetooth';
import type { BleTransport } from './types';
import { WebBluetoothTransport } from './webBluetooth';

let transport: BleTransport | null = null;

/** Native Bluetooth inside the Android app, Web Bluetooth in a browser. */
export function getTransport(): BleTransport {
  transport ??= Capacitor.isNativePlatform() ? new NativeBluetoothTransport() : new WebBluetoothTransport();
  return transport;
}

export type * from './types';
