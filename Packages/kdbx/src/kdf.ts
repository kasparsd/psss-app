// Key derivation: AES-KDF and Argon2d/Argon2id, and the VariantDictionary that carries their parameters in KDBX 4.
import { argon2Sync, createCipheriv } from 'node:crypto';
import { concat, le32, le64, Reader } from './bytes.ts';
import { Corrupt, LimitExceeded, Unsupported } from './errors.ts';
import { sha256 } from './ciphers.ts';
import type { Limits } from './limits.ts';

export const KDF_AES = 'c9d9f39a628a4460bf740d08c18a4fea';
export const KDF_ARGON2D = 'ef636ddf8c29444b91f7a9a403e30a0c';
export const KDF_ARGON2ID = '9e298b1956db4773b23dfc3ec6f0a1e6';

// Other types exist (bool 0x08, int32 0x0c, int64 0x0d, string 0x18); they are kept as bytes and written back unchanged.
const T_UINT32 = 0x04, T_UINT64 = 0x05, T_BYTES = 0x42;

interface VariantEntry {
  type: number;
  name: string;
  value: Uint8Array;
}

/** KeePass's typed key-value block (KDF parameters, public custom data). Entries keep their order. */
export class VariantDictionary {
  entries: VariantEntry[] = [];

  static parse(bytes: Uint8Array): VariantDictionary {
    const r = new Reader(bytes);
    if ((r.u16() & 0xff00) !== 0x0100) throw new Unsupported('variant dictionary version', 'Unsupported: a variant dictionary of another major version');
    const d = new VariantDictionary();
    for (;;) {
      const type = r.u8();
      if (type === 0) break;
      const nameLength = r.u32();
      const name = new TextDecoder().decode(r.bytes(nameLength));
      const valueLength = r.u32();
      d.entries.push({ type, name, value: r.bytes(valueLength) });
    }
    return d;
  }

  encode(): Uint8Array {
    const parts: Uint8Array[] = [Uint8Array.of(0x00, 0x01)];
    for (const e of this.entries) {
      const name = new TextEncoder().encode(e.name);
      parts.push(Uint8Array.of(e.type), le32(name.length), name, le32(e.value.length), e.value);
    }
    parts.push(Uint8Array.of(0));
    return concat(...parts);
  }

  private find(name: string, type: number): Uint8Array | undefined {
    return this.entries.find((e) => e.name === name && e.type === type)?.value;
  }
  getBytes(name: string): Uint8Array | undefined { return this.find(name, T_BYTES); }
  getU32(name: string): number | undefined {
    const v = this.find(name, T_UINT32);
    return v && v.length === 4 ? new DataView(v.buffer, v.byteOffset, 4).getUint32(0, true) : undefined;
  }
  getU64(name: string): bigint | undefined {
    const v = this.find(name, T_UINT64);
    return v && v.length === 8 ? new DataView(v.buffer, v.byteOffset, 8).getBigUint64(0, true) : undefined;
  }
  private put(type: number, name: string, value: Uint8Array) {
    this.entries = this.entries.filter((e) => e.name !== name);
    this.entries.push({ type, name, value });
  }
  setBytes(name: string, v: Uint8Array) { this.put(T_BYTES, name, v); }
  setU32(name: string, v: number) { this.put(T_UINT32, name, le32(v)); }
  setU64(name: string, v: bigint | number) { this.put(T_UINT64, name, le64(v)); }
}

/** The key derivation settings of a file, without the random seed. */
export type KdfFormat =
  | { type: 'aes'; rounds: number }
  | { type: 'argon2d' | 'argon2id'; memoryKiB: number; iterations: number; parallelism: number };

/** The settings with their seed (what is in the file). */
export type KdfParams =
  | { type: 'aes'; seed: Uint8Array; rounds: bigint }
  | {
    type: 'argon2d' | 'argon2id';
    salt: Uint8Array;
    memoryBytes: bigint;
    iterations: bigint;
    parallelism: number;
    version: number;
    secret: Uint8Array;
    associatedData: Uint8Array;
  };

const hexOf = (b: Uint8Array | undefined) => (b ? Buffer.from(b).toString('hex') : '');

export function kdfFromDictionary(d: VariantDictionary): KdfParams {
  const id = hexOf(d.getBytes('$UUID'));
  if (id === KDF_AES) {
    const seed = d.getBytes('S');
    const rounds = d.getU64('R');
    if (!seed || seed.length !== 32 || rounds === undefined || rounds === 0n) throw new Corrupt('the AES-KDF parameters are missing or invalid');
    return { type: 'aes', seed, rounds };
  }
  if (id === KDF_ARGON2D || id === KDF_ARGON2ID) {
    const salt = d.getBytes('S');
    const parallelism = d.getU32('P');
    const memoryBytes = d.getU64('M');
    const iterations = d.getU64('I');
    if (!salt || salt.length < 8 || parallelism === undefined || memoryBytes === undefined || iterations === undefined || iterations === 0n || parallelism === 0) {
      throw new Corrupt('the Argon2 parameters are missing or invalid');
    }
    const version = d.getU32('V') ?? 0x13;
    return {
      type: id === KDF_ARGON2D ? 'argon2d' : 'argon2id', salt, memoryBytes, iterations, parallelism, version,
      secret: d.getBytes('K') ?? new Uint8Array(0), associatedData: d.getBytes('A') ?? new Uint8Array(0),
    };
  }
  throw new Unsupported('key derivation function', `Unsupported: the key derivation function ${id || '(none)'}`);
}

export function kdfToDictionary(p: KdfParams): VariantDictionary {
  const d = new VariantDictionary();
  const hexBytes = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
  if (p.type === 'aes') {
    d.setBytes('$UUID', hexBytes(KDF_AES));
    d.setU64('R', p.rounds);
    d.setBytes('S', p.seed);
  } else {
    d.setBytes('$UUID', hexBytes(p.type === 'argon2d' ? KDF_ARGON2D : KDF_ARGON2ID));
    d.setBytes('S', p.salt);
    d.setU32('P', p.parallelism);
    d.setU64('M', p.memoryBytes);
    d.setU64('I', p.iterations);
    d.setU32('V', p.version);
    if (p.secret.length > 0) d.setBytes('K', p.secret);
    if (p.associatedData.length > 0) d.setBytes('A', p.associatedData);
  }
  return d;
}

export function kdfFormat(p: KdfParams): KdfFormat {
  if (p.type === 'aes') return { type: 'aes', rounds: Number(p.rounds) };
  return { type: p.type, memoryKiB: Number(p.memoryBytes / 1024n), iterations: Number(p.iterations), parallelism: p.parallelism };
}

/** Rejects absurd parameters before anything is allocated or looped. */
export function checkKdfLimits(p: KdfParams, limits: Limits): void {
  if (p.type === 'aes') {
    if (p.rounds > BigInt(limits.maxAesKdfRounds)) {
      throw new LimitExceeded('maxAesKdfRounds', `AES-KDF asks for ${p.rounds} rounds (limit ${limits.maxAesKdfRounds})`);
    }
    return;
  }
  if (p.memoryBytes > BigInt(limits.maxArgon2MemoryBytes)) {
    throw new LimitExceeded('maxArgon2MemoryBytes', `Argon2 asks for ${p.memoryBytes} bytes of memory (limit ${limits.maxArgon2MemoryBytes})`);
  }
  if (p.iterations > BigInt(limits.maxArgon2Iterations)) {
    throw new LimitExceeded('maxArgon2Iterations', `Argon2 asks for ${p.iterations} passes (limit ${limits.maxArgon2Iterations})`);
  }
  if (p.parallelism > limits.maxArgon2Parallelism) {
    throw new LimitExceeded('maxArgon2Parallelism', `Argon2 asks for ${p.parallelism} lanes (limit ${limits.maxArgon2Parallelism})`);
  }
  if (p.memoryBytes * p.iterations > BigInt(limits.maxArgon2WorkBytes)) {
    throw new LimitExceeded('maxArgon2WorkBytes', 'Argon2 memory times passes is beyond the work limit');
  }
}

/**
 * AES-256-ECB applied `rounds` times to one 16-byte block. The two halves of the key are independent chains, and a chain is
 * AES-256-CBC over zero blocks with the half as IV (each ciphertext block is the encryption of the one before), so the whole
 * loop runs inside OpenSSL: about fifteen times faster than one call per round.
 */
function aesChain(seed: Uint8Array, start: Uint8Array, rounds: number): Uint8Array {
  const cipher = createCipheriv('aes-256-cbc', seed, start);
  cipher.setAutoPadding(false);
  const zeros = new Uint8Array(Math.min(rounds, 65536) * 16);
  let last = start;
  for (let left = rounds; left > 0;) {
    const n = Math.min(left, 65536);
    const out = cipher.update(zeros.subarray(0, n * 16));
    last = out.subarray(out.length - 16);
    left -= n;
  }
  return new Uint8Array(last);
}

/** Runs the KDF over the composite key and returns the 32-byte transformed key. */
export function transformKey(composite: Uint8Array, p: KdfParams, limits: Limits): Uint8Array {
  checkKdfLimits(p, limits);
  if (p.type === 'aes') {
    const rounds = Number(p.rounds);
    return sha256(concat(aesChain(p.seed, composite.subarray(0, 16), rounds), aesChain(p.seed, composite.subarray(16, 32), rounds)));
  }
  if (p.version !== 0x13) throw new Unsupported('Argon2 version', `Unsupported: Argon2 version 0x${p.version.toString(16)} (only 0x13)`);
  const memoryKiB = Number(p.memoryBytes / 1024n);
  if (memoryKiB < 8 * p.parallelism || memoryKiB < 32) throw new Corrupt('the Argon2 memory is below the minimum for its lanes');
  try {
    return new Uint8Array(argon2Sync(p.type, {
      message: composite, nonce: p.salt, parallelism: p.parallelism, tagLength: 32, memory: memoryKiB,
      passes: Number(p.iterations), secret: p.secret, associatedData: p.associatedData,
    }));
  } catch (e) {
    throw new Corrupt(`the Argon2 parameters are not usable (${e instanceof Error ? e.message : String(e)})`);
  }
}
