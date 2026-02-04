/**
 * Xiaomi Mi Device Activation Module
 * 
 * Implements the Mi device activation protocol to retrieve the bind key.
 * Based on the working Telink Flasher implementation by Atc1441.
 */

// --- UUIDs ---
const MI_SERVICE = 0xfe95;
const CHAR_ENC_10 = 0x0010;
const CHAR_ENC_04 = 0x0004;  // Firmware version
const CHAR_ENC_19 = 0x0019;

// --- Utility Functions ---

function hexToBytes(hex) {
    const bytes = [];
    for (let c = 0; c < hex.length; c += 2) {
        bytes.push(parseInt(hex.substr(c, 2), 16));
    }
    return new Uint8Array(bytes);
}

function bytesToHex(data) {
    return new Uint8Array(data).reduce(
        (memo, i) => memo + ('0' + i.toString(16)).slice(-2),
        ''
    );
}

function hex2ascii(hex) {
    let str = '';
    for (let i = 0; i < hex.length && hex.substr(i, 2) !== '00'; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
}

function makeRandomDeviceId() {
    const prefix = '00626c742e332e31323976';
    const randomPart = bytesToHex(window.crypto.getRandomValues(new Uint8Array(6)));
    const suffix = '415443';
    return prefix + randomPart + suffix;
}

/**
 * HKDF-SHA256 matching sjcl behavior
 */
async function hkdfSha256(ikm, length, info) {
    const salt = new Uint8Array(32);

    const saltKey = await crypto.subtle.importKey(
        'raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));

    const infoBytes = new TextEncoder().encode(info);
    const n = Math.ceil(length / 32);
    const okm = new Uint8Array(n * 32);

    let t = new Uint8Array(0);
    const prkKey = await crypto.subtle.importKey(
        'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    for (let i = 1; i <= n; i++) {
        const data = new Uint8Array(t.length + infoBytes.length + 1);
        data.set(t, 0);
        data.set(infoBytes, t.length);
        data[data.length - 1] = i;
        t = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, data));
        okm.set(t, (i - 1) * 32);
    }

    return bytesToHex(okm.slice(0, length));
}

async function writeChar(characteristic, hexData) {
    await characteristic.writeValue(hexToBytes(hexData));
}

/**
 * Perform device activation to retrieve bind key
 */
export async function doActivation(device) {
    if (!device?.gatt?.connected) {
        throw new Error('Device not connected');
    }

    const server = device.gatt;

    // Get Mi encryption service
    let encService;
    try {
        encService = await server.getPrimaryService(MI_SERVICE);
    } catch (err) {
        throw new Error('Mi Auth service not found. Device may have custom firmware.');
    }

    // Get characteristics (same order as Telink Flasher miAuthorization)
    const enc10 = await encService.getCharacteristic(CHAR_ENC_10);

    // Read firmware version first (like Telink Flasher does)
    let fwVersion = '';
    try {
        const enc04 = await encService.getCharacteristic(CHAR_ENC_04);
        const fwData = await enc04.readValue();
        fwVersion = hex2ascii(bytesToHex(fwData.buffer));
        console.log('Firmware version:', fwVersion);
    } catch (e) {
        console.warn('Could not read firmware version:', e);
    }

    const enc19 = await encService.getCharacteristic(CHAR_ENC_19);

    // Pre-generate ECDH keypair
    const keypair = await window.crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );

    const ownPublicKeyRaw = await window.crypto.subtle.exportKey('raw', keypair.publicKey);
    const ownPublicKeyHex = bytesToHex(ownPublicKeyRaw);

    // State machine
    let state = 0;
    let devicePublicKey = '';
    let isActivated = false;
    let deviceKnownId = '';
    const deviceNewId = makeRandomDeviceId();
    let bindKey = null;
    let resolveActivation, rejectActivation;

    const activationPromise = new Promise((resolve, reject) => {
        resolveActivation = resolve;
        rejectActivation = reject;
    });

    const timeout = setTimeout(() => {
        cleanup();
        rejectActivation(new Error('Activation timeout - no response from device'));
    }, 30000);

    const handleEnc10 = (event) => {
        const value = bytesToHex(event.target.value.buffer);
        console.log('enc_10 received:', value);

        if (value === '12000000') {
            cleanup();
            rejectActivation(new Error('Activation failed - device rejected'));
        } else if (value === '11000000') {
            console.log('Activation successful!');
            cleanup();
            if (bindKey) {
                resolveActivation(bindKey);
            } else {
                rejectActivation(new Error('Activation success but no key derived'));
            }
        }
    };

    const handleEnc19 = async (event) => {
        const value = bytesToHex(event.target.value.buffer);
        console.log('enc_19 received:', value, 'state:', state, 'isActivated:', isActivated);

        try {
            if (value === '000000000100') {
                // Not activated
                isActivated = false;
                console.log('Device not activated, sending 00000101');
                await writeChar(enc19, '00000101');

            } else if (value === '000000000200') {
                // Already activated
                isActivated = true;
                console.log('Device already activated, sending 00000101');
                await writeChar(enc19, '00000101');

            } else if (isActivated && state === 0 && value.substring(0, 4) === '0100') {
                deviceKnownId = value.substring(4);
                console.log('Received known ID part 1');

            } else if (isActivated && state === 0 && value.substring(0, 4) === '0200') {
                deviceKnownId += value.substring(4);
                console.log('Received known ID part 2, proceeding to key exchange');

                await writeChar(enc19, '00000100');
                await writeChar(enc10, '15000000');
                await writeChar(enc19, '000000030400');
                state = 1;

            } else if (value === '010001000000') {
                // Non-activated device response
                console.log('Non-activated device response, proceeding');
                await writeChar(enc19, '00000100');
                await writeChar(enc10, '15000000');
                await writeChar(enc19, '000000030400');
                state = 1;

            } else if (state === 1 && value === '00000101') {
                console.log('Device ready for public key, sending in 4 chunks');
                state = 2;

                // Send public key in 4 chunks (skip "04" prefix, send X and Y in 36-char chunks)
                // Telink format: substring((36*i)+2, (36*i)+36+2)
                const chunk1 = '0100' + ownPublicKeyHex.substring(2, 38);
                const chunk2 = '0200' + ownPublicKeyHex.substring(38, 74);
                const chunk3 = '0300' + ownPublicKeyHex.substring(74, 110);
                const chunk4 = '0400' + ownPublicKeyHex.substring(110);

                console.log('Sending chunks:', chunk1.length, chunk2.length, chunk3.length, chunk4.length);

                await writeChar(enc19, chunk1);
                await writeChar(enc19, chunk2);
                await writeChar(enc19, chunk3);
                await writeChar(enc19, chunk4);

            } else if (value === '000000030400') {
                console.log('Received 000000030400, sending 00000101');
                await writeChar(enc19, '00000101');

            } else if (state === 2 && value.substring(0, 4) === '0100') {
                devicePublicKey = '04' + value.substring(4);
                console.log('Received device public key part 1');

            } else if (state === 2 && value.substring(0, 4) === '0200') {
                devicePublicKey += value.substring(4);
                console.log('Received device public key part 2');

            } else if (state === 2 && value.substring(0, 4) === '0300') {
                devicePublicKey += value.substring(4);
                console.log('Received device public key part 3');

            } else if (state === 2 && value.substring(0, 4) === '0400') {
                devicePublicKey += value.substring(4);
                console.log('Received device public key part 4, deriving shared key');

                await writeChar(enc19, '00000100');

                // Derive shared secret
                const deviceKeyImported = await window.crypto.subtle.importKey(
                    'raw',
                    hexToBytes(devicePublicKey),
                    { name: 'ECDH', namedCurve: 'P-256' },
                    true,
                    []
                );

                const sharedSecret = await window.crypto.subtle.deriveBits(
                    { name: 'ECDH', namedCurve: 'P-256', public: deviceKeyImported },
                    keypair.privateKey,
                    256
                );

                const sharedKeyHex = bytesToHex(sharedSecret);
                console.log('Shared secret derived');

                // HKDF to get 64 bytes
                const derivedKeyHex = await hkdfSha256(
                    hexToBytes(sharedKeyHex),
                    64,
                    'mible-setup-info'
                );

                // Extract bind key
                bindKey = derivedKeyHex.substring(24, 56);
                console.log('Bind key derived:', bindKey);

                // We have the key! Return it immediately.
                // Full registration requires AES-CCM encrypted DID which Web Crypto doesn't support,
                // but for just getting the bind key, we're done!
                cleanup();
                resolveActivation(bindKey);

            } else if (state === 2 && value === '00000101') {
                console.log('Device ready for encrypted DID, sending completion');
                state = 3;
                await writeChar(enc10, '13000000');

            } else if (state === 3 && value === '00000100') {
                console.log('Protocol complete');
                state = 0;
                await writeChar(enc10, '13000000');

            } else if (value === '000001050100') {
                cleanup();
                rejectActivation(new Error('Device timeout - try again'));

            } else {
                console.log('Unhandled enc_19 message:', value);
            }
        } catch (err) {
            console.error('Error in handleEnc19:', err);
            cleanup();
            rejectActivation(err);
        }
    };

    const cleanup = () => {
        clearTimeout(timeout);
        try {
            enc10.removeEventListener('characteristicvaluechanged', handleEnc10);
            enc19.removeEventListener('characteristicvaluechanged', handleEnc19);
            enc10.stopNotifications().catch(() => { });
            enc19.stopNotifications().catch(() => { });
        } catch (e) {
            // Ignore
        }
    };

    // Start notifications (same order as Telink Flasher)
    await enc10.startNotifications();
    enc10.addEventListener('characteristicvaluechanged', handleEnc10);

    await enc19.startNotifications();
    enc19.addEventListener('characteristicvaluechanged', handleEnc19);

    console.log('Notifications started, sending activation command a2000000');

    // Send activation command
    await writeChar(enc10, 'a2000000');

    return activationPromise;
}
