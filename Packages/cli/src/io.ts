// The injected world of the command: streams, folder, environment, terminal facts and the vault service.
// The real binary passes process.*; tests pass fakes, so almost everything runs in process.

import type { VaultService, ServiceOptions } from './service.ts';

export interface InputStream {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  setEncoding?: (encoding: BufferEncoding) => unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  pause(): unknown;
  resume(): unknown;
  unshift?(chunk: Uint8Array | string): void;
  [Symbol.asyncIterator]?(): AsyncIterableIterator<any>;
}

export interface OutputStream {
  write(chunk: string): unknown;
}

export interface CliIo {
  stdin: InputStream;
  stdout: OutputStream;
  stderr: OutputStream;
  /** Folder that relative paths resolve against, and where `.psss.json` is read. */
  cwd: string;
  /** Environment variables. Also where the user's home and config folders come from, so tests can point them at a temporary folder. */
  env: Readonly<Record<string, string | undefined>>;
  isTTY: { stdin: boolean; stdout: boolean; stderr?: boolean };
  /** Clock, for tests. */
  now?: () => Date;
  /** Operating system name as in process.platform. Defaults to the real one. */
  platform?: string;
  /** True when the program started by `run` should share the real terminal (stdio inherited). The binary sets it; tests leave it off and capture output. */
  inheritStdio?: boolean;
  /** Makes the vault service for one run. The real binary will construct it lazily; absent means this build cannot open a vault. */
  service?: (options: ServiceOptions) => VaultService | Promise<VaultService>;
}

export function isCi(env: CliIo['env']): boolean {
  const v = env.CI;
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

/** A person is at a terminal and CI is not set: menus and questions are allowed. */
export function isInteractive(io: CliIo): boolean {
  return io.isTTY.stdin && io.isTTY.stdout && !isCi(io.env);
}

export function homeOf(io: CliIo): string {
  return io.env.HOME ?? io.env.USERPROFILE ?? '';
}

/** Shows a path the way a person reads it: `./x` below the working folder, `~/x` below home, otherwise as given. */
export function displayPath(io: CliIo, path: string): string {
  const slash = (s: string) => s.replace(/\\/g, '/');
  const p = slash(path);
  const cwd = slash(io.cwd).replace(/\/+$/, '');
  if (cwd && p.startsWith(`${cwd}/`)) return `./${p.slice(cwd.length + 1)}`;
  const home = slash(homeOf(io)).replace(/\/+$/, '');
  if (home && p === home) return '~';
  if (home && p.startsWith(`${home}/`)) return `~/${p.slice(home.length + 1)}`;
  return path;
}
