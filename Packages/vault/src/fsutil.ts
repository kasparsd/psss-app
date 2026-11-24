// File helpers. Atomic replacement for the device's own state, put-if-absent for everything written to a location (spec 8: "put if absent").
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { VaultError } from './errors.ts';

/** `.tmp-<pid>-<random>-<name>`: the writer's process id is in the name, so that a temporary file left by a process that was killed can be told from
 *  one that is being written (see `DeviceState.sweepOutbox`). Readers ignore every `.tmp-` name. */
const tmpName = (name: string) => `.tmp-${process.pid}-${randomBytes(6).toString('hex')}-${name}`;

function writeDurably(path: string, data: Uint8Array, mode: number): void {
  const fd = openSync(path, 'wx', mode);
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}

function syncDirectory(dir: string): void {
  try { const fd = openSync(dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* not every platform can; best effort */ }
}

/** Write a temporary file in the same directory and rename it over `path`: a reader sees the old file or the new one, never half. With
 *  `durable` (the default) the file and then the directory are flushed to disk first, so the file survives a power failure. */
export function writeAtomic(path: string, data: Uint8Array, mode = 0o600, durable = true, syncDir = durable): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, tmpName(basename(path)));
  if (durable) writeDurably(tmp, data, mode); else writeFileSync(tmp, data, { flag: 'wx', mode });
  try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* gone already */ } throw e; }
  if (syncDir) syncDirectory(dir);
}

/** Flushes a folder's entries to disk: what makes the files renamed or linked into it survive a power failure. */
export const flushDirectory = syncDirectory;

const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

/** Put `data` at `root/rel` unless something is there. Equal content already there is success ('exists'); different content is a
 *  conflict, never an overwrite. The file appears whole or not at all: it is written under a `.tmp-` name (readers ignore those) and
 *  linked into place, which fails if the name is taken. With `durable` (the default) the data is flushed to disk before it is linked, so a
 *  power failure cannot leave a truncated file under the final name. */
export function putIfAbsent(root: string, rel: string, data: Uint8Array, durable = true): 'written' | 'exists' {
  const final = join(root, rel);
  const check = (): 'exists' => {
    if (!same(readFileSync(final), data)) throw new VaultError('conflict', `${rel} exists with different content`);
    return 'exists';
  };
  if (existsSync(final)) return check();
  const dir = dirname(final);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, tmpName(basename(final)));
  if (durable) writeDurably(tmp, data, 0o644); else writeFileSync(tmp, data, { flag: 'wx', mode: 0o644 });
  try {
    try { linkSync(tmp, final); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return check();
      // a file system without hard links: fall back to rename after the existence check above
      if (existsSync(final)) return check();
      renameSync(tmp, final);
      return 'written';
    }
    return 'written';
  } finally {
    try { unlinkSync(tmp); } catch { /* renamed away or gone */ }
  }
}
