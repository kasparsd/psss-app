import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTACHMENT_MAX_BYTES, VaultError } from '../src/index.ts';
import { newVault } from './helpers.ts';

const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

test('a file put on an item reads back exactly, across chunks, and verify stays clean', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  const big = bytes(2 * 1024 * 1024 + 5);
  const w = e.vault.putFile('psss://Certs/password', 'ca.pem', big);
  assert.equal(w.replaced, false);
  e.vault.putFile('psss://Certs/password', 'empty.txt', new Uint8Array());
  const list = e.vault.files('psss://Certs/password');
  assert.ok(list.kind === 'files');
  assert.deepEqual(list.files.map((f) => [f.name, f.size]), [['ca.pem', big.length], ['empty.txt', 0]]);
  const got = e.vault.readFile('psss://Certs/password', 'CA.PEM');
  assert.ok(got.kind === 'file' && Buffer.from(got.data).equals(Buffer.from(big)), 'the bytes are the same (the name is found ignoring case)');
  assert.ok(e.vault.verify().ok, 'verify is clean');
});

test('a name the item has is refused unless replaced; the old file is then gone and the new one read back', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  e.vault.putFile('psss://Certs/password', 'a.txt', bytes(10));
  assert.throws(() => e.vault.putFile('psss://Certs/password', 'a.txt', bytes(11)), (x: unknown) => x instanceof VaultError && x.code === 'file_exists');
  const r = e.vault.putFile('psss://Certs/password', 'a.txt', bytes(11, 9), { replace: true });
  assert.equal(r.replaced, true);
  const list = e.vault.files('psss://Certs/password');
  assert.ok(list.kind === 'files' && list.files.length === 1 && list.files[0]!.size === 11);
});

test('odd names: empty, separators, control characters and dots are refused; a normal Unicode name is kept', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  for (const n of ['', '  ', 'a/b', 'a\\b', '..', '.', 'a\nb', 'a\u0000b']) {
    assert.throws(() => e.vault.putFile('psss://Certs/password', n, bytes(3)), (x: unknown) => x instanceof VaultError && x.code === 'bad_file_name', JSON.stringify(n));
  }
  e.vault.putFile('psss://Certs/password', 'résumé ‮.pdf', bytes(3));
  const list = e.vault.files('psss://Certs/password');
  assert.ok(list.kind === 'files' && list.files[0]!.name === 'résumé ‮.pdf', 'the vault keeps the name as given; printing escapes it');
});

test('a file over the limit is refused before anything is written', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  const before = readdirSync(e.location).sort();
  assert.throws(() => e.vault.putFile('psss://Certs/password', 'huge.bin', new Uint8Array(ATTACHMENT_MAX_BYTES + 1)), (x: unknown) => x instanceof VaultError && x.code === 'file_too_large');
  assert.deepEqual(readdirSync(e.location).sort(), before);
  assert.ok(!existsSync(join(e.location, 'groups', 'x')));
});

test('chunks are in the folder before the record that names them: a stop between leaves no dangling reference', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  const orig = (e.vault as unknown as { writeRecord: unknown }).writeRecord;
  (e.vault as unknown as { writeRecord: () => never }).writeRecord = () => { throw new Error('killed'); };
  assert.throws(() => e.vault.putFile('psss://Certs/password', 'x.bin', bytes(3000)), /killed/);
  (e.vault as unknown as { writeRecord: unknown }).writeRecord = orig;
  const list = e.vault.files('psss://Certs/password');
  assert.ok(list.kind === 'files' && list.files.length === 0, 'no file is named');
  assert.ok(e.vault.verify().ok, 'verify is clean with the unused chunk');
});

test('a file name is at most 255 bytes: 255 is kept, 256 is refused with its own code', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  e.vault.putFile('psss://Certs/password', `${'a'.repeat(251)}.pem`, bytes(3));
  assert.throws(() => e.vault.putFile('psss://Certs/password', `${'a'.repeat(252)}.pem`, bytes(3)), (x: unknown) => x instanceof VaultError && x.code === 'file_name_too_long');
  assert.throws(() => e.vault.putFile('psss://Certs/password', 'é'.repeat(128), bytes(3)), (x: unknown) => x instanceof VaultError && x.code === 'file_name_too_long', 'bytes, not characters');
});

test('sweepBlobTemps removes the temporary pieces of a dead or long-gone writer and never a young live one', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Certs' });
  e.vault.putFile('psss://Certs/password', 'a.bin', bytes(10));
  const blobs = join(e.location, 'groups');
  const gid = readdirSync(blobs)[0]!;
  const prefix = join(blobs, gid, 'blobs', readdirSync(join(blobs, gid, 'blobs'))[0]!);
  const make = (name: string, ageMs: number) => {
    const p = join(prefix, name);
    writeFileSync(p, 'half a piece');
    const t0 = (Date.now() - ageMs) / 1000;
    utimesSync(p, t0, t0);
    return p;
  };
  const before = readdirSync(prefix).length;
  const deadOld = make('.tmp-999991-aaaaaaaaaaaa-chunk', 60_000);
  const deadYoung = make('.tmp-999992-bbbbbbbbbbbb-chunk', 1_000);
  const liveYoung = make(`.tmp-${process.pid}-cccccccccccc-chunk`, 1_000);
  const liveAncient = make(`.tmp-${process.pid}-dddddddddddd-chunk`, 10 * 60_000);
  const alive = (pid: number) => pid === process.pid;
  const removed = e.vault.sweepBlobTemps(120_000, Date.now(), alive);
  assert.equal(removed, 2);
  assert.ok(!existsSync(deadOld) && !existsSync(liveAncient));
  assert.ok(existsSync(deadYoung), 'a writer that only looks dead (another computer) gets time to finish a piece');
  assert.ok(existsSync(liveYoung), 'a young file of a live process is never touched');
  assert.equal(readdirSync(prefix).length, before + 2, 'the real piece stays');
  assert.ok(e.vault.verify().ok);
});
