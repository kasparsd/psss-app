import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { run } from '../src/cli.ts';
import { FakeVaultService } from '../src/fake-service.ts';
import type { FakeScenario } from '../src/fake-service.ts';
import type { CliIo } from '../src/io.ts';
import type { ServiceOptions } from '../src/service.ts';

/** A stand-in for a terminal's standard input: isTTY, raw mode that can be checked, and typed text. */
export class FakeTty extends Readable {
  isTTY = true;
  rawMode = false;
  rawModeCalls: boolean[] = [];
  constructor(typed: string) {
    super();
    if (typed !== '') this.push(typed);
  }
  setRawMode(mode: boolean): this {
    this.rawMode = mode;
    this.rawModeCalls.push(mode);
    return this;
  }
  _read(): void {}
}

export interface Sandbox {
  root: string;
  home: string;
  cwd: string;
  cleanup(): void;
  write(relative: string, content: string, mode?: number): string;
}

export function sandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), 'psss-cli-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'work');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return {
    root,
    home,
    cwd,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    write(relative, content, mode) {
      const full = path.isAbsolute(relative) ? relative : path.join(cwd, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
      if (mode !== undefined) chmodSync(full, mode);
      return full;
    },
  };
}

export interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  /** Standard output and standard error in the order they were written, as a terminal would show them. */
  combined: string;
  /** The options the command resolved and handed to the service factory (undefined when no service was made). */
  serviceOptions?: ServiceOptions;
  stdin?: FakeTty;
  argv: string[];
}

export interface RunOptions {
  box: Sandbox;
  /** Text piped to standard input (not a terminal). */
  stdin?: string;
  /** Text typed at a terminal; makes standard input a terminal. */
  typed?: string;
  /** Standard output is a terminal. */
  stdoutTty?: boolean;
  env?: Record<string, string | undefined>;
  fake?: FakeVaultService;
  scenario?: Partial<FakeScenario>;
  /** No service at all, like the binary of today. */
  noService?: boolean;
  platform?: string;
}

export function scenarioFor(box: Sandbox, extra: Partial<FakeScenario> = {}): FakeScenario {
  return { home: box.home, cwd: box.cwd, ...extra };
}

export async function runCli(argv: string[], options: RunOptions): Promise<Outcome> {
  const { box } = options;
  let stdout = '';
  let stderr = '';
  let combined = '';
  const tty = options.typed !== undefined ? new FakeTty(options.typed) : undefined;
  let stdin: Readable;
  if (tty) stdin = tty;
  else {
    const pass = new PassThrough();
    pass.end(options.stdin ?? '');
    stdin = pass;
  }
  const fake = options.fake ?? new FakeVaultService(scenarioFor(box, options.scenario));
  let serviceOptions: ServiceOptions | undefined;
  const io: CliIo = {
    stdin: stdin as unknown as CliIo['stdin'],
    stdout: { write: (s) => ((stdout += s), (combined += s), true) },
    stderr: { write: (s) => ((stderr += s), (combined += s), true) },
    cwd: box.cwd,
    env: { HOME: box.home, ...(options.env ?? {}) },
    isTTY: { stdin: tty !== undefined, stdout: options.stdoutTty === true },
    platform: options.platform ?? 'linux',
    ...(options.noService
      ? {}
      : {
          service: (o: ServiceOptions) => {
            serviceOptions = o;
            return fake.withOptions(o);
          },
        }),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr, combined, serviceOptions, stdin: tty, argv };
}

/** Trailing spaces are not visible in the mock, so compared text ignores them. */
export function norm(text: string): string {
  return text.split('\n').map((l) => l.trimEnd()).join('\n');
}

export const SECRET = 'sk-distinct-4f9c2e71-do-not-print';

/** The standard fictional vault of the mock: Example API, Example Bank and Example Shop. */
export const ITEMS = [
  { id: 'a1b2c3d4', title: 'Example API', username: 'robin@example.com', fields: { token: 'sk-example-old' } },
  { id: '7f3a9c21', title: 'Example Bank', username: 'robin@example.com', fields: { password: 'bank-pw-1', code: '123456' } },
  { id: 'b01d5e44', title: 'Example Shop', username: 'robin@example.com', fields: { password: 'shop-pw-1' } },
];
