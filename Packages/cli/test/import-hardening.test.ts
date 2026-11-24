// import and export through the real binary and the real service: two at once, a failure part of the way, progress, what is printed about odd
// names, where an export may not go, and the plain words of the errors.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { newDatabase, newEntry, writeKdbx } from '../../kdbx/src/index.ts';
import { withLock } from '../../vault/src/index.ts';
import { failureError } from '../src/commands/command.ts';
import { createVaultService } from '../src/vault-service.ts';
import { FakeVaultService } from '../src/fake-service.ts';
import { BIN, device } from './real-helpers.ts';
import type { Device } from './real-helpers.ts';
import { runCli, sandbox, scenarioFor } from './helpers.ts';

const NOW = new Date(1_700_000_000_000);

function kdbx(d: Device, name: string, entries: Array<Parameters<typeof newEntry>[0]>): { file: string; env: Record<string, string> } {
  const db = newDatabase({ name: 'src', now: NOW });
  for (const e of entries) db.root.entries.push(newEntry(e, { now: NOW }));
  const file = path.join(d.cwd, name);
  writeFileSync(file, writeKdbx(db, { password: 'file-pw' }, { version: '4.1' }));
  const pwFile = path.join(d.root, 'kdbx-pw.txt');
  writeFileSync(pwFile, 'file-pw\n', { mode: 0o600 });
  return { file, env: { PSSS_KDBX_PASSWORD_FILE: pwFile } };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Site ${i}`, username: `user${i}`, password: `pw-${i}` }));
function ready(t: TestContext): Device {
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0, 'setup: init');
  return d;
}
function runAsync(d: Device, args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', BIN, ...args], { cwd: d.cwd, env: d.env(env), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (x) => { stdout += x; });
    child.stderr.on('data', (x) => { stderr += x; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('two imports of one file at once: the vault holds the entries once, and the second says there is nothing new', async (t) => {
  const d = ready(t);
  const { file, env } = kdbx(d, 'Family.kdbx', many(40));
  const [a, b] = await Promise.all([runAsync(d, ['import', file], env), runAsync(d, ['import', file], env)]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const said = [a.stdout, b.stdout].sort();
  assert.match(said[0]!, /^Added 40 items to Only Me\.\n/, 'one run added them');
  assert.match(said[1]!, /^Nothing new to add to Only Me\.\n40 items are already here, unchanged\.\n/, 'the other found them all');
  const list = (JSON.parse(d.psss(['list', '--json']).stdout) as { items: unknown[] }).items;
  assert.equal(list.length, 40, 'the vault holds 40 items, not 80');
  assert.equal(d.psss(['verify']).code, 0);
});

test('another command that needs the vault while an import runs is told so in plain words', (t) => {
  const d = ready(t);
  const state = d.stateDir('Personal');
  const src = `import('${path.join(import.meta.dirname, '..', '..', 'vault', 'src', 'index.ts')}').then(({ withLock }) => withLock(process.argv[1], () => { console.log('held'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 9000); }, { what: 'import' }))`;
  return new Promise<void>((resolve, reject) => {
    const holder = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', src, state], { stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => holder.kill());
    holder.stdout.once('data', () => {
      try {
        const r = d.psss(['list']);
        assert.equal(r.code, 1);
        assert.equal(r.stderr, 'Another psss is importing into this vault right now. Wait for it to finish and try again. Nothing was changed.\n');
        assert.ok(!/state_locked|lock/.test(r.stderr), 'no jargon');
        resolve();
      } catch (e) { reject(e); }
    });
  });
  void withLock;
});

test('an import that stops after k items says how many were added and that running it again finishes the job; exit code 1', async (t) => {
  const d = ready(t);
  const { file } = kdbx(d, 'Family.kdbx', many(10));
  const options = { cwd: d.cwd, home: d.home, platform: process.platform, configDir: path.join(d.config, 'psss'), stateDir: path.join(d.state, 'psss'), vault: d.vaultPath('Personal') };
  const request = { file, credentials: { password: 'file-pw' }, dryRun: false, stripInvalid: false, includeTrash: false, update: false };
  const svc = createVaultService(options);
  assert.equal((await svc.open()).ok, true);
  const stopped = await svc.importKdbx({ ...request, progress: (done) => { if (done === 4) throw new Error('disk exploded'); } });
  assert.equal(stopped.ok, false);
  if (stopped.ok) return;
  const error = failureError({ cwd: d.cwd, env: {}, stdin: {} as never, stdout: { write: () => true }, stderr: { write: () => true }, isTTY: { stdin: false, stdout: false } }, stopped);
  assert.equal(error.exitCode, 1, 'a failure is exit code 1');
  assert.match(error.message, /disk exploded/, 'it says why');
  assert.match(error.message, /it added 4 items\. Those stay in the vault\./, 'it says how many were stored');
  assert.match(error.message, /Run the same command again to finish/, 'and what to do');
  assert.doesNotMatch(error.message, /Nothing was changed/, 'and never claims that nothing changed');
  const again = createVaultService(options);
  assert.equal((await again.open()).ok, true);
  const finished = await again.importKdbx(request);
  assert.ok(finished.ok && finished.value.added === 6 && finished.value.unchanged === 4, 'running it again adds the other six');
  assert.equal((JSON.parse(d.psss(['list', '--json']).stdout) as { items: unknown[] }).items.length, 10);
});

test('--progress writes a line on standard error, never on standard output, never into --json, and nothing without it when not at a terminal', (t) => {
  const d = ready(t);
  const { file, env } = kdbx(d, 'Family.kdbx', many(30));
  const plain = d.psss(['import', file], { env });
  assert.equal(plain.code, 0, plain.stderr);
  assert.doesNotMatch(plain.stderr, /Importing/, 'no progress when stderr is not a terminal and it was not asked for');
  const shown = d.psss(['import', file, '--progress'], { env });
  assert.match(shown.stderr, /Importing 30 of 30\n/, '--progress shows how far it got');
  assert.doesNotMatch(shown.stdout, /Importing/, 'standard output has only the result');
  const json = d.psss(['import', file, '--progress', '--json'], { env });
  assert.doesNotMatch(json.stderr, /Importing/, 'never with --json');
  assert.equal(JSON.parse(json.stdout).file, './Family.kdbx', '--json names the file the way export does');
});

test('odd names in a file cannot forge, flood or reorder a line: they are cut and escaped; a size limit gets no flag hint', (t) => {
  const d = ready(t);
  const { file, env } = kdbx(d, 'Odd.kdbx', [
    { title: `A\nwarning: forged line \u202eevil${'T'.repeat(70_000)}`, username: 'u', password: 'p' },
    { title: 'Notes', username: 'u2', password: 'p', notes: 'N'.repeat(300_000) },
  ]);
  const r = d.psss(['import', file], { env });
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stderr.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 2, `one line per kind and part of an item: ${r.stderr}`);
  assert.ok(lines.every((l) => l.startsWith('warning: ')), 'every line is one of ours: a newline in a title forged nothing');
  assert.ok(lines.every((l) => l.length < 400), 'no line is longer than a sentence and a few names');
  assert.ok(!r.stderr.includes('\u202e'), 'the right-to-left override is not sent to the terminal');
  assert.match(r.stderr, /\\u\{a\}/, 'it is shown as an escape instead');
  assert.match(r.stderr, /^warning: The title is longer than the 65,536 bytes[^\n]*\n/m, 'the title finding');
  assert.match(r.stderr, /^warning: The notes are longer than the 262,144 bytes[^\n]*\n/m, 'and the notes finding are separate lines, each true');
  assert.match(r.stdout, /2 fields were not imported because they are over a size or number limit of an item\./, 'what the file asked for is counted');
  assert.doesNotMatch(r.stdout, /--strip-invalid/, 'a size limit gets no hint: the flag would not help');
  const json = JSON.parse(d.psss(['import', file, '--json'], { env }).stdout) as { issues: Array<{ item?: string }>; items: Array<{ title: string }> };
  assert.ok(json.issues.every((i) => i.item === undefined || [...i.item].length <= 60), '--json names are cut too');
  assert.ok(json.items.every((i) => [...i.title].length <= 60));
});

test('the flag hint shows for fields refused for their characters, and only for those', async () => {
  const { importText } = await import('../src/commands/import.ts');
  const base = { group: 'Only Me', dryRun: false, added: 3, attachments: 0, updated: 0, unchanged: 0, keptYours: 0, changedInFile: 0, conflicts: 0, skippedDeleted: 0, skippedGone: 0, skippedTrash: 0, inFolders: 0, refusedItems: 0, strippedFields: 0, issues: [], items: [] };
  const mixed = importText({ ...base, refusedFields: 5, invalidFields: 2 });
  assert.match(mixed, /2 fields were not imported for characters a KeePass file cannot hold\. Add --strip-invalid to import them without those characters\./);
  assert.match(mixed, /3 fields were not imported because they are over a size or number limit of an item\./);
  assert.equal(mixed.match(/--strip-invalid/g)!.length, 1);
  assert.doesNotMatch(importText({ ...base, refusedFields: 72, invalidFields: 0 }), /--strip-invalid/, '72 fields over a limit: no hint');
});

test('an export may not be written into the vault folder or below it, where it would sync every secret in the clear', (t) => {
  const d = ready(t);
  const vault = d.vaultPath('Personal');
  const before = readdirSync(vault).sort();
  for (const target of [path.join(vault, 'Personal.kdbx'), path.join(vault, 'sub', 'Personal.kdbx')]) {
    const r = d.psss(['export', '--format', 'kdbx', target], { stdin: 'export-pw\n' });
    assert.equal(r.code, 1, 'exit 1');
    assert.match(r.stderr, /is inside .*Personal\.psss, a place this vault is kept in and shared from\./, 'it names the folder');
    assert.match(r.stderr, /Choose another place for the file, outside the vault folder\.\n$/, 'and the way out');
    assert.equal(existsSync(target), false, 'nothing was written');
    const dry = d.psss(['export', '--format', 'kdbx', target, '--dry-run']);
    assert.equal(dry.code, 1, 'a dry run refuses too');
  }
  assert.deepEqual(readdirSync(vault).sort(), before, 'the vault folder is as it was');
  const fine = d.psss(['export', '--format', 'kdbx', path.join(d.cwd, 'Personal.kdbx')], { stdin: 'export-pw\n' });
  assert.equal(fine.code, 0, fine.stderr);
});

test('errors read as sentences: no codes in front, no two periods, and a group that is not there is said plainly', async (t) => {
  const d = ready(t);
  const { file, env } = kdbx(d, 'Family.kdbx', many(2));
  const r = d.psss(['import', file, '--group', 'Nope'], { env });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'This computer cannot add items to a group called "Nope". Nothing was changed.\n');
  const svc = createVaultService({ cwd: '/w', home: '/h', platform: 'linux', configDir: '/c', stateDir: '/s' }) as unknown as { translate(e: unknown): { message: string } };
  const { VaultError } = await import('../../vault/src/index.ts');
  for (const e of [new VaultError('no_group', 'this device cannot write to any group'), new VaultError('group_required', 'there is more than one group: say which'), new VaultError('ambiguous_group', 'several groups named X'), new VaultError('bad_state', 'x is not device state.'), new VaultError('state_locked', 'Another psss is running.')]) {
    const text = svc.translate(e).message;
    assert.doesNotMatch(text, /[a-z]+_[a-z]+:/, `no code in: ${text}`);
    assert.doesNotMatch(text, /\.\./, `no two periods in: ${text}`);
  }
});

test('import --help lists its flags on the usage line', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['import', '--help'], { box, fake: new FakeVaultService(scenarioFor(box)) });
    assert.match(r.stdout, /^Usage: psss import <file> \[--dry-run\] \[--strip-invalid\] \[--include-trash\] \[--update\] \[--kdbx-key-file <path>\] \[--progress\] \[--json\]\n/);
  } finally {
    box.cleanup();
  }
});
