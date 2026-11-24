// A folder location (spec 8.1): reading what is in it and the paths that writes go to. Writing itself is `putIfAbsent` in fsutil.ts.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkInfo } from '../../format/src/folder.ts';

export type Probe = { state: 'vault' } | { state: 'empty' } | { state: 'unreadable'; reason: string };

/** `vault`: a folder with a valid psss.json. `empty`: nothing there yet (a location that has just been added, which sync fills).
 *  `unreadable`: anything else, with the reason. */
export function probe(path: string): Probe {
  try {
    if (!existsSync(path)) return { state: 'empty' };
    if (!statSync(path).isDirectory()) return { state: 'unreadable', reason: 'not a folder' };
    if (existsSync(join(path, 'psss.json'))) {
      try { checkInfo(path); } catch (e) { return { state: 'unreadable', reason: (e as Error).message }; }
      return { state: 'vault' };
    }
    return readdirSync(path).filter((n) => n !== '.DS_Store').length === 0 ? { state: 'empty' } : { state: 'unreadable', reason: 'not a psss vault: the folder has no psss.json' };
  } catch (e) {
    return { state: 'unreadable', reason: (e as Error).message };
  }
}

const dirs = (path: string): string[] => { try { return readdirSync(path).sort(); } catch { return []; } };
const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };

export interface SlotFile { pid: string; name: string; bytes: Uint8Array }
/** people/<pid>/slots/<slot_id>.slot (8.1) */
export function listSlots(root: string): SlotFile[] {
  const out: SlotFile[] = [];
  for (const pid of dirs(join(root, 'people'))) {
    for (const name of dirs(join(root, 'people', pid, 'slots'))) {
      const p = join(root, 'people', pid, 'slots', name);
      if (name.endsWith('.slot') && !name.startsWith('.tmp-') && isFile(p)) out.push({ pid, name, bytes: new Uint8Array(readFileSync(p)) });
    }
  }
  return out;
}

export const listGroupIds = (root: string): string[] => dirs(join(root, 'groups')).filter((n) => /^[0-9a-f]{64}$/.test(n));

export interface WrapFile { epoch: number; name: string; bytes: Uint8Array }
/** groups/<gid>/keys/<epoch>/<pid>-<name>.key for one person, every epoch (8.1) */
export function listWraps(root: string, gid: string, pid: string): WrapFile[] {
  const out: WrapFile[] = [];
  for (const e of dirs(join(root, 'groups', gid, 'keys'))) {
    if (!/^[0-9]+$/.test(e)) continue;
    for (const name of dirs(join(root, 'groups', gid, 'keys', e))) {
      const p = join(root, 'groups', gid, 'keys', e, name);
      if (name.startsWith(`${pid}-`) && name.endsWith('.key') && isFile(p)) out.push({ epoch: Number(e), name, bytes: new Uint8Array(readFileSync(p)) });
    }
  }
  return out;
}

export interface SegmentFile { rel: string; chain: string; name: string; data: Uint8Array }
/** every .seg and .mseg under groups/<gid>/log/<chain>/, `.tmp-` files ignored (8.1) */
export function readSegments(root: string, gid: string): SegmentFile[] {
  const out: SegmentFile[] = [];
  const base = join('groups', gid, 'log');
  for (const chain of dirs(join(root, base))) {
    for (const name of dirs(join(root, base, chain))) {
      if (name.startsWith('.tmp-') || !(name.endsWith('.seg') || name.endsWith('.mseg'))) continue;
      const rel = join(base, chain, name);
      if (isFile(join(root, rel))) out.push({ rel, chain, name, data: new Uint8Array(readFileSync(join(root, rel))) });
    }
  }
  return out;
}

/** Everything that is neither a record nor psss.json and is written once and never changed: slots, wraps and attachment chunks. A
 *  new location needs all of it, and each is copied unchanged under the same name. */
export function supportFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const n of dirs(join(root, rel))) {
      if (n.startsWith('.tmp-') || n === '.DS_Store') continue;
      const r = join(rel, n);
      if (isFile(join(root, r))) out.push(r); else walk(r);
    }
  };
  walk('people');
  for (const gid of listGroupIds(root)) { walk(join('groups', gid, 'keys')); walk(join('groups', gid, 'blobs')); }
  return out;
}
