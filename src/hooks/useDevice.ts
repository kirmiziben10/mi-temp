import { useCallback, useEffect, useRef, useState } from 'react';
import { getTransport, type BleConnection, type FoundDevice, type Unsubscribe } from '../ble';
import { AbortedError } from '../lib/async';
import type { Reading } from '../protocol/codec';
import { DeviceSession } from '../protocol/session';
import type { Firmware, HistoryPoint, SyncProgress } from '../protocol/types';
import {
  appendLocalSample,
  clearDeviceLog,
  loadDeviceLog,
  loadLocalLog,
  saveDeviceLogTrimming,
  saveLocalLog,
  type DeviceLog,
} from '../storage/history';
import { applyPvvxResult, applyStockResult, countAdded, pvvxRequest, stockRequest, usableCache } from '../storage/syncPlan';
import { storage } from '../storage/storage';

export type Status = 'disconnected' | 'connecting' | 'connected';

export interface LogEntry {
  id: number;
  time: string;
  message: string;
  data?: unknown;
}

export interface SyncState extends SyncProgress {
  running: boolean;
}

const MAX_LOG = 200;
const BIND_KEY = 'mi_bind_key'; // same key as the previous app, so a saved key survives the update
const LAST_DEVICE = 'miTemp.v2.lastDevice';

let logId = 0;

function describeError(err: unknown): string {
  if (err instanceof DOMException || err instanceof Error) {
    if (err.name === 'NotFoundError') return 'No device selected. Please try again.';
    if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
      return 'Bluetooth access denied. Please check your browser permissions.';
    }
    if (err.name === 'NetworkError') return 'Connection failed. Make sure your device is nearby and try again.';
    if (err.message) return err.message;
  }
  return String(err);
}

const isCancel = (err: unknown) =>
  err instanceof AbortedError ||
  (err instanceof Error && (err.name === 'AbortError' || /user cancel/i.test(err.message)));

export function useDevice() {
  const transport = getTransport();
  const sessionRef = useRef<DeviceSession | null>(null);
  const syncAbort = useRef<AbortController | null>(null);
  const scanStop = useRef<Unsubscribe | null>(null);
  /** The connection the UI currently belongs to; callbacks from any other one are stale. */
  const activeConn = useRef<BleConnection | null>(null);
  const removeDisconnectListener = useRef<(() => void) | null>(null);

  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [status, setStatus] = useState<Status>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(() => storage.getString(LAST_DEVICE));
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const [supportsActivation, setSupportsActivation] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [batteryEstimated, setBatteryEstimated] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [localHistory, setLocalHistory] = useState<HistoryPoint[]>(loadLocalLog);
  const [deviceHistory, setDeviceHistory] = useState<HistoryPoint[]>(
    () => (deviceId && loadDeviceLog(deviceId)?.points) || [],
  );
  const [lastSync, setLastSync] = useState<number | null>(() => (deviceId && loadDeviceLog(deviceId)?.lastSync) || null);
  const [sync, setSync] = useState<SyncState>({ running: false, received: 0 });
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [bindKey, setBindKeyState] = useState<string>(() => storage.getString(BIND_KEY) ?? '');
  const [picker, setPicker] = useState<{ open: boolean; devices: FoundDevice[]; error?: string }>({
    open: false,
    devices: [],
  });

  const addLog = useCallback((message: string, data?: unknown) => {
    const entry = { id: ++logId, time: new Date().toLocaleTimeString(), message, data };
    setLog((prev) => [...prev.slice(-(MAX_LOG - 1)), entry]);
  }, []);

  useEffect(() => {
    void transport.availability().then(setAvailability);
  }, [transport]);

  // Persist the local log whenever a new (per-minute) sample is added.
  const localSaved = useRef(localHistory);
  useEffect(() => {
    if (localSaved.current !== localHistory) {
      localSaved.current = localHistory;
      saveLocalLog(localHistory);
    }
  }, [localHistory]);

  const resetLive = useCallback(() => {
    removeDisconnectListener.current?.();
    removeDisconnectListener.current = null;
    activeConn.current = null;
    sessionRef.current = null;
    setStatus('disconnected');
    setReading(null);
    setRaw(null);
    setBattery(null);
    setFirmware(null);
    setSupportsActivation(false);
  }, []);

  const startSession = useCallback(
    async (conn: BleConnection) => {
      addLog('Connected to GATT server', conn.name);
      removeDisconnectListener.current?.();
      activeConn.current = conn;
      let lost = false;
      removeDisconnectListener.current = conn.onDisconnect(() => {
        if (activeConn.current !== conn) return; // a previous connection, already torn down
        lost = true;
        addLog('Device disconnected');
        syncAbort.current?.abort(new AbortedError('Device disconnected'));
        resetLive();
        setError('Device disconnected. Make sure it is nearby and reconnect.');
      });
      const session = await DeviceSession.start(conn, {
        log: addLog,
        onReading: ({ reading, raw }) => {
          setReading(reading);
          setRaw(raw);
          setLastUpdate(new Date());
          setLocalHistory((prev) =>
            appendLocalSample(prev, { t: Date.now(), temperature: reading.temperature, humidity: reading.humidity }),
          );
        },
        onBattery: (percent, source) => {
          setBattery(percent);
          setBatteryEstimated(source === 'voltage');
        },
      });
      // The link can drop while the session is starting; don't publish a dead connection.
      if (lost || activeConn.current !== conn || !conn.isConnected()) {
        await session.close().catch(() => undefined);
        throw new Error('The device disconnected while connecting. Please try again.');
      }
      sessionRef.current = session;
      setFirmware(session.firmware);
      setSupportsActivation(session.supportsActivation);
      setDeviceName(conn.name);
      setDeviceId(conn.id);
      storage.set(LAST_DEVICE, conn.id);
      const cached = loadDeviceLog(conn.id);
      setDeviceHistory(cached?.points ?? []);
      setLastSync(cached?.lastSync ?? null);
      setSyncMessage(null);
      setStatus('connected');
      addLog('Connected successfully!');
    },
    [addLog, resetLive],
  );

  const runConnect = useCallback(
    async (open: () => Promise<BleConnection>) => {
      setStatus('connecting');
      setError(null);
      setLog([]);
      addLog('Starting connection…');
      let conn: BleConnection | null = null;
      try {
        conn = await open();
        await startSession(conn);
      } catch (err) {
        addLog('Connection failed', describeError(err));
        await conn?.disconnect().catch(() => undefined);
        resetLive();
        setError(isCancel(err) ? 'Connection cancelled' : describeError(err));
      }
    },
    [addLog, resetLive, startSession],
  );

  const stopScan = useCallback(async () => {
    const stop = scanStop.current;
    scanStop.current = null;
    await stop?.();
  }, []);

  const connect = useCallback(async () => {
    if (status !== 'disconnected') return;
    if (transport.requestDevice) {
      await runConnect(() => transport.requestDevice!());
      return;
    }
    // Native: show our own picker fed by a BLE scan.
    setError(null);
    setPicker({ open: true, devices: [] });
    try {
      scanStop.current = await transport.scan!((found) =>
        setPicker((p) => {
          const devices = p.devices.filter((d) => d.id !== found.id);
          devices.push(found);
          devices.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
          return { ...p, devices };
        }),
      );
    } catch (err) {
      setPicker((p) => ({ ...p, error: describeError(err) }));
    }
  }, [runConnect, status, transport]);

  const chooseDevice = useCallback(
    async (device: FoundDevice) => {
      await stopScan();
      setPicker({ open: false, devices: [] });
      await runConnect(() => transport.connect!(device));
    },
    [runConnect, stopScan, transport],
  );

  const cancelPicker = useCallback(async () => {
    await stopScan();
    setPicker({ open: false, devices: [] });
  }, [stopScan]);

  const disconnect = useCallback(async () => {
    syncAbort.current?.abort();
    const session = sessionRef.current;
    resetLive(); // also detaches the disconnect listener, so this isn't reported as a link loss
    addLog('Disconnected by user');
    await session?.close();
  }, [addLog, resetLive]);

  const syncHistory = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || sync.running) return;
    const id = session.conn.id;
    const cache = usableCache(loadDeviceLog(id), session.firmware);
    const ac = new AbortController();
    syncAbort.current = ac;
    setSync({ running: true, received: 0 });
    setSyncMessage(null);
    setError(null);
    addLog('Starting device history sync…');
    const onProgress = (p: SyncProgress) => setSync({ running: true, ...p });
    try {
      let next: DeviceLog;
      let complete: boolean;
      if (session.firmware === 'stock') {
        const res = await session.syncStock({ ...stockRequest(cache), signal: ac.signal, onProgress });
        next = applyStockResult(cache, res);
        complete = res.complete;
      } else {
        if (cache?.incomplete) addLog('Previous read-out was interrupted; reading the full log');
        const res = await session.syncPvvx({ ...pvvxRequest(cache), signal: ac.signal, onProgress });
        next = applyPvvxResult(cache, res);
        complete = res.complete;
      }
      const added = countAdded(cache?.points, next.points);
      const now = Date.now();
      next.lastSync = now;
      const total = next.points.length;
      const saved = saveDeviceLogTrimming(id, next);
      let msg = `${added} new record${added === 1 ? '' : 's'}`;
      if (!complete) msg += ' (stream ended early — sync again to continue)';
      if (saved === 0) {
        // Keep showing what was downloaded, but say it is not persisted.
        msg += '. Could not save the history (storage full?), so it will be lost on reload';
        addLog('Could not save device history cache (storage full?)');
      } else {
        if (saved < total) {
          next.points = next.points.slice(total - saved);
          msg += `. Storage is full, so only the newest ${saved} records were kept`;
          addLog('Storage full: trimmed the device history cache', { kept: saved, dropped: total - saved });
        }
        setLastSync(now);
      }
      setDeviceHistory(next.points);
      setSyncMessage(msg);
      addLog('History sync finished', { added, total: next.points.length, complete });
    } catch (err) {
      if (isCancel(err)) {
        setSyncMessage('Sync cancelled');
        addLog('History sync cancelled');
      } else {
        setError(`Failed to fetch history: ${describeError(err)}`);
        addLog('History sync failed', describeError(err));
      }
    } finally {
      syncAbort.current = null;
      setSync({ running: false, received: 0 });
    }
  }, [addLog, sync.running]);

  const cancelSync = useCallback(() => syncAbort.current?.abort(), []);

  const clearDeviceHistory = useCallback(() => {
    if (!deviceId) return;
    clearDeviceLog(deviceId);
    setDeviceHistory([]);
    setLastSync(null);
    setSyncMessage(null);
  }, [deviceId]);

  const clearLocalHistory = useCallback(() => setLocalHistory([]), []);

  const setBindKey = useCallback((key: string) => {
    setBindKeyState(key);
    storage.set(BIND_KEY, key);
  }, []);

  const activate = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setActivating(true);
    setError(null);
    addLog('Starting activation…');
    try {
      const res = await session.activate();
      setBindKey(res.bindKey);
      // The key goes into the Bind Key field only; derived session material is never logged.
      addLog('Activation successful — bind key saved', { firmware: res.firmwareVersion, wasActivated: res.wasActivated });
    } catch (err) {
      setError(`Activation failed: ${describeError(err)}`);
      addLog('Activation failed', describeError(err));
    } finally {
      setActivating(false);
    }
  }, [addLog, setBindKey]);

  // Release the radio when the app is closed.
  useEffect(
    () => () => {
      void scanStop.current?.();
      void sessionRef.current?.close();
    },
    [],
  );

  return {
    transportKind: transport.kind,
    availability,
    status,
    deviceName,
    firmware,
    supportsActivation,
    reading,
    raw,
    battery,
    batteryEstimated,
    lastUpdate,
    error,
    log,
    localHistory,
    deviceHistory,
    lastSync,
    sync,
    syncMessage,
    activating,
    bindKey,
    picker,
    connect,
    chooseDevice,
    cancelPicker,
    disconnect,
    syncHistory,
    cancelSync,
    clearDeviceHistory,
    clearLocalHistory,
    setBindKey,
    activate,
  };
}

export type DeviceController = ReturnType<typeof useDevice>;
