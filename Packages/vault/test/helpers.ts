// Test helpers. Not part of the library.
import type { TestContext } from 'node:test';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hex } from '../../format/src/bytes.ts';
import { cmap, type CborValue } from '../../format/src/cbor.ts';
import { writeSegment } from '../../format/src/folder.ts';
import { derivePerson, type Person } from '../../format/src/keys.ts';
import { KIND, keyRing, openRecord, sealRecord, type Rec } from '../../format/src/record.ts';
import { openSlot, unwrapGroupKey } from '../../format/src/slots.ts';
import { readFrames } from '../../format/src/folder.ts';
import { createVault, seededRandom, type CreateOptions, type Vault } from '../src/index.ts';
import { readKeyFile } from '../src/keyfile.ts';
import { listGroupIds, listSlots, listWraps, readSegments } from '../src/location.ts';

export const START = 1_700_000_000_000;
/** Argon2id parameters far below the limits of spec 7.2: only with the test-only switch (`testOnlyWeakKdf`). */
export const WEAK = { argon2: { memory: 256, passes: 2, lanes: 1 }, testOnlyWeakKdf: true } as const;

export function tmp(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'psss-vault-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A shared fake clock: `tick()` moves it on and returns the new time, so that "the later edit" is well defined across devices. */
export function makeClock(start = START) {
  let t = start;
  return { now: () => t, tick: (ms = 1) => (t += ms), set: (ms: number) => { t = ms; } };
}

export function makeRng(seed: string) {
  const random = seededRandom(`rng/${seed}`);
  const int = (n: number) => new DataView(random(4).buffer).getUint32(0) % n;
  return { int, between: (lo: number, hi: number) => lo + int(hi - lo + 1), pick: <T>(a: readonly T[]): T => a[int(a.length)]! };
}

export interface Env {
  dir: string;
  location: string;
  keyFile: string;
  stateDir: string;
  vault: Vault;
  clock: ReturnType<typeof makeClock>;
  recoveryKit?: string;
}
export function newVault(t: TestContext, opts: Partial<CreateOptions> = {}, seed = 'vault', start = START): Env {
  const dir = tmp(t);
  const clock = makeClock(start);
  const o: CreateOptions = { name: 'Personal', location: join(dir, 'Personal.psss'), keyFile: join(dir, 'device.key'), stateDir: join(dir, 'state'), now: clock.now, random: seededRandom(seed), ...opts };
  const { vault, recoveryKit } = createVault(o);
  return { dir, location: o.location, keyFile: o.keyFile, stateDir: o.stateDir, vault, clock, ...(recoveryKit ? { recoveryKit } : {}) };
}

export const copyDir = (from: string, to: string) => cpSync(from, to, { recursive: true });

/** Everything a test needs to read a vault's files and forge records the way an insider with the group key could: the person (from the
 *  key file through the device slot) and the epoch 0 key (from the wrap). Never used by the library. */
export class Insider {
  location: string;
  person: Person;
  gid: Uint8Array;
  gidHex: string;
  key: Uint8Array;
  constructor(location: string, keyFile: string) {
    this.location = location;
    const k = readKeyFile(keyFile);
    const slot = listSlots(location).find((s) => { try { openSlot(s.bytes, { deviceKemSeed: k.kemSeed }); return true; } catch { return false; } })!;
    this.person = derivePerson(openSlot(slot.bytes, { deviceKemSeed: k.kemSeed }));
    this.gidHex = listGroupIds(location)[0]!;
    this.gid = Uint8Array.from(Buffer.from(this.gidHex, 'hex'));
    this.key = unwrapGroupKey(this.gid, 0, this.person.pid, this.person.kemSeed, listWraps(location, this.gidHex, hex(this.person.pid))[0]!.bytes);
  }
  /** every record in the folder, in chain and sequence order */
  records(): Rec[] {
    const ring = keyRing([[this.gid, 0, this.key]]);
    const out: Rec[] = [];
    for (const seg of readSegments(this.location, this.gidHex)) for (const f of readFrames(seg.data).frames) out.push(openRecord(f, ring));
    return out.sort((a, b) => (hex(a.device) < hex(b.device) ? -1 : hex(a.device) > hex(b.device) ? 1 : a.seq - b.seq));
  }
  chainDirs(): string[] { return readdirSync(join(this.location, 'groups', this.gidHex, 'log')); }
  files(chain: string): string[] { return readdirSync(join(this.location, 'groups', this.gidHex, 'log', chain)).sort(); }
  path(chain: string, name: string): string { return join(this.location, 'groups', this.gidHex, 'log', chain, name); }
  genesis(): Rec { return this.records().find((r) => r.kind === KIND.genesis)!; }
  /** a record the group key opens, signed by `signer`, as chain (author of signer, device) seq `seq` */
  seal(signer: Person, device: Uint8Array, seq: number, prev: Uint8Array | null, payload: CborValue & Map<number | string, CborValue>, clockMs: number, mhead = this.genesis().id): Uint8Array {
    return sealRecord(signer, this.gid, 0, this.key, { author: signer.pid, device, seq, prev, clock: [clockMs, 0], kind: KIND.item, payload, mhead });
  }
  itemPayload(id: Uint8Array, title: string): Map<number | string, CborValue> {
    return cmap([[1, id], [2, cmap([['title', title], ['type', 1]])], [3, []]]);
  }
  put(sealed: Uint8Array, rec: { author: Uint8Array; device: Uint8Array; seq: number }): string {
    return writeSegment(this.location, this.gid, rec.author, rec.device, rec.seq, [sealed]);
  }
}

export const read = (path: string) => new Uint8Array(readFileSync(path));
export const write = (path: string, data: Uint8Array) => writeFileSync(path, data);
