import { useState, useCallback, useEffect, useRef } from 'react';
import { doActivation } from '../utils/xiaomiActivation';
import { UUIDS, CONSTANTS } from '../utils/constants';

/**
 * Custom hook for managing Bluetooth connection to Xiaomi Temperature Monitor
 * Handles connection, data parsing, history fetching, and activation.
 * 
 * @returns {Object} Bluetooth device state and methods
 */
export const useBluetoothDevice = () => {
  const [device, setDevice] = useState(null);
  const deviceRef = useRef(null);
  const listenersRef = useRef([]); // Store active listeners for cleanup
  
  const [connected, setConnected] = useState(false);
  const [temperature, setTemperature] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [battery, setBattery] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rawData, setRawData] = useState(null);
  const [debugLog, setDebugLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [deviceHistory, setDeviceHistory] = useState([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [bindKey, setBindKey] = useState(null);

  /**
   * Add a cleanup function to the list
   * @param {Function} cleanupFn - Function to run on cleanup
   */
  const addCleanupListener = useCallback((cleanupFn) => {
    listenersRef.current.push(cleanupFn);
  }, []);

  /**
   * Run all cleanup listeners and clear the list
   */
  const cleanupListeners = useCallback(() => {
    listenersRef.current.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.warn('Error during cleanup:', e);
      }
    });
    listenersRef.current = [];
  }, []);

  /**
   * Add a debug log entry
   * @param {string} message - Log message
   * @param {any} data - Optional data to log
   */
  const addDebugLog = useCallback((message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLog(prev => [...prev, { timestamp, message, data }].slice(-CONSTANTS.MAX_DEBUG_LOGS));
  }, []);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('mi_temp_history');
      const savedBindKey = localStorage.getItem('mi_bind_key');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
      if (savedBindKey) {
        setBindKey(savedBindKey);
      }
    } catch (err) {
      console.error('Failed to load history from localStorage:', err);
    }
  }, []);

  // Save history to localStorage whenever it changes
  const saveHistoryEntry = useCallback((temp, hum) => {
    setHistory(prev => {
      const newEntry = {
        timestamp: Date.now(),
        temperature: temp,
        humidity: hum
      };
      const updated = [...prev, newEntry].slice(-CONSTANTS.MAX_HISTORY_ENTRIES);
      try {
        localStorage.setItem('mi_temp_history', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save history to localStorage:', err);
      }
      return updated;
    });
  }, []);

  // Save bind key to localStorage
  const saveBindKey = useCallback((key) => {
    setBindKey(key);
    try {
      localStorage.setItem('mi_bind_key', key);
      addDebugLog('Bind key saved', key);
    } catch (err) {
      console.error('Failed to save bind key:', err);
    }
  }, [addDebugLog]);

  /**
   * Parse the temperature/humidity characteristic value
   * @param {DataView} value - Raw data view
   */
  const parseData = useCallback((value) => {
    try {
      // Store raw data
      const bytes = [];
      for (let i = 0; i < value.byteLength; i++) {
        bytes.push(value.getUint8(i));
      }
      const rawHex = bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
      setRawData({ bytes, hex: rawHex });

      // Based on TelinkFlasher.html lines 145-152
      // Temperature: 2 bytes, little-endian, signed, divided by 100
      // Humidity: 1 byte, unsigned
      const sign = value.getUint8(1) & (1 << 7);
      let temp = ((value.getUint8(1) & 0x7F) << 8) | value.getUint8(0);
      if (sign) temp = temp - 32767;
      temp = temp / 100;

      const hum = value.getUint8(2);

      addDebugLog('Data received', {
        raw: rawHex,
        temperature: `${temp}°C`,
        humidity: `${hum}%`,
        bytes: bytes.length
      });

      setTemperature(temp);
      setHumidity(hum);
      setLastUpdate(new Date());
      setError(null);

      // Save to history
      saveHistoryEntry(temp, hum);
    } catch (err) {
      console.error('Error parsing data:', err);
      addDebugLog('Parse error', err.message);
      setError('Failed to parse sensor data');
    }
  }, [addDebugLog, saveHistoryEntry]);

  // Handle characteristic value changes
  const handleCharacteristicValueChanged = useCallback((event) => {
    const value = event.target.value;
    parseData(value);
  }, [parseData]);

  /**
   * Connect to the device with retry logic
   */
  const connect = useCallback(async () => {
    if (isConnecting) return;
    
    setIsConnecting(true);
    setError(null);
    setDebugLog([]);
    addDebugLog('Starting connection...');

    const maxRetries = CONSTANTS.MAX_CONNECTION_RETRIES;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        addDebugLog(`Connection attempt ${attempt}/${maxRetries}`);

        if (attempt === 1) {
          // Only request device on first attempt
          addDebugLog('Requesting Bluetooth device...');

          const bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [
              { namePrefix: 'LYWSD03' },  // Stock device name
              { namePrefix: 'ATC' },       // Custom firmware names
              { namePrefix: 'Mi' }
            ],
            optionalServices: [
              UUIDS.SERVICE_MAIN,
              UUIDS.SERVICE_BATTERY,
              UUIDS.SERVICE_MI_DATA,
              UUIDS.SERVICE_MI_AUTH
            ]
          });

          addDebugLog('Device selected', bluetoothDevice.name);
          setDevice(bluetoothDevice);

          // Listen for disconnection
          const handleDisconnect = () => {
            console.log('Device disconnected');
            addDebugLog('Device disconnected');
            setConnected(false);
            setTemperature(null);
            setHumidity(null);
            setBattery(null);
            cleanupListeners(); // Clean up all listeners on disconnect
          };

          bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnect);
          
          // Add disconnection listener cleanup manually since it's on the device, not a characteristic
          // We don't add it to listenersRef because we want it to persist until actual disconnect
        
          // Store device for retries
          deviceRef.current = bluetoothDevice;
        }

        const bluetoothDevice = deviceRef.current;
        if (!bluetoothDevice) {
          throw new Error('No device selected');
        }

        // Connect to GATT server
        addDebugLog('Connecting to GATT server...');
        const server = await bluetoothDevice.gatt.connect();
        addDebugLog('GATT server connected');

        // Get the main service
        addDebugLog('Getting service', UUIDS.SERVICE_MAIN);
        const service = await server.getPrimaryService(UUIDS.SERVICE_MAIN);
        addDebugLog('Service found');

        // Get the temperature/humidity characteristic
        addDebugLog('Getting characteristic', UUIDS.CHAR_TEMP_HUMIDITY);
        const characteristic = await service.getCharacteristic(UUIDS.CHAR_TEMP_HUMIDITY);
        addDebugLog('Characteristic found');

        // Start notifications
        addDebugLog('Starting notifications...');
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
        
        // Register cleanup for this listener
        addCleanupListener(() => {
            characteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
            characteristic.stopNotifications().catch(e => console.warn('Failed to stop notifications', e));
        });
        
        addDebugLog('Notifications enabled');

        // Read the initial value
        addDebugLog('Reading initial value...');
        const value = await characteristic.readValue();
        parseData(value);

        // Try to get Battery Service
        try {
          addDebugLog('Getting battery service...');
          const batteryService = await server.getPrimaryService(UUIDS.SERVICE_BATTERY);
          const batteryChar = await batteryService.getCharacteristic(UUIDS.CHAR_BATTERY_LEVEL);

          await batteryChar.startNotifications();
          
          const handleBatteryChange = (e) => {
            const level = e.target.value.getUint8(0);
            setBattery(level);
            addDebugLog('Battery level updated', `${level}%`);
          };
          
          batteryChar.addEventListener('characteristicvaluechanged', handleBatteryChange);
          
          // Register cleanup for battery listener
          addCleanupListener(() => {
              batteryChar.removeEventListener('characteristicvaluechanged', handleBatteryChange);
              batteryChar.stopNotifications().catch(e => console.warn('Failed to stop battery notifications', e));
          });

          const batteryValue = await batteryChar.readValue();
          const level = batteryValue.getUint8(0);
          setBattery(level);
          addDebugLog('Battery level read', `${level}%`);
        } catch (battErr) {
          console.warn('Battery service not available:', battErr);
          // Don't fail the whole connection, just log it
          addDebugLog('Battery service failed (non-fatal)', battErr.message);
        }

        setConnected(true);
        setIsConnecting(false);
        addDebugLog('Connected successfully!');
        return; // Success! Exit the retry loop

      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err);
        addDebugLog(`Attempt ${attempt} failed`, err.message);
        lastError = err;

        // If user cancelled, don't retry
        if (err.message && err.message.includes('User cancelled')) {
          break;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const waitTime = Math.min(CONSTANTS.TIMEOUT_CONNECTION_RETRY_BASE * Math.pow(2, attempt - 1), CONSTANTS.TIMEOUT_CONNECTION_RETRY_MAX);
          addDebugLog(`Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries failed
    addDebugLog('All connection attempts failed');

    // Provide more helpful error messages
    let errorMessage = 'Failed to connect after multiple attempts';

    if (lastError) {
      if (lastError.name === 'NotFoundError') {
        errorMessage = 'No device selected. Please try again.';
      } else if (lastError.name === 'SecurityError') {
        errorMessage = 'Bluetooth access denied. Please check your browser permissions.';
      } else if (lastError.name === 'NetworkError') {
        errorMessage = 'Connection failed. Make sure your device is nearby and try again.';
      } else if (lastError.message && lastError.message.includes('User cancelled')) {
        errorMessage = 'Connection cancelled';
      } else if (lastError.message) {
        errorMessage = lastError.message;
      }
    }

    setError(errorMessage);
    setIsConnecting(false);
    setConnected(false);
    cleanupListeners(); // Cleanup any partial listeners
  }, [handleCharacteristicValueChanged, parseData, addDebugLog, addCleanupListener, cleanupListeners, isConnecting]);

  /**
   * Disconnect from the device
   */
  const disconnect = useCallback(() => {
    if (deviceRef.current && deviceRef.current.gatt.connected) {
      cleanupListeners(); // Clean up listeners before disconnecting
      deviceRef.current.gatt.disconnect();
      addDebugLog('Disconnected by user');
      setConnected(false);
      setDevice(null);
      deviceRef.current = null;
      setTemperature(null);
      setHumidity(null);
      setBattery(null);
    }
  }, [addDebugLog, cleanupListeners]);

  /**
   * Perform activation to get bind key
   */
  const activate = useCallback(async () => {
    if (!deviceRef.current) {
      setError('No device connected. Please connect first.');
      return null;
    }

    try {
      addDebugLog('Starting activation...');
      setError(null);

      const key = await doActivation(deviceRef.current);

      if (key) {
        saveBindKey(key);
        addDebugLog('Activation successful', `Key: ${key.substring(0, 8)}...`);
        return key;
      } else {
        throw new Error('No bind key returned');
      }
    } catch (err) {
      console.error('Activation error:', err);
      const errorMsg = `Activation failed: ${err.message}`;
      setError(errorMsg);
      addDebugLog('Activation failed', err.message);
      return null;
    }
  }, [addDebugLog, saveBindKey]);

  /**
   * Fetch device history (supports both Stock and ATC firmware)
   */
  const fetchDeviceHistory = useCallback(async () => {
    if (!deviceRef.current || !deviceRef.current.gatt.connected) {
      setError('No device connected. Please connect first.');
      return [];
    }

    setIsFetchingHistory(true);
    setError(null);
    setDeviceHistory([]); // Clear previous history
    addDebugLog('Starting device history fetch...');

    const server = deviceRef.current.gatt;

    try {
      // -------------------------------------------------------------
      // STRATEGY 1: Try Stock Firmware History (Mi Home app method)
      // -------------------------------------------------------------
      try {
        addDebugLog('Checking for stock firmware history service...');
        const service = await server.getPrimaryService(UUIDS.SERVICE_MAIN);

        // Check if history characteristic exists
        let historyChar;
        try {
          historyChar = await service.getCharacteristic(UUIDS.CHAR_HISTORY_DATA);
        } catch (_e) {
          // If main service exists but history char doesn't, it might be an older firmware or different mode
          // Fall through to catch block to try ATC
          throw new Error('Stock history characteristic not found');
        }

        addDebugLog('Stock firmware history characteristics found');

        // 1. Get device time to calculate start time
        addDebugLog('Reading device time...');
        const timeChar = await service.getCharacteristic(UUIDS.CHAR_DEVICE_TIME);
        const timeValue = await timeChar.readValue();

        // Parse time: [timestamp(4), tz_offset(1)?]
        const deviceTimestamp = timeValue.getUint32(0, true); // Little-endian

        // Calculate device activation time (approximate)
        const now = Date.now() / 1000;
        const timeOffset = now - deviceTimestamp;
        addDebugLog(`Time sync: device=${deviceTimestamp}, offset=${timeOffset.toFixed(0)}s`);

        // 2. Get number of records
        addDebugLog('Reading record count...');
        const numRecordsChar = await service.getCharacteristic(UUIDS.CHAR_NUM_RECORDS);
        const numRecordsValue = await numRecordsChar.readValue();
        const totalRecords = numRecordsValue.getUint32(0, true);
        const currentRecords = numRecordsValue.getUint32(4, true);

        addDebugLog(`Found ${totalRecords} total records, ${currentRecords} current`);

        if (currentRecords === 0) {
          addDebugLog('No history records found on device');
          setIsFetchingHistory(false);
          return [];
        }

        // 3. Set index to read from (0 = start)
        const idxChar = await service.getCharacteristic(UUIDS.CHAR_RECORD_IDX);
        const idxBuffer = new ArrayBuffer(4);
        new DataView(idxBuffer).setUint32(0, 0, true);
        await idxChar.writeValue(idxBuffer);

        // 4. Subscribe to history notifications
        const historyEntries = [];
        let lastUpdate = Date.now();

        const handleStockHistory = (event) => {
          const value = event.target.value;
          // Format based on lywsd02/03: <IIhBhB (14 bytes)
          // [idx(4)] [ts(4)] [max_temp(2)] [max_hum(1)] [min_temp(2)] [min_hum(1)]

          if (value.byteLength >= 14) {
            // idx is available at 0, but unused
            const tsRaw = value.getUint32(4, true);
            const maxTemp = value.getInt16(8, true) / 100;
            const maxHum = value.getUint8(10);
            const minTemp = value.getInt16(11, true) / 100;
            const minHum = value.getUint8(13);

            // Calculate timestamp: Device Time + Offset we calculated earlier
            const timestamp = (tsRaw + timeOffset) * 1000;

            historyEntries.push({
              timestamp,
              temperature: (maxTemp + minTemp) / 2, // Average for display
              humidity: (maxHum + minHum) / 2,
              minTemperature: minTemp,
              maxTemperature: maxTemp,
              minHumidity: minHum,
              maxHumidity: maxHum,
              source: 'stock'
            });

            lastUpdate = Date.now();

            if (historyEntries.length % 10 === 0) {
              addDebugLog(`Received ${historyEntries.length} / ${currentRecords} records...`);
            }
          }
        };

        await historyChar.startNotifications();
        historyChar.addEventListener('characteristicvaluechanged', handleStockHistory);

        // Wait for data completion
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            // Timeout if no data for 3 seconds OR we have all records
            if (Date.now() - lastUpdate > CONSTANTS.TIMEOUT_HISTORY_CHUNK || historyEntries.length >= currentRecords) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);
        });

        // Cleanup
        historyChar.removeEventListener('characteristicvaluechanged', handleStockHistory);
        await historyChar.stopNotifications();

        historyEntries.sort((a, b) => a.timestamp - b.timestamp);
        setDeviceHistory(historyEntries);
        addDebugLog(`Stock history fetch complete: ${historyEntries.length} entries`);
        setIsFetchingHistory(false);
        return historyEntries;

      } catch (stockErr) {
        console.warn('Stock firmware fetch failed, trying ATC...', stockErr);
        addDebugLog('Stock firmware history not available/failed', stockErr.message);
        // Continue to ATC method...
      }

      // -------------------------------------------------------------
      // STRATEGY 2: ATC Firmware History
      // -------------------------------------------------------------

      // Try to get ATC service
      let atcService;
      try {
        atcService = await server.getPrimaryService(UUIDS.SERVICE_ATC);
        addDebugLog('ATC service found');
      } catch (_err) {
        throw new Error('Neither Stock nor ATC firmware history available.');
      }

      // Get command characteristic
      const cmdChar = await atcService.getCharacteristic(UUIDS.CHAR_ATC_CMD);
      addDebugLog('Command characteristic found');

      const historyEntries = [];
      let receivingData = true;
      let timeout = null;

      // Set up notification handler for incoming data
      const handleNotification = (event) => {
        const value = event.target.value;
        const cmdId = value.getUint8(0);

        if (cmdId === CONSTANTS.CMD_ID_MEMO_DATA) {
          // Parse history data packet
          // Format: [cmd_id(1)] [timestamp(4)] [temp(2)] [hum(1)] [battery(1)] ...
          const packetSize = CONSTANTS.HISTORY_PACKET_SIZE_ATC;
          const numEntries = Math.floor((value.byteLength - 1) / packetSize);

          for (let i = 0; i < numEntries; i++) {
            const offset = 1 + (i * packetSize);
            if (offset + packetSize <= value.byteLength) {
              const timestamp = value.getUint32(offset, true) * 1000; // Convert to ms
              const tempRaw = value.getInt16(offset + 4, true);
              const temp = tempRaw / 100;
              const hum = value.getUint8(offset + 6);
              const battery = value.getUint16(offset + 7, true) / 1000; // mV to V

              historyEntries.push({
                timestamp,
                temperature: temp,
                humidity: hum,
                battery,
                source: 'custom'
              });
            }
          }

          addDebugLog(`Received ${numEntries} history entries`);

          // Reset timeout - more data might be coming
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            receivingData = false;
          }, CONSTANTS.TIMEOUT_ATC_CHUNK);
        }
      };

      await cmdChar.startNotifications();
      cmdChar.addEventListener('characteristicvaluechanged', handleNotification);

      // Send command to start reading memory
      // Command format: [CMD_ID_MEMO_START] [start_offset(4 bytes, little-endian)]
      const cmdBuffer = new ArrayBuffer(5);
      const cmdView = new DataView(cmdBuffer);
      cmdView.setUint8(0, CONSTANTS.CMD_ID_MEMO_START);
      cmdView.setUint32(1, 0, true); // Start from offset 0

      addDebugLog('Sending history read command...');
      await cmdChar.writeValue(cmdBuffer);

      // Wait for data to finish coming in
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!receivingData) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);

        // Maximum wait time
        setTimeout(() => {
          receivingData = false;
          clearInterval(checkInterval);
          resolve();
        }, CONSTANTS.TIMEOUT_HISTORY_FETCH);
      });

      // Cleanup
      cmdChar.removeEventListener('characteristicvaluechanged', handleNotification);
      await cmdChar.stopNotifications();

      // Sort by timestamp and update state
      historyEntries.sort((a, b) => a.timestamp - b.timestamp);
      setDeviceHistory(historyEntries);

      addDebugLog(`Device history fetch complete: ${historyEntries.length} entries`);
      setIsFetchingHistory(false);
      return historyEntries;

    } catch (err) {
      console.error('History fetch error:', err);
      const errorMsg = `Failed to fetch history: ${err.message}`;
      setError(errorMsg);
      addDebugLog('History fetch failed', err.message);
      setIsFetchingHistory(false);
      return [];
    }
  }, [addDebugLog]);

  // Check if Web Bluetooth is available
  const isBluetoothAvailable = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupListeners();
      if (deviceRef.current && deviceRef.current.gatt.connected) {
        deviceRef.current.gatt.disconnect();
      }
    };
  }, [cleanupListeners]);

  return {
    connect,
    disconnect,
    activate,
    fetchDeviceHistory,
    connected,
    isConnecting,
    isFetchingHistory,
    temperature,
    humidity,
    battery,
    lastUpdate,
    error,
    isBluetoothAvailable,
    deviceName: device?.name || null,
    rawData,
    debugLog,
    history,
    deviceHistory,
    bindKey,
    saveBindKey
  };
};
