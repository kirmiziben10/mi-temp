/**
 * AES-CCM encryption (RFC 3610) on top of WebCrypto.
 *
 * WebCrypto has no CCM mode, which is why the previous app stopped the Mi activation halfway.
 * CCM is just CBC-MAC + CTR, and WebCrypto has both building blocks:
 *  - CBC-MAC = last block of AES-CBC (zero IV) over the formatted input,
 *  - CTR     = AES-CTR with the CCM counter block.
 * Only encryption is needed (the device ID we send during registration).
 */

const BLOCK = 16;

export async function aesCcmEncrypt(
  key: Uint8Array<ArrayBuffer>,
  nonce: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
  tagLength: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (nonce.length < 7 || nonce.length > 13) throw new Error('CCM nonce must be 7..13 bytes');
  if (tagLength < 4 || tagLength > 16 || tagLength % 2) throw new Error('Invalid CCM tag length');
  const L = 15 - nonce.length; // size of the length field
  const subtle = globalThis.crypto.subtle;

  // --- CBC-MAC input: B0 || encoded AAD (zero padded) || plaintext (zero padded)
  const b0 = new Uint8Array(BLOCK);
  b0[0] = (aad.length > 0 ? 0x40 : 0) | (((tagLength - 2) / 2) << 3) | (L - 1);
  b0.set(nonce, 1);
  for (let i = 0, len = plaintext.length; i < L; i++, len = Math.floor(len / 256)) {
    b0[BLOCK - 1 - i] = len & 0xff;
  }

  let aadBlock = new Uint8Array(0);
  if (aad.length > 0) {
    if (aad.length >= 0xff00) throw new Error('CCM AAD too long');
    const raw = new Uint8Array(2 + aad.length);
    raw[0] = aad.length >> 8;
    raw[1] = aad.length & 0xff;
    raw.set(aad, 2);
    aadBlock = padToBlock(raw);
  }
  const macInput = new Uint8Array(BLOCK + aadBlock.length + padToBlock(plaintext).length);
  macInput.set(b0, 0);
  macInput.set(aadBlock, BLOCK);
  macInput.set(plaintext, BLOCK + aadBlock.length);

  const cbcKey = await subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  const cbcOut = new Uint8Array(
    await subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(BLOCK) }, cbcKey, macInput),
  );
  // WebCrypto appends one PKCS#7 padding block; the MAC is the block before it.
  const mac = cbcOut.slice(macInput.length - BLOCK, macInput.length);

  // --- CTR: A_i = flags(L-1) || nonce || counter_i ; S0 encrypts the tag, S1.. the payload.
  const a0 = new Uint8Array(BLOCK);
  a0[0] = L - 1;
  a0.set(nonce, 1);
  const ctrKey = await subtle.importKey('raw', key, { name: 'AES-CTR' }, false, ['encrypt']);
  const ctrInput = new Uint8Array(BLOCK + plaintext.length);
  ctrInput.set(mac, 0);
  ctrInput.set(plaintext, BLOCK);
  const ctrOut = new Uint8Array(
    await subtle.encrypt({ name: 'AES-CTR', counter: a0, length: L * 8 }, ctrKey, ctrInput),
  );

  const out = new Uint8Array(plaintext.length + tagLength);
  out.set(ctrOut.subarray(BLOCK), 0);
  out.set(ctrOut.subarray(0, tagLength), plaintext.length);
  return out;
}

function padToBlock(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(Math.ceil(data.length / BLOCK) * BLOCK);
  out.set(data);
  return out;
}
