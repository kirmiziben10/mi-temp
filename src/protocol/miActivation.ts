/**
 * Xiaomi "Mi" activation (registration) over the 0xfe95 service, which yields the bind key
 * used to decrypt the device's encrypted BLE advertisements (e.g. in Home Assistant).
 *
 * Port of the registration state machine in atc1441's TelinkFlasher.html (vendored in
 * /Telink Flasher). The previous app stopped as soon as it had *derived* the key and never sent
 * the AES-CCM-encrypted device ID or the final 0x13 "register" command. In that case the device
 * never stores the new key, so the key it displayed didn't work. This runs the full exchange
 * and only reports success after the device confirms it (0x11 on the control characteristic).
 *
 * Note: activation re-binds the sensor. If it was paired with the Mi Home app, that pairing is
 * replaced.
 */
import { aesCcmEncrypt } from '../lib/aesCcm';
import { AbortedError, deferred, withTimeout } from '../lib/async';
import { asciiZ, bytesToHex, hexToBytes } from '../lib/bytes';
import type { BleConnection, Unsubscribe } from '../ble/types';
import type { LogFn } from './types';
import { MI_AUTH } from './uuids';

export interface ActivationResult {
  bindKey: string; // 32 hex chars
  token: string; // 24 hex chars
  firmwareVersion: string | null;
  wasActivated: boolean;
}

const ACTIVATION_TIMEOUT = 30_000;

const CTRL = {
  START_REGISTER: 'a2000000',
  KEY_EXCHANGE: '15000000',
  REGISTER: '13000000',
  REGISTER_OK: '11000000',
  REGISTER_FAILED: '12000000',
} as const;

const DATA = {
  READY: '00000101',
  ACK: '00000100',
  NOT_ACTIVATED: '000000000100',
  ACTIVATED: '000000000200',
  NOT_ACTIVATED_REPLY: '010001000000',
  ANNOUNCE_PUBKEY: '000000030400',
  ANNOUNCE_DID: '000000000200',
  DEVICE_TIMEOUT: '000001050100',
} as const;

/** "\0blt.3.129v" + 6 random bytes + "ATC" — the device ID format TelinkFlasher registers. */
function newDeviceId(): string {
  return '00626c742e332e31323976' + bytesToHex(crypto.getRandomValues(new Uint8Array(6))) + '415443';
}

async function hkdfSha256(ikm: Uint8Array<ArrayBuffer>, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    // Empty salt == HashLen zero bytes (RFC 5869), which is what sjcl's hkdf(…, null, …) uses.
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function activateDevice(conn: BleConnection, log: LogFn = () => undefined, signal?: AbortSignal): Promise<ActivationResult> {
  if (!(await conn.hasService(MI_AUTH.SERVICE))) {
    throw new Error('Mi Auth service not found (custom firmware does not need activation).');
  }

  let firmwareVersion: string | null = null;
  try {
    firmwareVersion = asciiZ(await conn.read(MI_AUTH.SERVICE, MI_AUTH.FIRMWARE_VERSION));
    log('Firmware version', firmwareVersion);
  } catch {
    log('Could not read firmware version (non-fatal)');
  }

  const keypair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ownPublicKey = bytesToHex(await crypto.subtle.exportKey('raw', keypair.publicKey)); // 04 || X || Y

  const sendData = (hex: string) => conn.write(MI_AUTH.SERVICE, MI_AUTH.DATA, hexToBytes(hex));
  const sendCtrl = (hex: string) => conn.write(MI_AUTH.SERVICE, MI_AUTH.CONTROL, hexToBytes(hex));

  const result = deferred<ActivationResult>();
  let state: 0 | 1 | 2 | 3 = 0;
  let activated = false;
  let knownId = '';
  let deviceId = newDeviceId();
  let devicePublicKey = '';
  let keys: { bindKey: string; token: string; encryptedDid: string } | null = null;

  const startKeyExchange = async () => {
    await sendData(DATA.ACK);
    await sendCtrl(CTRL.KEY_EXCHANGE);
    await sendData(DATA.ANNOUNCE_PUBKEY);
    state = 1;
  };

  const deriveKeys = async () => {
    const peer = await crypto.subtle.importKey('raw', hexToBytes(devicePublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, keypair.privateKey, 256));
    const derived = await hkdfSha256(shared, 'mible-setup-info', 64);
    const token = bytesToHex(derived.subarray(0, 12));
    const bindKey = bytesToHex(derived.subarray(12, 28));
    const encryptedDid = bytesToHex(
      await aesCcmEncrypt(
        derived.slice(28, 44),
        hexToBytes('101112131415161718191a1b'),
        hexToBytes(deviceId),
        new TextEncoder().encode('devID'),
        4,
      ),
    );
    keys = { bindKey, token, encryptedDid };
    log('Session keys derived, registering device ID');
  };

  const handleData = async (hex: string) => {
    log('enc_19 ←', hex);
    const prefix = hex.substring(0, 4);
    const rest = hex.substring(4);
    if (hex === DATA.NOT_ACTIVATED || hex === DATA.ACTIVATED) {
      activated = hex === DATA.ACTIVATED;
      log(activated ? 'Device was already activated (re-binding)' : 'Device not activated yet');
      await sendData(DATA.READY);
    } else if (activated && state === 0 && prefix === '0100') {
      knownId = rest;
    } else if (activated && state === 0 && prefix === '0200') {
      knownId += rest;
      deviceId = knownId.substring(8); // keep the ID the device already knows
      await startKeyExchange();
    } else if (hex === DATA.NOT_ACTIVATED_REPLY) {
      await startKeyExchange();
    } else if (state === 1 && hex === DATA.READY) {
      state = 2;
      // Our public key without the 0x04 prefix, as four 18-byte frames.
      for (let i = 0; i < 4; i++) {
        await sendData(`0${i + 1}00` + ownPublicKey.substring(2 + 36 * i, 2 + 36 * (i + 1)));
      }
    } else if (hex === DATA.ANNOUNCE_PUBKEY) {
      await sendData(DATA.READY);
    } else if (state === 2 && ['0100', '0200', '0300', '0400'].includes(prefix) && !keys) {
      devicePublicKey = (prefix === '0100' ? '04' : devicePublicKey) + rest;
      if (prefix === '0400') {
        await sendData(DATA.ACK);
        await deriveKeys();
        await sendData(DATA.ANNOUNCE_DID);
      }
    } else if (state === 2 && hex === DATA.READY && keys) {
      state = 3;
      await sendData('0100' + keys.encryptedDid.substring(0, 36));
      await sendData('0200' + keys.encryptedDid.substring(36));
    } else if (state === 3 && hex === DATA.ACK) {
      state = 0;
      await sendCtrl(CTRL.REGISTER);
    } else if (hex === DATA.DEVICE_TIMEOUT) {
      throw new Error('The device timed out during activation. Try again.');
    }
  };

  // Notifications are processed strictly in order: each step may write before the next arrives.
  let chain = Promise.resolve();
  const onData = (v: DataView) => {
    chain = chain.then(() => handleData(bytesToHex(v))).catch((err) => result.reject(err));
  };
  const onCtrl = (v: DataView) => {
    const hex = bytesToHex(v);
    log('enc_10 ←', hex);
    if (hex === CTRL.REGISTER_FAILED) result.reject(new Error('The device rejected the activation.'));
    if (hex === CTRL.REGISTER_OK) {
      if (keys) {
        result.resolve({ bindKey: keys.bindKey, token: keys.token, firmwareVersion, wasActivated: activated });
      } else {
        result.reject(new Error('Device reported success before keys were exchanged.'));
      }
    }
  };

  const unsubscribes: Unsubscribe[] = [];
  const onAbort = () => result.reject(new AbortedError());
  signal?.addEventListener('abort', onAbort);
  try {
    unsubscribes.push(await conn.subscribe(MI_AUTH.SERVICE, MI_AUTH.CONTROL, onCtrl));
    unsubscribes.push(await conn.subscribe(MI_AUTH.SERVICE, MI_AUTH.DATA, onData));
    log('Starting registration');
    await sendCtrl(CTRL.START_REGISTER);
    return await withTimeout(result.promise, ACTIVATION_TIMEOUT, 'Activation');
  } finally {
    signal?.removeEventListener('abort', onAbort);
    for (const off of unsubscribes) await off();
  }
}
