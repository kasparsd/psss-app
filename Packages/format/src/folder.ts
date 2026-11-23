// Section 8.1: the folder layout. Only this module touches the file system.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { concat, hex, readU32, u32 } from './bytes.ts';
import { limits } from './limits.ts';
import { sha256 } from './prims.ts';

/** 8.1: a writer produces exactly these bytes and a line feed. */
export const INFO_JSON = '{"format":"psss-vault","version":1}\n';

/** 8.1: a segment is a sequence of frames u32(len(sealed)) || sealed. */
export const frame = (sealed: Uint8Array): Uint8Array => concat(u32(sealed.length), sealed);

/** Read frames. 8.1: stop at a frame longer than the largest sealed record or (when `seqOf` is given) out of sequence, and ignore an
 *  incomplete final frame (an upload in progress). A frame that cannot be opened yet (`seqOf` returns null: no key yet) is kept and
 *  passed over: it takes the place of one record, so the next readable record must still follow in sequence. `stopped` says why
 *  reading ended early. */
export function readFrames(data: Uint8Array, seqOf?: (sealed: Uint8Array) => number | null):
    { frames: Uint8Array[]; incompleteTail: number; stopped: 'oversized' | 'out_of_sequence' | null } {
  const frames: Uint8Array[] = [];
  let pos = 0, last: number | null = null, skipped = 0, stopped: 'oversized' | 'out_of_sequence' | null = null;
  while (pos < data.length) {
    if (data.length - pos < 4) break;
    const len = readU32(data, pos);
    if (len > limits.maxSealed) { stopped = 'oversized'; break; }
    if (len > data.length - pos - 4) break;
    const f = data.slice(pos + 4, pos + 4 + len);
    if (seqOf) {
      const q = seqOf(f);
      if (q === null) { if (last !== null) skipped++; }
      else {
        if (last !== null && q !== last + 1 + skipped) { stopped = 'out_of_sequence'; break; }
        last = q; skipped = 0;
      }
    }
    frames.push(f);
    pos += 4 + len;
  }
  return { frames, incompleteTail: data.length - pos, stopped };
}

export const chainDir = (gid: string, pid: string, device: string) => join('groups', gid, 'log', `${pid}-${device}`);
const ten = (n: number) => String(n).padStart(10, '0');
/** 8.1 (draft 3): `<first seq>-<last seq>.seg` or `.mseg`, each seq in ten decimal digits. */
export const segmentName = (firstSeq: number, lastSeq: number = firstSeq, membership = false) => `${ten(firstSeq)}-${ten(lastSeq)}${membership ? '.mseg' : '.seg'}`;
/** 8.1: a file being written has a name beginning with this; readers ignore it. */
export const TMP_PREFIX = '.tmp-';
const isSegment = (n: string) => !n.startsWith(TMP_PREFIX) && (n.endsWith('.seg') || n.endsWith('.mseg'));
export const slotPath = (pid: string, slotId: string) => join('people', pid, 'slots', `${slotId}.slot`);
/** `name` is 8 random bytes in hexadecimal, so two wraps never share a path. */
export const keyPath = (gid: string, epoch: number, pid: string, name: string) => join('groups', gid, 'keys', String(epoch), `${pid}-${name}.key`);
export const blobPath = (gid: string, chunkId: string) => join('groups', gid, 'blobs', chunkId.slice(0, 2), chunkId);

function putIfAbsent(root: string, rel: string, data: Uint8Array): void {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  if (existsSync(p)) {
    if (Buffer.compare(readFileSync(p), data) !== 0) throw new Error(`exists with different content: ${rel}`);
    return;
  }
  writeFileSync(p, data, { flag: 'wx' });
}

export function initFolder(root: string): void {
  mkdirSync(root, { recursive: true });
  putIfAbsent(root, 'psss.json', new TextEncoder().encode(INFO_JSON));
}
export const putSlot = (root: string, pid: Uint8Array, slotId: Uint8Array, slot: Uint8Array) => putIfAbsent(root, slotPath(hex(pid), hex(slotId)), slot);
export const putWrap = (root: string, gid: Uint8Array, epoch: number, pid: Uint8Array, name: Uint8Array, wrap: Uint8Array) =>
  putIfAbsent(root, keyPath(hex(gid), epoch, hex(pid), hex(name)), wrap);

/** 7.1: every wrap a location holds for one person and epoch. */
export function readWraps(root: string, gid: Uint8Array, epoch: number, pid: Uint8Array): Uint8Array[] {
  const dir = join(root, 'groups', hex(gid), 'keys', String(epoch));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith(`${hex(pid)}-`) && n.endsWith('.key')).sort().map((n) => new Uint8Array(readFileSync(join(dir, n))));
}

/** 8.1 (draft 3): no file is ever changed. Put `sealeds` (consecutive records of one chain, ascending seq) into a new file, written
 *  under a `.tmp-` name first and then renamed. Returns the path relative to the root. */
export function writeSegment(root: string, gid: Uint8Array, author: Uint8Array, device: Uint8Array, firstSeq: number, sealeds: Uint8Array[], membership = false): string {
  const rel = chainDir(hex(gid), hex(author), hex(device));
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  const name = segmentName(firstSeq, firstSeq + sealeds.length - 1, membership);
  const data = concat(...sealeds.map(frame));
  const tmp = join(dir, `${TMP_PREFIX}${hex(sha256(data)).slice(0, 16)}-${name}`);
  writeFileSync(tmp, data, { flag: 'w' });
  renameSync(tmp, join(dir, name));
  return join(rel, name);
}

/** One record written on its own, as a device does after each change. (Draft 2 appended to the newest segment; draft 3 never changes a file.) */
export const appendRecord = (root: string, gid: Uint8Array, author: Uint8Array, device: Uint8Array, seq: number, sealed: Uint8Array, membership = false): string =>
  writeSegment(root, gid, author, device, seq, [sealed], membership);

/** 8.1: a device MAY gather many small segments of its own chain into one larger file (written the same way) and then delete the
 *  small ones. `seqOf` reads the seq of a sealed record. Only `.seg` files are gathered, each run of consecutive records into one. */
export function gatherSegments(root: string, gid: Uint8Array, author: Uint8Array, device: Uint8Array, seqOf: (sealed: Uint8Array) => number): string[] {
  const dir = join(root, chainDir(hex(gid), hex(author), hex(device)));
  const files = readdirSync(dir).filter((n) => isSegment(n) && n.endsWith('.seg')).sort();
  const bySeq = new Map<number, Uint8Array>();
  for (const n of files) for (const f of readFrames(new Uint8Array(readFileSync(join(dir, n)))).frames) bySeq.set(seqOf(f), f);
  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  const written: string[] = [];
  for (let i = 0; i < seqs.length;) {
    let j = i;
    while (j + 1 < seqs.length && seqs[j + 1] === seqs[j]! + 1) j++;
    written.push(writeSegment(root, gid, author, device, seqs[i]!, seqs.slice(i, j + 1).map((q) => bySeq.get(q)!)));
    i = j + 1;
  }
  const keep = new Set(written.map((w) => w.split('/').pop()!));
  for (const n of files) if (!keep.has(n)) unlinkSync(join(dir, n));
  return written;
}

export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const n of readdirSync(join(root, rel)).sort()) {
      const r = rel ? join(rel, n) : n;
      if (statSync(join(root, r)).isDirectory()) walk(r); else out.push(r);
    }
  };
  walk('');
  return out;
}

export function checkInfo(root: string): void {
  const j = JSON.parse(readFileSync(join(root, 'psss.json'), 'utf8'));
  if (j.format !== 'psss-vault' || j.version !== 1) throw new Error('not a psss vault, version 1');
}

/** Read every sealed record under a group's log (ignoring `.tmp-` files), in file order. Segments may overlap (8.1): a record that
 *  appears in several files is returned once, at its first place. */
export function readGroupLog(root: string, gid: Uint8Array, seqOf?: (sealed: Uint8Array) => number | null): { path: string; sealed: Uint8Array }[] {
  const base = join('groups', hex(gid), 'log');
  if (!existsSync(join(root, base))) return [];
  const out: { path: string; sealed: Uint8Array }[] = [];
  const seen = new Set<string>();
  for (const chain of readdirSync(join(root, base)).sort()) {
    for (const seg of readdirSync(join(root, base, chain)).filter(isSegment).sort()) {
      for (const f of readFrames(new Uint8Array(readFileSync(join(root, base, chain, seg))), seqOf).frames) {
        const id = hex(sha256(f));
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ path: join(base, chain, seg), sealed: f });
      }
    }
  }
  return out;
}
