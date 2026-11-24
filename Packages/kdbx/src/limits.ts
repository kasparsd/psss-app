// Safety limits. A vault file is untrusted input: each limit is checked before the memory or time it guards is spent.

export interface Limits {
  /** Largest plaintext after decompression (and so the largest XML plus attachments). Default 256 MiB. Reading peaks at about two to three times the decompressed size in memory. */
  maxDecompressedBytes: number;
  /** Largest Argon2 memory a file may ask for, in bytes. Default 1 GiB. */
  maxArgon2MemoryBytes: number;
  /** Most Argon2 passes. Default 256. */
  maxArgon2Iterations: number;
  /** Most Argon2 lanes. Default 64. */
  maxArgon2Parallelism: number;
  /** Memory times passes, in bytes: bounds the time even when each factor passes. Default 16 GiB. */
  maxArgon2WorkBytes: number;
  /** Most AES-KDF rounds. About 30 million rounds a second here, so the default 200 million is roughly 7 seconds. */
  maxAesKdfRounds: number;
  /** Largest single block of the HMAC or hashed block stream. Default 256 MiB. */
  maxBlockBytes: number;
  /** Largest field of the outer header (KDBX 4). Default 1 MiB. */
  maxHeaderFieldBytes: number;
  /** Deepest element nesting of the XML (and of the group tree on write). Default 128. */
  maxXmlDepth: number;
  /** Most XML elements. Default 5,000,000. */
  maxXmlNodes: number;
}

export const defaultLimits: Readonly<Limits> = Object.freeze({
  maxDecompressedBytes: 256 * 1024 * 1024,
  maxArgon2MemoryBytes: 1024 * 1024 * 1024,
  maxArgon2Iterations: 256,
  maxArgon2Parallelism: 64,
  maxArgon2WorkBytes: 16 * 1024 * 1024 * 1024,
  maxAesKdfRounds: 200_000_000,
  maxBlockBytes: 256 * 1024 * 1024,
  maxHeaderFieldBytes: 1024 * 1024,
  maxXmlDepth: 128,
  maxXmlNodes: 5_000_000,
});

export function resolveLimits(partial?: Partial<Limits>): Limits {
  return { ...defaultLimits, ...(partial ?? {}) };
}
