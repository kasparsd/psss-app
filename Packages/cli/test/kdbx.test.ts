// import and export in process, against the fake service: usage errors, where the password comes from, the streams, --json, exit codes.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import { norm, runCli, sandbox, scenarioFor } from './helpers.ts';

const PW = 'pw-distinct-91c3d6-do-not-print';

function setup(existing?: ReturnType<typeof sandbox>) {
  const box = existing ?? sandbox();
  const file = path.join(box.cwd, 'Family.kdbx');
  const fake = new FakeVaultService(
    scenarioFor(box, {
      vaultName: 'Personal',
      groups: ['Personal'],
      kdbxFiles: {
        [file]: { password: PW, items: 3, attachments: 1, trashed: 2, inFolders: 2, issues: [{ kind: 'historyOtherFields', item: 'Mail', detail: 'Earlier versions of this entry changed more than the password. Only earlier passwords are imported.' }] },
        [path.join(box.cwd, 'keyonly.kdbx')]: { password: '', items: 1 },
        [path.join(box.cwd, 'broken.kdbx')]: { problem: 'corrupt' },
        [path.join(box.cwd, 'text.kdbx')]: { problem: 'notKdbx' },
        [path.join(box.cwd, 'huge.kdbx')]: { problem: 'tooLarge' },
      },
    }),
  );
  return { box, file, fake };
}

test('import: the password is typed, piped, or read from PSSS_KDBX_PASSWORD_FILE, and never printed', async () => {
  const { box, file, fake } = setup();
  try {
    const typed = await runCli(['import', file], { box, fake, typed: `${PW}\n` });
    assert.equal(typed.code, 0, 'a typed password opens the file');
    assert.equal(fake.kdbxPassword, PW, 'the service got the password that was typed');
    assert.match(typed.stderr, /^Password for Family\.kdbx \(not shown\): \n/, 'the prompt names the file and says nothing is echoed');
    const piped = await runCli(['import', file], { box, fake: setup(box).fake, stdin: `${PW}\n` });
    assert.equal(piped.code, 0, 'a piped password opens the file');
    const pwFile = box.write('pw.txt', `${PW}\n`);
    const viaFile = await runCli(['import', file], { box, fake: setup(box).fake, env: { PSSS_KDBX_PASSWORD_FILE: pwFile }, stdin: '' });
    assert.equal(viaFile.code, 0, 'PSSS_KDBX_PASSWORD_FILE opens the file with no prompt');
    assert.doesNotMatch(viaFile.stderr, /Password for/, 'and asks nothing');
    for (const r of [typed, piped, viaFile]) assert.ok(!r.combined.includes(PW), 'the password is in no output');
    const none = await runCli(['import', file], { box, fake: setup(box).fake, stdin: '' });
    assert.equal(none.code, 2, 'no password and nothing piped is a usage error');
    assert.match(none.stderr, /No password was given for \.\/Family\.kdbx\./, 'and says what to do');
    const missingFile = await runCli(['import'], { box, fake });
    assert.equal(missingFile.code, 2, 'no file is a usage error');
    const argument = await runCli(['import', file, PW], { box, fake });
    assert.equal(argument.code, 2, 'a password as an argument is refused');
    assert.ok(!argument.combined.includes(PW), 'and is not repeated');
  } finally {
    box.cleanup();
  }
});

test('import: a key file alone, and the words for each way a file can fail', async () => {
  const { box, fake } = setup();
  try {
    const keyOnly = await runCli(['import', 'keyonly.kdbx', '--kdbx-key-file', 'my.key'], { box, fake, typed: '\n' });
    assert.equal(keyOnly.code, 0, 'with a key file the password may be left empty');
    assert.match(keyOnly.stderr, /Password for keyonly\.kdbx \(not shown, Enter for none\): /, 'the prompt says Enter is enough');
    assert.equal(fake.kdbxRequests.at(-1)?.keyFile, 'my.key', 'the key file path went to the service');
    const cases: Array<[string[], number, RegExp, string?]> = [
      [['import', 'Family.kdbx'], 4, /^The password or key file does not open \.\/Family\.kdbx\. Nothing was changed\.\nA damaged file looks the same\.\n$/, 'wrong'],
      [['import', 'broken.kdbx'], 1, /^\.\/broken\.kdbx is damaged, so none of it was read\. Nothing was changed\.\n$/],
      [['import', 'text.kdbx'], 1, /^\.\/text\.kdbx is not a KeePass file \(KDBX 3 or 4\)\. Nothing was changed\.\n$/],
      [['import', 'huge.kdbx'], 1, /^\.\/huge\.kdbx is larger than Psss will read/],
      [['import', 'nothing.kdbx'], 1, /^There is no file at \.\/nothing\.kdbx\. Nothing was changed\.\n$/],
    ];
    for (const [argv, code, text, pw] of cases) {
      const r = await runCli(argv, { box, fake, stdin: `${pw ?? 'x'}\n` });
      assert.equal(r.code, code, `${argv.join(' ')} should exit ${code}`);
      assert.equal(r.stdout, '', 'a failure prints nothing on standard output');
      assert.match(r.stderr, text, `${argv.join(' ')} should say so plainly`);
    }
  } finally {
    box.cleanup();
  }
});

test('import: what a person reads, a second run, and --json', async () => {
  const { box, file, fake } = setup();
  try {
    const first = await runCli(['import', file], { box, fake, stdin: `${PW}\n` });
    assert.equal(
      norm(first.stdout),
      `Added 3 items and 1 attachment to Personal.
2 entries in the file's Recycle Bin were left out. Add --include-trash to bring them in as deleted items.
2 items were in folders. Psss has no folders, so they are in Personal with the rest.
`,
      'the first run says what came in and what did not',
    );
    assert.equal(first.stderr, 'warning: Earlier versions of this entry changed more than the password. Only earlier passwords are imported. ("Mail")\n', 'a finding is one warning on standard error');
    const again = await runCli(['import', file], { box, fake, stdin: `${PW}\n` });
    assert.match(again.stdout, /^Nothing new to add to Personal\.\n3 items are already here, unchanged\.\n/, 'the second run reports unchanged, and adds nothing');
    const json = await runCli(['import', file, '--json', '--dry-run'], { box, fake, stdin: `${PW}\n` });
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
    assert.equal(parsed.dryRun, true, 'JSON says it was a dry run');
    assert.equal(parsed.unchanged, 3, 'JSON carries the counts');
    assert.equal(parsed.file, './Family.kdbx', 'and the file as a person would name it');
    assert.ok(!json.stdout.includes(PW), 'and no password');
    const flagged = await runCli(['import', file, '--include-trash', '--update', '--strip-invalid'], { box, fake: setup(box).fake, stdin: `${PW}\n` });
    assert.equal(flagged.code, 0, 'the flags are accepted');
  } finally {
    box.cleanup();
  }
});

test('export: needs --format kdbx and a file, asks for the new password, refuses to replace a file, and a dry run asks for nothing', async () => {
  const { box, fake } = setup();
  try {
    assert.equal((await runCli(['export', 'out.kdbx'], { box, fake })).code, 2, 'no format is a usage error');
    const wrong = await runCli(['export', '--format', 'csv', 'out.csv'], { box, fake });
    assert.equal(wrong.code, 2, 'another format is a usage error');
    assert.match(wrong.stderr, /writes only kdbx/, 'and says what is written');
    assert.equal((await runCli(['export', '--format', 'kdbx'], { box, fake })).code, 2, 'no file is a usage error');
    const dry = await runCli(['export', '--format', 'kdbx', 'out.kdbx', '--dry-run'], { box, fake, stdin: '' });
    assert.equal(dry.code, 0, 'a dry run needs no password');
    assert.equal(norm(dry.stdout), 'Would write ./out.kdbx with 0 items.\nNothing was written.\n', 'and says nothing was written');
    assert.doesNotMatch(dry.stderr, /Password/, 'a dry run asks nothing');
    const real = await runCli(['export', '--format', 'kdbx', 'out.kdbx'], { box, fake, stdin: `${PW}\n` });
    assert.equal(real.code, 0, 'a piped password writes the file');
    assert.equal(fake.kdbxPassword, PW, 'the service got it');
    assert.ok(!real.combined.includes(PW), 'and nothing printed it');
    const again = await runCli(['export', '--format', 'kdbx', 'out.kdbx'], { box, fake, stdin: `${PW}\n` });
    assert.equal(again.code, 1, 'a file that exists is not replaced');
    assert.equal(again.stderr, './out.kdbx already exists, so nothing was written.\nChoose another name, or add --force to replace it.\n', 'and the way out is named');
    const forced = await runCli(['export', '--format', 'kdbx', 'out.kdbx', '--force', '--json'], { box, fake, stdin: `${PW}\n` });
    assert.equal(forced.code, 0, '--force replaces it');
    assert.equal((JSON.parse(forced.stdout) as { file: string }).file, './out.kdbx', 'JSON names the file');
  } finally {
    box.cleanup();
  }
});
