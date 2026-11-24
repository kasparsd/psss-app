// Helpers for the tests that run the real `psss` binary as a child process against the real vault library.
// The environment is explicit and minimal: no inherited HOME or XDG folders, no terminal, CI set.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { generateDeviceKey, openVault, systemRandom, writeKeyFile } from '../../vault/src/index.ts';

export const BIN = path.join(import.meta.dirname, '..', 'src', 'bin', 'psss.ts');

export interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
  argv: string[];
}

/** One computer: its own home, key and state folders, and a working folder. */
export class Device {
  root: string;
  home: string;
  cwd: string;
  config: string;
  state: string;
  /** Everything every command printed on this device, to check for secrets. */
  log: Result[] = [];

  constructor(root: string) {
    this.root = root;
    this.home = path.join(root, 'home');
    this.cwd = path.join(root, 'work');
    this.config = path.join(this.home, '.config');
    this.state = path.join(this.home, '.local', 'state');
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.cwd, { recursive: true });
  }

  env(extra: Record<string, string> = {}): Record<string, string> {
    return { PATH: '/usr/bin:/bin', HOME: this.home, XDG_CONFIG_HOME: this.config, XDG_STATE_HOME: this.state, CI: '1', ...extra };
  }

  /** Runs `psss <args>` with `stdin` piped in (never a terminal). */
  psss(args: string[], options: { stdin?: string; env?: Record<string, string>; cwd?: string } = {}): Result {
    const argv = ['--disable-warning=ExperimentalWarning', BIN, ...args];
    const r = spawnSync(process.execPath, argv, {
      cwd: options.cwd ?? this.cwd,
      env: this.env(options.env),
      input: options.stdin ?? '',
      encoding: 'utf8',
      timeout: 120_000,
    });
    const out: Result = { code: r.status, stdout: r.stdout, stderr: r.stderr, argv: args };
    this.log.push(out);
    return out;
  }

  get vaultFolder(): string {
    return path.join(this.home, 'Psss');
  }
  vaultPath(name: string): string {
    return path.join(this.vaultFolder, `${name}.psss`);
  }
  keyFile(name: string): string {
    return path.join(this.config, 'psss', 'keys', `${name}.key`);
  }
  stateDir(name: string): string {
    return path.join(this.state, 'psss', name);
  }

  /** The vault library on the same files, for setting up and checking from outside the command. */
  library(name: string, folder = this.vaultPath(name)) {
    return openVault({ locations: [folder], unlock: { keyFile: this.keyFile(name) }, stateDir: this.stateDir(name) });
  }
}

export function device(t: TestContext, name = 'psss-real-'): Device {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), name))); // no symbolic links in the path, so displayed paths match
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new Device(root);
}

/** A second computer for the same vault: a new key file, admitted through a device slot with the library (the invitation exchange is not specified). */
export function admit(first: Device, second: Device, name: string, folder = first.vaultPath(name)): void {
  const key = generateDeviceKey(systemRandom);
  writeKeyFile(second.keyFile(name), key.kemSeed);
  first.library(name, folder).admitDevice(key.kemPk);
}

/** Every file below a folder, sorted. */
export function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

export const segments = (vaultFolder: string): string[] => files(vaultFolder).filter((f) => f.endsWith('.seg') || f.endsWith('.mseg'));

export function keySeed(file: string): string {
  return (JSON.parse(readFileSync(file, 'utf8')) as { kem_seed: string }).kem_seed;
}

export const SECRET = 'sk-real-8c41d7e2-do-not-print';
