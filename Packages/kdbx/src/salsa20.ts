// Salsa20/20 (Bernstein), the protected-value cipher of KDBX 3. Node has no Salsa20, so it is written here and checked
// against the ECRYPT known-answer vectors in test/kat.test.ts.

function rotl(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) | 0;
}

export class Salsa20 {
  private state = new Int32Array(16);
  private work = new Int32Array(16);
  private block = new Uint8Array(64);
  private used = 64;

  constructor(key: Uint8Array, iv: Uint8Array) {
    if (key.length !== 32) throw new Error('Salsa20 key must be 32 bytes');
    if (iv.length !== 8) throw new Error('Salsa20 iv must be 8 bytes');
    const kv = new DataView(key.buffer, key.byteOffset, 32);
    const iv32 = new DataView(iv.buffer, iv.byteOffset, 8);
    const s = this.state;
    s[0] = 0x61707865;
    s[5] = 0x3320646e;
    s[10] = 0x79622d32;
    s[15] = 0x6b206574;
    for (let i = 0; i < 4; i++) {
      s[1 + i] = kv.getInt32(4 * i, true);
      s[11 + i] = kv.getInt32(16 + 4 * i, true);
    }
    s[6] = iv32.getInt32(0, true);
    s[7] = iv32.getInt32(4, true);
  }

  private refill(): void {
    const x = this.work;
    const s = this.state;
    x.set(s);
    const qr = (a: number, b: number, c: number, d: number) => {
      x[b] = x[b]! ^ rotl((x[a]! + x[d]!) | 0, 7);
      x[c] = x[c]! ^ rotl((x[b]! + x[a]!) | 0, 9);
      x[d] = x[d]! ^ rotl((x[c]! + x[b]!) | 0, 13);
      x[a] = x[a]! ^ rotl((x[d]! + x[c]!) | 0, 18);
    };
    for (let i = 0; i < 10; i++) {
      qr(0, 4, 8, 12); qr(5, 9, 13, 1); qr(10, 14, 2, 6); qr(15, 3, 7, 11);
      qr(0, 1, 2, 3); qr(5, 6, 7, 4); qr(10, 11, 8, 9); qr(15, 12, 13, 14);
    }
    const out = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i++) out.setInt32(4 * i, (x[i]! + s[i]!) | 0, true);
    // 64-bit block counter in words 8 and 9.
    s[8] = (s[8]! + 1) | 0;
    if (s[8] === 0) s[9] = (s[9]! + 1) | 0;
    this.used = 0;
  }

  process(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      if (this.used === 64) this.refill();
      out[i] = data[i]! ^ this.block[this.used++]!;
    }
    return out;
  }
}
