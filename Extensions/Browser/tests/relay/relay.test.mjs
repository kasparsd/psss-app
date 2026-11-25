// The relay harness (scripts/test-relay.sh): the hostile-input and secrecy checklist of AGENTS.md ("Delegated work and validation")
// for the browser relay, through the real server code and the real host.
//
// Subjects: the stand-in relay (build.py standin: the app's `BrowserRelayServer` over the prototype's vaults, with an injected
// peer policy), the test host (build.py host --testing) and a release-style host (ad hoc, no team). Every case that talks to a
// server first checks that the server is still alive and still answers a ping afterwards: a hostile peer must never end the relay.
// Node 24, nothing installed. Everything is written under a folder in /tmp (a socket path holds at most 103 bytes).
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync, symlinkSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BUILD = join(ROOT, 'build/browser');
const STANDIN = join(BUILD, 'relay-standin/psss-relay-standin');
const BUILT_TEST_HOST = join(BUILD, 'host-test/psss-native-host');
let TEST_HOST = BUILT_TEST_HOST; // a copy in the scratch folder, with its own allowed-callers.txt (set below)
const RELEASE_HOST = process.env.PSSS_RELEASE_HOST; // an ad hoc, release-style host built by test-relay.sh into a scratch folder
const CALLER = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scratch = mkdtempSync('/tmp/psss-rt-');
if (existsSync(BUILT_TEST_HOST)) {
  mkdirSync(join(scratch, 'host'));
  TEST_HOST = join(scratch, 'host/psss-native-host');
  copyFileSync(BUILT_TEST_HOST, TEST_HOST);
}
let counter = 0;
const fresh = (name) => { const d = join(scratch, `${name}${++counter}`); mkdirSync(d); return d; };
after(() => { for (const p of running) p.kill('SIGKILL'); rmSync(scratch, { recursive: true, force: true }); });

// ---- helpers -------------------------------------------------------------------------------------------------------

const running = new Set();
/** Starts the stand-in relay. Resolves with { socket, root, proc, output(), kill() }, or { failed: { code, stderr } } when it will not start. */
async function relay({ root = fresh('r'), store, env = {}, args = [] } = {}) {
  store ??= fresh('store');
  const proc = spawn(STANDIN, ['--directory', join(root, 'Relay'), ...args], { env: { ...process.env, PSSS_PROTOTYPE_DIR: store, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(proc);
  let out = '', err = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  const closed = new Promise((done) => proc.once('close', (code, signal) => { running.delete(proc); done({ code, signal }); }));
  const result = await Promise.race([
    new Promise((ok) => { const poll = setInterval(() => { if (out.startsWith('ready ')) { clearInterval(poll); ok('ready'); } }, 10); proc.once('close', () => clearInterval(poll)); }),
    closed,
  ]);
  const handle = {
    root, store, proc, socket: join(root, 'Relay/browser.sock'), closed,
    output: () => out + err,
    stdout: () => out, stderr: () => err,
    async kill() { proc.kill('SIGKILL'); await closed; },
  };
  if (result !== 'ready') return { ...handle, failed: { code: result.code, stderr: err.trim() } };
  return handle;
}

const frame = (payload) => {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
};
const envelope = (request, extra = {}) => ({ relay: 1, caller: CALLER, request, ...extra });
const ping = (id = 'p') => ({ v: 5, id, type: 'ping' });

/** Connects, sends `chunks` (bytes, or { wait: ms }), then reads until the server closes or `readFor` ms pass. */
function exchange(socket, chunks, { readFor = 4000, closeAfterSend = false } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const got = [];
    let closed = false;
    let connected = false;
    const c = connect(socket);
    c.on('data', (d) => got.push(d));
    c.on('error', (e) => { got.push(Buffer.alloc(0)); finish(e.code ?? 'error'); });
    c.on('close', () => finish('closed'));
    let ended = false;
    // `closed`: the server ended a connection that had been made. A write that meets a server which has already closed fails with
    // EPIPE, ECONNRESET, ENOTCONN or EPROTOTYPE depending on a race in the kernel (a refused peer is closed at once, before the
    // client has written), and all of them mean the same thing. A failure to connect, or a connection left open, is not a close.
    function finish(how) { if (ended) return; ended = true; clearTimeout(timer); closed = how === 'closed' || (connected && how !== 'open' && how !== 'ECONNREFUSED' && how !== 'ENOENT'); c.destroy(); done({ ...parse(Buffer.concat(got)), how, closed, ms: Date.now() - started }); }
    const timer = setTimeout(() => finish('open'), readFor);
    c.on('connect', async () => {
      connected = true;
      for (const chunk of chunks) {
        if (ended) return;
        if (chunk.wait) await sleep(chunk.wait); else c.write(chunk);
      }
      if (closeAfterSend) c.end();
    });
  });
}
/** The frames in a reply: [{...}], and what was left over (a partial frame is a bug in the server). */
function parse(buffer) {
  const frames = [];
  let i = 0;
  while (buffer.length - i >= 4) {
    const n = buffer.readUInt32BE(i);
    if (buffer.length - i - 4 < n) break;
    frames.push(JSON.parse(buffer.subarray(i + 4, i + 4 + n).toString()));
    i += 4 + n;
  }
  return { frames, leftover: buffer.length - i };
}
const ask = async (socket, request, extra) => (await exchange(socket, [frame(envelope(request, extra))], { readFor: 6000 })).frames[0];
const alive = async (r, what = '') => {
  assert.deepEqual([r.proc.exitCode, r.proc.signalCode], [null, null], `the relay is still running ${what}`);
  const reply = await ask(r.socket, ping('alive'));
  assert.deepEqual({ ok: reply?.ok, id: reply?.id, app: reply?.app }, { ok: true, id: 'alive', app: true }, `the relay still answers ${what}: ${JSON.stringify(reply)}`);
};

function nativeFrame(object) {
  const body = Buffer.from(JSON.stringify(object));
  const head = Buffer.alloc(4); head.writeUInt32LE(body.length); // native endian on this Mac
  return Buffer.concat([head, body]);
}
function nativeReplies(buffer) {
  const out = [];
  for (let i = 0; i + 4 <= buffer.length;) { const n = buffer.readUInt32LE(i); out.push(JSON.parse(buffer.subarray(i + 4, i + 4 + n).toString())); i += 4 + n; }
  return out;
}
/** Runs a host (default: the test host) with the browser's messages on stdin. Resolves with { replies, stderr, code, signal }. */
function host(socket, messages, { binary = TEST_HOST, args = [CALLER], onSpawn } = {}) {
  return new Promise((done) => {
    const callers = join(dirname(binary), 'allowed-callers.txt');
    if (!existsSync(callers)) writeFileSync(callers, `${CALLER}\npasswords@psss.app\n`);
    const p = spawn(binary, args, { env: { ...process.env, PSSS_RELAY_SOCKET: socket }, stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(p);
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('close', (code, signal) => { running.delete(p); done({ replies: nativeReplies(Buffer.concat(out)), stderr: Buffer.concat(err).toString(), code, signal }); });
    p.stdin.on('error', () => {});
    onSpawn?.(p);
    for (const m of messages) p.stdin.write(Buffer.isBuffer(m) ? m : nativeFrame(m));
    p.stdin.end();
  });
}

before(() => {
  for (const [path, how] of [[STANDIN, 'build.py standin'], [BUILT_TEST_HOST, 'build.py host --testing']]) {
    assert.ok(existsSync(path), `build it first: ${how} (scripts/test-relay.sh does)`);
  }
});

// ---- framing fuzz --------------------------------------------------------------------------------------------------

test('framing: impossible lengths, truncation and garbage never end the relay, and a refused frame gets one plain error', async () => {
  const r = await relay();
  const header = (n) => { const h = Buffer.alloc(4); h.writeUInt32BE(n); return h; };
  const lengths = [[0, 'zero'], [65537, '64 KiB + 1'], [0xFFFFFFFF, '2^32 - 1'], [0x80000000, '2^31'], [1 << 20, '1 MiB']];
  for (const [n, name] of lengths) {
    const reply = await exchange(r.socket, [header(n)]);
    assert.equal(reply.frames[0]?.error, 'unsupported', `${name}: refused at the header, nothing more is read`);
    assert.equal(reply.frames[0]?.ok, false); assert.equal(reply.leftover, 0);
    assert.ok(reply.ms < 1000, `${name}: answered at once, not after the deadline`);
  }
  const exactly = await exchange(r.socket, [frame(envelope({ ...ping('big'), pad: 'x'.repeat(65536 - 200) }))]);
  assert.equal(exactly.frames[0]?.ok, true, 'a request just under the cap is served');
  for (const [name, chunks] of [
    ['header cut short (1 byte)', [Buffer.from([0])]],
    ['header cut short (3 bytes)', [Buffer.from([0, 0, 0])]],
    ['body cut short', [header(100), Buffer.from('{"relay":1')]],
    ['header only, then close', [header(10)]],
  ]) {
    const reply = await exchange(r.socket, chunks, { closeAfterSend: true });
    assert.deepEqual([reply.frames, reply.closed], [[], true], `${name}: closed with no reply`);
  }
  const hostile = [
    ['malformed JSON', frame('{nope')], ['an array', frame('[]')], ['a string', frame('"x"')], ['a number', frame('123')], ['null', frame('null')],
    ['an empty object', frame('{}')], ['trailing garbage', frame('{"relay":1,"caller":"c","request":{}} x')],
    ['depth 10', frame('{"a":'.repeat(10) + '1' + '}'.repeat(10))],
    ['depth 50000 (a stack bomb)', frame('['.repeat(50000))], ['unbalanced', frame('{"relay":1,"caller":"x","request":{"a":[}}')],
    ['invalid UTF-8', frame(Buffer.concat([Buffer.from('{"relay":1,"caller":"'), Buffer.from([0xff, 0xfe]), Buffer.from('","request":{}}')]))],
    ['UTF-16 JSON', frame(Buffer.from(JSON.stringify(envelope(ping())), 'utf16le'))],
    ['NUL inside', frame(Buffer.concat([Buffer.from('{"relay":1,"caller":"a'), Buffer.from([0]), Buffer.from('","request":{}}')]))],
    ['request not an object', frame(envelope('ping'))], ['request an array', frame(envelope([1, 2]))],
    ['relay 2', frame(envelope(ping(), { relay: 2 }))], ['relay true', frame(envelope(ping(), { relay: true }))], ['relay "1"', frame(envelope(ping(), { relay: '1' }))],
    ['relay 1.5', frame(envelope(ping(), { relay: 1.5 }))], ['no relay', frame({ caller: CALLER, request: ping() })],
    ['caller missing', frame({ relay: 1, request: ping() })], ['caller a number', frame(envelope(ping(), { caller: 7 }))],
    ['caller empty', frame(envelope(ping(), { caller: '' }))], ['caller 257 bytes', frame(envelope(ping(), { caller: 'c'.repeat(257) }))],
    ['caller with a newline', frame(envelope(ping(), { caller: 'chrome-extension://a\nb/' }))],
  ];
  for (const [name, bytes] of hostile) {
    const reply = await exchange(r.socket, [bytes]);
    assert.equal(reply.frames[0]?.error, 'unsupported', `${name}: ${JSON.stringify(reply.frames)}`);
    assert.equal(reply.frames.length, 1, name); assert.equal(reply.leftover, 0, name);
  }
  await alive(r, 'after the fuzz');
  // A second request on the same connection is not served: one request per connection.
  const two = await exchange(r.socket, [frame(envelope(ping('one'))), frame(envelope(ping('two')))]);
  assert.deepEqual(two.frames.map((f) => f.id), ['one'], 'one request per connection');
  await r.kill();
});

test('requests with wrong types and over-long fields get a plain protocol error, never a crash', async () => {
  const r = await relay();
  const long = (n) => 'x'.repeat(n);
  const cases = [
    [{ v: 5, id: 'a', type: 'candidates', vault: long(65), origin: 'http://localhost' }, 'not-found'],
    [{ v: 5, id: 'a', type: 'candidates', vault: 7, origin: 'http://localhost' }, 'not-found'],
    [{ v: 5, id: 'a', type: 'candidates', vault: ['passwords'], origin: 'http://localhost' }, 'not-found'],
    [{ v: 5, id: 'a', type: 'candidates', vault: 'passwords', origin: { a: 1 } }, 'forbidden'],
    [{ v: 5, id: 'a', type: 'search', vault: 'passwords', origin: 'http://localhost', query: long(101) }, null],
    [{ v: 5, id: 'a', type: 'search', vault: 'passwords', origin: 'http://localhost', query: 5, fields: 'name' }, null],
    [{ v: 5, id: 'a', type: 'save', vault: 'passwords', origin: 'http://localhost', account: long(321), secret: 'x' }, 'unsupported'],
    [{ v: 5, id: 'a', type: 'save', vault: 'passwords', origin: 'http://localhost', account: 'a@b.c', secret: long(1025) }, 'unsupported'],
    [{ v: 5, id: 'a', type: 'save', vault: 'passwords', origin: 'http://localhost', account: 3, secret: ['x'] }, 'unsupported'],
    [{ v: 5, id: 'a', type: ['ping'] }, 'unsupported'], [{ v: 5, id: 'a', type: 'dump' }, 'unsupported'], [{ v: '5', id: 'a', type: 'ping' }, 'unsupported'],
    [{ v: 5, id: 7, type: 'ping' }, null], [{ v: 5, type: 'ping' }, null],
  ];
  for (const [request, error] of cases) {
    const reply = await ask(r.socket, request);
    assert.ok(reply && typeof reply.ok === 'boolean', JSON.stringify(request).slice(0, 80));
    if (error) assert.equal(reply.error, error, JSON.stringify(request).slice(0, 100));
    assert.equal(reply.v, 5);
  }
  await alive(r);
  await r.kill();
});

const SERVED = ['ping', 'vaults', 'candidates', 'search', 'credential', 'generate', 'save']; // what the real app serves (BrowserRelayLauncher.servedTypes)
test('only the allowed request types reach the protocol (the app serves what BrowserRelayLauncher.servedTypes lists)', async () => {
  const source = readFileSync(join(ROOT, 'App/Features/BrowserRelayLauncher.swift'), 'utf8');
  const listed = [...source.match(/servedTypes: Set<String> = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), [...SERVED].sort(), 'this test and the launcher name the same types');
  const r = await relay({ args: ['--allowed-types', SERVED.join(',')] });
  for (const type of SERVED) {
    const reply = await ask(r.socket, { v: 5, id: type, type, vault: 'passwords', origin: 'http://localhost', ref: 'x', account: 'a@b.c', secret: 's' });
    assert.notEqual(reply.error, 'unsupported', type);
  }
  for (const type of ['unlock-vault', 'switch-vault', 'card', 'card-candidates', 'nope']) {
    const reply = await ask(r.socket, { v: 5, id: type, type, vault: 'passwords', origin: 'http://localhost', ref: 'x' });
    assert.deepEqual([reply.ok, reply.error, reply.id], [false, 'unsupported', type], type);
  }
  await alive(r);
  await r.kill();
});

test('the caller is checked against the app’s compiled list, from the envelope', async () => {
  const r = await relay({ args: ['--callers', 'compiled'] });
  for (const caller of ['chrome-extension://evil/', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/', 'passwords@psss.app ', 'other@example.invalid']) {
    assert.deepEqual([(await ask(r.socket, ping('c'), { caller })).error], ['forbidden'], caller);
  }
  assert.equal((await ask(r.socket, ping('c'), { caller: 'passwords@psss.app' })).ok, true, 'the Firefox add-on id');
  assert.equal((await ask(r.socket, ping('c'), { caller: 'chrome-extension://edkafkibdigcfaipfibhgakgaphaicof/' })).ok, true, 'the development extension (debug build)');
  assert.equal(r.proc.exitCode, null);
  await r.kill();
});

// ---- deadlines and limits ------------------------------------------------------------------------------------------

test('a slow peer is closed at two seconds with a timeout, and a silent one too', async () => {
  const r = await relay();
  const slow = await exchange(r.socket, [Buffer.from([0, 0]), { wait: 3500 }], { readFor: 5000 });
  assert.equal(slow.frames[0]?.error, 'timeout');
  assert.ok(slow.ms >= 1900 && slow.ms < 2800, `closed at about 2 s, was ${slow.ms} ms`);
  const silent = await exchange(r.socket, [{ wait: 3500 }], { readFor: 5000 });
  assert.equal(silent.frames[0]?.error, 'timeout'); assert.ok(silent.ms >= 1900 && silent.ms < 2800, `${silent.ms} ms`);
  const dribble = await exchange(r.socket, [Buffer.from([0, 0, 0, 40]), ...Array.from({ length: 30 }, () => [Buffer.from('x'), { wait: 150 }]).flat()], { readFor: 5000 });
  assert.equal(dribble.frames[0]?.error, 'timeout', 'one byte at a time does not extend the deadline');
  assert.ok(dribble.ms < 2800, `${dribble.ms} ms`);
  await alive(r);
  await r.kill();
});

test('a reply that takes longer than five seconds is a timeout, and nothing is sent later', async () => {
  const r = await relay({ env: { PSSS_STANDIN_DELAY_MS: '6500' } });
  const reply = await exchange(r.socket, [frame(envelope(ping('slow')))], { readFor: 9000 });
  assert.deepEqual([reply.frames[0]?.error, reply.frames[0]?.id, reply.frames.length], ['timeout', 'slow', 1]);
  assert.ok(reply.ms >= 4900 && reply.ms < 6000, `${reply.ms} ms`);
  await sleep(2500); // the handler finishes now; its reply must go nowhere
  assert.equal(r.proc.exitCode, null);
  await r.kill();
});

test('the ninth open connection is told busy at once and closed; the first eight are still served', async () => {
  const r = await relay();
  const held = [];
  for (let i = 0; i < 8; i++) held.push(await new Promise((ok) => { const c = connect(r.socket, () => ok(c)); c.on('error', () => {}); }));
  await sleep(100);
  const ninth = await exchange(r.socket, [frame(envelope(ping('nine')))]);
  assert.deepEqual([ninth.frames[0]?.error, ninth.frames[0]?.ok, ninth.leftover], ['busy', false, 0]);
  assert.ok(ninth.ms < 500);
  // Through the real host: the id of the request comes back on the busy error.
  const viaHost = await host(r.socket, [ping('h1')]);
  assert.deepEqual([viaHost.replies[0].error, viaHost.replies[0].id, viaHost.replies[0].v], ['busy', 'h1', 5]);
  // The first eight can still send their request.
  held[0].write(frame(envelope(ping('first'))));
  const first = await new Promise((ok) => held[0].once('data', (d) => ok(parse(d).frames[0])));
  assert.equal(first.ok, true);
  for (const c of held) c.destroy();
  await sleep(300);
  await alive(r, 'once the slots are free again');
  // Slots are given back when hosts die mid-request: ten killed hosts do not use up the eight.
  for (let i = 0; i < 10; i++) {
    const c = connect(r.socket); c.on('error', () => {});
    await new Promise((ok) => c.once('connect', ok));
    c.write(frame(envelope(ping('x')).toString().slice(0, 10))); c.destroy();
  }
  await sleep(300);
  await alive(r, 'after ten abandoned connections');
  await r.kill();
});

test('twenty connections at once: each gets a whole reply, either the answer or busy, and two hosts at once are both served', async () => {
  const r = await relay({ env: { PSSS_STANDIN_DELAY_MS: '150' } });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => exchange(r.socket, [frame(envelope(ping(`n${i}`)))])));
  for (const [i, x] of results.entries()) {
    assert.equal(x.leftover, 0); assert.equal(x.frames.length, 1, `connection ${i}`);
    assert.ok(x.frames[0].ok === true ? x.frames[0].id === `n${i}` : x.frames[0].error === 'busy', JSON.stringify(x.frames[0]));
  }
  assert.ok(results.filter((x) => x.frames[0].ok).length >= 8, 'at least eight were answered');
  const [a, b] = await Promise.all([host(r.socket, [ping('a1'), ping('a2')]), host(r.socket, [ping('b1'), { v: 5, id: 'b2', type: 'vaults' }])]);
  assert.deepEqual(a.replies.map((x) => [x.id, x.ok]), [['a1', true], ['a2', true]]);
  assert.deepEqual(b.replies.map((x) => [x.id, x.ok]), [['b1', true], ['b2', true]]);
  await r.kill();
});

// ---- lock file, socket file, folder --------------------------------------------------------------------------------

test('one server at a time: a second copy does not listen, a killed one is replaced, a leftover socket is taken over', async () => {
  const root = fresh('lock');
  const a = await relay({ root });
  const mode = (p) => (statSync(p).mode & 0o7777).toString(8);
  assert.deepEqual([mode(join(root, 'Relay')), mode(a.socket), mode(join(root, 'Relay/relay.lock'))], ['700', '600', '600'], 'folder 0700, socket 0600, lock 0600');
  assert.deepEqual(readdirSync(join(root, 'Relay')).sort(), ['browser.sock', 'relay.lock'], 'the folder holds only the socket and the lock');
  const b = await relay({ root, store: a.store });
  assert.equal(b.failed?.code, 3, `a second copy does not listen: ${b.failed?.stderr}`);
  await alive(a, 'while a second copy was refused');
  await a.kill(); // kill -9: the socket file and the lock file stay, the kernel frees the lock
  assert.ok(existsSync(a.socket), 'a leftover socket file');
  const refused = await host(a.socket, [ping('gone')]);
  assert.equal(refused.replies[0].error, 'not-running', 'a socket file with nobody behind it is not-running, not an error');
  const c = await relay({ root, store: a.store });
  assert.equal(c.failed, undefined, 'a new copy takes the lock and replaces the socket');
  await alive(c, 'after the restart');
  assert.equal((await host(c.socket, [ping('back')])).replies[0].ok, true);
  await c.kill();
  // A plain file where the socket goes, a stale lock file, and a lock file that is a link: only the first two are ours to replace.
  rmSync(join(root, 'Relay/browser.sock')); writeFileSync(join(root, 'Relay/browser.sock'), 'not a socket');
  const d = await relay({ root, store: a.store });
  assert.equal(d.failed, undefined); await alive(d); await d.kill();
  const linked = fresh('linkroot'); mkdirSync(join(linked, 'Relay'));
  symlinkSync('/etc/hosts', join(linked, 'Relay/relay.lock'));
  const e = await relay({ root: linked });
  assert.ok(e.failed?.code === 5, 'a lock file that is a link is refused'); assert.equal(readFileSync('/etc/hosts', 'utf8').length > 0, true);
});

test('a socket path too long to bind, and a Relay folder that cannot be made, are plain refusals', async () => {
  const deep = fresh('deep');
  const longRoot = join(deep, 'a'.repeat(60), 'b'.repeat(40));
  const tooLong = await relay({ root: longRoot });
  assert.equal(tooLong.failed?.code, 4, 'no listening on a path over 103 bytes'); assert.match(tooLong.failed.stderr, /too long/);
  assert.equal(existsSync(longRoot), false, 'nothing was created');
  const viaHost = await host(join(longRoot, 'Relay/browser.sock'), [ping('long')]);
  assert.equal(viaHost.replies[0].error, 'not-running');

  const locked = fresh('ro'); chmodSync(locked, 0o500);
  const noFolder = await relay({ root: locked });
  chmodSync(locked, 0o700);
  assert.equal(noFolder.failed?.code, 5, `${noFolder.failed?.stderr}`);
  assert.doesNotMatch(noFolder.failed.stderr, /errno|\(\d+\)|POSIX|NSCocoa/i, 'plain words, no raw codes');
  const file = fresh('file'); writeFileSync(join(file, 'Relay'), 'a file');
  assert.equal((await relay({ root: file })).failed?.code, 5, 'a file where the folder goes');
  const link = fresh('dirlink'); symlinkSync(fresh('elsewhere'), join(link, 'Relay'));
  assert.equal((await relay({ root: link })).failed?.code, 5, 'a link where the folder goes');
  // A folder that exists with loose permissions is tightened, not trusted.
  const loose = fresh('loose'); mkdirSync(join(loose, 'Relay'), { mode: 0o755 });
  const tight = await relay({ root: loose });
  assert.equal(statSync(join(loose, 'Relay')).mode & 0o777, 0o700); await tight.kill();
  const read = await relay({ root: fresh('~') });
  assert.equal(read.failed, undefined, 'a path with a tilde is just a path'); await read.kill();
});

// ---- peers ---------------------------------------------------------------------------------------------------------

test('a refused peer is closed with no reply, however it asks', async () => {
  const r = await relay({ env: { PSSS_STANDIN_PEER: 'refuse' } });
  for (const chunks of [[frame(envelope(ping()))], [Buffer.from('GET / HTTP/1.0\r\n\r\n')], [], [Buffer.from([0, 0, 0, 0])]]) {
    const reply = await exchange(r.socket, chunks, { readFor: 1500 });
    assert.deepEqual([reply.frames, reply.leftover, reply.closed], [[], 0, true]);
  }
  const viaHost = await host(r.socket, [ping('refused')]);
  assert.deepEqual([viaHost.replies[0].ok, viaHost.replies[0].error, viaHost.replies[0].id], [false, 'failed', 'refused'], 'the host sees only a closed connection');
  assert.equal(r.proc.exitCode, null);
  assert.equal(r.output().replace(/^ready .*\n/, ''), '', 'nothing about the refusal reaches stdout or stderr');
  await r.kill();
});

test('the peer is judged by its code signature through the audit token: only the signature the policy names is served', async () => {
  const wanted = /CDHash=([0-9a-f]+)/.exec(spawnSync('codesign', ['-d', '-vvv', TEST_HOST], { encoding: 'utf8' }).stderr)?.[1];
  assert.ok(wanted, 'the test host\'s code directory hash is readable');
  const r = await relay({ env: { PSSS_STANDIN_PEER: `cdhash:${wanted}` } });
  const ok = await host(r.socket, [ping('mine'), { v: 5, id: 'v', type: 'vaults' }]);
  assert.deepEqual(ok.replies.map((x) => [x.id, x.ok]), [['mine', true], ['v', true]], 'the host whose hash is named is served');
  const copy = join(fresh('copy'), 'psss-native-host');
  copyFileSync(TEST_HOST, copy); writeFileSync(join(dirname(copy), 'allowed-callers.txt'), `${CALLER}\n`);
  assert.equal((await host(r.socket, [ping('copy')], { binary: copy })).replies[0].ok, true, 'a byte-identical copy has the same hash');
  const other = await exchange(r.socket, [frame(envelope(ping('node')))], { readFor: 1500 });
  assert.deepEqual([other.frames, other.closed], [[], true], 'node (another signature) gets nothing');
  const nc = spawnSync('/usr/bin/nc', ['-U', r.socket], { input: frame(envelope(ping('nc'))), timeout: 3000 });
  assert.equal(nc.stdout.length, 0, 'nc -U is closed with no reply');
  const changed = join(fresh('changed'), 'psss-native-host');
  copyFileSync(TEST_HOST, changed);
  execFileSync('codesign', ['--force', '--sign', '-', '-i', 'app.psss.somebody-else', changed], { stdio: 'ignore' });
  writeFileSync(join(dirname(changed), 'allowed-callers.txt'), `${CALLER}\n`);
  assert.equal((await host(r.socket, [ping('re')], { binary: changed })).replies[0].error, 'failed', 'the same code under another identifier is another signature');
  assert.equal((await host(r.socket, [ping('still')])).replies[0].ok, true, 'the policy still serves the named host');
  assert.deepEqual([r.proc.exitCode, r.proc.signalCode], [null, null]);
  await r.kill();
});

test('the release-style host (no team signature) cannot verify the app and says so, without sending anything', async (t) => {
  if (!RELEASE_HOST) return t.skip('PSSS_RELEASE_HOST is not set (scripts/test-relay.sh sets it)');
  const r = await relay();
  const out = await host(r.socket, [ping('r1'), { v: 5, id: 'r2', type: 'vaults' }], { binary: RELEASE_HOST });
  assert.deepEqual(out.replies.map((x) => [x.id, x.ok, x.error]), [['r1', false, 'not-verified'], ['r2', false, 'not-verified']]);
  const env = spawnSync(RELEASE_HOST, [CALLER], { input: nativeFrame(ping('e')), env: { ...process.env, PSSS_RELAY_SOCKET: r.socket }, encoding: 'buffer' });
  assert.equal(nativeReplies(env.stdout)[0].error, 'not-verified', 'a release host ignores PSSS_RELAY_SOCKET');
  assert.equal(readFileSync(RELEASE_HOST).includes('PSSS_RELAY_SOCKET'), false, 'the variable name is not in the release host');
  assert.equal(readFileSync(TEST_HOST).includes('PSSS_RELAY_SOCKET'), true, 'and is in the test host');
  await alive(r, 'untouched by the release host: it never connected');
  await r.kill();
});

test('the host refuses a caller that is not on its list, and does not look at the relay', async () => {
  const r = await relay();
  const out = await host(r.socket, [ping('x')], { args: ['chrome-extension://evil/'] });
  assert.deepEqual([out.code, out.replies], [2, []]);
  assert.match(out.stderr, /caller not allowed/);
  const none = await host(r.socket, [ping('x')], { args: [] });
  assert.equal(none.code, 2);
  await r.kill();
});

// ---- kill -9 ------------------------------------------------------------------------------------------------------

test('kill -9 of the host in the middle of a request: the relay drops the reply, frees the slot and keeps serving', async () => {
  const r = await relay({ env: { PSSS_STANDIN_DELAY_MS: '300' } });
  for (let i = 0; i < 12; i++) {
    await host(r.socket, [ping(`k${i}`)], { onSpawn: (p) => setTimeout(() => p.kill('SIGKILL'), 100) });
  }
  await sleep(4500); // the main actor runs the twelve abandoned requests one at a time; their replies go nowhere
  await alive(r, 'after twelve killed hosts');
  const held = [];
  for (let i = 0; i < 8; i++) held.push(await new Promise((ok) => { const c = connect(r.socket, () => ok(c)); c.on('error', () => {}); }));
  await sleep(100);
  assert.equal((await exchange(r.socket, [frame(envelope(ping('n')))])).frames[0]?.error, 'busy', 'exactly eight slots: none was lost to a killed host');
  for (const c of held) c.destroy();
  await r.kill();
});

test('kill -9 of the relay in the middle of a request: the host answers at once, then not-running, and a restart serves again', async () => {
  const root = fresh('k9');
  const r = await relay({ root, env: { PSSS_STANDIN_DELAY_MS: '3000' } });
  const started = Date.now();
  const during = await host(r.socket, [ping('mid')], { onSpawn: () => setTimeout(() => r.proc.kill('SIGKILL'), 400) });
  assert.deepEqual([during.replies[0].ok, during.replies[0].error, during.replies[0].id], [false, 'failed', 'mid']);
  assert.ok(Date.now() - started < 2500, 'the host does not wait out its deadline for a dead relay');
  assert.equal(during.code, 0);
  assert.equal((await host(r.socket, [ping('after')])).replies[0].error, 'not-running');
  const again = await relay({ root, store: r.store });
  assert.equal(again.failed, undefined);
  assert.equal((await host(again.socket, [ping('again')])).replies[0].ok, true);
  await again.kill();
});

// ---- R2: candidates, search, credential and generate from the vault a request names, and the offer ledger ----------------------

const SITE = 'https://gitforge.example';
/** Two vaults open (Passwords and Work) while a third, Archive (locked), is the one the app shows. */
function twoOpen() {
  const store = fresh('two');
  writeFileSync(join(store, 'vaults.json'), JSON.stringify({ active: 'archive', open: ['passwords', 'work'] }));
  return store;
}
const req = (type, fields = {}) => ({ v: 5, id: type, type, ...fields });
const candidatesOf = async (r, vault, origin) => (await ask(r.socket, req('candidates', { vault, origin }))).candidates ?? [];
const credential = (r, fields) => ask(r.socket, req('credential', fields));
const SECRETS = ['Demo-only-Sample1!', 'Demo-only-Work1!', 'Demo-only-Work2!', 'Demo-only-Sample2!', 'Demo-only-Maple7!'];

test('two vaults open while another is shown: each fills from its own vault, a locked one gives nothing, nothing is switched', async () => {
  const r = await relay({ store: twoOpen() });
  const list = (await ask(r.socket, req('vaults'))).vaults.map((v) => `${v.id}:${v.state}:${v.active}`);
  assert.deepEqual(list.slice(0, 3), ['passwords:open:false', 'work:open:false', 'archive:locked:true']);
  const work = await candidatesOf(r, 'work', SITE);
  assert.deepEqual(work.map((c) => c.title), ['Gitforge (work)']);
  const mine = await candidatesOf(r, 'passwords', 'http://localhost:8080');
  assert.equal(mine.length, 1);
  const fromWork = await credential(r, { ref: work[0].ref, origin: SITE, vault: 'work' });
  assert.deepEqual([fromWork.ok, fromWork.secret, fromWork.account], [true, 'Demo-only-Work1!', 'sam@harbor.example']);
  const fromPasswords = await credential(r, { ref: mine[0].ref, origin: 'http://localhost:8080', vault: 'passwords' });
  assert.deepEqual([fromPasswords.ok, fromPasswords.secret], [true, 'Demo-only-Sample1!']);
  for (const type of ['candidates', 'search']) {
    const reply = await ask(r.socket, req(type, { vault: 'archive', origin: SITE, query: 'git' }));
    assert.deepEqual([reply.ok, reply.error, reply.candidates, reply.results], [false, 'locked', undefined, undefined], type);
  }
  const locked = await credential(r, { ref: work[0].ref, origin: SITE, vault: 'archive' });
  assert.deepEqual([locked.ok, locked.error, locked.secret, locked.fields], [false, 'locked', undefined, undefined]);
  assert.equal((await ask(r.socket, req('vaults'))).vaults.find((v) => v.active).id, 'archive', 'the shown vault did not change');
  await r.kill();
});

test('a credential is released only for a login the app has just shown for this page: a bare ref is nothing', async () => {
  const store = twoOpen();
  const r = await relay({ store });
  // Learn a real ref from a relay that is not this one's ledger: a second relay on the same store lists it, this one is never asked.
  const other = await relay({ store });
  const ref = (await candidatesOf(other, 'work', SITE))[0].ref;
  await other.kill();
  for (const manual of [false, true, 'true', 1]) {
    const reply = await credential(r, { ref, origin: SITE, vault: 'work', manual });
    assert.deepEqual([reply.ok, reply.error, reply.secret, reply.account, reply.fields], [false, 'not-found', undefined, undefined, undefined], `manual=${manual}`);
  }
  assert.equal((await candidatesOf(r, 'work', SITE))[0].ref, ref);
  assert.equal((await credential(r, { ref, origin: SITE, vault: 'work' })).secret, 'Demo-only-Work1!', 'after it is listed, it is released');
  // The offer is for that page: another site's page with the same ref gets nothing, with or without manual.
  for (const origin of ['https://other.example', 'https://gitforge.example.evil.example', 'https://sub.gitforge.example']) {
    for (const manual of [false, true]) {
      const reply = await credential(r, { ref, origin, vault: 'work', manual });
      assert.equal(reply.ok, false, `${origin} manual=${manual}`);
      assert.equal(reply.secret, undefined);
    }
  }
  await alive(r);
  await r.kill();
});

test('Other Matches: manual releases only a login a search on this page returned, never on plain http outside localhost', async () => {
  const r = await relay({ store: twoOpen() });
  const search = (fields) => ask(r.socket, req('search', { vault: 'passwords', ...fields }));
  // A login saved for another site is listed by candidates for nothing: manual without a search is refused.
  const found = await search({ origin: SITE, query: 'google' });
  const other = found.results.find((x) => x.website === 'google.com');
  assert.equal(other.matches, false);
  const mine = await candidatesOf(r, 'passwords', 'http://localhost:8080');
  const viaList = await credential(r, { ref: mine[0].ref, origin: SITE, vault: 'passwords', manual: true });
  assert.deepEqual([viaList.ok, viaList.error], [false, 'not-found'], 'a candidates list for another page offered nothing here');
  // Without manual, a login saved for another site is refused by the origin rule even though a search showed it.
  const plain = await credential(r, { ref: other.ref, origin: SITE, vault: 'passwords' });
  assert.deepEqual([plain.ok, plain.error, plain.secret], [false, 'forbidden', undefined]);
  for (const manual of ['true', 1, null, [true]]) {
    const wrong = await credential(r, { ref: other.ref, origin: SITE, vault: 'passwords', manual });
    assert.deepEqual([wrong.ok, wrong.error, wrong.secret], [false, 'forbidden', undefined], `manual=${JSON.stringify(manual)}`);
  }
  const filled = await credential(r, { ref: other.ref, origin: SITE, vault: 'passwords', manual: true });
  assert.deepEqual([filled.ok, filled.secret], [true, 'Demo-only-Sample2!']);
  // Plain http is refused for the search and for the fill, whatever the ref.
  for (const origin of ['http://gitforge.example', 'http://192.168.0.7', 'http://localhost.evil.example']) {
    assert.equal((await search({ origin, query: 'google' })).error, 'forbidden', origin);
    const reply = await credential(r, { ref: other.ref, origin, vault: 'passwords', manual: true });
    assert.deepEqual([reply.ok, reply.error, reply.secret], [false, 'forbidden', undefined], origin);
  }
  const local = await search({ origin: 'http://localhost:3000', query: 'google' });
  assert.equal((await credential(r, { ref: local.results[0].ref, origin: 'http://localhost:3000', vault: 'passwords', manual: true })).ok, true, 'localhost may be filled over http');
  // Another vault's id never reaches this vault's login.
  const crossed = await credential(r, { ref: other.ref, origin: SITE, vault: 'work', manual: true });
  assert.deepEqual([crossed.ok, crossed.error], [false, 'not-found']);
  await alive(r);
  await r.kill();
});

test('a ref from one open vault sent with another open vault’s id is not found, even when the other vault was searched', async () => {
  const r = await relay({ store: twoOpen() });
  const work = (await candidatesOf(r, 'work', SITE))[0];
  const searched = await ask(r.socket, req('search', { vault: 'passwords', origin: SITE, query: 'localhost' }));
  const mine = searched.results[0];
  for (const [ref, vault] of [[work.ref, 'passwords'], [mine.ref, 'work']]) {
    for (const manual of [false, true]) {
      const reply = await credential(r, { ref, origin: SITE, vault, manual });
      assert.deepEqual([reply.ok, reply.error, reply.secret, reply.account], [false, 'not-found', undefined, undefined], `${vault} manual=${manual}`);
    }
  }
  await r.kill();
});

test('an offer expires after five minutes and the ledger is emptied by a lock (injected clock and signal)', async () => {
  const r = await relay({ store: twoOpen() });
  const first = (await candidatesOf(r, 'work', SITE))[0];
  assert.equal((await credential(r, { ref: first.ref, origin: SITE, vault: 'work' })).ok, true);
  r.proc.kill('SIGUSR2'); // the ledger's clock moves six minutes on
  await sleep(300);
  const expired = await credential(r, { ref: first.ref, origin: SITE, vault: 'work' });
  assert.deepEqual([expired.ok, expired.error, expired.secret], [false, 'not-found', undefined], 'an expired offer releases nothing');
  const again = (await candidatesOf(r, 'work', SITE))[0];
  assert.equal((await credential(r, { ref: again.ref, origin: SITE, vault: 'work' })).ok, true, 'a new list offers it again');
  const searched = await ask(r.socket, req('search', { vault: 'passwords', origin: SITE, query: 'google' }));
  r.proc.kill('SIGUSR2'); await sleep(300);
  const manual = await credential(r, { ref: searched.results[0].ref, origin: SITE, vault: 'passwords', manual: true });
  assert.equal(manual.error, 'not-found', 'a searched offer expires too');
  // A lock, sleep or screen lock empties it at once.
  const fresh1 = (await candidatesOf(r, 'work', SITE))[0];
  r.proc.kill('SIGUSR1'); await sleep(300);
  const cleared = await credential(r, { ref: fresh1.ref, origin: SITE, vault: 'work' });
  assert.deepEqual([cleared.ok, cleared.error, cleared.secret], [false, 'not-found', undefined], 'a cleared ledger releases nothing');
  await alive(r);
  await r.kill();
});

test('a vault locked between search and fill answers locked, never another vault’s data, and the other open vault still serves', async () => {
  const store = twoOpen();
  const r = await relay({ store });
  const work = (await candidatesOf(r, 'work', SITE))[0];
  const mine = (await candidatesOf(r, 'passwords', 'http://localhost:8080'))[0];
  writeFileSync(join(store, 'vaults.json'), JSON.stringify({ active: 'archive', open: ['passwords'] })); // Work locks
  const raced = await credential(r, { ref: work.ref, origin: SITE, vault: 'work' });
  assert.deepEqual([raced.ok, raced.error, raced.secret, raced.account, raced.fields], [false, 'locked', undefined, undefined, undefined]);
  assert.ok(!JSON.stringify(raced).includes('Demo-only'));
  const wrongVault = await credential(r, { ref: work.ref, origin: SITE, vault: 'passwords' });
  assert.equal(wrongVault.error, 'not-found', 'Passwords does not answer in Work’s place');
  assert.equal((await credential(r, { ref: mine.ref, origin: 'http://localhost:8080', vault: 'passwords' })).secret, 'Demo-only-Sample1!');
  for (const type of ['candidates', 'search']) assert.equal((await ask(r.socket, req(type, { vault: 'work', origin: SITE, query: 'git' }))).error, 'locked');
  await r.kill();
});

test('generate is made in the app: a different strong password each time, and it is in no log or file', async () => {
  const r = await relay();
  const made = [];
  for (let i = 0; i < 5; i++) { const reply = await ask(r.socket, req('generate')); assert.equal(reply.ok, true); made.push(reply.password); }
  assert.equal(new Set(made).size, 5);
  assert.ok(made.every((p) => typeof p === 'string' && p.length >= 12));
  const reply = await ask(r.socket, req('generate', { vault: 7, origin: { a: 1 }, extra: 'x'.repeat(5000) }));
  assert.equal(reply.ok, true, 'extra and wrongly typed fields are ignored');
  await r.kill();
  const everything = [r.stdout(), r.stderr(), ...readdirSync(join(r.root, 'Relay')).map((f) => f)].join('\n');
  for (const password of made) assert.ok(!everything.includes(password));
});

test('hostile values in every new field get a plain error and never a secret or a crash', async () => {
  const r = await relay({ store: twoOpen() });
  const ref = (await candidatesOf(r, 'work', SITE))[0].ref;
  await ask(r.socket, req('search', { vault: 'passwords', origin: SITE, query: 'google' }));
  const long = (n) => 'x'.repeat(n);
  const bad = [undefined, null, 7, true, [ref], { ref }, '', long(65), long(10000), '../../etc/passwd', `${ref}\n`, `${ref}\u202e`, '\u0000'];
  for (const value of bad) {
    for (const field of ['ref', 'vault', 'origin']) {
      const request = { ref, vault: 'work', origin: SITE, [field]: value };
      const reply = await credential(r, request);
      assert.equal(reply.ok, false, `${field}=${JSON.stringify(value)?.slice(0, 30)}`);
      assert.ok(['not-found', 'forbidden'].includes(reply.error), `${field}: ${reply.error}`);
      assert.ok(!SECRETS.some((s) => JSON.stringify(reply).includes(s)));
    }
    for (const type of ['candidates', 'search']) {
      const reply = await ask(r.socket, req(type, { vault: 'work', origin: SITE, query: value, fields: value, ref: value }));
      assert.ok(typeof reply.ok === 'boolean' && reply.v === 5, `${type} ${JSON.stringify(value)?.slice(0, 30)}`);
      assert.ok(!SECRETS.some((s) => JSON.stringify(reply).includes(s)));
    }
  }
  for (const fields of [[7], [null], ['name', 7], 'name', { a: 1 }, Array(500).fill('name'), [long(10000)]]) {
    const reply = await ask(r.socket, req('search', { vault: 'work', origin: SITE, query: 'git', fields }));
    assert.equal(reply.ok, true, JSON.stringify(fields).slice(0, 40));
  }
  assert.equal((await ask(r.socket, req('search', { vault: 'work', origin: SITE, query: long(101) }))).results.length, 0, 'an over-long query finds nothing');
  assert.equal((await credential(r, { ref: long(10000), origin: SITE, vault: 'work', manual: true })).error, 'not-found');
  assert.equal((await credential(r, { ref, origin: SITE, vault: 'work' })).secret, 'Demo-only-Work1!', 'hostile requests changed nothing');
  await alive(r);
  await r.kill();
});

test('twenty concurrent fills across two open vaults each get their own vault’s answer', async () => {
  const r = await relay({ store: twoOpen() });
  const work = (await candidatesOf(r, 'work', SITE))[0];
  const mine = (await candidatesOf(r, 'passwords', 'http://localhost:8080'))[0];
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2
    ? credential(r, { ref: work.ref, origin: SITE, vault: 'work' })
    : credential(r, { ref: mine.ref, origin: 'http://localhost:8080', vault: 'passwords' })));
  replies.forEach((reply, i) => {
    if (reply?.error === 'busy') return;
    assert.equal(reply.secret, i % 2 ? 'Demo-only-Work1!' : 'Demo-only-Sample1!', `request ${i}`);
  });
  await alive(r);
  await r.kill();
});

// ---- what the replies say ------------------------------------------------------------------------------------------

test('hostile vault names reach the host as one short safe line, and the list never carries a secret', async () => {
  const store = fresh('hostile');
  const names = ['Work‮gpj.exe', 'Two\nLines\r\n', '../../etc/passwd', '<img src=x onerror=alert(1)>', 'x'.repeat(10000), '​⁦⁩', 'Tab\tName', '\u0000nul', 'ok'];
  writeFileSync(join(store, 'vaults.json'), JSON.stringify({ vaults: names.map((n, i) => ({ id: `v${i}`, name: n, location: n })) }));
  const r = await relay({ store });
  const reply = (await host(r.socket, [{ v: 5, id: 'vl', type: 'vaults' }])).replies[0];
  assert.equal(reply.ok, true); assert.equal(reply.vaults.length, names.length);
  for (const v of reply.vaults) for (const field of ['name', 'location']) {
    assert.doesNotMatch(v[field], /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\u061c]/u, `${field}: ${JSON.stringify(v[field])}`);
    assert.ok([...v[field]].length <= 80);
  }
  assert.equal(reply.vaults[2].name, '../../etc/passwd', 'a path-like name is text, never a path');
  assert.equal(reply.vaults[5].name, 'Vault'); assert.ok(!JSON.stringify(reply).includes('Demo-only'));
  assert.ok(reply.vaults.every((v) => v.id.length <= 64));
  await r.kill();
});

test('no secret in any log, output, folder or reply except the ones that are meant to carry it', async () => {
  const store = fresh('secrets');
  const r = await relay({ store });
  const known = ['Demo-only-Sample1!', 'Demo-only-Work1!', 'Demo-only-Work2!', '4242424242424242', '5555555555554444'];
  const typed = 'Typed-fixture-secret-9f3a!'; // sent in a `save`, and read back by a `credential`
  const messages = [
    ping('1'), { v: 5, id: '2', type: 'vaults' }, { v: 5, id: '3', type: 'candidates', vault: 'passwords', origin: 'http://localhost:8080' },
    { v: 5, id: '4', type: 'search', vault: 'passwords', origin: 'http://localhost:8080', query: 'local' }, { v: 5, id: '5', type: 'card-candidates', vault: 'passwords', origin: 'https://shop.example' },
    { v: 5, id: '6', type: 'switch-vault', vault: 'work' }, { v: 5, id: '7', type: 'unlock-vault', vault: 'work' },
    { v: 5, id: '8', type: 'save', vault: 'passwords', origin: 'http://localhost:8080', account: 'fixture@example.net', secret: typed },
    { v: 5, id: '9', type: 'save', vault: 'work', origin: 'https://gitforge.example', account: 'refused@example.net', secret: typed + 'x', extra: 'y'.repeat(50) },
    { v: 5, id: '10', type: 'candidates', vault: 'work', origin: 'https://gitforge.example' }, { v: 5, id: '11', type: 'search', vault: 'work', origin: 'https://gitforge.example', query: 'ledger' },
    { v: 5, id: '12', type: 'credential', vault: 'work', ref: 'nothing', origin: 'https://gitforge.example' }, { v: 5, id: '13', type: 'card', vault: 'passwords', ref: 'sample-card-0', origin: 'https://shop.example' },
  ];
  const out = await host(r.socket, messages);
  const secretFree = out.replies.filter((x) => x.id !== 'c1');
  assert.ok(secretFree.length >= messages.length - 1);
  const firstCandidates = out.replies.find((x) => x.id === '3').candidates;
  const credential = await host(r.socket, [{ v: 5, id: 'c1', type: 'credential', vault: 'passwords', ref: firstCandidates[0].ref, origin: 'http://localhost:8080' }]);
  assert.equal(credential.replies[0].ok, true); assert.ok(credential.replies[0].secret, 'the credential reply is the one that carries the password');
  for (const reply of secretFree) for (const secret of [...known, typed]) assert.ok(!JSON.stringify(reply).includes(secret), `${reply.id}: no secret in this reply`);
  for (const bad of ['unsupported-request', '\u0000']) await ask(r.socket, { v: 5, id: bad, type: bad });
  const everything = [out.stderr, credential.stderr, r.stdout(), r.stderr()].join('\n');
  for (const secret of [...known, typed, 'refused@example.net']) assert.ok(!everything.includes(secret), `no ${secret.slice(0, 8)}… in any stdout or stderr`);
  for (const file of readdirSync(join(r.root, 'Relay'))) if (statSync(join(r.root, 'Relay', file)).isFile()) assert.ok(!readFileSync(join(r.root, 'Relay', file)).includes('Demo-only'), `the relay folder holds no secret (${file})`);
  assert.deepEqual(readdirSync(join(r.root, 'Relay')).sort(), ['browser.sock', 'relay.lock'], 'the relay folder holds no state file');
  await r.kill();
  const unified = spawnSync('/usr/bin/log', ['show', '--last', '2m', '--predicate', 'subsystem == "app.psss"', '--style', 'compact'], { encoding: 'utf8', timeout: 20000 });
  if (unified.status === 0) for (const secret of [...known, typed]) assert.ok(!unified.stdout.includes(secret), 'no secret in the unified log');
});

// ---- R4: save --------------------------------------------------------------------------------------------------------------------

const savedLogins = (store, vault) => {
  const file = join(store, vault === 'passwords' ? 'saved-logins.json' : `saved-logins-${vault}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
};
const save = (r, fields) => ask(r.socket, req('save', { vault: 'work', origin: SITE, account: 'new@example.net', secret: 'Typed-secret-1', ...fields }));
const SAVE_SECRETS = ['Typed-secret-1', 'Typed-secret-2', 'Changed-secret-9'];

test('save: a new login goes into the open vault the request names, whichever vault is shown, and needs no offer', async () => {
  const store = twoOpen(); // Archive (locked) is the one the app shows
  const r = await relay({ store });
  const made = await save(r, { account: 'fresh@example.net', secret: 'Typed-secret-1' });
  assert.deepEqual([made.ok, made.result, made.vault], [true, 'created', 'work']);
  assert.ok(!SAVE_SECRETS.some((s) => JSON.stringify(made).includes(s)), 'the reply carries no secret');
  const [saved] = savedLogins(store, 'work');
  assert.deepEqual([saved.account, saved.website, saved.title, saved.secret], ['fresh@example.net', 'gitforge.example', 'gitforge.example', 'Typed-secret-1']);
  assert.deepEqual(savedLogins(store, 'passwords'), [], 'another open vault is not written');
  const listed = await candidatesOf(r, 'work', SITE);
  assert.ok(listed.some((c) => c.account === 'fresh@example.net'), 'the new login is offered for its site');
  // Whitespace around the username is trimmed, as the popup does.
  assert.equal((await save(r, { account: '  spaced@example.net  ' })).result, 'created');
  assert.equal(savedLogins(store, 'work').at(-1).account, 'spaced@example.net');
  await alive(r);
  await r.kill();
});

test('save: an update needs the login to have been offered for this page, and changes only the password', async () => {
  const store = twoOpen();
  const r = await relay({ store });
  const update = { account: 'sam@harbor.example', secret: 'Changed-secret-9' };
  const missing = await save(r, update);
  assert.deepEqual([missing.ok, missing.error, missing.result], [false, 'not-found', undefined], 'nothing offered it: not found');
  assert.deepEqual(savedLogins(store, 'work'), [], 'and nothing was written');
  // Offered for another page, or in another vault, is not an offer for this one.
  await candidatesOf(r, 'work', 'https://other.example');
  await candidatesOf(r, 'passwords', SITE);
  assert.equal((await save(r, update)).error, 'not-found');
  const [offered] = await candidatesOf(r, 'work', SITE);
  assert.deepEqual([offered.title, offered.account], ['Gitforge (work)', 'sam@harbor.example']);
  const done = await save(r, update);
  assert.deepEqual([done.ok, done.result, done.vault], [true, 'updated', 'work']);
  const [after] = savedLogins(store, 'work');
  assert.deepEqual([after.title, after.account, after.website, after.secret], ['Gitforge (work)', 'sam@harbor.example', 'gitforge.example', 'Changed-secret-9']);
  assert.equal(savedLogins(store, 'work').length, 1, 'still one login');
  assert.deepEqual(savedLogins(store, 'passwords'), []);
  // A cleared or expired ledger ends the offer.
  r.proc.kill('SIGUSR1'); await sleep(300);
  assert.equal((await save(r, { ...update, secret: 'Typed-secret-2' })).error, 'not-found', 'a cleared ledger');
  await candidatesOf(r, 'work', SITE);
  r.proc.kill('SIGUSR2'); await sleep(300);
  assert.equal((await save(r, { ...update, secret: 'Typed-secret-2' })).error, 'not-found', 'an expired offer');
  assert.equal(savedLogins(store, 'work')[0].secret, 'Changed-secret-9', 'refused updates changed nothing');
  await r.kill();
});

test('save: a vault that is locked, not available or unknown is not written, and nothing else is written instead', async () => {
  const store = twoOpen();
  const r = await relay({ store });
  const cases = [['archive', 'locked'], ['travel', 'not-available'], ['nope', 'not-found'], ['', 'not-found'], [null, 'not-found'], [7, 'not-found'], ['x'.repeat(65), 'not-found']];
  for (const [vault, error] of cases) {
    const reply = await save(r, { vault });
    assert.deepEqual([reply.ok, reply.error], [false, error], JSON.stringify(vault));
  }
  const noVault = await ask(r.socket, req('save', { origin: SITE, account: 'a@b.c', secret: 'Typed-secret-1' }));
  assert.equal(noVault.error, 'not-found');
  writeFileSync(join(store, 'vaults.json'), JSON.stringify({ active: 'archive', open: ['passwords'] })); // Work locks
  assert.equal((await save(r, { vault: 'work' })).error, 'locked', 'locked between the list and the save');
  assert.deepEqual(readdirSync(store).filter((f) => f.startsWith('saved-logins')), [], 'no file was written anywhere');
  await r.kill();
});

test('save: limits and hostile values get a plain error and write nothing', async () => {
  const store = twoOpen();
  const r = await relay({ store });
  const bad = ['', '   ', 'a\nb', 'a\r\nb', 'a‮b', 'a⁦b', 'a​b', 'a‍b', 'a\u0000b', 'a b', 'a\u0085b', 'ab', 'x'.repeat(321), 'x'.repeat(10000), 7, null, true, ['a@b.c'], { a: 1 }];
  for (const account of bad) {
    const reply = await save(r, { account });
    assert.deepEqual([reply.ok, reply.error], [false, 'unsupported'], `account ${JSON.stringify(account)?.slice(0, 40)}`);
  }
  for (const secret of ['', 7, null, ['x'], { a: 1 }, 'y'.repeat(1025), 'y'.repeat(10000), 'y'.repeat(60000)]) {
    const reply = await save(r, { secret });
    assert.deepEqual([reply.ok, reply.error], [false, 'unsupported'], `secret ${JSON.stringify(secret)?.slice(0, 30)}`);
  }
  for (const origin of ['http://gitforge.example', 'http://192.168.0.7', 'http://localhost.evil.example', 'ftp://gitforge.example', 'javascript:alert(1)', 'https://user:pw@gitforge.example', 'https://', '', 7, null, `https://${'a'.repeat(300)}.example`]) {
    const reply = await save(r, { origin });
    assert.deepEqual([reply.ok, reply.error], [false, 'forbidden'], `origin ${JSON.stringify(origin)?.slice(0, 40)}`);
  }
  assert.deepEqual(readdirSync(store).filter((f) => f.startsWith('saved-logins')), [], 'nothing was written by any of them');
  // The edges are accepted.
  const longest = await save(r, { account: 'x'.repeat(320), secret: 'y'.repeat(1024) });
  assert.deepEqual([longest.ok, longest.result], [true, 'created']);
  assert.equal((await save(r, { account: 'tab\tinside@example.net', secret: 's' })).error, 'unsupported', 'a tab is a control character too');
  for (const origin of ['http://localhost:8080', 'http://127.0.0.1:3000']) assert.equal((await save(r, { origin, account: `l-${origin.length}@example.net` })).ok, true, origin);
  assert.deepEqual(savedLogins(store, 'work').map((i) => i.account.length), [320, 'l-21@example.net'.length, 'l-21@example.net'.length], 'only the accepted logins are in the file');
  await alive(r);
  assert.ok(!SAVE_SECRETS.some((s) => r.output().includes(s)) && !r.output().includes('y'.repeat(50)), 'no secret in the relay output');
  await r.kill();
});

test('save: two saves at once are both written, and the same new login twice is one login', async () => {
  const store = twoOpen();
  const r = await relay({ store });
  for (let round = 0; round < 3; round++) {
    const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => save(r, { vault: i % 2 ? 'work' : 'passwords', account: `p${round}-${i}@example.net`, secret: `S-${round}-${i}` })));
    assert.ok(replies.every((x) => x.ok && x.result === 'created'), JSON.stringify(replies.map((x) => x.error)));
  }
  const accounts = (vault) => savedLogins(store, vault).map((i) => i.account).sort();
  assert.equal(accounts('work').length, 9); assert.equal(accounts('passwords').length, 9);
  const same = await Promise.all(Array.from({ length: 6 }, (_, i) => save(r, { account: 'twin@example.net', secret: `Twin-${i}` })));
  assert.deepEqual(same.filter((x) => x.ok).map((x) => x.result), ['created'], 'one is created');
  assert.ok(same.filter((x) => !x.ok).every((x) => x.error === 'not-found'), 'the others find it and, never offered it, change nothing');
  assert.equal(savedLogins(store, 'work').filter((i) => i.account === 'twin@example.net').length, 1);
  await alive(r);
  await r.kill();
});

// The same code over REAL encrypted vaults (Tests/Relay/VaultRelay): `kill -9` in the middle of saves, then the files are opened again.
const VAULT_RELAY = process.env.PSSS_VAULT_RELAY;
const vaultEnv = (data) => ({ ...process.env, PSSS_TEST_ROOT: data, PSSS_VAULT_PASSWORD: 'pw-fixture-7Hq2-relay-save' });
function vaultServer(data, directory) {
  const proc = spawn(VAULT_RELAY, ['serve', '--directory', directory], { env: vaultEnv(data), stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(proc);
  let out = '', err = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  const closed = new Promise((done) => proc.once('close', () => { running.delete(proc); done(); }));
  const ready = new Promise((ok, no) => {
    const poll = setInterval(() => { if (out.startsWith('ready ')) { clearInterval(poll); ok(); } }, 20);
    proc.once('close', () => { clearInterval(poll); no(new Error(`the vault relay stopped: ${err}`)); });
  });
  return { proc, ready, closed, socket: join(directory, 'browser.sock'), output: () => out + err, async kill() { proc.kill('SIGKILL'); await closed; } };
}
const vaultTool = (data, ...args) => spawnSync(VAULT_RELAY, args, { env: vaultEnv(data), encoding: 'utf8', timeout: 120000 });
const vaultItems = (data, id) => {
  const out = vaultTool(data, 'check', '--vault', id);
  assert.equal(out.status, 0, `the vault file opens again: ${out.stderr}`);
  return JSON.parse(out.stdout);
};

test('save over real vaults: kill -9 of the app in the middle of saves leaves each vault file whole, every acknowledged save in it', { timeout: 300000 }, async () => {
  assert.ok(VAULT_RELAY && existsSync(VAULT_RELAY), 'build it first: scripts/test-relay.sh does');
  const data = fresh('data'), directory = join(fresh('vr'), 'Relay');
  const prepared = vaultTool(data, 'prepare');
  assert.equal(prepared.status, 0, prepared.stderr);
  const [, idA, idB] = prepared.stdout.trim().split(' ');
  const acknowledged = new Set();
  let attempted = 0;
  for (let round = 0; round < 4; round++) {
    const server = vaultServer(data, directory);
    await server.ready;
    const probe = await ask(server.socket, req('vaults'));
    assert.deepEqual(probe.vaults.map((v) => v.state), ['open', 'open'], 'both vaults are open in the app');
    // Saves go one after the other into vault A while the server is killed at a different moment each round.
    const killAt = [150, 40, 300, 90][round] + Math.floor(Math.random() * 60);
    const killer = sleep(killAt).then(() => server.kill());
    for (let i = 0; i < 400 && server.proc.exitCode === null && server.proc.signalCode === null; i++) {
      const account = `k${round}-${i}@example.net`;
      attempted++;
      const reply = await ask(server.socket, req('save', { vault: idA, origin: SITE, account, secret: `Typed-secret-${round}-${i}` })).catch(() => undefined);
      if (reply?.ok === true && reply.result === 'created') acknowledged.add(account);
    }
    await killer;
    assert.ok(server.proc.signalCode === 'SIGKILL', 'the app was killed, not stopped');
    const a = vaultItems(data, idA);
    const found = new Set(a.items.map((x) => x.account));
    for (const account of acknowledged) assert.ok(found.has(account), `${account} was acknowledged and is in the file`);
    assert.ok(found.size <= 1 + attempted, 'nothing that was never sent');
    assert.equal(found.size, a.items.length, 'no login twice');
    assert.equal(a.items.find((x) => x.account === 'a@example.net')?.secret, 'Seed-A-secret-1', 'the first login is untouched');
    assert.ok(a.items.filter((x) => x.account !== 'a@example.net').every((x) => x.website === 'gitforge.example' && x.title === 'gitforge.example'));
    const b = vaultItems(data, idB);
    assert.deepEqual(b.items.map((x) => [x.account, x.secret]), [['b@example.net', 'Seed-B-secret-1']], 'the other vault was never written');
    assert.ok(a.items.length > 1 || round > 0, 'the first round saved at least one login before it was killed');
  }
  assert.ok(acknowledged.size > 0, 'some saves were acknowledged');
  // The vault files are encrypted: no secret, account or password in any file under the test root, or in the relay's output.
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) f.isDirectory() ? walk(join(dir, f.name)) : files.push(join(dir, f.name)); };
  walk(data);
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const secret of ['Typed-secret-0-0', 'Seed-A-secret-1', 'pw-fixture-7Hq2-relay-save', 'k0-0@example.net']) assert.ok(!bytes.includes(secret), `no ${secret.slice(0, 8)}… in ${file.replace(data, '')}`);
  }
});

test('save over real vaults: two saves at once make one login, an update needs an offer, a lock is honoured', { timeout: 120000 }, async () => {
  assert.ok(VAULT_RELAY && existsSync(VAULT_RELAY), 'build it first: scripts/test-relay.sh does');
  const data = fresh('data'), directory = join(fresh('vr'), 'Relay');
  const [, idA, idB] = vaultTool(data, 'prepare').stdout.trim().split(' ');
  const server = vaultServer(data, directory);
  await server.ready;
  const send = (fields) => ask(server.socket, req('save', { origin: SITE, ...fields }));
  const same = await Promise.all(Array.from({ length: 6 }, (_, i) => send({ vault: idB, account: 'twin@example.net', secret: `Twin-secret-${i}` })));
  assert.deepEqual(same.filter((x) => x.ok).map((x) => x.result), ['created']);
  assert.ok(same.filter((x) => !x.ok).every((x) => x.error === 'not-found'));
  assert.equal(vaultItems(data, idB).items.filter((x) => x.account === 'twin@example.net').length, 1);
  // The seed login of A: an update without an offer is not found; after the page's list, it changes the password only and keeps the old one in its history.
  const update = { vault: idA, account: 'a@example.net', secret: 'Changed-secret-9' };
  assert.equal((await send(update)).error, 'not-found');
  assert.equal(vaultItems(data, idA).items[0].secret, 'Seed-A-secret-1');
  const listed = await ask(server.socket, req('candidates', { vault: idA, origin: SITE }));
  assert.equal(listed.candidates.length, 1);
  assert.deepEqual([(await send(update)).result], ['updated']);
  const a = vaultItems(data, idA);
  assert.deepEqual(a.items.map((x) => [x.title, x.account, x.website, x.secret]), [['Gitforge (A)', 'a@example.net', 'gitforge.example', 'Changed-secret-9']]);
  assert.deepEqual(a.history, [1], 'the old password is in the history, as the app keeps it');
  assert.equal(vaultItems(data, idB).items.length, 2, 'B is as it was');
  assert.ok(!SAVE_SECRETS.concat(['Twin-secret-0']).some((s) => server.output().includes(s)), 'no secret in the output');
  await server.kill();
});

// ---- the Safari extension as a relay client (R5) -----------------------------------------------------------------------

// `psss-relay-vault safari` runs the Safari extension's own logic (`SafariRelay`, App/Core/SafariRelay.swift) for one message,
// without the app check (an ad hoc client), over a relay that may not exist. The raw socket tests above and below stand for what the
// app does with the Safari peer: its kind comes from the signature (injected here as `safari` or `safari-cdhash:`), never the message.
const safariAsk = (data, socket, message, launch = 'no') => {
  const out = spawnSync(VAULT_RELAY, ['safari', '--socket', socket, '--message', JSON.stringify(message), '--launch', launch], { env: vaultEnv(data), encoding: 'utf8', timeout: 30000 });
  assert.equal(out.status, 0, `the Safari client ran: ${out.stderr}`);
  return JSON.parse(out.stdout);
};
const cdhash = (binary) => /CDHash=([0-9a-f]+)/.exec(spawnSync('codesign', ['-d', '-vvv', binary], { encoding: 'utf8' }).stderr)?.[1];

test('Safari peer: its caller is fixed to the one name Safari has, and it cannot claim a Chrome origin or the Firefox id', async () => {
  const r = await relay({ env: { PSSS_STANDIN_PEER: 'safari' }, args: ['--callers', 'compiled'] });
  assert.deepEqual([(await ask(r.socket, ping('s'), { caller: 'safari' })).ok], [true]);
  const served = await ask(r.socket, { v: 5, id: 'v', type: 'vaults' }, { caller: 'safari' });
  assert.deepEqual([served.ok, served.vaults.length > 0], [true, true], 'a Safari peer is served the browser protocol');
  for (const caller of [CALLER, 'chrome-extension://edkafkibdigcfaipfibhgakgaphaicof/', 'passwords@psss.app', 'Safari', 'safari ', 'Safari-extension', 'x']) {
    const reply = await ask(r.socket, ping('c'), { caller });
    assert.deepEqual([reply.ok, reply.error, reply.id], [false, 'forbidden', 'c'], JSON.stringify(caller));
  }
  // A caller that is not even text, or empty, is not a Safari caller either.
  for (const caller of [7, null, '', ['safari'], 'safari\n']) assert.equal((await ask(r.socket, ping('c'), { caller })).ok, false, JSON.stringify(caller));
  assert.deepEqual([r.proc.exitCode, r.proc.signalCode], [null, null]);
  await r.kill();
});

test('native host peer: it cannot claim to be Safari, whatever the message says', async () => {
  const r = await relay({ args: ['--callers', 'compiled'] });
  for (const caller of ['safari', 'Safari', 'safari-web-extension']) assert.deepEqual([(await ask(r.socket, ping('n'), { caller })).error], ['forbidden'], caller);
  assert.equal((await ask(r.socket, ping('n'), { caller: 'passwords@psss.app' })).ok, true);
  await r.kill();
});

test('Safari peer by code signature: the client the policy names is served as Safari, a host is not, and Safari is not served as a host', async (t) => {
  if (!VAULT_RELAY) return t.skip('PSSS_VAULT_RELAY is not set');
  const data = fresh('data');
  const wanted = cdhash(VAULT_RELAY);
  assert.ok(wanted, 'the Safari client stand-in\'s code directory hash is readable');
  const r = await relay({ env: { PSSS_STANDIN_PEER: `safari-cdhash:${wanted}` }, args: ['--callers', 'compiled'] });
  const viaClient = safariAsk(data, r.socket, { v: 5, id: 'sp', type: 'ping' });
  assert.deepEqual([viaClient.ok, viaClient.id, viaClient.app], [true, 'sp', true], 'the Safari client reaches the app through the relay');
  const asHost = await host(r.socket, [ping('h')]);
  assert.equal(asHost.replies[0].error, 'failed', 'the native host has another signature: closed with no reply');
  const other = await exchange(r.socket, [frame(envelope(ping('node'), { caller: 'safari' }))], { readFor: 1500 });
  assert.deepEqual([other.frames, other.closed], [[], true], 'another process claiming to be Safari gets nothing');
  await r.kill();
  // The same signature named as a native host: the Safari client's caller is not on the compiled list, so it is refused.
  const h = await relay({ env: { PSSS_STANDIN_PEER: `cdhash:${wanted}` }, args: ['--callers', 'compiled'] });
  const refused = safariAsk(data, h.socket, { v: 5, id: 'sp', type: 'ping' });
  assert.deepEqual([refused.ok, refused.error, refused.id], [false, 'forbidden', 'sp'], 'the signature says native host, so "safari" is not a caller it may use');
  await h.kill();
});

test('Safari client: the app’s reply goes back unchanged, for every kind of request, and nothing changes in the relay', async (t) => {
  if (!VAULT_RELAY) return t.skip('PSSS_VAULT_RELAY is not set');
  const data = fresh('data');
  const r = await relay({ env: { PSSS_STANDIN_PEER: 'safari' }, args: ['--callers', 'compiled'] });
  const vaults = { v: 5, id: 'a', type: 'vaults' };
  const direct = await ask(r.socket, vaults, { caller: 'safari' });
  assert.deepEqual(safariAsk(data, r.socket, vaults), direct, 'vaults');
  const bad = { v: 5, id: 'b', type: 'credential', vault: 'nope', origin: 'https://x.example', ref: 'r' };
  assert.deepEqual(safariAsk(data, r.socket, bad), await ask(r.socket, bad, { caller: 'safari' }), 'an error is the app’s error');
  const unknownType = safariAsk(data, r.socket, { v: 5, id: 'u', type: 'nope' });
  assert.deepEqual([unknownType.ok, unknownType.error, unknownType.id], [false, 'unsupported', 'u']);
  const old = safariAsk(data, r.socket, { v: 4, id: 'o', type: 'ping' });
  assert.deepEqual([old.ok, old.error], [false, 'unsupported'], 'a version mismatch is the protocol’s');
  // Too large for the relay (64 KiB): answered by the client, never sent.
  const huge = safariAsk(data, r.socket, { v: 5, id: 'h', type: 'search', vault: 'x', origin: 'https://x.example', query: 'q'.repeat(70 * 1024) });
  assert.deepEqual([huge.ok, huge.error, huge.id], [false, 'unsupported', 'h']);
  // Hostile text in the id comes back as it is the app’s: one plain string, no crash.
  const odd = safariAsk(data, r.socket, { v: 5, id: 'x‮\n../../' + 'y'.repeat(300), type: 'ping' });
  assert.equal(odd.ok, true);
  assert.deepEqual([r.proc.exitCode, r.proc.signalCode], [null, null]);
  await r.kill();
});

test('Safari client with no app: vaults come from the App Group (every vault locked), unlock needs the app, everything else is not running', async (t) => {
  if (!VAULT_RELAY) return t.skip('PSSS_VAULT_RELAY is not set');
  const data = fresh('data');
  const prepared = vaultTool(data, 'prepare');
  assert.equal(prepared.status, 0, prepared.stderr);
  const [, idA, idB] = prepared.stdout.trim().split(' ');
  const gone = join(fresh('none'), 'Relay/browser.sock'); // nothing there at all
  const stale = (await (async () => { const r = await relay({ env: { PSSS_STANDIN_PEER: 'safari' } }); await r.kill(); return r.socket; })()); // an app killed with kill -9 leaves its socket file
  assert.ok(existsSync(stale), 'a killed relay leaves its socket file');
  for (const socket of [gone, stale, undefined]) {
    const label = socket === undefined ? 'no group container' : socket === gone ? 'no socket' : 'a stale socket';
    const ask1 = (message, launch) => spawnSync(VAULT_RELAY, ['safari', ...(socket ? ['--socket', socket] : []), '--message', JSON.stringify(message), '--launch', launch ?? 'no'], { env: vaultEnv(data), encoding: 'utf8', timeout: 30000 });
    const run = (message, launch) => { const out = ask1(message, launch); assert.equal(out.status, 0, out.stderr); return JSON.parse(out.stdout); };
    const list = run({ v: 5, id: 'l', type: 'vaults' });
    assert.deepEqual([list.ok, list.id], [true, 'l'], label);
    assert.deepEqual(list.vaults.map((v) => v.name).sort(), ['Save A', 'Save B'], `${label}: the stored vaults`);
    assert.ok(list.vaults.every((v) => v.state !== 'open'), `${label}: none is open without the app`);
    const active = list.vaults.find((v) => v.active);
    const other = list.vaults.find((v) => !v.active);
    assert.ok(active && other);
    const needs = run({ v: 5, id: 'u', type: 'unlock-vault', vault: active.id });
    assert.deepEqual([needs.ok, needs.error, needs.id], [false, 'needs-app', 'u'], `${label}: unlock needs the app`);
    assert.ok(needs.vaults.length === 2);
    const launched = run({ v: 5, id: 'u', type: 'unlock-vault', vault: active.id }, 'yes');
    assert.deepEqual([launched.ok, launched.app], [true, 'opened'], `${label}: an app the extension could start has come forward`);
    const notCurrent = run({ v: 5, id: 'u', type: 'unlock-vault', vault: other.id }, 'yes');
    assert.equal(notCurrent.error, 'forbidden', `${label}: only the shown vault is unlocked, and the app is not launched for another`);
    assert.equal(run({ v: 5, id: 'u', type: 'unlock-vault', vault: '00000000-0000-0000-0000-000000000000' }, 'yes').error, 'not-found');
    for (const message of [
      { v: 5, id: 'p', type: 'ping' }, { v: 5, id: 'c', type: 'candidates', vault: active.id, origin: 'https://gitforge.example' },
      { v: 5, id: 's', type: 'search', vault: active.id, origin: 'https://gitforge.example', query: 'git' },
      { v: 5, id: 'k', type: 'credential', vault: active.id, origin: 'https://gitforge.example', ref: 'x' },
      { v: 5, id: 'g', type: 'generate' }, { v: 5, id: 'w', type: 'save', vault: active.id, origin: 'https://gitforge.example', account: 'a@b.c', secret: 'Never-sent-secret-1' },
      { v: 5, id: 'sw', type: 'switch-vault', vault: other.id }, { v: 5, id: 'x', type: 'nope' }]) {
      const reply = run(message, 'yes');
      assert.deepEqual([reply.ok, reply.error, reply.id], [false, 'not-running', message.id], `${label}: ${message.type}`);
    }
  }
  // Nothing was written or started by any of it, and no secret is anywhere.
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) f.isDirectory() ? walk(join(dir, f.name)) : files.push(join(dir, f.name)); };
  walk(data);
  for (const file of files) assert.ok(!readFileSync(file).includes('Never-sent-secret-1'), `no secret in ${file.replace(data, '')}`);
  void idA; void idB;
});
