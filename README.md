# Mi Temperature Monitor

A web app **and Android app** for the **Xiaomi Mi Temperature and Humidity Monitor 2** (LYWSD03MMC). It connects over Bluetooth LE to show live readings, download the log stored on the thermometer, and get the device's bind key.

Works with the **stock Xiaomi firmware** and with **[pvvx custom firmware](https://github.com/pvvx/ATC_MiThermometer)**. Flashing is not required.

## Features

- **Live readings**: temperature, humidity, battery (from the battery service, or estimated from the cell voltage), and the comfort face `(^_^)` / `(-^-)`.
- **On-device history**: one **Sync** button downloads the log stored on the thermometer.
  - Stock firmware: hourly min/max records, drawn as a band around the mean.
  - pvvx firmware: the flash log (by default one averaged sample every 10 minutes).
  - Syncs are incremental: only new records are fetched, and the log is cached per device.
- **Local history**: the app also logs one sample per minute while connected, kept for 14 days.
- **Charts**: 1h / 6h / 24h / 7d / All windows on a real time axis. Long ranges are downsampled, keeping the min/max extremes.
- **Bind key**: runs the full Mi activation and returns the key used to decrypt the sensor's encrypted advertisements (e.g. in Home Assistant).
- **Developer console**: raw bytes, decoded values, and a step-by-step protocol log.
- Light/dark theme (follows the system until you choose one), responsive desktop/mobile layout.

## Using it

### In a browser

You need a browser with [Web Bluetooth](https://caniuse.com/web-bluetooth): Chrome, Edge or Opera on desktop or Android. Web Bluetooth only works over **HTTPS or `localhost`**.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ — host it on any HTTPS static host
```

### On Android

The Android app is the same UI wrapped with [Capacitor](https://capacitorjs.com/). Inside the app, Bluetooth goes through the native Android stack (`@capacitor-community/bluetooth-le`) instead of Web Bluetooth. It includes its own device picker, and on Android 12+ it asks for *Nearby devices* permission only, not location.

- **Prebuilt APK**: every push runs CI (`.github/workflows/ci.yml`), which builds `app-debug.apk`. Download it from the run's *Artifacts* (`mi-temp-debug-apk`) and install it on the phone (allow "install unknown apps").
- **Build it yourself** (needs Android Studio, or the Android SDK plus JDK 21):

  ```bash
  npm install
  npm run android:sync     # build the web app and copy it into android/
  npm run android:open     # open in Android Studio, then Run ▶
  # or, from the command line:
  npm run android:apk      # -> android/app/build/outputs/apk/debug/app-debug.apk
  ```

Minimum Android version: 7.0 (API 24).

## How history retrieval works

This was rebuilt from scratch. The protocol details were checked against reference implementations: [h4/lywsd02](https://github.com/h4/lywsd02), [uduncanu/lywsd03mmc](https://github.com/uduncanu/lywsd03mmc), pvvx's firmware source (`cmd_parser.c`, `send_memo_blk`) and pvvx's `GraphMemo.html` / `GraphMemoOriginal.html`.

### Stock firmware (service `ebe0ccb0-…`)

| Step | Characteristic | Data |
| --- | --- | --- |
| 1 | `ebe0ccb9` read | `u32 newestIndex, u32 newSinceLastReadout` |
| 2 | `ebe0ccb7` read | `u32` device clock (seconds) — used as the time anchor |
| 3 | `ebe0ccbc` notify on | |
| 4 | `ebe0ccba` write | `u32` start index (0 = everything stored) |
| 5 | `ebe0ccbc` notifications | 14 bytes `<IIhBhB>`: index, device time, max °C×10, max %RH, min °C×10, min %RH |

The download is complete when the record with `index == newestIndex` arrives.

### pvvx firmware (command characteristic `0x1f1f`)

`[0x23]` returns the device clock. `[0x35, count16, 0, 0]` streams up to `count` records, newest first. Each record is 13 bytes `[0x35, n16, time32, °C×100, %RH×100, mV]`, and `[0x35, 0, 0]` ends the stream. Sending `[0x35, 0, 0]` also stops a read-out early.

### Timestamps

Neither firmware has a trustworthy wall clock. The stock clock counts seconds since the battery went in. So the app reads the device clock once per sync and places every record at `now − (deviceNow − recordTime)`. Records that would land in the future or years in the past are dropped and logged. These come from a clock that was set or reset between records.

### What was wrong in the previous version

Every one of these is covered by a unit test against a simulated device (`src/protocol/protocol.test.ts`):

1. **History was cut short.** The download stopped after `newSinceLastReadout` records, which is the number of *new* records, not the number stored. Against a simulated device holding 168 records, the old build returned 21. It now runs until the newest index arrives.
2. **It gave up too early.** It waited only 3 s of silence, but this sensor is slow (the reference client waits 15 s). Now it waits up to 20 s for the first record, then 10 s between records. If a stream does stop early, the partial data is kept and the next sync resumes.
3. **Always a full download.** Syncs now resume after the last stored index. If the counter goes backwards (battery change), the device was reset and the app downloads everything again. If a device ignores the resume index, the app falls back to index 0.
4. **The bind key was not required.** The old UI said a bind key was needed for history; it never was. History now works without activation, and the hidden "triple-click / long-press" gesture is replaced by a visible **Sync** button.
5. **The custom-firmware path could never work.** It waited for 9-byte records under command `0x36`. In pvvx firmware `0x36` is *clear log*, and records arrive under `0x35` in a 13-byte layout. The app never sends `0x36`.
6. **The "bind key" was not valid.** Activation stopped right after deriving the key, without sending the AES-CCM-encrypted device ID or the final register command. So the device never stored that key. The full exchange now runs (with an AES-CCM implementation on WebCrypto, tested against Node's), and success is only reported once the device confirms.
7. **Smaller fixes.** Negative temperatures were off by 0.01 °C (sign handling). The local log wrote to storage on every notification but kept only ~1.5 hours of data. Charts used an evenly spaced category axis instead of real time. GATT operations weren't serialized, which can fail with "operation already in progress".

> Activation re-binds the sensor. If it is paired with the Mi Home app, that pairing stops working. The app asks before doing it.

## Project structure

```
src/
  ble/            transport-neutral BLE interface
    webBluetooth.ts      browser (Web Bluetooth)
    nativeBluetooth.ts   Android (Capacitor plugin)
  protocol/       everything device-specific, no UI, unit-tested
    codec.ts             packet decoders
    clock.ts             device-clock → wall-clock anchoring
    stockHistory.ts      stock firmware log download
    pvvx.ts              pvvx firmware live data + flash log
    miActivation.ts      Mi registration / bind key
    session.ts           firmware detection, live readings, battery
  storage/        local log + per-device log cache (localStorage)
  hooks/          React state (useDevice, useTheme)
  components/     UI
android/          Capacitor Android project
Telink Flasher/   atc1441's TelinkFlasher (reference for the activation protocol / firmware flashing)
```

## Development

```bash
npm run check    # typecheck + lint + unit tests
npm test         # unit tests only (vitest)
```

The protocol code only talks to the small `BleConnection` interface (`src/ble/types.ts`), so the tests run it against simulated devices in `src/test/fakeDevices.ts`. That includes the device side of the Mi activation, which only accepts the registration if the encrypted device ID decrypts under the key it derived.

## Credits

- [atc1441/ATC_MiThermometer](https://github.com/atc1441/ATC_MiThermometer): the TelinkFlasher activation flow and the original reverse engineering.
- [pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer): custom firmware, its command protocol and history readers.
- [h4/lywsd02](https://github.com/h4/lywsd02) and [uduncanu/lywsd03mmc](https://github.com/uduncanu/lywsd03mmc): the stock history protocol.

MIT licensed.
