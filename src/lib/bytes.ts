/** Byte/hex helpers. All hex strings are lowercase without separators unless noted. */

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) throw new Error(`Odd-length hex string: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(data: ArrayBufferLike | ArrayBufferView, separator = ''): string {
  const bytes =
    data instanceof Uint8Array
      ? data
      : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(separator);
}

/** Copies a DataView so later reuse of the underlying buffer by the BLE stack cannot change it. */
export function copyView(view: DataView): DataView<ArrayBuffer> {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return new DataView(copy.buffer);
}

export function viewToBytes(view: DataView): Uint8Array<ArrayBuffer> {
  return new Uint8Array(copyView(view).buffer);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function u32le(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

/** Reads a NUL-terminated ASCII string. */
export function asciiZ(view: DataView): string {
  let s = '';
  for (let i = 0; i < view.byteLength; i++) {
    const c = view.getUint8(i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}
