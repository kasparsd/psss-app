// An exclusive lock on the device-state directory, so that two psss processes of one device never read the same sequence number, outbox
// and remembered heads and seal two records at the same place. `node:fs` only, so it works on every platform.
//
//   <stateDir>/lock    {"pid":..,"time":..,"token":".."}; created whole (written under a temporary name, then linked into place)
//
// - Taking it: create the file exclusively. If it exists, wait with a short randomised backoff and try again, up to `waitMs`.
// - A lock is stale when its process is gone, or it is older than `staleMs`. A stale lock is stolen: renamed away (one thief wins), checked
//   to be the one that was judged stale, then removed. A crash while holding it therefore costs nothing: the state files are written
//   atomically and the next process steals the lock.
// - Within one process the lock is re-entrant (everything here is synchronous, so nothing else of this process can interleave).
import { linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { VaultError } from './errors.ts';

export const LOCK_NAME = 'lock';
export interface LockOptions {
  /** how long to wait for another psss to finish, in milliseconds. Default 5000. */
  waitMs?: number;
  /** a lock older than this is taken over even if its process looks alive. Default two minutes. */
  staleMs?: number;
  /** what the holder is doing, written into the lock so that a process that has to wait can say so (for example `import`) */
  what?: string;
  /** the time source for the times written into the lock and compared with them; `Date.now` by default. For tests: a lock must not go stale over a gap on this clock. */
  clock?: () => number;
}
interface LockInfo { pid: number; time: number; token: string; what?: string }

const held = new Map<string, number>();
const tokens = new Map<string, string>();

function sleep(ms: number): void {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const end = Date.now() + ms; while (Date.now() < end) { /* spin */ } }
}

/** Whether a process with this id exists (on this machine). */
export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function readLock(path: string): LockInfo | 'unreadable' | null {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'unreadable'; }
  try {
    const d = JSON.parse(text) as Partial<LockInfo>;
    if (typeof d.pid === 'number' && typeof d.time === 'number' && typeof d.token === 'string') return { pid: d.pid, time: d.time, token: d.token, ...(typeof d.what === 'string' ? { what: d.what } : {}) };
  } catch { /* fall through */ }
  return 'unreadable';
}

function create(path: string, info: LockInfo): boolean {
  const tmp = `${path}.${info.token}.tmp`;
  writeFileSync(tmp, JSON.stringify(info), { flag: 'wx', mode: 0o600 });
  try {
    try { linkSync(tmp, path); return true; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      // a file system without hard links: an exclusive create (the content follows at once; a reader treats an empty file as held and young)
      try { writeFileSync(path, JSON.stringify(info), { flag: 'wx', mode: 0o600 }); return true; }
      catch (e2) { if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e2; }
    }
  } finally { try { unlinkSync(tmp); } catch { /* gone */ } }
}

/** Removes the lock at `path` if it is still the one described by `seen`. Of several processes that find the same stale lock, one renames it
 *  away; the others fail on the rename. A process that renamed a lock that is not the one it judged (a fresh one taken in between) puts it back. */
function steal(path: string, seen: LockInfo | 'unreadable'): void {
  const away = `${path}.stale-${randomBytes(6).toString('hex')}`;
  try { renameSync(path, away); } catch { return; }
  const got = readLock(away);
  const same = seen === 'unreadable' ? got === 'unreadable' : got !== null && got !== 'unreadable' && got.token === seen.token;
  if (same) { try { unlinkSync(away); } catch { /* gone */ } return; }
  try { linkSync(away, path); } catch { /* somebody else holds it now: theirs wins */ }
  try { unlinkSync(away); } catch { /* gone */ }
}

function isStale(path: string, seen: LockInfo | 'unreadable', now: number, staleMs: number): boolean {
  if (seen === 'unreadable') {
    // empty or damaged: a file just being created is young; anything older than a few seconds is debris
    try { return now - statSync(path).mtimeMs > 5000; } catch { return false; }
  }
  return !processAlive(seen.pid) || now - seen.time > staleMs;
}

export function lockPath(dir: string): string { return join(dir, LOCK_NAME); }

/** Tells the others that this process is still alive and holds the lock of `dir`: a long piece of work (an import) calls it now and then, at
 *  least every `staleMs / 4`, so that the lock is never older than `staleMs` while the work goes on. Does nothing when this process holds no
 *  lock on `dir`. The file is replaced whole, with the same token, so a reader sees the old time or the new one. */
export function refreshLock(dir: string, opts: LockOptions = {}): void {
  const path = lockPath(dir);
  const token = tokens.get(path);
  if (token === undefined) return;
  const mine = readLock(path);
  if (mine === null || mine === 'unreadable' || mine.token !== token) return;
  const next: LockInfo = { ...mine, time: (opts.clock ?? Date.now)() };
  const tmp = `${path}.${token}.beat`;
  try {
    writeFileSync(tmp, JSON.stringify(next), { flag: 'w', mode: 0o600 });
    renameSync(tmp, path);
  } catch { try { unlinkSync(tmp); } catch { /* gone */ } }
}

/** Runs `fn` holding the exclusive lock of `dir`. Throws a VaultError `state_locked` if another psss still holds it after `waitMs`. */
export function withLock<T>(dir: string, fn: () => T, opts: LockOptions = {}): T {
  const path = lockPath(dir);
  const depth = held.get(path) ?? 0;
  if (depth > 0) { held.set(path, depth + 1); try { return fn(); } finally { held.set(path, depth); } }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const waitMs = opts.waitMs ?? 5000, staleMs = opts.staleMs ?? 120_000;
  const clock = opts.clock ?? Date.now;
  const info: LockInfo = { pid: process.pid, time: clock(), token: randomBytes(8).toString('hex'), ...(opts.what !== undefined ? { what: opts.what } : {}) };
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    info.time = clock();
    if (create(path, info)) break;
    const seen = readLock(path);
    if (seen !== null) {
      if (isStale(path, seen, clock(), staleMs)) { steal(path, seen); continue; }
    } else continue; // released between the two calls
    if (Date.now() - started >= waitMs) {
      const who = seen === 'unreadable' ? '' : ` (process ${seen.pid})`;
      const err = new VaultError('state_locked', `Another psss is running${who} and holds ${path}. Wait for it to finish and try again; if no psss is running, delete that file.`);
      if (seen !== 'unreadable' && seen.what !== undefined) err.what = seen.what;
      throw err;
    }
    attempt++;
    sleep(Math.min(200, 5 + Math.random() * 15 * Math.min(attempt, 10)));
  }
  held.set(path, 1);
  tokens.set(path, info.token);
  try { return fn(); }
  finally {
    held.delete(path);
    tokens.delete(path);
    const mine = readLock(path);
    if (mine !== null && mine !== 'unreadable' && mine.token === info.token) { try { unlinkSync(path); } catch { /* gone */ } }
  }
}
