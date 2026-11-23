// Section 8.1: the folder layout. Only this module touches the file system.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { concat, hex, readU32, u32 } from './bytes.ts';
import { limits } from './limits.ts';

/** 8.1: a writer produces exactly these bytes and a line feed. */
export const INFO_JSON = '{"format":"psss-vault","version":1}\n';

/** 8.1: a segment is a sequence of frames u32(len(sealed)) || sealed. */
export const frame = (sealed: Uint8Array): Uint8Array => concat(u32(sealed.length), sealed);

/** Read frames. 8.1: stop at a frame longer than the largest sealed record or (when `seqOf` is given) out of sequence, and ignore an
 *  incomplete final frame (an upload in progress). `stopped` says why reading ended early. */
export function readFrames(data: Uint8Array, seqOf?: (sealed: Uint8Array) => number | null):
    { frames: Uint8Array[]; incompleteTail: number; stopped: 'oversized' | 'out_of_sequence' | null } {
  const frames: Uint8Array[] = [];
  let pos = 0, last: number | null = null, stopped: 'oversized' | 'out_of_sequence' | null = null;
  while (pos < data.length) {
    if (data.length - pos < 4) break;
    const len = readU32(data, pos);
    if (len > limits.maxSealed) { stopped = 'oversized'; break; }
    if (len > data.length - pos - 4) break;
    const f = data.slice(pos + 4, pos + 4 + len);
    if (seqOf) {
      const q = seqOf(f); // null: the frame cannot be opened here (no key yet), so its place cannot be judged
      if (q !== null) {
        if (last !== null && q !== last + 1) { stopped = 'out_of_sequence'; break; }
        last = q;
      }
    }
    frames.push(f);
    pos += 4 + len;
  }
  return { frames, incompleteTail: stopped ? data.length - pos : data.length - pos, stopped };
}

export const chainDir = (gid: string, pid: string, device: string) => join('groups', gid, 'log', `${pid}-${device}`);
export const segmentName = (firstSeq: number, membership = false) => `${String(firstSeq).padStart(10, '0')}${membership ? '.mseg' : '.seg'}`;
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

/** 8.1: append to the newest `.seg` of the chain; start a new one once it has reached 65,536 bytes or follows a membership record.
 *  A membership record is written alone in a `.mseg`. */
export function appendRecord(root: string, gid: Uint8Array, author: Uint8Array, device: Uint8Array, seq: number, sealed: Uint8Array, membership = false): string {
  const rel = chainDir(hex(gid), hex(author), hex(device));
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  let name: string;
  if (membership) {
    name = segmentName(seq, true);
  } else {
    const all = readdirSync(dir).filter((n) => n.endsWith('.seg') || n.endsWith('.mseg')).sort();
    const newest = all[all.length - 1];
    name = newest && newest.endsWith('.seg') && statSync(join(dir, newest)).size < limits.segmentLimit ? newest : segmentName(seq);
  }
  appendFileSync(join(dir, name), frame(sealed));
  return join(rel, name);
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

/** Read every sealed record under a group's log, in file order. */
export function readGroupLog(root: string, gid: Uint8Array, seqOf?: (sealed: Uint8Array) => number | null): { path: string; sealed: Uint8Array }[] {
  const base = join('groups', hex(gid), 'log');
  if (!existsSync(join(root, base))) return [];
  const out: { path: string; sealed: Uint8Array }[] = [];
  for (const chain of readdirSync(join(root, base)).sort()) {
    for (const seg of readdirSync(join(root, base, chain)).filter((n) => n.endsWith('.seg') || n.endsWith('.mseg')).sort()) {
      for (const f of readFrames(new Uint8Array(readFileSync(join(root, base, chain, seg))), seqOf).frames) out.push({ path: join(base, chain, seg), sealed: f });
    }
  }
  return out;
}
