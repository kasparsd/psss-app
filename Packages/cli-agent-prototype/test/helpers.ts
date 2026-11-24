// A broker in this process and the psss command in a child process. What the child prints is what an agent would see.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Broker, listen, type Answer, type Ask, type Item } from '../src/broker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.join(here, '../src/cli.ts');
export const ITEMS: Item[] = JSON.parse(fs.readFileSync(path.join(here, '../fixtures/vault.json'), 'utf8'));

/** Every stored secret, and every stored title, in the fixture. */
export const SECRETS = ITEMS.flatMap((i) => [...Object.values(i.fields), ...(i.totp ? [i.totp] : [])]);
export const TITLES = [...new Set(ITEMS.map((i) => i.title))];

export type Seen = { code: number; out: string; err: string; all: string };

export type Bench = {
  broker: Broker;
  asks: Ask[];
  /** Runs the psss command the way an agent would and returns everything it printed. */
  psss(args: string[], options?: { requester?: string; input?: string }): Promise<Seen>;
  close(): Promise<void>;
};

export async function bench(answer: (ask: Ask) => Answer, now?: () => number): Promise<Bench> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psss-'));
  const socket = path.join(dir, 's');
  const asks: Ask[] = [];
  const broker = new Broker({
    items: ITEMS,
    now,
    approver: async (ask) => {
      asks.push(ask);
      return answer(ask);
    },
  });
  const server = await listen(broker, socket);
  return {
    broker,
    asks,
    psss(args, options = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], {
          env: { ...process.env, PSSS_SOCKET: socket, PSSS_PROTO_REQUESTER: options.requester ?? 'Agent' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout.on('data', (c: Buffer) => out.push(c));
        child.stderr.on('data', (c: Buffer) => err.push(c));
        child.on('error', reject);
        child.on('close', (code) => {
          const o = Buffer.concat(out).toString('utf8');
          const e = Buffer.concat(err).toString('utf8');
          resolve({ code: code ?? -1, out: o, err: e, all: o + e });
        });
        child.stdin.end(options.input ?? '');
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => {
          fs.rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      });
    },
  };
}

/** Fails when any stored secret appears in the text, also base64 or hex encoded. */
export function leaked(text: string): string[] {
  return SECRETS.filter((s) => text.includes(s) || text.includes(Buffer.from(s).toString('base64')) || text.includes(Buffer.from(s).toString('hex')));
}

export const once = (): Answer => ({ decision: 'once' });
export const untilLock = (): Answer => ({ decision: 'until-lock' });
export const deny = (): Answer => ({ decision: 'deny' });
