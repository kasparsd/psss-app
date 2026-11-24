// Device state (docs/cli.md, "Device state"): what the format requires of a device, kept outside the vault, in `stateDir`.
//   state.json                       { version, name, deviceId, chains, heads }
//   outbox/<gid>-<seq>.sealed        the sealed bytes of every record this device wrote that has not reached every location
// - `deviceId` labels this device's chain of records (spec 3.2).
// - `chains[gid]` is the last record this device sealed in each group: its seq and record_id. The next record is seq + 1 with that prev.
// - `heads[location][gid/author/device]` is the last record this device accepted from that location: the rollback check (spec 4.4).
// - the outbox holds sealed bytes, stored before anything is written to a location, and every delivery sends exactly those bytes (4.1).
// Every file is replaced atomically. Losing the directory does not lose the vault but makes the device a new one (a new device id).
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fromHex, hex } from '../../format/src/bytes.ts';
import type { Remembered } from '../../format/src/remember.ts';
import { VaultError } from './errors.ts';
import { writeAtomic } from './fsutil.ts';

export interface ChainHead { seq: number; id: string }
interface StateData {
  version: 1;
  name: string;
  deviceId: string;
  chains: Record<string, ChainHead>;
  heads: Record<string, Record<string, ChainHead>>;
}
export interface OutboxEntry { gid: string; seq: number; sealed: Uint8Array }

const OUTBOX_NAME = /^([0-9a-f]{64})-([0-9]{10})\.sealed$/;

export class DeviceState {
  dir: string;
  data: StateData;
  private dirty = false;
  private durable: boolean;
  /** a read-only copy: nothing is ever written to `dir` (see `ephemeral`) */
  readonly memory: boolean = false;

  constructor(dir: string, data: StateData, durable = true) { this.dir = dir; this.data = data; this.durable = durable; }

  /** The device state as it is on disk, or a new one that exists only in memory, and never writes: for a command that must change nothing (a dry run). */
  static ephemeral(dir: string, name: string, deviceId: Uint8Array): DeviceState {
    const d = DeviceState.read(dir) ?? { version: 1 as const, name, deviceId: hex(deviceId), chains: {}, heads: {} };
    const s = new DeviceState(dir, d, false) as { memory: boolean } & DeviceState;
    (s as { memory: boolean }).memory = true;
    return s;
  }

  static load(dir: string, durable = true): DeviceState | null {
    const d = DeviceState.read(dir);
    return d ? new DeviceState(dir, d, durable) : null;
  }

  private static read(dir: string): StateData | null {
    const path = join(dir, 'state.json');
    if (!existsSync(path)) return null;
    let d: StateData;
    try { d = JSON.parse(readFileSync(path, 'utf8')) as StateData; } catch { throw new VaultError('bad_state', `${path} is not valid JSON`); }
    if (!d || d.version !== 1 || typeof d.deviceId !== 'string' || !/^[0-9a-f]{32}$/.test(d.deviceId) || typeof d.chains !== 'object' || typeof d.heads !== 'object') {
      throw new VaultError('bad_state', `${path} is not device state, version 1`);
    }
    return d;
  }

  /** Reads state.json again, after another process may have changed it (called with the state lock held). Returns true if the file differs
   *  from what this object held; the object then holds the file's content. */
  reload(): boolean {
    if (this.memory) return false;
    const d = DeviceState.read(this.dir);
    if (!d || JSON.stringify(d) === JSON.stringify(this.data)) return false;
    this.data = d;
    this.dirty = false;
    return true;
  }

  static create(dir: string, name: string, deviceId: Uint8Array, durable = true): DeviceState {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const s = new DeviceState(dir, { version: 1, name, deviceId: hex(deviceId), chains: {}, heads: {} }, durable);
    s.dirty = true;
    s.flush();
    return s;
  }

  /** Replaces state.json atomically. Not flushed to disk: what a lost write costs is covered below. Use `flush` where it matters. */
  save(): void {
    if (this.memory) return;
    if (!this.dirty) return;
    this.write(false);
  }
  /** As `save`, and flushed to disk. Called before an outbox entry is removed: from then on the vault itself is the only proof of the
   *  record, and a state that fell behind it would make the device take a new device id (3.2). */
  flush(): void {
    if (this.memory) return;
    if (!this.dirty && !this.unflushed) return;
    this.write(true);
  }
  private unflushed = false;
  private write(durable: boolean): void {
    writeAtomic(join(this.dir, 'state.json'), new TextEncoder().encode(`${JSON.stringify(this.data, null, 2)}\n`), 0o600, durable && this.durable);
    this.dirty = false;
    this.unflushed = !durable;
  }

  get deviceId(): Uint8Array { return fromHex(this.data.deviceId); }
  get name(): string { return this.data.name; }

  /** 3.2: a device that cannot be certain of the last sequence number it wrote takes a new device id and starts its chains again. */
  takeNewDevice(deviceId: Uint8Array): void {
    if (this.memory) return;
    this.data.deviceId = hex(deviceId);
    this.data.chains = {};
    this.dirty = true;
    this.flush();
  }

  /** Called after the sealed bytes are in the outbox, before anything leaves the device. Not flushed: if the process dies before the next
   *  flush, the outbox (flushed) is the proof of the record and the next open advances the number again. */
  advance(gid: string, seq: number, id: string): void {
    if (this.memory) throw new VaultError('read_only', 'this vault was opened to read only');
    this.data.chains[gid] = { seq, id };
    this.dirty = true;
    this.save();
  }
  chain(gid: string): ChainHead | undefined { return this.data.chains[gid]; }

  // ---- outbox
  private get outboxDir(): string { return join(this.dir, 'outbox'); }
  private outboxPath(gid: string, seq: number): string { return join(this.outboxDir, `${gid}-${String(seq).padStart(10, '0')}.sealed`); }
  putOutbox(gid: string, seq: number, sealed: Uint8Array): void { if (this.memory) throw new VaultError('read_only', 'this vault was opened to read only'); writeAtomic(this.outboxPath(gid, seq), sealed, 0o600, this.durable); }
  removeOutbox(gid: string, seq: number): void { if (this.memory) return; try { unlinkSync(this.outboxPath(gid, seq)); } catch { /* already gone */ } }
  outbox(): OutboxEntry[] {
    if (!existsSync(this.outboxDir)) return [];
    const out: OutboxEntry[] = [];
    for (const name of readdirSync(this.outboxDir).sort()) {
      const m = OUTBOX_NAME.exec(name);
      if (m) out.push({ gid: m[1]!, seq: Number(m[2]), sealed: new Uint8Array(readFileSync(join(this.outboxDir, name))) });
    }
    return out;
  }

  // ---- remembered chain heads, per location (spec 4.4)
  remembered(location: string): Remembered {
    const out: Remembered = new Map();
    for (const [chain, h] of Object.entries(this.data.heads[location] ?? {})) out.set(chain, { seq: h.seq, id: fromHex(h.id) });
    return out;
  }
  setRemembered(location: string, heads: Remembered): void {
    const next: Record<string, ChainHead> = {};
    for (const [chain, h] of [...heads].sort(([a], [b]) => (a < b ? -1 : 1))) next[chain] = { seq: h.seq, id: hex(h.id) };
    if (JSON.stringify(next) === JSON.stringify(this.data.heads[location] ?? {})) return;
    this.data.heads[location] = next;
    this.dirty = true;
  }
}
