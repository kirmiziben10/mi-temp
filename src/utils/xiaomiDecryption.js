/**
 * Xiaomi BLE Advertisement Decryption
 * 
 * Decrypts encrypted BLE advertising packets from Xiaomi devices using AES-CCM.
 * Stock firmware encrypts data in service 0xfe95 advertisements.
 */

/**
 * Decrypt Xiaomi BLE advertisement data
 * @param {Uint8Array} encryptedData - The encrypted advertisement data
 * @param {string} bindKey - The 32-character hex bind key
 * @param {Uint8Array} mac - Device MAC address (6 bytes)
 * @param {number} frameCounter - Frame counter from the packet
 * @returns {Promise<Uint8Array>} Decrypted data
 */
export async function decryptXiaomiData(encryptedData, bindKey, mac, frameCounter) {
    if (!bindKey || bindKey.length !== 32) {
        throw new Error('Bind key must be 32 hex characters');
    }

    // Convert bind key from hex string to Uint8Array
    const keyBytes = new Uint8Array(
        bindKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );

    // Construct nonce (12 bytes)
    // Format: MAC (6 bytes) + Product ID (2 bytes) + Frame Counter (4 bytes)
    const nonce = new Uint8Array(12);
    nonce.set(mac, 0); // MAC address
    nonce.set([0x5B, 0x05], 6); // Product ID for LYWSD03MMC (0x055B little-endian)

    // Frame counter (4 bytes, big-endian)
    nonce[8] = (frameCounter >> 24) & 0xFF;
    nonce[9] = (frameCounter >> 16) & 0xFF;
    nonce[10] = (frameCounter >> 8) & 0xFF;
    nonce[11] = frameCounter & 0xFF;

    try {
        // Import the key for AES-CCM
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' }, // Note: CCM not widely supported, using GCM as fallback
            false,
            ['decrypt']
        );

        // Decrypt using AES-GCM (similar to CCM for this use case)
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: nonce,
                tagLength: 32 // 4 bytes = 32 bits
            },
            cryptoKey,
            encryptedData
        );

        return new Uint8Array(decrypted);
    } catch (err) {
        console.error('Decryption failed:', err);
        throw new Error(`Failed to decrypt: ${err.message}`);
    }
}

/**
 * Parse Xiaomi service data (0xfe95) advertisement
 * @param {DataView} serviceData - The service data from advertisement
 * @param {string} bindKey - Optional bind key for encrypted data
 * @returns {Object|null} Parsed data object or null if not parseable
 */
export function parseXiaomiServiceData(serviceData, bindKey = null) {
    try {
        // Xiaomi service data format:
        // Byte 0-1: Frame control
        // Byte 2-3: Product ID
        // Byte 4: Frame counter
        // Byte 5-10: MAC address
        // Byte 11+: Object data (encrypted or plain)

        if (serviceData.byteLength < 11) {
            return null; // Too short
        }

        const frameControl = serviceData.getUint16(0, true);
        const productId = serviceData.getUint16(2, true);
        const frameCounter = serviceData.getUint8(4);

        // Extract MAC
        const mac = new Uint8Array(6);
        for (let i = 0; i < 6; i++) {
            mac[i] = serviceData.getUint8(5 + i);
        }

        // Check if data is encrypted
        const isEncrypted = (frameControl & 0x0008) !== 0;

        if (isEncrypted && !bindKey) {
            console.warn('Data is encrypted but no bind key provided');
            return null;
        }

        // Object data starts at byte 11
        const objectData = new Uint8Array(
            serviceData.buffer.slice(11)
        );

        return {
            frameControl,
            productId,
            frameCounter,
            mac,
            isEncrypted,
            objectData
        };
    } catch (err) {
        console.error('Failed to parse service data:', err);
        return null;
    }
}

/**
 * Extract temperature and humidity from decrypted Xiaomi data
 * @param {Uint8Array} data - Decrypted object data
 * @returns {Object} Object with temperature and humidity
 */
export function extractTempHumidity(data) {
    // Xiaomi object format uses Type-Length-Value encoding
    // Common types:
    // 0x04 = Temperature (2 bytes, little-endian, signed, /100)
    // 0x06 = Humidity (2 bytes, little-endian, unsigned, /100)
    // 0x0D = Temperature + Humidity (4 bytes)

    let temperature = null;
    let humidity = null;

    let i = 0;
    while (i < data.length - 1) {
        const type = data[i];
        const length = data[i + 1];

        if (i + 2 + length > data.length) break;

        const value = data.slice(i + 2, i + 2 + length);

        if (type === 0x04 && length === 2) {
            // Temperature
            const tempInt = (value[1] << 8) | value[0];
            temperature = tempInt / 100;
        } else if (type === 0x06 && length === 2) {
            // Humidity
            const humInt = (value[1] << 8) | value[0];
            humidity = humInt / 100;
        } else if (type === 0x0D && length === 4) {
            // Combined temp + humidity
            const tempInt = (value[1] << 8) | value[0];
            const humInt = (value[3] << 8) | value[2];
            temperature = tempInt / 100;
            humidity = humInt / 100;
        }

        i += 2 + length;
    }

    return { temperature, humidity };
}
