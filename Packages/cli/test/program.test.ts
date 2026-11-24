import assert from 'node:assert/strict';
import test from 'node:test';
import { commands, EXIT_FAILED, EXIT_LOCKED, EXIT_NOT_FOUND, EXIT_OK, EXIT_USAGE } from '../src/cli.ts';
import { FakeVaultService } from '../src/fake-service.ts';
import { ITEMS, runCli, sandbox, scenarioFor } from './helpers.ts';

const IMPLEMENTED = ['init', 'status', 'get', 'set', 'list', 'search', 'rm', 'restore', 'run', 'code', 'sync', 'verify', 'history', 'import', 'export', 'generate', 'item', 'file'];
const PLANNED = ['doctor', 'vault', 'group', 'member', 'device', 'location', 'key'];

const helpNames = (help: string): string[] =>
  [...(/\nCommands:\n([\s\S]*?)\n\n/.exec(help)?.[1] ?? '').matchAll(/^ {2}([a-z]+)/gm)].map((m) => m[1]);

test('the registered commands are exactly the ones --help lists, and each prints its own usage', async () => {
  const box = sandbox();
  try {
    const help = await runCli(['--help'], { box, noService: true });
    const listed = helpNames(help.stdout);
    assert.deepEqual([...listed].sort(), commands.map((c) => c.name).sort(), 'every registered command must be in --help, and nothing else');
    assert.deepEqual([...listed].sort(), [...IMPLEMENTED, ...PLANNED].sort(), 'the commands are the ones docs/cli.md names');
    for (const name of listed) {
      const own = await runCli([name, '--help'], { box, noService: true });
      assert.equal(own.code, EXIT_OK, `psss ${name} --help should exit 0`);
      assert.match(own.stdout, new RegExp(`^Usage: psss ${name}\\b`), `psss ${name} --help should start with its usage`);
      const viaHelp = await runCli(['help', name], { box, noService: true });
      assert.equal(viaHelp.stdout, own.stdout, `psss help ${name} should print the same as psss ${name} --help`);
    }
    for (const name of PLANNED) {
      assert.match(help.stdout, new RegExp(`^ {2}${name}\\s+\\(planned\\)`, 'm'), `${name} should be marked planned in the help`);
    }
    for (const name of IMPLEMENTED) {
      assert.doesNotMatch(help.stdout, new RegExp(`^ {2}${name}\\s+\\(planned\\)`, 'm'), `${name} is built and must not be marked planned`);
    }
  } finally {
    box.cleanup();
  }
});

test('commands that are not built say so on standard error and exit 1, whatever they are given', async () => {
  const box = sandbox();
  try {
    for (const name of PLANNED) {
      const r = await runCli([name, 'sub', '--whatever'], { box });
      assert.equal(r.stdout, '', `psss ${name} must print nothing on standard output`);
      assert.equal(r.stderr, `psss ${name} is not built yet.\n`, `psss ${name} should say it is not built yet`);
      assert.equal(r.code, EXIT_FAILED, `psss ${name} should exit 1`);
    }
  } finally {
    box.cleanup();
  }
});

test('exit codes: 0 done, 1 failed, 2 usage or failed verify, 3 no such item or ambiguous, 4 locked or no key', async () => {
  const box = sandbox();
  try {
    const items = [ITEMS[0], ITEMS[1], ITEMS[2]];
    assert.deepEqual([EXIT_OK, EXIT_FAILED, EXIT_USAGE, EXIT_NOT_FOUND, EXIT_LOCKED], [0, 1, 2, 3, 4], 'the table of exit codes');
    assert.equal((await runCli(['list'], { box, scenario: { items } })).code, 0, 'a normal command exits 0');
    assert.equal((await runCli(['list'], { box, noService: true })).code, 1, 'a build with no vault library exits 1');
    assert.equal((await runCli(['sync'], { box, scenario: { items, sync: { locations: [{ label: 'iCloud Drive', path: '/x', pulled: 0, pushed: 0, error: 'not reachable' }] } } })).code, 1, 'a location that cannot be reached exits 1');
    assert.equal((await runCli(['nope'], { box })).code, 2, 'an unknown command exits 2');
    assert.equal((await runCli(['get', 'psss://Example/password'], { box, scenario: { items } })).code, 3, 'an ambiguous name exits 3');
    assert.equal((await runCli(['get', 'psss://Nothing/password'], { box, scenario: { items } })).code, 3, 'no such item exits 3');
    assert.equal((await runCli(['get', 'psss://Example API/nothing'], { box, scenario: { items } })).code, 3, 'no such field exits 3');
    assert.equal((await runCli(['get', 'psss://Nowhere/Example API/token'], { box, scenario: { items } })).code, 3, 'no such group exits 3');
    for (const keyState of ['keyFileMissing', 'keyFileUnreadable', 'noKey', 'noVault', 'locked', 'wrong'] as const) {
      const r = await runCli(['get', 'psss://Example API/token'], { box, scenario: { items, keyState } });
      assert.equal(r.code, 4, `a vault that cannot be opened (${keyState}) exits 4`);
      assert.equal(r.stdout, '', `${keyState} prints nothing on standard output`);
    }
    const verify = { records: 3, locations: 1, problems: [{ kind: 'other' as const, location: '/x', message: 'a member record was forged.' }] };
    assert.equal((await runCli(['verify'], { box, scenario: { verify } })).code, 2, 'a failed verify exits 2');
  } finally {
    box.cleanup();
  }
});

test('the locked and wrong-key messages say which vault and what to do, and never whether a password exists', async () => {
  const box = sandbox();
  try {
    const wrong = await runCli(['status', '--key-file', '/keys/other.key'], { box, scenario: { keyState: 'wrong' } });
    assert.equal(wrong.stderr, 'Cannot open the vault "Personal".\nThe key in /keys/other.key does not open it.\nCheck that it is the key for this vault.\n', 'wrong key text');
    const none = await runCli(['status'], { box, scenario: { keyState: 'noVault' }, env: { PSSS_VAULT: '/nowhere' } });
    assert.equal(none.stderr, 'There is no vault at /nowhere.\nCreate one with: psss init <name>\nor point PSSS_VAULT at a vault folder.\n', 'no vault text');
    const nokey = await runCli(['status'], { box, scenario: { keyState: 'noKey' } });
    assert.match(nokey.stderr, /^Cannot open the vault "Personal"\.\nNo key was found on this computer\.\nPoint PSSS_KEY_FILE/, 'no key text');
  } finally {
    box.cleanup();
  }
});

test('strictness: unknown flags, extra arguments and contradictory values are errors before any work', async () => {
  const box = sandbox();
  try {
    const cases: Array<{ argv: string[]; message: RegExp; why: string }> = [
      { argv: ['get', '--nope', 'psss://Example API/token'], message: /Unknown option --nope for psss get/, why: 'an unknown flag' },
      { argv: ['--nope', 'get', 'psss://Example API/token'], message: /Unknown option --nope/, why: 'an unknown flag before the command' },
      { argv: ['--nope'], message: /Unknown option --nope/, why: 'an unknown flag and no command' },
      { argv: ['get', 'psss://Example', 'API/token'], message: /takes one argument, but 1 more was not expected\. If a reference has spaces, put it in quotes/, why: 'an unquoted reference with a space' },
      { argv: ['status', 'extra'], message: /takes no arguments, but 1 more was not expected/, why: 'an argument where none belongs' },
      { argv: ['--json', 'status'], message: /Unknown option --json/, why: "--json is per command and never global" },
      { argv: ['set', 'psss://Example API/token', '--value', 'x'], message: /Unknown option --value for psss set/, why: 'there is no --value flag' },
      { argv: ['get', '--vault'], message: /option --vault needs a value/, why: 'a flag with no value' },
      { argv: ['status', '--json=yes'], message: /option --json does not take a value/, why: 'a switch given a value' },
      { argv: ['get', '--group', 'Family', 'psss://Work/Example API/token'], message: /names the group "Work" but --group \(or PSSS_GROUP\) says "Family"/, why: 'a group in the reference and another in --group' },
      { argv: ['list', 'Work', '--group', 'Family'], message: /"Work" and --group .* "Family" disagree/, why: 'two groups for list' },
      { argv: ['get', 'Example API/token'], message: /is not a reference/, why: 'a name that is not a reference' },
      { argv: ['get', 'psss://Example API'], message: /too few parts/, why: 'a reference with no field' },
      { argv: ['run', '--env', 'A=psss://x/y', '--env', 'A=psss://x/z', '--', 'true'], message: /A is set more than once/, why: 'the same variable twice' },
      { argv: ['run', '--env', 'A=literal', '--', 'true'], message: /must be a psss:\/\/ reference/, why: 'a literal value instead of a reference' },
      { argv: ['run', '--env', 'A=psss://x/y'], message: /needs a program after "--"/, why: 'no program' },
      { argv: ['run', '--', 'true'], message: /at least one --env/, why: 'no variables' },
      { argv: ['init'], message: /needs a name/, why: 'init without a name' },
      { argv: ['init', 'a/b'], message: /cannot be a vault name/, why: 'a name with a slash' },
    ];
    for (const c of cases) {
      const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]] }));
      const r = await runCli(c.argv, { box, fake });
      assert.equal(r.code, EXIT_USAGE, `${c.why}: psss ${c.argv.join(' ')} should exit 2`);
      assert.match(r.stderr, c.message, `${c.why}: the message should say what is wrong`);
      assert.equal(r.stdout, '', `${c.why}: nothing on standard output`);
      assert.deepEqual(fake.calls, [], `${c.why}: nothing may be opened, read or written before the error`);
    }
  } finally {
    box.cleanup();
  }
});

test('global options may come before or after the command, and psss with no command prints the help', async () => {
  const box = sandbox();
  try {
    const items = [ITEMS[0]];
    const before = await runCli(['--vault', './v', '--group', 'Only Me', 'list'], { box, scenario: { items } });
    assert.equal(before.code, 0, 'options before the command are accepted');
    assert.equal(before.serviceOptions?.vault, './v', '--vault before the command is used');
    assert.equal(before.serviceOptions?.group, 'Only Me', '--group before the command is used');
    const after = await runCli(['list', '--vault=./w', '-y'], { box, scenario: { items } });
    assert.equal(after.serviceOptions?.vault, './w', '--vault=value after the command is used');
    const bare = await runCli([], { box, noService: true });
    assert.match(bare.stdout, /^psss 0\.0\.0: use a Psss vault/, 'no arguments print the help');
    assert.equal(bare.code, 0, 'the help is not an error');
    assert.match((await runCli(['--version'], { box, noService: true })).stdout, /^psss \d+\.\d+\.\d+\n$/, '--version prints the version');
  } finally {
    box.cleanup();
  }
});

test('a vault service that is not connected is reported once, in plain words', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['status'], { box, noService: true });
    assert.equal(r.code, 1, 'exit 1');
    assert.equal(r.stderr, 'This build of psss cannot open a vault yet: the vault library is not connected to it.\n', 'plain words');
  } finally {
    box.cleanup();
  }
});

test('the real executable runs as a child process: help on standard output, an honest failure with no vault, exit codes through the process', async () => {
  const { spawnSync } = await import('node:child_process');
  const bin = new URL('../src/bin/psss.ts', import.meta.url).pathname;
  const help = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', bin, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, 'psss --help exits 0 as a process');
  assert.match(help.stdout, /^psss 0\.0\.0: use a Psss vault/, 'and prints the help on standard output');
  const empty = (await import('node:fs')).mkdtempSync(`${(await import('node:os')).tmpdir()}/psss-program-`);
  const status = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', bin, 'status'], { encoding: 'utf8', cwd: empty, env: { PATH: '/usr/bin:/bin', HOME: empty, CI: '1' } });
  (await import('node:fs')).rmSync(empty, { recursive: true, force: true });
  assert.equal(status.status, 4, 'psss status with no vault on this computer exits 4');
  assert.equal(status.stdout, '', 'and prints nothing on standard output');
  const bad = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', bin, 'get', '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2, 'a usage error exits 2 as a process');
});

test('the real service maps a value that is too large to a usage error with the limit, and an unknown failure keeps its cause', async () => {
  const { createVaultService } = await import('../src/vault-service.ts');
  const { ValidationError } = await import('../src/errors.ts');
  const svc = createVaultService({ cwd: '/w', home: '/h', platform: 'linux', configDir: '/c', stateDir: '/s' }) as unknown as { translate(e: unknown): { message: string } };
  const big = Object.assign(new Error('too big'), { name: 'ValueTooLarge', limit: 65536 });
  assert.throws(
    () => svc.translate(big),
    (e: Error) => e instanceof ValidationError && e.message === 'That value is too large to store (limit 65,536 bytes).',
    'ValueTooLarge becomes the plain message with the limit (exit 2)',
  );
  assert.match(svc.translate(new Error('disk exploded')).message, /disk exploded/, 'an unknown failure says why');
  assert.doesNotMatch(svc.translate(new Error('x')).message, /Something went wrong/, 'and never the bare phrase');
});
