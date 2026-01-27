import { useState, useCallback, useEffect } from 'react';

const SERVICE_UUID = 'ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6';
const TEMP_HUMIDITY_CHAR_UUID = 'ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6';

export const useBluetoothDevice = () => {
  const [device, setDevice] = useState(null);
  const [connected, setConnected] = useState(false);
  const [temperature, setTemperature] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [battery, setBattery] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rawData, setRawData] = useState(null);
  const [debugLog, setDebugLog] = useState([]);

  // Add debug log entry
  const addDebugLog = useCallback((message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLog(prev => [...prev, { timestamp, message, data }].slice(-50)); // Keep last 50 entries
  }, []);

  // Parse the temperature/humidity characteristic value
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
    } catch (err) {
      console.error('Error parsing data:', err);
      addDebugLog('Parse error', err.message);
      setError('Failed to parse sensor data');
    }
  }, [addDebugLog]);

  // Handle characteristic value changes
  const handleCharacteristicValueChanged = useCallback((event) => {
    const value = event.target.value;
    parseData(value);
  }, [parseData]);

  // Connect to the device with retry logic
  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setDebugLog([]);
    addDebugLog('Starting connection...');

    const maxRetries = 3;
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
            optionalServices: [SERVICE_UUID, 0xfe95, '00010203-0405-0607-0809-0a0b0c0d1912']
          });

          addDebugLog('Device selected', bluetoothDevice.name);
          setDevice(bluetoothDevice);

          // Listen for disconnection
          bluetoothDevice.addEventListener('gattserverdisconnected', () => {
            console.log('Device disconnected');
            addDebugLog('Device disconnected');
            setConnected(false);
            setTemperature(null);
            setHumidity(null);
            setBattery(null);
          });

          // Store device for retries
          window._btDevice = bluetoothDevice;
        }

        const bluetoothDevice = window._btDevice;
        if (!bluetoothDevice) {
          throw new Error('No device selected');
        }

        // Connect to GATT server
        addDebugLog('Connecting to GATT server...');
        const server = await bluetoothDevice.gatt.connect();
        addDebugLog('GATT server connected');

        // Get the main service
        addDebugLog('Getting service', SERVICE_UUID);
        const service = await server.getPrimaryService(SERVICE_UUID);
        addDebugLog('Service found');

        // Get the temperature/humidity characteristic
        addDebugLog('Getting characteristic', TEMP_HUMIDITY_CHAR_UUID);
        const characteristic = await service.getCharacteristic(TEMP_HUMIDITY_CHAR_UUID);
        addDebugLog('Characteristic found');

        // Start notifications
        addDebugLog('Starting notifications...');
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
        addDebugLog('Notifications enabled');

        // Read the initial value
        addDebugLog('Reading initial value...');
        const value = await characteristic.readValue();
        parseData(value);

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
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
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
  }, [handleCharacteristicValueChanged, parseData, addDebugLog]);

  // Disconnect from the device
  const disconnect = useCallback(() => {
    if (device && device.gatt.connected) {
      device.gatt.disconnect();
      addDebugLog('Disconnected by user');
      setConnected(false);
      setDevice(null);
      setTemperature(null);
      setHumidity(null);
      setBattery(null);
    }
  }, [device, addDebugLog]);

  // Check if Web Bluetooth is available
  const isBluetoothAvailable = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (device && device.gatt.connected) {
        device.gatt.disconnect();
      }
    };
  }, [device]);

  return {
    connect,
    disconnect,
    connected,
    isConnecting,
    temperature,
    humidity,
    battery,
    lastUpdate,
    error,
    isBluetoothAvailable,
    deviceName: device?.name || null,
    rawData,
    debugLog
  };
};
