// The two block streams: the HMAC block stream of KDBX 4 and the hashed block stream of KDBX 3.
import { concat, equal, le32, le64, Reader } from './bytes.ts';
import { hmacSha256, sha256, sha512 } from './ciphers.ts';
import { Corrupt, LimitExceeded } from './errors.ts';
import type { Limits } from './limits.ts';

export const BLOCK_SIZE = 1024 * 1024;

/** Key for block `index` (the header HMAC uses index 2^64-1). */
export function hmacBlockKey(hmacKey: Uint8Array, index: bigint): Uint8Array {
  return sha512(le64(index), hmacKey);
}

export function hmacBlock(hmacKey: Uint8Array, index: bigint, data: Uint8Array): Uint8Array {
  return hmacSha256(hmacBlockKey(hmacKey, index), le64(index), le32(data.length), data);
}

/** Reads the HMAC block stream (each block: 32-byte HMAC, u32 length, data; a block of length 0 ends it). */
export function readHmacBlocks(r: Reader, hmacKey: Uint8Array, limits: Limits): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let index = 0n; ; index++) {
    const mac = r.bytes(32);
    const length = r.u32();
    if (length > limits.maxBlockBytes) throw new LimitExceeded('maxBlockBytes', `a block of ${length} bytes (limit ${limits.maxBlockBytes})`);
    const data = r.bytes(length);
    if (!equal(mac, hmacBlock(hmacKey, index, data))) throw new Corrupt(`block ${index} fails its HMAC`);
    if (length === 0) break;
    parts.push(data);
  }
  return concat(...parts);
}

export function writeHmacBlocks(data: Uint8Array, hmacKey: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let index = 0n;
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE, index++) {
    const block = data.subarray(offset, Math.min(offset + BLOCK_SIZE, data.length));
    parts.push(hmacBlock(hmacKey, index, block), le32(block.length), block);
  }
  parts.push(hmacBlock(hmacKey, index, new Uint8Array(0)), le32(0));
  return concat(...parts);
}

/** Reads the hashed block stream (each block: u32 index, 32-byte SHA-256, u32 length, data; length 0 ends it). */
export function readHashedBlocks(r: Reader, limits: Limits): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let expected = 0; ; expected++) {
    const index = r.u32();
    const hash = r.bytes(32);
    const length = r.u32();
    if (index !== expected) throw new Corrupt('the blocks are out of order');
    if (length > limits.maxBlockBytes) throw new LimitExceeded('maxBlockBytes', `a block of ${length} bytes (limit ${limits.maxBlockBytes})`);
    if (length === 0) break;
    const data = r.bytes(length);
    if (!equal(hash, sha256(data))) throw new Corrupt(`block ${index} fails its hash`);
    parts.push(data);
  }
  return concat(...parts);
}

export function writeHashedBlocks(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let index = 0;
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE, index++) {
    const block = data.subarray(offset, Math.min(offset + BLOCK_SIZE, data.length));
    parts.push(le32(index), sha256(block), le32(block.length), block);
  }
  parts.push(le32(index), new Uint8Array(32), le32(0));
  return concat(...parts);
}
