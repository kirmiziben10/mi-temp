import { uuid16 } from '../ble/types';

/** Xiaomi vendor UUID family used by the stock LYWSD03MMC firmware. */
const xiaomi = (short: string) => `ebe0${short}-7a0a-4b0c-8a1a-6ff2997da3a6`;

/**
 * Stock (Xiaomi) firmware: main service with readings and the on-device history log.
 * Layouts verified against h4/lywsd02, uduncanu/lywsd03mmc and pvvx's GraphMemoOriginal.html.
 */
export const STOCK = {
  SERVICE: xiaomi('ccb0'),
  /** R/W  u32 device clock (seconds) [+ i8 tz offset]. Uptime unless something set it. */
  TIME: xiaomi('ccb7'),
  /** R    u32 index of the newest record, u32 count of records not yet read ("new"). */
  NUM_RECORDS: xiaomi('ccb9'),
  /** R/W  u32 index to start streaming the history from. Writing it starts the stream. */
  RECORD_IDX: xiaomi('ccba'),
  /** N    14-byte hourly records <IIhBhB: idx, time, maxT/10, maxH, minT/10, minH>. */
  HISTORY: xiaomi('ccbc'),
  /** R/N  <hBh: temperature/100, humidity %, battery mV>. */
  READING: xiaomi('ccc1'),
} as const;

/** Standard Battery Service. */
export const BATTERY = {
  SERVICE: uuid16(0x180f),
  LEVEL: uuid16(0x2a19),
} as const;

/**
 * pvvx custom firmware (github.com/pvvx/ATC_MiThermometer) command channel.
 * One characteristic carries every command; the first byte of each packet is the command id.
 */
export const PVVX = {
  SERVICE: uuid16(0x1f10),
  COMMAND: uuid16(0x1f1f),
  CMD_TIME: 0x23, // get/set device clock -> [0x23, u32 time]
  CMD_MEASURE: 0x33, // start/stop measurement notifications -> [0x33, u16 mV, s16 T/100, s16 H/100, ...]
  CMD_LOGGER: 0x35, // read flash log -> [0x35, u16 n, u32 time, s16 T/100, u16 H/100, u16 mV] ... [0x35, 0, 0]
  // 0x36 is "CLEAR log". The previous app treated 0x36 as "history data"; never send it.
} as const;

/** Xiaomi MiBeacon / Mi Auth service, used for activation (bind key). */
export const MI_AUTH = {
  SERVICE: uuid16(0xfe95),
  FIRMWARE_VERSION: uuid16(0x0004),
  CONTROL: uuid16(0x0010),
  DATA: uuid16(0x0019),
} as const;

/** Every service the app may touch; Web Bluetooth requires them to be declared up front. */
export const ALL_SERVICES = [STOCK.SERVICE, BATTERY.SERVICE, PVVX.SERVICE, MI_AUTH.SERVICE];

/** Advertised name prefixes: stock firmware, atc1441/pvvx custom firmware. */
export const NAME_PREFIXES = ['LYWSD03', 'ATC_', 'PVVX', 'MHO-C', 'Mi', 'XMWSDJ'];
