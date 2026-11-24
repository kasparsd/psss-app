// Golden tests for the approved terminal frames A1 to A10 in Design/Mocks/command-line-and-agents.html (part 1).
// Each expectation is the mock's terminal text, character for character; the exit code is the `echo $?` of the frame.
// Compared as shown on a terminal: trailing spaces are invisible in the mock, so they are ignored, and a typed answer
// at a prompt is put back where the terminal would have echoed it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import { rootHelp } from '../src/help.ts';
import { ITEMS, norm, runCli, sandbox, scenarioFor } from './helpers.ts';

const DEPLOY = (token: string | null) =>
  `#!/bin/sh\n${token === null ? '' : `[ "$DEPLOY_TOKEN" = "${token}" ] || { echo "wrong token" >&2; exit 9; }\n`}${
    token === null ? '' : 'echo "Deploying to example.com ..."\necho "Done."\n'
  }`;

test('A1: init in a terminal says what was made, where, who holds the key, offers a way back, and takes "Not now"', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['init', 'Personal'], { box, typed: '2\n', stdoutTty: true });
    const mock = `Created the vault "Personal".

  Where   ~/Psss/Personal.psss
          A folder of encrypted files. Nothing is uploaded.
  Key     ~/.config/psss/keys/Personal.key
          This computer's key. Without it nobody can open the
          vault, not even Psss.

How do you want a way back if that file is lost?
  1  A vault password
  2  Not now
Choose 1 or 2: 2

Done. Add a way back later with: psss key password set
Next: psss set --create "psss://Example API/token"
`;
    const shown = r.combined.replace('Choose 1 or 2: ', 'Choose 1 or 2: 2\n');
    assert.equal(norm(shown), mock, 'the whole terminal session should read exactly as frame A1');
    assert.equal(r.code, 0, 'A1 should exit 0');
    assert.match(r.stdout, /^Created the vault "Personal"\./, 'the results go to standard output');
    assert.match(r.stderr, /^How do you want a way back/, 'the question goes to standard error so a pipe stays clean');
    assert.equal(r.stdin?.rawMode, false, 'the terminal must not be left in raw mode');
  } finally {
    box.cleanup();
  }
});

test('A2: init in a script asks nothing, warns on standard error and exits 0', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['init', 'Team', '--vault', './vault'], { box, stdin: '' });
    assert.equal(r.stdout, 'Created the vault "Team" in ./vault/Team.psss\nKey file: ~/.config/psss/keys/Team.key (readable by you only)\n', 'A2 standard output');
    assert.equal(
      r.stderr,
      'warning: that key file is the only way into the vault.\nRun psss key password set, or pass --no-recovery\nto stop this warning.\n',
      'A2 warning on standard error',
    );
    assert.equal(r.code, 0, 'A2 should exit 0 so a script can create a vault');
  } finally {
    box.cleanup();
  }
});

test('A3: status uses the words of the app and says what "Behind" cannot know', async () => {
  const box = sandbox();
  try {
    const personal = path.join(box.home, 'Psss', 'Personal.psss');
    const icloud = path.join(box.home, 'iCloud', 'Psss', 'Personal.psss');
    const r = await runCli(['status'], {
      box,
      stdoutTty: true,
      scenario: {
        itemCount: 42,
        locations: [
          { label: 'This computer', path: personal, state: 'upToDate' },
          { label: 'iCloud Drive', path: icloud, state: 'behind' },
        ],
      },
    });
    const mock = `Vault     Personal   1 group (Only Me), 42 items
Key       this computer's key file
Way back  none yet. Add one with: psss key password set
Kept in
  This computer    ~/Psss/Personal.psss             Up to date
  iCloud Drive     ~/iCloud/Psss/Personal.psss      Behind
Behind: psss has not seen everything this location holds.
It cannot know what a location has not delivered yet.
Run psss sync to merge.
`;
    assert.equal(r.stdout, mock, 'A3 standard output');
    assert.equal(r.stderr, '', 'A3 prints nothing on standard error');
    assert.equal(r.code, 0, 'A3 exits 0 even when a location is behind');
  } finally {
    box.cleanup();
  }
});

test('A4: set reads without echo, get prints the bare value, list shows names and never values', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(
      scenarioFor(box, {
        items: [
          { id: 'a1b2c3d4', title: 'Example API', username: 'robin@example.com', fields: { token: 'sk-example-old' } },
          { id: '7f3a9c21', title: 'Example Bank', username: 'robin@example.com', fields: { password: 'bank-pw-1', code: '123456' } },
        ],
      }),
    );
    const set = await runCli(['set', 'psss://Example API/token'], { box, fake, typed: 'sk-example-0000\r', stdoutTty: true });
    assert.equal(
      norm(set.combined),
      'Value (not shown):\nSaved "token" in Example API (Personal).\nThe earlier value is kept under previous values.\n',
      'A4 set: the prompt, then what was saved, with the value shown nowhere',
    );
    assert.equal(set.code, 0, 'A4 set exits 0');
    assert.equal(set.stdin?.rawMode, false, 'raw mode is restored after typing a value');
    assert.deepEqual(set.stdin?.rawModeCalls, [true, false], 'raw mode is switched on for the value and off again');

    const get = await runCli(['get', 'psss://Example API/token'], { box, fake, stdoutTty: true });
    assert.equal(get.stdout, 'sk-example-0000\n', 'A4 get prints the bare value and nothing else');
    assert.equal(get.stderr, '', 'A4 get prints nothing on standard error');

    const list = await runCli(['list'], { box, fake, stdoutTty: true });
    assert.equal(
      list.stdout,
      'Example API    robin@example.com    token\nExample Bank   robin@example.com    password, code\n',
      'A4 list: names, accounts and field names',
    );
    assert.ok(!list.combined.includes('sk-example'), 'list must never show a value');
  } finally {
    box.cleanup();
  }
});

test('A5: run puts the value in the program environment and prints nothing of its own', async () => {
  const box = sandbox();
  try {
    box.write('deploy.sh', DEPLOY('sk-example-0000'), 0o755);
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ id: 'a1b2c3d4', title: 'Example API', fields: { token: 'sk-example-0000' } }] }));
    const r = await runCli(['run', '--env', 'DEPLOY_TOKEN=psss://Example API/token', '--', './deploy.sh'], { box, fake, stdoutTty: true });
    assert.equal(r.stdout, 'Deploying to example.com ...\nDone.\n', 'A5 shows only what the program printed');
    assert.equal(r.stderr, '', 'A5 prints nothing on standard error');
    assert.equal(r.code, 0, 'A5 passes on the program exit code, 0');
  } finally {
    box.cleanup();
  }
});

test('A6: a name that matches two items lists them by id and exits 3; a name that matches none says so and exits 3', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(
      scenarioFor(box, {
        items: [
          { id: '7f3a9c21', title: 'Example', username: 'robin@example.com', fields: { password: 'p1' } },
          { id: 'b01d5e44', title: 'Example', username: 'sam@example.com', fields: { password: 'p2' } },
          { id: 'a1b2c3d4', title: 'Example API', username: 'robin@example.com', fields: { token: 't' } },
        ],
      }),
    );
    const two = await runCli(['get', 'psss://Example/password'], { box, fake });
    assert.equal(
      two.combined,
      `"Example" matches 2 items in Personal. Use one of these:
  psss://id:7f3a9c21/password   Example   robin@example.com
  psss://id:b01d5e44/password   Example   sam@example.com
`,
      'A6 ambiguous',
    );
    assert.equal(two.stdout, '', 'an error leaves standard output empty');
    assert.equal(two.code, 3, 'A6 ambiguous exits 3');

    const near = await runCli(['get', 'psss://Exampel/password'], { box, fake });
    assert.equal(
      near.combined,
      'There is no item called "Exampel" in Personal.\nDid you mean: Example, Example API?\nSee what is there with: psss list\n',
      'A6 no such item, with hints',
    );
    assert.equal(near.code, 3, 'A6 no such item exits 3, the same as ambiguous');
    const none = await runCli(['get', 'psss://Nothing/password'], { box, fake });
    assert.equal(none.combined, 'There is no item called "Nothing" in Personal.\nSee what is there with: psss list\n', 'no near miss, no hint line');
    assert.equal(none.code, 3, 'exit 3');
    assert.equal((await runCli(['get', 'psss://example api/token'], { box, fake })).stdout, 't', 'a title matches ignoring case');
    assert.equal((await runCli(['get', 'psss://Exam/token'], { box, fake })).code, 3, 'a prefix is never a match, so a script cannot get another item');
  } finally {
    box.cleanup();
  }
});

test('A7: a missing key file names the vault, the file and the two ways in, and exits 4', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['get', 'psss://Example API/token'], { box, scenario: { keyState: 'keyFileMissing', items: [ITEMS[0]] } });
    assert.equal(
      r.combined,
      `Cannot open the vault "Personal".
This computer's key file is missing: ~/.config/psss/keys/Personal.key
Point PSSS_KEY_FILE at your key file, or use the vault
password with PSSS_PASSWORD_FILE.
`,
      'A7 text',
    );
    assert.equal(r.code, 4, 'A7 exits 4');
  } finally {
    box.cleanup();
  }
});

test('A8: verify says all match and exits 0; a changed record and a rolled-back location are reported and exit 2', async () => {
  const box = sandbox();
  try {
    const icloud = path.join(box.home, 'iCloud', 'Psss', 'Personal.psss');
    const clean = await runCli(['verify'], { box, scenario: { verify: { records: 1204, locations: 2, problems: [] } } });
    assert.equal(
      clean.combined,
      'Checked 1,204 records in 2 locations.\nAll of them match. Nothing is missing that this\ncomputer has seen before.\n',
      'A8 clean',
    );
    assert.equal(clean.code, 0, 'A8 clean exits 0');

    const bad = await runCli(['verify'], {
      box,
      scenario: {
        verify: {
          records: 1204,
          locations: 2,
          problems: [
            { kind: 'changed', location: icloud, count: 1 },
            { kind: 'missing', location: icloud },
            {
              kind: 'other',
              location: icloud,
              message: "A record is missing from the middle of a device's history\nin ~/iCloud/Psss/Personal.psss. The ones after it wait\nfor it.",
              detail: 'group 1a2b3c4d, chain 99aa/77bb: records 4 to 5 missing',
            },
          ],
        },
      },
    });
    assert.equal(
      bad.combined,
      `Checked 1,204 records in 2 locations.
1 record in ~/iCloud/Psss/Personal.psss was changed after
it was written. It is ignored.
That location is missing records this computer saw before.
It may have been rolled back.
A record is missing from the middle of a device's history
in ~/iCloud/Psss/Personal.psss. The ones after it wait
for it.
`,
      'A8 problems',
    );
    assert.equal(bad.code, 2, 'A8 problems exit 2, the code of a failed check');
  } finally {
    box.cleanup();
  }
});

test('A9: import and export are drawn in the mock but not built yet: they say so and exit 1', async () => {
  const box = sandbox();
  try {
    for (const name of ['import', 'export']) {
      const r = await runCli([name, 'x.kdbx', '--dry-run'], { box });
      assert.equal(r.stderr, `psss ${name} is not built yet.\n`, `psss ${name} should say it is not built yet`);
      assert.equal(r.code, 1, `psss ${name} should exit 1`);
    }
  } finally {
    box.cleanup();
  }
});

test('A10: in CI a missing reference is a usage error, exit 2, and no list is offered; run works with only environment variables', async () => {
  const box = sandbox();
  try {
    box.write('deploy.sh', '#!/bin/sh\nexit 0\n', 0o755);
    const env = { CI: 'true', PSSS_VAULT: path.join(box.root, 'vault'), PSSS_KEY_FILE: path.join(box.root, 'key') };
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ id: 'c0ffee01', title: 'Deploy', fields: { token: 'tok' } }] }));
    const ran = await runCli(['run', '--env', 'DEPLOY_TOKEN=psss://Deploy/token', '--', './deploy.sh'], { box, fake, env });
    assert.equal(ran.combined, '', 'A10 run prints nothing when the program prints nothing');
    assert.equal(ran.code, 0, 'A10 run exits 0');
    assert.equal(ran.serviceOptions?.vault, env.PSSS_VAULT, 'the runner provides the vault through PSSS_VAULT');
    assert.equal(ran.serviceOptions?.keyFile, env.PSSS_KEY_FILE, 'the runner provides the key file through PSSS_KEY_FILE');

    const get = await runCli(['get'], { box, fake, env, stdin: 'would-be-choice\n' });
    assert.equal(
      get.combined,
      `psss get needs a reference, such as
"psss://Example API/token". No terminal is attached,
so Psss cannot offer a list to choose from.
`,
      'A10 text',
    );
    assert.equal(get.code, 2, 'A10 exits 2');
    assert.deepEqual(fake.calls.filter((c) => c === 'get' || c === 'open').length, 2, 'get with no reference must not open the vault or read standard input to choose (only the run above did)');
  } finally {
    box.cleanup();
  }
});

test('help: the golden file matches the real --help output', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['--help'], { box, noService: true });
    const golden = readFileSync(new URL('./golden/help.txt', import.meta.url), 'utf8');
    assert.equal(r.stdout, golden, 'psss --help changed: if that is intended, update test/golden/help.txt and the docs');
    assert.equal(r.stdout, rootHelp('0.0.0'), 'the help comes from the registered commands');
    assert.equal(r.code, 0, '--help exits 0');
  } finally {
    box.cleanup();
  }
});
