/**
 * Bluetooth UUIDs and Constants for Xiaomi Mi Temperature Monitor
 */

// --- UUIDs ---

// Standard & Xiaomi Services
export const UUIDS = {
  // Main Temperature/Humidity Service (Xiaomi & ATC)
  SERVICE_MAIN: 'ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6',
  CHAR_TEMP_HUMIDITY: 'ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6',

  // Battery Service (Standard BLE)
  SERVICE_BATTERY: 0x180F,
  CHAR_BATTERY_LEVEL: 0x2A19,

  // ATC Custom Firmware Service
  SERVICE_ATC: 0x1F10,
  CHAR_ATC_CMD: 0x1F1F,

  // Xiaomi Activation Service
  SERVICE_MI_AUTH: '00010203-0405-0607-0809-0a0b0c0d1912',
  CHAR_AUTH_INIT: '00000010-0000-1000-8000-00805f9b34fb',
  CHAR_AUTH: '00000001-0000-1000-8000-00805f9b34fb',
  CHAR_FIRMWARE_VER: '00000004-0000-1000-8000-00805f9b34fb',
  CHAR_BEACON_KEY: '00000014-0000-1000-8000-00805f9b34fb',

  // Stock Firmware History
  CHAR_HISTORY_DATA: 'ebe0ccbc-7a0a-4b0c-8a1a-6ff2997da3a6',
  CHAR_NUM_RECORDS: 'ebe0ccb9-7a0a-4b0c-8a1a-6ff2997da3a6',
  CHAR_RECORD_IDX: 'ebe0ccba-7a0a-4b0c-8a1a-6ff2997da3a6',
  CHAR_DEVICE_TIME: 'ebe0ccb7-7a0a-4b0c-8a1a-6ff2997da3a6',

  // Xiaomi Service Data (Advertisements)
  SERVICE_MI_DATA: 0xfe95,
};

// --- Constants ---

export const CONSTANTS = {
  // ATC History Command IDs
  CMD_ID_MEMO_START: 0x35,
  CMD_ID_MEMO_DATA: 0x36,

  // Limits
  MAX_DEBUG_LOGS: 50,
  MAX_HISTORY_ENTRIES: 1000,
  HISTORY_PACKET_SIZE_ATC: 9,

  // Timeouts (ms)
  TIMEOUT_CONNECTION_RETRY_BASE: 1000,
  TIMEOUT_CONNECTION_RETRY_MAX: 3000,
  TIMEOUT_HISTORY_FETCH: 30000,
  TIMEOUT_HISTORY_CHUNK: 3000,
  TIMEOUT_ATC_CHUNK: 2000,
  TIMEOUT_AUTH_RESPONSE: 10000,

  // Retries
  MAX_CONNECTION_RETRIES: 3,
};
