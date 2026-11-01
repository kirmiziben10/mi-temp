import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aesCcmEncrypt } from './aesCcm';
import { bytesToHex, hexToBytes } from './bytes';

function nodeCcm(key: Buffer, nonce: Buffer, pt: Buffer, aad: Buffer, tag: number): string {
  const c = createCipheriv('aes-128-ccm', key, nonce, { authTagLength: tag });
  if (aad.length) c.setAAD(aad, { plaintextLength: pt.length });
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return ct.toString('hex') + c.getAuthTag().toString('hex');
}

describe('aesCcmEncrypt', () => {
  it('matches the Mi registration parameters (12-byte nonce, "devID" AAD, 4-byte tag)', async () => {
    const key = randomBytes(16);
    const nonce = Buffer.from('101112131415161718191a1b', 'hex');
    const did = Buffer.from('00626c742e332e31323976a1b2c3d4e5f6415443', 'hex');
    const aad = Buffer.from('devID');
    const ours = await aesCcmEncrypt(new Uint8Array(key), new Uint8Array(nonce), new Uint8Array(did), new Uint8Array(aad), 4);
    expect(ours.length).toBe(24);
    expect(bytesToHex(ours)).toBe(nodeCcm(key, nonce, did, aad, 4));
  });

  it('matches node for random sizes, nonces and tag lengths', async () => {
    for (let i = 0; i < 40; i++) {
      const key = randomBytes(16);
      const nonce = randomBytes(7 + (i % 7));
      const pt = randomBytes(i * 3);
      const aad = randomBytes(i % 5 === 0 ? 0 : i);
      const tag = [4, 6, 8, 12, 16][i % 5]!;
      const ours = await aesCcmEncrypt(new Uint8Array(key), new Uint8Array(nonce), new Uint8Array(pt), new Uint8Array(aad), tag);
      expect(bytesToHex(ours)).toBe(nodeCcm(key, nonce, pt, aad, tag));
    }
  });

  it('hex helpers round-trip', () => {
    expect(bytesToHex(hexToBytes('00ff10Ab'))).toBe('00ff10ab');
  });
});
