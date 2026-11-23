// What a caller of the psss command can and cannot see. Each test states one claim docs/cli.md makes,
// including the claims about what does NOT protect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { HIDDEN } from '../src/mask.ts';
import { totp } from '../src/totp.ts';
import { ITEMS, SECRETS, TITLES, bench, deny, leaked, once, untilLock } from './helpers.ts';

const TOKEN = ITEMS[0].fields.token;
const NODE = process.execPath;

test('before the person allows anything, a caller sees no item, not even a name', async () => {
  const b = await bench(deny);
  try {
    const listed = await b.psss(['list']);
    const json = await b.psss(['list', '--json']);
    assert.equal(listed.code, 0);
    assert.equal(json.out.trim(), '[]');
    for (const title of TITLES) assert.ok(!(listed.all + json.all).includes(title), `list named ${title}`);
    assert.deepEqual(leaked(listed.all + json.all), []);
  } finally {
    await b.close();
  }
});

test('run: the program receives the secret and the caller does not see it', async () => {
  const b = await bench(once);
  try {
    const length = await b.psss(['run', '--env', 'TOKEN=psss://Example API/token', '--', NODE, '-e', 'console.log(process.env.TOKEN.length)']);
    assert.equal(length.code, 0);
    assert.equal(length.out.trim(), String(TOKEN.length), 'the program did not receive the secret');
    assert.deepEqual(leaked(length.all), []);

    // A program that prints its token by accident, on either stream, in pieces.
    const printed = await b.psss(['run', '--env', 'TOKEN=psss://Example API/token', '--', NODE, '-e',
      'const t=process.env.TOKEN; process.stdout.write("a "+t.slice(0,9)); setTimeout(()=>{process.stdout.write(t.slice(9)+" b\\n"); console.error("err "+t)},50)']);
    assert.equal(printed.out, `a ${HIDDEN} b\n`);
    assert.equal(printed.err, `err ${HIDDEN}\n`);
    assert.deepEqual(leaked(printed.all), []);
    assert.equal(b.asks.length, 2, 'Allow Once must ask again');
    assert.equal(b.asks[0].use, 'run');
    assert.ok(b.asks[0].detail.includes('process.env.TOKEN.length'), 'the sheet must show the whole command');
  } finally {
    await b.close();
  }
});

test('run: the exit code of the program is passed on', async () => {
  const b = await bench(once);
  try {
    const seen = await b.psss(['run', '--env', 'TOKEN=psss://Example API/token', '--', NODE, '-e', 'process.exit(7)']);
    assert.equal(seen.code, 7);
  } finally {
    await b.close();
  }
});

test('KNOWN LIMIT: masking is not a boundary. A program the caller chose can hand the secret back encoded', async () => {
  const b = await bench(once);
  try {
    const seen = await b.psss(['run', '--env', 'TOKEN=psss://Example API/token', '--', NODE, '-e', 'console.log(Buffer.from(process.env.TOKEN).toString("base64"))']);
    assert.ok(!seen.all.includes(TOKEN), 'the plain value must still be hidden');
    assert.equal(Buffer.from(seen.out.trim(), 'base64').toString(), TOKEN, 'expected the documented leak; if this fails the claim in docs/cli.md must change');
    // What stands between the person and this is the sheet: it showed the command, and offered no “until Psss locks”.
    assert.ok(b.asks[0].detail.includes('base64'));
    assert.equal(b.asks[0].canKeep, false, 'running a program must be asked for every time');
  } finally {
    await b.close();
  }
});

test('a caller cannot tell “no such item” from “the person said no” from “no such field”', async () => {
  const refused = await bench(deny);
  const missing = await bench(once);
  try {
    const args = (ref: string) => ['run', '--env', `TOKEN=${ref}`, '--', '/usr/bin/printenv', 'TOKEN'];
    const said_no = await refused.psss(args('psss://Example API/token'));
    const no_item = await missing.psss(args('psss://No Such Thing/token'));
    const no_field = await missing.psss(args('psss://Example API/nonsense'));
    assert.equal(said_no.code, 3);
    assert.deepEqual([no_item.code, no_item.all], [said_no.code, said_no.all]);
    assert.deepEqual([no_field.code, no_field.all], [said_no.code, said_no.all]);
    // The person is asked each time, so the three do not differ in time either: a missing name still shows a sheet.
    assert.equal(missing.asks.length, 2);
    assert.equal(missing.asks[0].candidates.length, 0);
  } finally {
    await refused.close();
    await missing.close();
  }
});

test('“until Psss locks” covers one caller and one item, shows in the list, and ends when Psss locks', async () => {
  const b = await bench(untilLock, () => 59_000);
  try {
    const code = (requester = 'Agent') => b.psss(['code', 'Example Shop'], { requester });
    assert.equal((await code()).out.trim(), '287082');
    await code();
    assert.equal(b.asks.length, 1, 'the same request must not ask again');
    await code('Another App');
    assert.equal(b.asks.length, 2, 'another caller must be asked for');

    const listed = await b.psss(['list']);
    assert.ok(listed.out.includes('Example Shop'), 'what was allowed is listed');
    assert.ok(!listed.out.includes('Example Bank') && !listed.out.includes('Example API'), 'what was not allowed is not');
    assert.deepEqual(leaked(listed.all), []);
    assert.equal(b.broker.kept().length, 2);

    b.broker.lock();
    const locked = await code();
    assert.equal(locked.code, 4);
    assert.equal(b.asks.length, 2, 'a locked vault asks nothing');
    b.broker.unlock();
    await code();
    assert.equal(b.asks.length, 3, 'locking must forget what was allowed');
  } finally {
    await b.close();
  }
});

test('two items with one name: the person picks in the app, and the caller never sees the other', async () => {
  const work = ITEMS.find((i) => i.id === 'item-git-work')!;
  const b = await bench((ask) => ({ decision: 'until-lock', item: ask.candidates.find((c) => c.username === 'robin-work')?.id }));
  try {
    const seen = await b.psss(['run', '--env', 'T=psss://Code Host/token', '--', NODE, '-e', 'console.log(process.env.T.length)']);
    assert.equal(b.asks[0].candidates.length, 2);
    assert.equal(seen.out.trim(), String(work.fields.token.length));
    assert.deepEqual(leaked(seen.all), []);
  } finally {
    await b.close();
  }
});

test('fetch: the secret goes to the site it is saved for, and nowhere else', async () => {
  const got: { url: string; auth: string }[] = [];
  const server = http.createServer((req, res) => {
    got.push({ url: req.url ?? '', auth: req.headers.authorization ?? '' });
    if (req.url === '/moved') {
      res.writeHead(302, { location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/elsewhere` }).end();
    } else {
      // A site that repeats what it was sent.
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`you sent ${req.headers.authorization}\n`);
    }
  });
  // No host: both IPv4 and IPv6, since “localhost” may resolve to either.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const b = await bench(untilLock);
  try {
    // “localhost” is one of the item's sites; Node resolves it to the server above.
    const echoed = await b.psss(['fetch', 'psss://Example API/token', `http://localhost:${port}/echo`]);
    assert.equal(echoed.code, 0, echoed.all);
    assert.equal(got.at(-1)?.auth, `Bearer ${TOKEN}`, 'the site must receive the secret');
    assert.equal(echoed.out, `you sent Bearer ${HIDDEN}\n`);
    assert.deepEqual(leaked(echoed.all), []);
    assert.equal(b.asks[0].use, 'fetch');
    assert.equal(b.asks[0].detail, `GET http://localhost:${port}/echo, as a bearer token`);
    assert.deepEqual(b.asks[0].fields, ['token'], 'the sheet names the field');

    const basic = await b.psss(['fetch', '--basic', 'psss://Example API/token', `http://localhost:${port}/echo`]);
    assert.equal(got.at(-1)?.auth, 'Basic ' + Buffer.from(`robin@example.com:${TOKEN}`).toString('base64'));
    assert.deepEqual(leaked(basic.all), []);
    assert.ok(basic.out.includes(HIDDEN));

    // Another host: refused, the person is told, nothing is sent.
    const before = got.length;
    const other = await b.psss(['fetch', 'psss://Example API/token', `http://127.0.0.1:${port}/echo`]);
    assert.equal(other.code, 3);
    const elsewhere = await b.psss(['fetch', 'psss://Example Bank/password', `http://localhost:${port}/echo`]);
    assert.equal(elsewhere.code, 3);
    assert.equal(got.length, before, 'a refused request must not reach any server');
    assert.ok(b.asks.at(-1)?.blocked?.includes('bank.example.com'), 'the person is told why');
    assert.deepEqual(leaked(other.all + elsewhere.all), []);

    // A redirect to another host is reported and not followed.
    const moved = await b.psss(['fetch', 'psss://Example API/token', `http://localhost:${port}/moved`]);
    assert.ok(moved.err.includes('HTTP 302'));
    assert.ok(!got.some((g) => g.url === '/elsewhere'), 'the redirect was followed');

    // Plain http to anything but localhost is refused whatever the vault holds.
    const plain = await b.psss(['fetch', 'psss://Example API/token', 'http://api.example.com/']);
    assert.equal(plain.code, 3);
    assert.ok(plain.err.includes('https'));
  } finally {
    await b.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('code: a verification code is given, the secret behind it is not', async () => {
  const at = 59_000;
  const b = await bench(once, () => at);
  try {
    const seen = await b.psss(['code', 'Example Shop']);
    assert.equal(seen.out.trim(), totp(ITEMS[1].totp!, at));
    assert.equal(seen.out.trim(), '287082', 'RFC 6238 test value at 59 s');
    assert.deepEqual(leaked(seen.all), []);
    const none = await b.psss(['code', 'Example Bank']);
    assert.equal(none.code, 3);
  } finally {
    await b.close();
  }
});

test('show: refused outside a terminal before the person is even asked; with --print it is the one exposing path', async () => {
  const b = await bench(untilLock);
  try {
    const refused = await b.psss(['show', 'psss://Example Bank/password']);
    assert.equal(refused.code, 1);
    assert.equal(b.asks.length, 0, 'no sheet for something psss will not do');
    assert.deepEqual(leaked(refused.all), []);

    const printed = await b.psss(['show', '--print', 'psss://Example Bank/password']);
    assert.equal(printed.out.trim(), ITEMS[2].fields.password, 'show --print is expected to print the value');
    assert.equal(b.asks[0].canKeep, false);
    await b.psss(['show', '--print', 'psss://Example Bank/password']);
    assert.equal(b.asks.length, 2, 'showing a value is asked for every time, whatever was answered');
    assert.deepEqual((await b.psss(['list', '--json'])).out.trim(), '[]', 'showing once keeps nothing');
  } finally {
    await b.close();
  }
});

test('save --generate: a caller can add a login whose password it never sees', async () => {
  const b = await bench(once);
  try {
    const seen = await b.psss(['save', '--title', 'New Service', '--username', 'robin', '--site', 'new.example.com', '--generate']);
    assert.equal(seen.code, 0, seen.all);
    assert.equal(seen.out.trim(), 'psss://New Service/password');
    const made = b.broker.items.find((i) => i.title === 'New Service')!;
    assert.equal(made.fields.password.length, 24);
    assert.ok(!seen.all.includes(made.fields.password));

    const typed = await b.psss(['save', '--title', 'Typed', '--stdin'], { input: 'value-from-stdin-123\n' });
    assert.equal(typed.out.trim(), 'psss://Typed/password');
    assert.equal(b.broker.items.find((i) => i.title === 'Typed')!.fields.password, 'value-from-stdin-123');
    assert.ok(!typed.all.includes('value-from-stdin-123'));
  } finally {
    await b.close();
  }
});

test('the activity list names who used what and how, and holds no value', async () => {
  const b = await bench(once);
  try {
    await b.psss(['run', '--env', 'TOKEN=psss://Example API/token', '--', '/usr/bin/printenv', 'TOKEN']);
    await b.psss(['code', 'Example Shop']);
    await b.psss(['show', '--print', 'psss://Example Bank/password']);
    const text = JSON.stringify(b.broker.activity);
    assert.equal(b.broker.activity.length, 3);
    assert.deepEqual(b.broker.activity.map((a) => [a.requester, a.item, a.use, a.outcome]), [
      ['Agent', 'Example API', 'run', 'allowed once'],
      ['Agent', 'Example Shop', 'code', 'allowed once'],
      ['Agent', 'Example Bank', 'show', 'allowed once'],
    ]);
    for (const secret of SECRETS) assert.ok(!text.includes(secret));
    assert.equal(b.broker.activity[0].detail, '/usr/bin/printenv', 'the record keeps the program, not its arguments');
  } finally {
    await b.close();
  }
});

test('when the app is not open or is locked, the command says so and exits 4', async () => {
  const b = await bench(once);
  b.broker.lock();
  const locked = await b.psss(['code', 'Example Shop']);
  assert.equal(locked.code, 4);
  assert.ok(locked.err.includes('locked'));
  const status = await b.psss(['status']);
  assert.equal(status.code, 4);
  await b.close();
  const closed = await b.psss(['list']);
  assert.equal(closed.code, 4);
  assert.ok(closed.err.includes('not open'));
});

// The tests below were added after the independent run of 2026-11-23 walked around the first version.

test('run is never kept: the same command line asks again, whatever the person answered', async () => {
  // Two independent runs walked around a kept run: first through other arguments (git -c alias, find -exec), then with
  // an identical command line whose behaviour was changed through the environment, the folder and files it reads.
  const b = await bench(untilLock);
  try {
    const run = (...command: string[]) => b.psss(['run', '--env', 'TOKEN=psss://Example API/token', '--', ...command]);
    for (const command of [['/usr/bin/git', '--version'], ['/usr/bin/git', '--version'], ['/usr/bin/printenv', 'TOKEN'], ['/usr/bin/printenv', 'TOKEN']]) await run(...command);
    assert.equal(b.asks.length, 4, 'every run must be shown to the person');
    assert.ok(b.asks.every((ask) => ask.canKeep === false), '“until Psss locks” must not be offered for run');
    assert.deepEqual(b.asks[0].fields, ['token']);
    assert.deepEqual(b.broker.kept(), []);
    assert.equal((await b.psss(['list', '--json'])).out.trim(), '[]');
  } finally {
    await b.close();
  }
});

test('fetch: “until Psss locks” covers the request that was shown, not the whole host', async () => {
  const hit: string[] = [];
  const serve = () => http.createServer((req, res) => (hit.push(`${req.method} ${req.headers.host}${req.url}`), res.end('ok')));
  const one = serve();
  const two = serve();
  await new Promise<void>((resolve) => one.listen(0, resolve));
  await new Promise<void>((resolve) => two.listen(0, resolve));
  const p1 = (one.address() as net.AddressInfo).port;
  const p2 = (two.address() as net.AddressInfo).port;
  const b = await bench(untilLock);
  try {
    const get = (...args: string[]) => b.psss(['fetch', ...args]);
    await get('psss://Example API/token', `http://localhost:${p1}/a`);
    await get('psss://Example API/token', `http://localhost:${p1}/a?page=2`);
    assert.equal(b.asks.length, 1, 'the same request with another query must not ask again');
    await get('psss://Example API/token', `http://localhost:${p2}/a`);
    assert.equal(b.asks.length, 2, 'another port must ask');
    await get('psss://Example API/token', `http://localhost:${p1}/b`);
    assert.equal(b.asks.length, 3, 'another path must ask');
    await get('-X', 'DELETE', 'psss://Example API/token', `http://localhost:${p1}/a`);
    assert.equal(b.asks.length, 4, 'another method must ask');
    assert.equal(b.asks[3].detail, `DELETE http://localhost:${p1}/a, as a bearer token`);
    await get('--header', 'X-Api-Key', 'psss://Example API/token', `http://localhost:${p1}/a`);
    assert.equal(b.asks.length, 5, 'another place for the secret must ask');
    assert.ok(b.asks[4].detail.endsWith('in the header X-Api-Key'));
    await get('--data', 'x=1', '-X', 'DELETE', 'psss://Example API/token', `http://localhost:${p1}/a`);
    assert.equal(b.asks.length, 6, 'adding a body must ask');
    assert.equal(hit.length, 7);

    // A method the sheet could not show as it is sent is refused, not sent as something else.
    const odd = await get('-X', 'M-SEARCH', 'psss://Example API/token', `http://localhost:${p1}/a`);
    assert.equal(odd.code, 1);
    assert.equal(hit.length, 7);
    assert.equal(b.asks.length, 6);
    const raw = await b.broker.handle({ v: 1, requester: 'Agent', op: 'use', use: 'fetch', refs: [{ item: 'Example API', field: 'token' }], url: `http://localhost:${p1}/a`, method: 'M-SEARCH', as: 'bearer', body: false });
    assert.equal(raw.ok, false);
  } finally {
    await b.close();
    await new Promise((resolve) => one.close(resolve));
    await new Promise((resolve) => two.close(resolve));
  }
});

test('fetch: a header that cannot be sent is refused before the person is asked', async () => {
  const b = await bench(untilLock);
  try {
    for (const args of [
      ['--header', 'X-A\r\nX-Injected: 1'],
      ['--header', 'Host'],
      ['--header', ''],
      ['-H', 'Host: evil.test'],
      ['-H', 'Bad Name: x'],
    ]) {
      const seen = await b.psss(['fetch', ...args, 'psss://Example API/token', 'http://localhost:9/a']);
      assert.equal(seen.code, 1, args.join(' ') + ' → ' + seen.all);
      assert.ok(!seen.err.includes('psss stopped'), 'the command must not crash: ' + seen.err);
    }
    assert.equal(b.asks.length, 0);
  } finally {
    await b.close();
  }
});

test('a field name that every object has is answered like any other missing field', async () => {
  const b = await bench(once);
  try {
    const missing = await b.psss(['run', '--env', 'T=psss://Example API/nonsense', '--', '/usr/bin/printenv', 'T']);
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const seen = await b.psss(['run', '--env', `T=psss://Example API/${name}`, '--', '/usr/bin/printenv', 'T']);
      assert.deepEqual([seen.code, seen.all], [missing.code, missing.all], name);
      const shown = await b.psss(['show', '--print', `psss://Example API/${name}`]);
      assert.deepEqual([shown.code, shown.all], [missing.code, missing.all], name);
    }
  } finally {
    await b.close();
  }
});

test('the stand-in refuses requests whose parts disagree or carry control characters', async () => {
  const b = await bench(untilLock);
  try {
    const base = { v: 1, requester: 'Agent', op: 'use', use: 'run', refs: [{ item: 'Example API', field: 'token' }] };
    const bad = [
      { ...base, program: '/usr/bin/printenv', argv: ['/bin/sh', '-c', 'echo $TOKEN'] },
      { ...base, program: '/usr/bin/printenv\nrun\nx', argv: ['/usr/bin/printenv\nrun\nx'] },
      { ...base, program: '/usr/bin/printenv', argv: ['/usr/bin/printenv', 7] },
      { ...base, requester: 'Claude\nFake', program: '/usr/bin/printenv', argv: ['/usr/bin/printenv'] },
      { ...base, requester: 'x'.repeat(100_000), program: '/usr/bin/printenv', argv: ['/usr/bin/printenv'] },
      { ...base, requester: 'Claude\u202e', program: '/usr/bin/printenv', argv: ['/usr/bin/printenv'] },
      { ...base, refs: [{ item: 'Example API\nYour bank asks you to confirm', field: 'token' }], program: '/usr/bin/printenv', argv: ['/usr/bin/printenv'] },
      { ...base, use: 'show', refs: [{ item: 'Example API', field: 'x\nAPPROVED' }] },
    ];
    for (const request of bad) {
      const answer = await b.broker.handle(request as never);
      assert.equal(answer.ok, false);
      assert.equal((answer as { error: string }).error, 'bad_request');
    }
    assert.equal(b.asks.length, 0);
    assert.deepEqual(b.broker.kept(), []);
  } finally {
    await b.close();
  }
});

test('KNOWN GAP: the stand-in answers anything that speaks the protocol; the app must check that the caller is the signed command', async () => {
  const b = await bench(once);
  try {
    const answer = await b.broker.handle({ v: 1, requester: 'Agent', op: 'use', use: 'show', refs: [{ item: 'Example Bank', field: 'password' }] });
    assert.equal(answer.ok, true, 'expected the documented gap; if the stand-in learns to check its caller, update docs/cli.md');
  } finally {
    await b.close();
  }
});

test('hidden characters in an argument are written out on the sheet', async () => {
  const b = await bench(deny);
  try {
    await b.psss(['run', '--env', 'T=psss://Example API/token', '--', '/usr/bin/printenv', 'a\u202eb', 'line\nbreak', '\u001b[2J']);
    const detail = b.asks[0].detail;
    assert.ok(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/.test(detail), JSON.stringify(detail));
    assert.ok(detail.includes('\\u202e') && detail.includes('\\n') && detail.includes('\\u001b'), detail);
  } finally {
    await b.close();
  }
});
