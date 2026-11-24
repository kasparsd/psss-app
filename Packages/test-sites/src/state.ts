import type { Totp } from './totp.ts';

export type Passkey = { id: string; publicKey: Buffer; signCount: number; rpId: string; created: number };
export type Account = { username: string; password: string; totp?: Totp; passkeys: Passkey[]; userHandle: string };
export type Session = { username: string; stage: 'otp' | 'full'; pendingSecret?: string };
export type Challenge = { kind: 'create' | 'get'; rpId: string; username?: string; expires: number };
export type Site = {
  accounts: Map<string, Account>;
  sessions: Map<string, Session>;
  challenges: Map<string, Challenge>;
  log: string[];
};

/** Every host name is its own site with its own accounts, sessions and cookies. Memory only: a restart forgets everything. */
const sites = new Map<string, Site>();

export function site(host: string): Site {
  let found = sites.get(host);
  if (!found) {
    found = { accounts: new Map(), sessions: new Map(), challenges: new Map(), log: [] };
    sites.set(host, found);
  }
  return found;
}

export function record(host: string, line: string): void {
  const log = site(host).log;
  log.unshift(`${new Date().toISOString().slice(11, 19)} ${line}`);
  log.length = Math.min(log.length, 40);
}

export function resetHost(host: string): void { sites.delete(host); }
export function resetAll(): void { sites.clear(); }
export function knownHosts(): string[] { return [...sites.keys()].sort(); }
