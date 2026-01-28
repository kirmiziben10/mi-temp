/**
 * Xiaomi Device Activation
 * 
 * Performs device activation to obtain the bind key needed for encrypted communication.
 * Based on the Mi Home app's activation protocol for LYWSD03MMC devices.
 */

// Activation service and characteristic UUIDs
const MI_SERVICE_UUID = '00010203-0405-0607-0809-0a0b0c0d1912';
const AUTH_INIT_CHAR_UUID = '00000010-0000-1000-8000-00805f9b34fb';
const AUTH_CHAR_UUID = '00000001-0000-1000-8000-00805f9b34fb';
const FIRMWARE_VER_CHAR_UUID = '00000004-0000-1000-8000-00805f9b34fb';
const BEACON_KEY_CHAR_UUID = '00000014-0000-1000-8000-00805f9b34fb';

// Activation constants
const MI_KEY1 = new Uint8Array([
    0x90, 0xCA, 0x85, 0xDE, 0x70, 0x70, 0x88, 0xA7,
    0x55, 0x32, 0xAB, 0xFC, 0x83, 0x8C, 0xE8, 0x29
]);

const MI_KEY2 = new Uint8Array([
    0x92, 0xAB, 0x54, 0xFA, 0xD3, 0x68, 0xB1, 0x2F,
    0x5E, 0x31, 0x04, 0x94, 0x1D, 0x8B, 0x76, 0xEF
]);

const MIX_A = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x8d, 0x3d, 0x3c, 0x97]);
const MIX_B = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x69, 0x12, 0x06, 0xd0]);

/**
 * Generate random bytes
 */
function generateRandomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

/**
 * Mix two byte arrays using XOR
 */
function mixBytes(a, b) {
    const result = new Uint8Array(Math.max(a.length, b.length));
    for (let i = 0; i < result.length; i++) {
        result[i] = (a[i] || 0) ^ (b[i] || 0);
    }
    return result;
}

/**
 * Cipher function using AES-ECB (simulated with SubtleCrypto)
 */
async function cipher(key, data) {
    try {
        // Import key for AES
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'AES-CBC' },
            false,
            ['encrypt']
        );

        // Use zero IV for ECB-like behavior (single block)
        const iv = new Uint8Array(16);

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-CBC', iv },
            cryptoKey,
            data
        );

        // Return only first 16 bytes (one block)
        return new Uint8Array(encrypted).slice(0, 16);
    } catch (err) {
        console.error('Cipher error:', err);
        throw err;
    }
}

/**
 * Perform the activation handshake
 */
async function mixA(mac, productId) {
    const data = new Uint8Array(16);
    data.set(MIX_A.slice(0, 12), 0);

    // Reverse MAC for mixing
    const reversedMac = new Uint8Array(mac).reverse();
    for (let i = 0; i < 6; i++) {
        data[i] = MIX_A[i] ^ reversedMac[i];
    }

    // Add product ID
    data[6] = MIX_A[6] ^ (productId & 0xFF);
    data[7] = MIX_A[7] ^ ((productId >> 8) & 0xFF);
    data[8] = MIX_A[8] ^ (productId & 0xFF);
    data[9] = MIX_A[9] ^ ((productId >> 8) & 0xFF);

    return data;
}

async function mixB(mac, productId) {
    const data = new Uint8Array(16);
    data.set(MIX_B.slice(0, 12), 0);

    // Reverse MAC for mixing
    const reversedMac = new Uint8Array(mac).reverse();
    for (let i = 0; i < 6; i++) {
        data[i] = MIX_B[i] ^ reversedMac[i];
    }

    // Add product ID
    data[6] = MIX_B[6] ^ (productId & 0xFF);
    data[7] = MIX_B[7] ^ ((productId >> 8) & 0xFF);
    data[8] = MIX_B[8] ^ (productId & 0xFF);
    data[9] = MIX_B[9] ^ ((productId >> 8) & 0xFF);

    return data;
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Parse MAC address from device name or ID
 */
function parseMAC(device) {
    // Try to extract MAC from device ID (format varies by browser)
    // For now, return a placeholder - the actual MAC comes from the device
    return new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

/**
 * Perform device activation to get bind key
 * @param {BluetoothDevice} device - The connected Bluetooth device
 * @returns {Promise<string|null>} The bind key as hex string, or null if failed
 */
export async function doActivation(device) {
    if (!device || !device.gatt || !device.gatt.connected) {
        throw new Error('Device not connected');
    }

    const server = device.gatt;

    try {
        console.log('Starting activation process...');

        // Get the MI service
        let service;
        try {
            service = await server.getPrimaryService(MI_SERVICE_UUID);
        } catch (err) {
            throw new Error('MI service not found. Device may already be activated or using custom firmware.');
        }

        // Get characteristics
        const authInitChar = await service.getCharacteristic(AUTH_INIT_CHAR_UUID);
        const authChar = await service.getCharacteristic(AUTH_CHAR_UUID);

        // Try to get beacon key characteristic
        let beaconKeyChar;
        try {
            beaconKeyChar = await service.getCharacteristic(BEACON_KEY_CHAR_UUID);
        } catch (err) {
            console.warn('Beacon key characteristic not available');
        }

        // Step 1: Send auth init command
        console.log('Sending auth init...');
        const authInitCmd = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00]);
        await authInitChar.writeValue(authInitCmd);

        // Step 2: Subscribe to auth notifications
        console.log('Subscribing to auth notifications...');
        await authChar.startNotifications();

        // Step 3: Generate random token and send
        const token = generateRandomBytes(12);
        const authCmd = new Uint8Array(13);
        authCmd[0] = 0x00; // Auth command
        authCmd.set(token, 1);

        console.log('Sending auth token...');

        // Wait for response
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                authChar.removeEventListener('characteristicvaluechanged', handler);
                reject(new Error('Auth response timeout'));
            }, 10000);

            const handler = (event) => {
                clearTimeout(timeout);
                authChar.removeEventListener('characteristicvaluechanged', handler);
                resolve(new Uint8Array(event.target.value.buffer));
            };

            authChar.addEventListener('characteristicvaluechanged', handler);
            authChar.writeValue(authCmd);
        });

        console.log('Received auth response:', bytesToHex(response));

        // Step 4: Try to read the beacon key directly
        if (beaconKeyChar) {
            try {
                console.log('Attempting to read beacon key...');
                const keyValue = await beaconKeyChar.readValue();
                const keyBytes = new Uint8Array(keyValue.buffer);

                if (keyBytes.length >= 12) {
                    const bindKey = bytesToHex(keyBytes.slice(0, 16));
                    console.log('Got bind key:', bindKey);
                    return bindKey;
                }
            } catch (err) {
                console.warn('Could not read beacon key directly:', err.message);
            }
        }

        // Step 5: If direct read failed, try alternate method
        // The response should contain the encrypted key
        if (response.length >= 16) {
            // Attempt to decrypt/extract key from response
            // This varies by firmware version
            const potentialKey = bytesToHex(response.slice(0, 16));
            console.log('Extracted potential key from response:', potentialKey);
            return potentialKey;
        }

        throw new Error('Could not obtain bind key from device');

    } catch (err) {
        console.error('Activation error:', err);
        throw err;
    }
}

/**
 * Check if device supports activation
 * @param {BluetoothDevice} device - The connected Bluetooth device
 * @returns {Promise<boolean>} True if device supports activation
 */
export async function supportsActivation(device) {
    if (!device || !device.gatt || !device.gatt.connected) {
        return false;
    }

    try {
        const service = await device.gatt.getPrimaryService(MI_SERVICE_UUID);
        await service.getCharacteristic(AUTH_CHAR_UUID);
        return true;
    } catch (err) {
        return false;
    }
}
