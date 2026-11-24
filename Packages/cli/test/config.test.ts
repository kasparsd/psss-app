import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { userConfigPath } from '../src/config.ts';
import { FakeVaultService } from '../src/fake-service.ts';
import { ITEMS, runCli, sandbox, scenarioFor } from './helpers.ts';
import type { Sandbox } from './helpers.ts';

const userFile = (box: Sandbox) => path.join(box.home, '.config', 'psss', 'config.json');

async function vaultUsed(box: Sandbox, argv: string[], env: Record<string, string> = {}): Promise<string | undefined> {
  const r = await runCli(['list', ...argv], { box, env, scenario: { items: [ITEMS[0]] } });
  assert.equal(r.code, 0, `list should work (stderr: ${r.stderr})`);
  return r.serviceOptions?.vault;
}

test('precedence: flag over environment over .psss.json over user config over the default', async () => {
  const box = sandbox();
  try {
    assert.equal(await vaultUsed(box, []), undefined, 'by default no vault is named and the service decides');
    box.write(userFile(box), JSON.stringify({ vault: 'from-user-config' }));
    assert.equal(await vaultUsed(box, []), 'from-user-config', 'the user config is used when nothing else says');
    box.write('.psss.json', JSON.stringify({ vault: 'from-project-file' }));
    assert.equal(await vaultUsed(box, []), 'from-project-file', '.psss.json beats the user config');
    assert.equal(await vaultUsed(box, [], { PSSS_VAULT: 'from-environment' }), 'from-environment', 'the environment beats .psss.json');
    assert.equal(await vaultUsed(box, ['--vault', 'from-flag'], { PSSS_VAULT: 'from-environment' }), 'from-flag', 'a flag beats the environment');
    assert.equal(await vaultUsed(box, [], { PSSS_VAULT: '' }), 'from-project-file', 'an empty variable counts as not set');
  } finally {
    box.cleanup();
  }
});

test('every global option follows the same precedence: group, key file, verbose', async () => {
  const box = sandbox();
  try {
    box.write(userFile(box), JSON.stringify({ group: 'U', keyFile: '/k/user.key', verbose: true }));
    box.write('.psss.json', JSON.stringify({ group: 'P' }));
    const used = async (argv: string[], env: Record<string, string> = {}) => {
      const r = await runCli(['list', ...argv], { box, env, scenario: { groups: ['U', 'P', 'E', 'F'] } });
      assert.equal(r.code, 0, r.stderr);
      return r;
    };
    assert.equal((await used([])).serviceOptions?.group, 'P', 'group: .psss.json over user config');
    assert.equal((await used([], { PSSS_GROUP: 'E' })).serviceOptions?.group, 'E', 'group: environment over .psss.json');
    assert.equal((await used(['--group', 'F'], { PSSS_GROUP: 'E' })).serviceOptions?.group, 'F', 'group: flag over environment');
    assert.equal((await used([])).serviceOptions?.keyFile, '/k/user.key', 'key file: user config');
    assert.equal((await used([], { PSSS_KEY_FILE: '/k/env.key' })).serviceOptions?.keyFile, '/k/env.key', 'key file: environment over user config');
    assert.equal((await used(['--key-file', '/k/flag.key'], { PSSS_KEY_FILE: '/k/env.key' })).serviceOptions?.keyFile, '/k/flag.key', 'key file: flag over environment');
    assert.match((await used([])).stderr, /psss: keyFile: \/k\/user\.key \(from the user config\)/, 'verbose from the user config says where each setting came from');
    assert.equal((await used([], { PSSS_VERBOSE: '0' })).stderr, '', 'PSSS_VERBOSE=0 beats a config file that says true');
    assert.match((await used(['--verbose'], { PSSS_VERBOSE: '0' })).stderr, /psss: group: P \(from \.psss\.json\)/, '--verbose beats PSSS_VERBOSE=0');
    const bad = await runCli(['list'], { box, env: { PSSS_VERBOSE: 'maybe' } });
    assert.equal(bad.code, 2, 'a nonsense PSSS_VERBOSE is a usage error');
    assert.match(bad.stderr, /PSSS_VERBOSE must be 1 or 0/, 'and says so');
  } finally {
    box.cleanup();
  }
});

test('.psss.json with a key that looks like a secret is rejected, naming the file and the key', async () => {
  const box = sandbox();
  try {
    for (const key of ['password', 'vaultPassword', 'token', 'apiKey', 'api_key', 'key', 'privateKey', 'secret', 'recoveryKit', 'passphrase', 'credentials']) {
      box.write('.psss.json', JSON.stringify({ vault: './v', [key]: 'x' }));
      const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]] }));
      const r = await runCli(['list'], { box, fake });
      assert.equal(r.code, 2, `a "${key}" key in .psss.json should exit 2`);
      assert.match(r.stderr, new RegExp(`\\.psss\\.json: the key "${key}" looks like a secret`), `the message should name the file and "${key}"`);
      assert.deepEqual(fake.calls, [], `nothing may run when .psss.json holds "${key}"`);
      assert.ok(!r.stderr.includes('"x"'), 'the value must not be echoed');
    }
  } finally {
    box.cleanup();
  }
});

test('config files reject unknown keys, key paths in a committed file, yes, wrong types and bad JSON', async () => {
  const box = sandbox();
  try {
    const cases: Array<{ file: 'project' | 'user'; body: string; message: RegExp; why: string }> = [
      { file: 'project', body: '{"colour":"blue"}', message: /\.psss\.json: unknown key "colour"\. Known keys: vault, group, verbose/, why: 'unknown key' },
      { file: 'project', body: '{"keyFile":"/k"}', message: /\.psss\.json: "keyFile" is not allowed in this file.*user config/, why: 'a key path in a committed file' },
      { file: 'project', body: '{"yes":true}', message: /unknown key "yes"/, why: 'a file must not answer yes for the person' },
      { file: 'project', body: '{"vault":5}', message: /"vault" must be a non-empty string/, why: 'wrong type' },
      { file: 'project', body: '{"verbose":"yes"}', message: /"verbose" must be true or false/, why: 'wrong boolean' },
      { file: 'project', body: '{not json', message: /\.psss\.json is not valid JSON/, why: 'bad JSON' },
      { file: 'project', body: '[]', message: /must hold one JSON object/, why: 'not an object' },
      { file: 'user', body: '{"password":"x"}', message: /config\.json: the key "password" looks like a secret/, why: 'a secret in the user config' },
      { file: 'user', body: '{"nope":1}', message: /config\.json: unknown key "nope"/, why: 'unknown key in the user config' },
    ];
    for (const c of cases) {
      box.write('.psss.json', '{}');
      box.write(userFile(box), '{}');
      box.write(c.file === 'project' ? '.psss.json' : userFile(box), c.body);
      const r = await runCli(['list'], { box, scenario: { items: [ITEMS[0]] } });
      assert.equal(r.code, 2, `${c.why}: exit 2`);
      assert.match(r.stderr, c.message, `${c.why}: message`);
    }
  } finally {
    box.cleanup();
  }
});

test('the user config may hold a key file path, and ~ is expanded to the home folder', async () => {
  const box = sandbox();
  try {
    box.write(userFile(box), JSON.stringify({ keyFile: '~/keys/device.key' }));
    const r = await runCli(['list'], { box, env: { PSSS_VAULT: '~/Vaults' }, scenario: { items: [ITEMS[0]] } });
    assert.equal(r.serviceOptions?.keyFile, path.join(box.home, 'keys', 'device.key'), '~/ in the key file becomes the home folder');
    assert.equal(r.serviceOptions?.vault, path.join(box.home, 'Vaults'), '~/ in PSSS_VAULT becomes the home folder');
  } finally {
    box.cleanup();
  }
});

test('the user config folder follows the platform and takes its base from the injected environment', () => {
  const io = (platform: string, env: Record<string, string>) => ({ platform, env, cwd: '/w' }) as never;
  assert.equal(userConfigPath(io('linux', { HOME: '/home/r' })), '/home/r/.config/psss/config.json', 'Linux default is ~/.config');
  assert.equal(userConfigPath(io('linux', { HOME: '/home/r', XDG_CONFIG_HOME: '/x' })), '/x/psss/config.json', 'Linux honours XDG_CONFIG_HOME');
  assert.equal(userConfigPath(io('darwin', { HOME: '/Users/r' })), '/Users/r/Library/Application Support/psss/config.json', 'macOS uses Application Support');
  assert.equal(userConfigPath(io('win32', { HOME: 'C:\\Users\\r', APPDATA: 'C:\\Users\\r\\AppData\\Roaming' })), 'C:\\Users\\r\\AppData\\Roaming\\psss\\config.json', 'Windows uses %APPDATA%');
});

test('the environment secrets reach the service but have no flag and no config key', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['list'], { box, env: { PSSS_KEY: 'k-env-1', PSSS_PASSWORD_FILE: '/p/pw' }, scenario: { items: [ITEMS[0]] } });
    assert.equal(r.serviceOptions?.key, 'k-env-1', 'PSSS_KEY is given to the service');
    assert.equal(r.serviceOptions?.passwordFile, '/p/pw', 'PSSS_PASSWORD_FILE is given to the service');
    for (const flag of ['--key', '--password', '--password-file']) {
      const bad = await runCli(['list', flag, 'x'], { box });
      assert.equal(bad.code, 2, `${flag} must not exist`);
    }
    box.write('.psss.json', JSON.stringify({ key: 'x' }));
    assert.equal((await runCli(['list'], { box })).code, 2, 'and a config file cannot carry a key');
  } finally {
    box.cleanup();
  }
});

test('key files and device state have their own default folders per platform', async () => {
  const { configDir, defaultKeyFile, stateDir } = await import('../src/config.ts');
  const io = (platform: string, env: Record<string, string>) => ({ platform, env, cwd: '/w' }) as never;
  assert.equal(defaultKeyFile(io('darwin', { HOME: '/Users/r' }), 'Personal'), '/Users/r/.config/psss/keys/Personal.key', 'macOS keys live in ~/.config/psss/keys');
  assert.equal(defaultKeyFile(io('linux', { HOME: '/h', XDG_CONFIG_HOME: '/x' }), 'Team'), '/x/psss/keys/Team.key', 'Linux honours XDG_CONFIG_HOME');
  assert.equal(defaultKeyFile(io('win32', { HOME: 'C:\\U', APPDATA: 'C:\\U\\AppData\\Roaming' }), 'P'), 'C:\\U\\AppData\\Roaming\\psss\\keys\\P.key', 'Windows keys live in %APPDATA%\\psss\\keys');
  assert.equal(configDir(io('linux', { HOME: '/h' })), '/h/.config/psss', 'config folder');
  assert.equal(stateDir(io('darwin', { HOME: '/Users/r' })), '/Users/r/.local/state/psss', 'macOS state in ~/.local/state/psss');
  assert.equal(stateDir(io('linux', { HOME: '/h', XDG_STATE_HOME: '/s' })), '/s/psss', 'Linux honours XDG_STATE_HOME');
  assert.equal(stateDir(io('win32', { HOME: 'C:\\U', LOCALAPPDATA: 'C:\\U\\AppData\\Local' })), 'C:\\U\\AppData\\Local\\psss', 'Windows state in %LOCALAPPDATA%\\psss');
});
