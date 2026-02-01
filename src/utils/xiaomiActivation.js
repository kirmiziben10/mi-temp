/**
 * Xiaomi Device Activation
 * 
 * Performs device activation to obtain the bind key needed for encrypted communication.
 * Based on the Mi Home app's activation protocol for LYWSD03MMC devices.
 */

import { UUIDS, CONSTANTS } from './constants';

/**
 * Generate random bytes
 * @param {number} length - Number of bytes to generate
 * @returns {Uint8Array} Random bytes
 */
function generateRandomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

/**
 * Convert bytes to hex string
 * @param {Uint8Array} bytes - Bytes to convert
 * @returns {string} Hex string
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
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
            service = await server.getPrimaryService(UUIDS.SERVICE_MI_AUTH);
        } catch (_err) {
            throw new Error('MI service not found. Device may already be activated or using custom firmware.');
        }

        // Get characteristics
        const authInitChar = await service.getCharacteristic(UUIDS.CHAR_AUTH_INIT);
        const authChar = await service.getCharacteristic(UUIDS.CHAR_AUTH);

        // Try to get beacon key characteristic
        let beaconKeyChar;
        try {
            beaconKeyChar = await service.getCharacteristic(UUIDS.CHAR_BEACON_KEY);
        } catch (_err) {
            console.warn('Beacon key characteristic not available', _err);
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
            let hasResolved = false;
            
            const timeout = setTimeout(() => {
                if (!hasResolved) {
                    hasResolved = true;
                    authChar.removeEventListener('characteristicvaluechanged', handler);
                    reject(new Error('Auth response timeout'));
                }
            }, CONSTANTS.TIMEOUT_AUTH_RESPONSE);

            const handler = (event) => {
                if (!hasResolved) {
                    hasResolved = true;
                    clearTimeout(timeout);
                    authChar.removeEventListener('characteristicvaluechanged', handler);
                    resolve(new Uint8Array(event.target.value.buffer));
                }
            };

            // Fix: Add listener BEFORE writing
            authChar.addEventListener('characteristicvaluechanged', handler);
            
            // Execute write operation
            authChar.writeValue(authCmd).catch(writeErr => {
                if (!hasResolved) {
                    hasResolved = true;
                    clearTimeout(timeout);
                    authChar.removeEventListener('characteristicvaluechanged', handler);
                    reject(writeErr);
                }
            });
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
        const service = await device.gatt.getPrimaryService(UUIDS.SERVICE_MI_AUTH);
        await service.getCharacteristic(UUIDS.CHAR_AUTH);
        return true;
    } catch (_err) {
        return false;
    }
}
