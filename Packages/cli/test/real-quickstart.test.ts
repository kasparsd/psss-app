// The real `psss` binary, the real vault library, temporary folders. The quickstart end to end, secrets, and restarts.

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { device, keySeed, SECRET } from './real-helpers.ts';

test('quickstart: init, set --create, get, list, status, run --env, rm, restore and verify work end to end on a real vault', (t) => {
  const d = device(t);
  const init = d.psss(['init', 'Personal', '--vault', './vault']);
  assert.equal(init.code, 0, 'init in a script should exit 0');
  assert.equal(
    init.stdout,
    `Created the vault "Personal" in ./vault/Personal.psss\nKey file: ~/.config/psss/keys/Personal.key (readable by you only)\n`,
    'init should say what it made and where the key is (frame A2)',
  );
  assert.match(init.stderr, /^warning: that key file is the only way into the vault\./, 'init without a terminal warns on standard error');
  assert.ok(existsSync(path.join(d.cwd, 'vault', 'Personal.psss', 'psss.json')), 'the vault folder should exist at the --vault path');
  assert.equal(statSync(d.keyFile('Personal')).mode & 0o777, 0o600, 'the key file should be readable by the owner only');
  assert.ok(!existsSync(path.join(d.cwd, 'vault', 'Personal.psss', 'Personal.key')), 'the key must not be inside the vault folder');
  const env = { PSSS_VAULT: './vault' };

  const set = d.psss(['set', '--create', 'psss://Example API/token'], { stdin: `${SECRET}\n`, env });
  assert.equal(set.code, 0, 'set --create should exit 0');
  assert.equal(set.stdout, 'Saved "token" in Example API (Personal).\nThere was no item with that title, so it was added (--create).\n', 'set says what was saved and never the value');

  const get = d.psss(['get', 'psss://example api/token'], { env });
  assert.equal(get.code, 0, 'get should exit 0');
  assert.equal(get.stdout, SECRET, 'get into a pipe prints exactly the value, ignoring the case of the title');
  assert.equal(get.stderr, '', 'get prints nothing on standard error');

  const list = d.psss(['list'], { env });
  assert.equal(list.stdout, 'Example API   token\n', 'list shows the title and the names of fields, never values');

  const status = d.psss(['status'], { env });
  assert.equal(status.code, 0, 'status should exit 0');
  assert.match(status.stdout, /^Vault {5}Personal {3}1 group \(Only Me\), 1 item\nKey {7}this computer's key file\nWay back {2}none yet\./, 'status shows groups, item count, key source and way back');
  assert.match(status.stdout, /This computer {4}\.\/vault\/Personal\.psss {6}Up to date\n$/, 'status shows the location as Up to date');

  // the program started by run writes the value to a file, so the output of psss itself stays empty
  const out = path.join(d.cwd, 'seen.txt');
  const script = path.join(d.cwd, 'use.sh');
  writeFileSync(script, `#!/bin/sh\nprintf %s "$API_TOKEN" > "${out}"\n`);
  chmodSync(script, 0o755);
  const run = d.psss(['run', '--env', 'API_TOKEN=psss://Example API/token', '--', './use.sh'], { env });
  assert.equal(run.code, 0, 'run passes on the program exit code');
  assert.equal(run.stdout + run.stderr, '', 'run prints nothing of its own');
  assert.equal(readFileSync(out, 'utf8'), SECRET, 'the program found the value in its environment');

  const rm = d.psss(['rm', 'psss://Example API'], { env });
  assert.equal(rm.code, 0, 'rm should exit 0');
  assert.match(d.psss(['list'], { env }).stdout, /^There is nothing in Personal yet\./, 'a removed item leaves the list');
  assert.equal(d.psss(['get', 'psss://Example API/token'], { env }).code, 3, 'a removed item cannot be read');
  const restore = d.psss(['restore', 'psss://Example API'], { env });
  assert.equal(restore.code, 0, 'restore should exit 0');
  assert.equal(d.psss(['get', 'psss://Example API/token'], { env }).stdout, SECRET, 'a restored item has its value back');

  const verify = d.psss(['verify'], { env });
  assert.equal(verify.code, 0, 'verify of an untouched vault exits 0');
  assert.match(verify.stdout, /^Checked \d+ records in 1 location\.\nAll of them match\./, 'verify says all records match');
  const sync = d.psss(['sync'], { env });
  assert.equal(sync.code, 0, 'sync with a single location exits 0');
  assert.match(sync.stdout, /Merged with 1 location\./, 'sync says what it merged');
});

test('init without --vault makes ~/Psss/<name>.psss, the default key file and device state, and every later command finds them with no flags', (t) => {
  const d = device(t);
  assert.equal(d.psss(['init', 'Home', '--no-recovery']).code, 0, 'init should exit 0');
  assert.ok(existsSync(path.join(d.vaultPath('Home'), 'psss.json')), 'the default vault is ~/Psss/<name>.psss');
  assert.ok(existsSync(d.keyFile('Home')), 'the default key file is <config>/psss/keys/<name>.key');
  assert.ok(existsSync(path.join(d.stateDir('Home'), 'state.json')), 'device state lives in the state folder');
  assert.equal(d.psss(['set', '--create', 'psss://Bank/password'], { stdin: 'pw-1' }).code, 0, 'set --create should work with no flags');
  assert.equal(d.psss(['get', 'psss://Bank/password']).stdout, 'pw-1', 'get should work with no flags');
  assert.equal(d.psss(['get', 'psss://Bank/password'], { env: { PSSS_VAULT: 'Home' } }).stdout, 'pw-1', 'a bare name in PSSS_VAULT means ~/Psss/<name>.psss');
});

test('init refuses a key file inside the vault folder with exit 2, also when the key file is the default location', (t) => {
  const d = device(t);
  const inside = d.psss(['init', 'Team', '--vault', './vault', '--key-file', './vault/Team.psss/device.key']);
  assert.equal(inside.code, 2, 'a key file inside the vault folder is a usage error');
  assert.match(inside.stderr, /is inside the vault folder/, 'the message says why');
  assert.ok(!existsSync(path.join(d.cwd, 'vault', 'Team.psss')), 'nothing was created');

  // The default key file is <XDG_CONFIG_HOME>/psss/keys/Team.key: put the config folder inside the vault folder.
  const around = d.psss(['init', 'Team', '--vault', '.'], { env: { XDG_CONFIG_HOME: path.join(d.cwd, 'Team.psss', 'cfg') } });
  assert.equal(around.code, 2, 'the default key file location inside the vault folder is refused too');
  assert.match(around.stderr, /is inside the vault folder/, 'the same message');
  assert.ok(!existsSync(path.join(d.cwd, 'Team.psss')), 'nothing was created, so no key sits inside the vault folder');

  // The same through a symbolic link: the key file is spelled differently but sits in the vault folder.
  mkdirSync(path.join(d.cwd, 'real'));
  symlinkSync(path.join(d.cwd, 'real'), path.join(d.cwd, 'alias'));
  const linked = d.psss(['init', 'Team', '--vault', './real'], { env: { XDG_CONFIG_HOME: path.join(d.cwd, 'alias', 'Team.psss', 'cfg') } });
  assert.equal(linked.code, 2, 'a key file that reaches the vault folder through a symbolic link is refused too');
  assert.ok(!existsSync(path.join(d.cwd, 'real', 'Team.psss')), 'nothing was created through the link');

  // The same with no --vault at all: the vault goes to ~/Psss/Team.psss and the config folder is inside it.
  const bare = d.psss(['init', 'Team'], { env: { XDG_CONFIG_HOME: path.join(d.vaultPath('Team'), 'cfg') } });
  assert.equal(bare.code, 2, 'the default vault location with a key file inside it is refused with exit 2');
  assert.match(bare.stderr, /is inside the vault folder/, 'the same message again');
  assert.ok(!existsSync(d.vaultPath('Team')), 'nothing was created in the default location either');

});

test('init twice for one name fails with exit 1, changes nothing and never overwrites the key', (t) => {
  const d = device(t);
  assert.equal(d.psss(['init', 'Home', '--no-recovery']).code, 0, 'the first init works');
  const seed = keySeed(d.keyFile('Home'));
  const again = d.psss(['init', 'Home', '--no-recovery']);
  assert.equal(again.code, 1, 'the second init fails');
  assert.match(again.stderr, /already exists/, 'it says the vault exists');
  assert.equal(keySeed(d.keyFile('Home')), seed, 'the key file is untouched');
});

test('no secret reaches standard output or standard error except from get, and none is in the arguments', (t) => {
  const d = device(t);
  d.psss(['init', 'Home', '--no-recovery']);
  const seed = keySeed(d.keyFile('Home'));
  d.psss(['set', '--create', 'psss://Service/token'], { stdin: SECRET });
  d.psss(['set', 'psss://Service/token'], { stdin: `${SECRET}-2` });
  d.psss(['get', 'psss://Service/token', '--json']);
  for (const args of [['list'], ['list', '--json'], ['status'], ['status', '--json'], ['verify'], ['sync'], ['rm', 'psss://Service'], ['restore', 'psss://Service'], ['get', 'psss://Nope/token'], ['set', 'psss://Nope/token'], ['get', 'psss://Service/nothing']]) {
    d.psss(args, { stdin: SECRET, env: { PSSS_VERBOSE: '1', PSSS_KEY: 'not-a-key-but-secret-looking-77' } });
  }
  const verbose = d.psss(['list', '--verbose'], { env: { PSSS_KEY: 'not-a-key-but-secret-looking-77' } });
  assert.ok(!(verbose.stdout + verbose.stderr).includes('not-a-key-but-secret-looking-77'), 'PSSS_KEY is never printed, even with --verbose');
  for (const r of d.log) {
    const shown = `${r.stdout}\n${r.stderr}`;
    const isGet = r.argv[0] === 'get' && r.argv[1] === 'psss://Service/token';
    if (!isGet) assert.ok(!shown.includes(SECRET), `psss ${r.argv.join(' ')} must not print a stored value`);
    assert.ok(!shown.includes(seed), `psss ${r.argv.join(' ')} must not print the key`);
    assert.ok(!r.argv.join(' ').includes(SECRET), 'a value is never in the arguments');
  }
  const get = d.log.find((r) => r.argv[0] === 'get' && r.argv.includes('--json'))!;
  assert.equal(JSON.parse(get.stdout).value, `${SECRET}-2`, 'get --json is where a value may appear, and it is the newest one');
});

test('get returns the same value after the process restarts, and writes after a restart continue the device chain so verify stays clean', (t) => {
  const d = device(t);
  d.psss(['init', 'Home', '--no-recovery']);
  d.psss(['set', '--create', 'psss://Bank/password'], { stdin: 'one' });
  assert.equal(d.psss(['get', 'psss://Bank/password']).stdout, 'one', 'first process reads its own write');
  assert.equal(d.psss(['get', 'psss://Bank/password']).stdout, 'one', 'a new process reads the same value');
  for (const v of ['two', 'three', 'four']) {
    assert.equal(d.psss(['set', 'psss://Bank/password'], { stdin: v }).code, 0, `set ${v} from a fresh process should work`);
    assert.equal(d.psss(['get', 'psss://Bank/password']).stdout, v, `get after a restart returns ${v}`);
  }
  const verify = d.psss(['verify']);
  assert.equal(verify.code, 0, `a chain written by several processes has no gap and no fork: ${verify.stdout}`);
});
