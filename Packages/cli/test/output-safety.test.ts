// Names from a vault are data: in `--json` and in every sentence they are written so that a direction mark or a control character cannot reorder
// or hide text. Also the words for a location that refuses a sync, and for a vault folder that cannot be read.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import { parseReference } from '../src/reference.ts';
import { runCli, sandbox, scenarioFor } from './helpers.ts';
import { device, segments } from './real-helpers.ts';

const RLO = '\u202e';
const canBlock = process.getuid?.() !== 0;
const items = [{ id: 'a1b2c3d4', title: `Ex${RLO}ample`, group: 'Only Me', fields: { [`to${RLO}ken`]: 'v' } }];
const hidden = (text: string) => /[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2028\u2029]/.test(text);

/** Registered before the device, so the folders are writable again when the device's own cleanup runs. */
function unblockLater(t: TestContext): string[] {
  const dirs: string[] = [];
  t.after(() => { for (const d of dirs) { try { chmodSync(d, 0o700); } catch { /* gone */ } } });
  return dirs;
}

test('get --json: the reference stays exact but has no raw direction mark (it is %-encoded and parses back), the names are escaped', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: items as never }));
    const r = await runCli(['get', `psss://Ex%E2%80%AEample/to%E2%80%AEken`, '--json'], { box, fake });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!hidden(r.stdout), 'no raw direction mark on standard output');
    const body = JSON.parse(r.stdout) as { reference: string; field: string; item: { title: string } };
    assert.match(body.reference, /^psss:\/\/id:[0-9a-f]+\/to%E2%80%AEken$/);
    assert.equal(parseReference(body.reference, 'field').field, `to${RLO}ken`, 'the reference reads back as the same field');
    assert.equal(body.field, 'to\\u{202e}ken');
    assert.equal(body.item.title, 'Ex\\u{202e}ample');
  } finally {
    box.cleanup();
  }
});

test('errors print an item title and a field name through the same escape and cut as warnings', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: items as never }));
    const noField = await runCli(['get', `psss://Ex%E2%80%AEample/nope${'x'.repeat(100)}`], { box, fake });
    assert.equal(noField.code, 3);
    assert.ok(!hidden(noField.stderr), noField.stderr);
    assert.match(noField.stderr, /^"Ex\\u\{202e\}ample" has no field called "nopex+…"\.\nIt has: to\\u\{202e\}ken\.\n$/);
    const noItem = await runCli(['get', `psss://Missing%E2%80%AE/token`], { box, fake });
    assert.ok(!hidden(noItem.stderr), noItem.stderr);
    assert.match(noItem.stderr, /item called "Missing\\u\{202e\}"/);
    const near = await runCli(['set', `psss://Exampl%E2%80%AEe/token`], { box, fake, stdin: 'v' });
    assert.ok(!hidden(near.stderr), near.stderr);
    const done = await runCli(['rm', `psss://Ex%E2%80%AEample`], { box, fake });
    assert.ok(!hidden(done.stdout + done.stderr), done.stdout);
  } finally {
    box.cleanup();
  }
});

test('real: sync against a location that refuses writes says why in plain words, names it, shows no raw error or full path, and exits 1', (t) => {
  if (!canBlock) return t.skip('running as root');
  const restore = unblockLater(t);
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0);
  assert.equal(d.psss(['set', '--create', 'psss://Existing/password'], { stdin: 'p0' }).code, 0);
  const dir = path.dirname(segments(d.vaultPath('Personal'))[0]!);
  restore.push(dir);
  chmodSync(dir, 0o500);
  assert.equal(d.psss(['set', 'psss://Existing/password'], { stdin: 'p1' }).code, 0, 'setup: a change that cannot be delivered');
  const r = d.psss(['sync']);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.ok(!/EACCES|EPERM|ENOENT/.test(r.stdout + r.stderr), 'no error code');
  assert.ok(!(r.stdout + r.stderr).includes(d.home), 'no full path with the home folder');
  assert.match(r.stderr, /This computer \(~\/Psss\/Personal\.psss\) could not be reached: permission denied\n/);
  const j = d.psss(['sync', '--json']);
  assert.equal(j.code, 1);
  assert.equal((JSON.parse(j.stdout) as { locations: Array<{ error?: string }> }).locations[0]!.error, 'permission denied');
});

test('real: a vault folder that exists but cannot be read says so (permission denied), not that there is no vault; exit 4', (t) => {
  if (!canBlock) return t.skip('running as root');
  const restore = unblockLater(t);
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0);
  restore.push(d.vaultFolder);
  chmodSync(d.vaultFolder, 0o000);
  const r = d.psss(['status']);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /^The vault folder ~\/Psss cannot be read \(permission denied\)\./);
  assert.ok(!r.stderr.includes('There is no vault'));
  chmodSync(d.vaultFolder, 0o700);
  chmodSync(d.vaultPath('Personal'), 0o000);
  restore.push(d.vaultPath('Personal'));
  const c = d.psss(['status']);
  assert.equal(c.code, 4, c.stdout + c.stderr);
  assert.match(c.stderr, /^The vault folder ~\/Psss\/Personal\.psss cannot be read \(permission denied\)\./);
  const missing = d.psss(['status'], { env: { PSSS_VAULT: path.join(d.cwd, 'nothing') } });
  assert.match(missing.stderr, /^There is no vault at/);
});
