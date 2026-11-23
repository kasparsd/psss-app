// Section 8.1: the folder layout. Only this module touches the file system.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { concat, hex, readU32, u32 } from './bytes.ts';

export const SEGMENT_LIMIT = 64 * 1024;
export const INFO_JSON = '{"format":"psss-vault","version":1}';

/** 8.1: a segment is a sequence of frames u32(len(sealed)) || sealed. */
export const frame = (sealed: Uint8Array): Uint8Array => concat(u32(sealed.length), sealed);

/** Read frames; an incomplete final frame (an upload in progress) is ignored. */
export function readFrames(data: Uint8Array): { frames: Uint8Array[]; incompleteTail: number } {
  const frames: Uint8Array[] = [];
  let pos = 0;
  while (pos < data.length) {
    if (data.length - pos < 4) break;
    const len = readU32(data, pos);
    if (len > data.length - pos - 4) break;
    frames.push(data.slice(pos + 4, pos + 4 + len));
    pos += 4 + len;
  }
  return { frames, incompleteTail: data.length - pos };
}

export const chainDir = (gid: string, pid: string, device: string) => join('groups', gid, 'log', `${pid}-${device}`);
export const segmentName = (firstSeq: number) => `${String(firstSeq).padStart(10, '0')}.seg`;
export const slotPath = (pid: string, slotId: string) => join('people', pid, 'slots', `${slotId}.slot`);
export const keyPath = (gid: string, epoch: number, pid: string) => join('groups', gid, 'keys', String(epoch), `${pid}.key`);
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
export const putWrap = (root: string, gid: Uint8Array, epoch: number, pid: Uint8Array, wrap: Uint8Array) => putIfAbsent(root, keyPath(hex(gid), epoch, hex(pid)), wrap);

/** 8.1: append to the newest segment of the chain; start a new one once it passes 64 KiB. */
export function appendRecord(root: string, gid: Uint8Array, author: Uint8Array, device: Uint8Array, seq: number, sealed: Uint8Array): string {
  const dir = join(root, chainDir(hex(gid), hex(author), hex(device)));
  mkdirSync(dir, { recursive: true });
  const segs = readdirSync(dir).filter((n) => n.endsWith('.seg')).sort();
  let name = segs.length ? segs[segs.length - 1]! : segmentName(seq);
  if (segs.length && statSync(join(dir, name)).size > SEGMENT_LIMIT) name = segmentName(seq);
  appendFileSync(join(dir, name), frame(sealed));
  return join(chainDir(hex(gid), hex(author), hex(device)), name);
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
export function readGroupLog(root: string, gid: Uint8Array): { path: string; sealed: Uint8Array }[] {
  const base = join('groups', hex(gid), 'log');
  if (!existsSync(join(root, base))) return [];
  const out: { path: string; sealed: Uint8Array }[] = [];
  for (const chain of readdirSync(join(root, base)).sort()) {
    for (const seg of readdirSync(join(root, base, chain)).filter((n) => n.endsWith('.seg')).sort()) {
      for (const f of readFrames(new Uint8Array(readFileSync(join(root, base, chain, seg)))).frames) out.push({ path: join(base, chain, seg), sealed: f });
    }
  }
  return out;
}
