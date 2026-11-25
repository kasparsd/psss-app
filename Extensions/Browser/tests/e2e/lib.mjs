// Shared helpers for the browser end-to-end tests: test site (Packages/test-sites, Node 24), CDP client, polling.
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const BUILD = resolve(ROOT, 'build/browser');
export const SITE = 'http://localhost:8080';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, what, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

const portOpen = (port) => new Promise((ok) => {
  const s = createConnection({ port, host: '127.0.0.1' }, () => { s.destroy(); ok(true); });
  s.on('error', () => ok(false));
});

/** Starts the test site on :8080 unless one is already listening. Returns a stop function. Needs Node 24 (the running Node). */
export async function startSite({ detach = false } = {}) {
  if (await portOpen(8080)) return () => {};
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', resolve(ROOT, 'Packages/test-sites/src/server.ts'), '--port', '8080'], { stdio: 'ignore', detached: detach });
  if (detach) child.unref();
  await until(() => portOpen(8080), 'test site on :8080');
  return () => { if (!detach) child.kill(); };
}

/**
 * Starts the stand-in relay (build.py standin): the app's relay server over the prototype's vaults, which keeps its state in
 * `store`. Its socket sits in a short folder under /tmp (a socket path holds at most 103 bytes). Resolves when it listens.
 * Returns the socket path for the host (`PSSS_RELAY_SOCKET`) and a stop function.
 */
export async function startStandIn(store, args = [], folder) {
  const root = folder ?? mkdtempSync('/tmp/psss-rl-');
  const child = spawn(join(BUILD, 'relay-standin/psss-relay-standin'), ['--directory', join(root, 'Relay'), ...args],
    { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PSSS_PROTOTYPE_DIR: store } });
  await new Promise((ok, fail) => {
    child.stdout.once('data', (d) => (String(d).startsWith('ready ') ? ok() : fail(new Error(`stand-in relay: ${d}`))));
    child.once('exit', (code) => fail(new Error(`stand-in relay exited with ${code}`)));
  });
  const exited = new Promise((done) => child.once('close', done));
  return {
    socket: join(root, 'Relay/browser.sock'),
    root,
    /** SIGKILL, as a crash: the socket file and lock file stay behind, and a new relay on the same folder must take over. */
    async kill() { child.kill('SIGKILL'); await exited; },
    stop() { child.kill(); rmSync(root, { recursive: true, force: true }); },
  };
}

/**
 * Minimal Chrome DevTools Protocol client. Two transports: a WebSocket (any Chromium started with
 * --remote-debugging-port) and a pipe (--remote-debugging-pipe, required for Extensions.loadUnpacked
 * in branded Chrome, which ignores --load-extension since version 137).
 */
export class CDP {
  constructor(transport) {
    this.t = transport;
    this.id = 0;
    this.pending = new Map();
    transport.onmessage = (text) => {
      const m = JSON.parse(text);
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.bad(new Error(`${p.method}: ${m.error.message}`)) : p.ok(m.result); }
    };
    this.ready = transport.ready ?? Promise.resolve();
  }
  static websocket(url) {
    const ws = new WebSocket(url);
    const t = { ready: new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; }), write: (s) => ws.send(s), close: () => ws.close() };
    ws.onmessage = ({ data }) => t.onmessage(data);
    return new CDP(t);
  }
  /** `child` was spawned with stdio [.., .., .., 'pipe', 'pipe'] and --remote-debugging-pipe. */
  static pipe(child) {
    const t = { write: (s) => child.stdio[3].write(s + '\0'), close: () => child.stdio[3].end() };
    let buffer = '';
    child.stdio[4].setEncoding('utf8').on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\0')) >= 0) { const m = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (m) t.onmessage(m); }
    });
    return new CDP(t);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.t.write(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad, method }));
  }
  close() { this.t.close(); }

  async openTab(url) {
    const { targetId } = await this.send('Target.createTarget', { url });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return new Tab(this, targetId, sessionId);
  }
}

export class Tab {
  constructor(cdp, targetId, sessionId) { Object.assign(this, { cdp, targetId, sessionId }); }
  async eval(expression) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async goto(url) {
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await until(async () => (await this.eval('location.href')) !== 'about:blank' && (await this.eval('document.readyState')) !== 'loading', `load ${url}`);
  }
  text() { return this.eval('document.body.innerText'); }
  close() { return this.cdp.send('Target.closeTarget', { targetId: this.targetId }); }
}
