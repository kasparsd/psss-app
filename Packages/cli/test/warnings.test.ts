import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import type { VaultIssue } from '../src/service.ts';
import { ITEMS, runCli, sandbox, scenarioFor } from './helpers.ts';

const issue: VaultIssue = {
  code: 'gap',
  location: '/icloud/Personal.psss',
  detail: 'group 1a2b3c4d, chain 99aa/77bb: records 4 to 5 missing',
  plain: 'A record is missing from the middle of a device history.',
};
const A11_PROBLEM = 'warning: "Personal" has a problem, so the value above may be\nout of date. Run psss verify to see what is wrong.\n';

test('A11: get and set print one warning on standard error after the result when the vault has a problem, and keep their exit code', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]], issues: [issue, { ...issue, code: 'fork' }] }));
    const got = await runCli(['get', 'psss://Example API/token'], { box, fake });
    assert.equal(got.stdout, 'sk-example-old', 'get still prints the bare value on standard output');
    assert.equal(got.stderr, A11_PROBLEM, 'exactly one warning, in the words of frame A11, even with two issues');
    assert.equal(got.combined, `sk-example-old${A11_PROBLEM}`, 'the warning comes after the value, as in the mock');
    assert.equal(got.code, 0, 'a problem never changes the exit code of a read');
    const set = await runCli(['set', 'psss://Example API/token'], { box, fake, stdin: 'new\n' });
    assert.equal(set.stderr, 'warning: "Personal" has a problem, so the new value may not show up\nuntil it is fixed. Run psss verify to see what is wrong.\n', 'set says the new value may not show up');
    assert.match(set.stdout, /^Saved "token"/, 'after the Saved line');
    assert.equal(set.code, 0, 'and still exits 0');
    assert.equal(set.stdout.includes('new'), false, 'and never prints the value');
    const json = await runCli(['get', 'psss://Example API/token', '--json'], { box, fake });
    assert.equal(json.stderr, A11_PROBLEM, 'get --json warns too, on standard error');
    assert.equal(JSON.parse(json.stdout).value, 'new', 'and keeps standard output clean JSON');
  } finally {
    box.cleanup();
  }
});

test('A11: list, status and run warn in their own words; a vault with no issues, or a service that does not know issues, is silent', async () => {
  const box = sandbox();
  try {
    const bad = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]], issues: [issue] }));
    const list = await runCli(['list'], { box, fake: bad });
    assert.equal(list.stderr, 'warning: "Personal" has a problem, so the result above may be\nout of date. Run psss verify to see what is wrong.\n', 'list says the result above');
    assert.equal(list.code, 0, 'list exits 0');
    const status = await runCli(['status'], { box, fake: bad });
    assert.match(status.stderr, /^warning: "Personal" has a problem, so the result above may be\n/, 'status says the result above');
    const run = await runCli(['run', '--env', 'T=psss://Example API/token', '--', process.execPath, '-e', 'process.exit(3)'], { box, fake: bad });
    assert.equal(run.stderr, 'warning: "Personal" has a problem, so the program ran with a value\nthat may be out of date. Run psss verify to see what is wrong.\n', 'run says the program ran with a value that may be out of date');
    assert.equal(run.code, 3, 'and passes on the exit code of the program');
    const verify = await runCli(['verify'], { box, fake: bad });
    assert.equal(verify.stderr, '', 'verify has its own report and adds no warning');
    const clean = await runCli(['list'], { box, fake: new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]], issues: [] })) });
    assert.equal(clean.stderr, '', 'no issues, no warning');
    const old = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]] }));
    const open = old.open.bind(old);
    old.open = async () => {
      const r = await open();
      if (r.ok) delete r.value.issues;
      return r;
    };
    assert.equal((await runCli(['list'], { box, fake: old })).stderr, '', 'a service without the property counts as no issues');
  } finally {
    box.cleanup();
  }
});

test('A11: a key file that other users can read is warned about before the value, with the fix; Windows is skipped; the output and exit code are unchanged', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0]], keyFileReadableByOthers: true }));
    const r = await runCli(['get', 'psss://Example API/token'], { box, fake });
    const key = '~/.config/psss/keys/Personal.key';
    assert.equal(r.combined, `warning: ${key} can be read by\nother users. Run: chmod 600 ${key}\nsk-example-old`, 'the warning comes first and names the fix, as in the second example of A11');
    assert.equal(r.code, 0, 'exit 0');
    const win = await runCli(['get', 'psss://Example API/token'], { box, fake, platform: 'win32' });
    assert.equal(win.stderr, '', 'no such modes on Windows, so no warning');
    assert.equal(win.stdout, 'sk-example-old', 'the value still comes out');
    const quiet = await runCli(['rm', 'psss://Example API'], { box, fake });
    assert.equal(quiet.stderr, '', 'rm is not one of the commands that warn');
  } finally {
    box.cleanup();
  }
});

test('A8: verify prints the plain text of each finding, and the technical detail only under --verbose and in --json', async () => {
  const box = sandbox();
  try {
    const verify = {
      records: 3,
      locations: 1,
      problems: [
        {
          kind: 'other' as const,
          location: '/icloud/Personal.psss',
          message: "A record is missing from the middle of a device's history\nin /icloud/Personal.psss. The ones after it wait\nfor it.",
          detail: 'group 1a2b3c4d, chain 99aa/77bb: records 4 to 5 missing',
        },
      ],
    };
    const plain = await runCli(['verify'], { box, scenario: { verify } });
    assert.equal(plain.stdout, `Checked 3 records in 1 location.\n${verify.problems[0].message}\n`, 'plain words only');
    assert.equal(/chain|1a2b3c4d|99aa/.test(plain.combined), false, 'no ids and no chain names in the plain text');
    assert.equal(plain.code, 2, 'exit 2');
    const loud = await runCli(['verify', '--verbose'], { box, scenario: { verify } });
    assert.match(loud.stdout, /Detail: group 1a2b3c4d, chain 99aa\/77bb/, '--verbose adds the raw detail');
    const json = JSON.parse((await runCli(['verify', '--json'], { box, scenario: { verify } })).stdout);
    assert.equal(json.problems[0].detail, verify.problems[0].detail, '--json carries the detail');
    assert.equal(json.problems[0].message, verify.problems[0].message, 'and the plain message');
  } finally {
    box.cleanup();
  }
});

test('sync with one location prints no "Reading" line; with several it prints one per location', async () => {
  const box = sandbox();
  try {
    const one = await runCli(['sync'], { box });
    assert.equal(one.stderr, '', 'a single local location needs no progress');
    assert.equal(one.stdout, 'This computer: nothing new.\nMerged with 1 location.\n', 'and the result is unchanged');
  } finally {
    box.cleanup();
  }
});
