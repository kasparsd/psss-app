import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import { readSecret } from '../src/input.ts';
import { ValidationError } from '../src/errors.ts';
import type { CliIo } from '../src/io.ts';
import { FakeTty, ITEMS, runCli, sandbox, scenarioFor, SECRET } from './helpers.ts';

const ioFor = (stdin: unknown, tty: boolean) => {
  let err = '';
  const io = { stdin, stdout: { write: () => true }, stderr: { write: (s: string) => ((err += s), true) }, cwd: '/', env: {}, isTTY: { stdin: tty, stdout: tty } } as unknown as CliIo;
  return { io, errText: () => err };
};
const piped = (text: string) => {
  const p = new PassThrough();
  p.end(text);
  return p;
};

test('a secret fed through set appears nowhere in argv, standard output or standard error, except in get', async () => {
  const box = sandbox();
  try {
    box.write('probe.sh', '#!/bin/sh\n[ -n "$TOKEN" ] || exit 9\n[ -z "${PSSS_KEY+x}" ] || exit 8\n[ -z "${PSSS_PASSWORD_FILE+x}" ] || exit 7\n', 0o755);
    const KEY = 'inline-key-should-never-print-91ac';
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0], ITEMS[1]] }));
    const env = { PSSS_KEY: KEY, PSSS_PASSWORD_FILE: '/pw/file-should-not-reach-children' };
    const quiet: string[][] = [
      ['set', 'psss://Example API/token'],
      ['set', '--create', 'psss://Brand New/token'],
      ['list'],
      ['list', '--json'],
      ['list', '--deleted'],
      ['status'],
      ['status', '--json'],
      ['verify'],
      ['verify', '--json'],
      ['sync'],
      ['sync', '--json'],
      ['rm', 'psss://Brand New'],
      ['restore', 'psss://Brand New'],
      ['get', 'psss://Nothing/token'],
      ['get', 'psss://Example/password'],
      ['get', 'psss://Example API/nothing'],
      ['run', '--env', 'TOKEN=psss://Example API/token', '--', './probe.sh'],
      ['set', 'psss://Example API/token', '--value', SECRET],
      ['--help'],
      ['get', '--help'],
    ];
    const seen: string[] = [];
    for (const argv of quiet) {
      const full = [...argv, ...(argv[0] === '--help' ? [] : ['--verbose'])];
      const r = await runCli(full, { box, fake, env, stdin: `${SECRET}\n` });
      assert.ok(!full.slice(0, -1).some((a) => a.includes(SECRET) && !argv.includes('--value')), 'the test itself never puts the secret in an argument');
      seen.push(r.stdout + r.stderr);
      assert.ok(!r.stdout.includes(SECRET), `psss ${argv.join(' ')} must not print the value on standard output`);
      assert.ok(!r.stderr.includes(SECRET), `psss ${argv.join(' ')} must not print the value on standard error`);
      assert.ok(!r.combined.includes(KEY), `psss ${argv.join(' ')} must not print PSSS_KEY`);
      assert.ok(!r.combined.includes('/pw/file-should-not-reach-children') || argv[0] === 'x', `psss ${argv.join(' ')} must not print PSSS_PASSWORD_FILE`);
      if (argv[0] === 'run') assert.equal(r.code, 0, `the program should get TOKEN and neither PSSS_KEY nor PSSS_PASSWORD_FILE (exit ${r.code}, ${r.stderr})`);
    }
    assert.equal(fake.peek('Brand New', 'token'), SECRET, 'the value was stored by set');
    const get = await runCli(['get', 'psss://Brand New/token'], { box, fake, env });
    assert.equal(get.stdout, SECRET, 'get is the one place the value appears');
    const json = await runCli(['get', '--json', 'psss://Brand New/token'], { box, fake, env });
    assert.equal(JSON.parse(json.stdout).value, SECRET, 'get --json also carries the value');
    assert.equal(seen.filter((s) => s.includes(SECRET)).length, 0, 'no other command printed it');
  } finally {
    box.cleanup();
  }
});

test('there is no way to pass a value as an argument', async () => {
  const box = sandbox();
  try {
    for (const argv of [
      ['set', 'psss://Example API/token', '--value', SECRET],
      ['set', 'psss://Example API/token', `--value=${SECRET}`],
      ['set', 'psss://Example API/token', SECRET],
    ]) {
      const r = await runCli(argv, { box, stdin: 'x\n', scenario: { items: [ITEMS[0]] } });
      assert.equal(r.code, 2, `psss ${argv.slice(0, 3).join(' ')} ... must be a usage error`);
      assert.ok(!r.combined.includes(SECRET), 'and the error must not repeat the value');
    }
  } finally {
    box.cleanup();
  }
});

test('readSecret from a pipe takes all of standard input and strips one trailing newline only', async () => {
  const table: Array<[string, string]> = [
    ['abc\n', 'abc'],
    ['abc', 'abc'],
    ['abc\r\n', 'abc'],
    ['abc\n\n', 'abc\n'],
    ['  padded  \n', '  padded  '],
    ['line one\nline two\n', 'line one\nline two'],
    ['pässwörd-ключ-密码\n', 'pässwörd-ключ-密码'],
  ];
  for (const [input, expected] of table) {
    const { io, errText } = ioFor(piped(input), false);
    assert.equal(await readSecret(io, 'Value: '), expected, `${JSON.stringify(input)} should give ${JSON.stringify(expected)}`);
    assert.equal(errText(), '', 'a pipe is never prompted');
  }
  const { io } = ioFor(piped('\n'), false);
  await assert.rejects(readSecret(io, 'Value: '), ValidationError, 'an empty value is a usage error');
});

test('readSecret in a terminal asks on standard error without echo and restores the terminal', async () => {
  const typed = new FakeTty('ab\u007fcé\r');
  const { io, errText } = ioFor(typed, true);
  assert.equal(await readSecret(io, 'Value (not shown): '), 'acé', 'backspace removes a character and non-ASCII is kept');
  assert.equal(errText(), 'Value (not shown): \n', 'the prompt is on standard error and nothing typed is echoed');
  assert.deepEqual(typed.rawModeCalls, [true, false], 'raw mode on while typing and off after');

  const cancelled = new FakeTty('abc\u0003');
  await assert.rejects(readSecret(ioFor(cancelled, true).io, 'Value: '), /Cancelled/, 'Ctrl-C cancels');
  assert.deepEqual(cancelled.rawModeCalls, [true, false], 'raw mode is restored after Ctrl-C');

  const eof = new FakeTty('\u0004');
  await assert.rejects(readSecret(ioFor(eof, true).io, 'Value: '), /Cancelled/, 'Ctrl-D on an empty line cancels');

  const failing = new FakeTty('');
  const { io: io3 } = ioFor(failing, true);
  const pending = readSecret(io3, 'Value: ');
  failing.destroy(new Error('terminal went away'));
  await assert.rejects(pending, /terminal went away/, 'an error while reading is passed on');
  assert.deepEqual(failing.rawModeCalls, [true, false], 'raw mode is restored on an error too');

  const empty = new FakeTty('\r');
  await assert.rejects(readSecret(ioFor(empty, true).io, 'Value: '), ValidationError, 'pressing Enter with nothing typed is a usage error');
});

test('set from a terminal never shows the typed value, and a cancelled set changes nothing', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]] }));
    const ok = await runCli(['set', 'psss://Example API/token'], { box, fake, typed: `${SECRET}\r`, stdoutTty: true });
    assert.equal(ok.code, 0, 'set exits 0');
    assert.ok(!ok.combined.includes(SECRET), 'nothing typed is printed');
    const cancelled = await runCli(['set', 'psss://Example API/token'], { box, fake, typed: 'partial\u0003', stdoutTty: true });
    assert.equal(cancelled.code, 1, 'Ctrl-C exits 1');
    assert.equal(cancelled.stderr, 'Value (not shown): \n' + 'Cancelled.\n', 'and says Cancelled');
    assert.equal(fake.peek('Example API', 'token'), SECRET, 'the stored value is unchanged by the cancelled set');
  } finally {
    box.cleanup();
  }
});

test('set with an empty pipe saves nothing and exits 2', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]] }));
    const r = await runCli(['set', 'psss://Example API/token'], { box, fake, stdin: '' });
    assert.equal(r.code, 2, 'empty input is a usage error');
    assert.equal(fake.peek('Example API', 'token'), 'sk-example-old', 'nothing was saved');
  } finally {
    box.cleanup();
  }
});
