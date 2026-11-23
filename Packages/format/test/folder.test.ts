import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hex } from '../src/bytes.ts';
import { appendRecord, checkInfo, chainDir, initFolder, putWrap, readFrames, readGroupLog, readWraps, segmentName, frame, INFO_JSON } from '../src/folder.ts';
import { limits } from '../src/limits.ts';
import { Scenario } from './scenario.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'psss-test-'));

test('a segment of 65,535 bytes takes the next record; one that has reached 65,536 starts a new segment named by seq', () => {
  const s = new Scenario();
  const g = s.genesis('a1');
  for (const [size, expectNew] of [[limits.segmentLimit - 1, false], [limits.segmentLimit, true], [limits.segmentLimit + 1, true]] as const) {
    const root = tmp();
    try {
      initFolder(root);
      const dir = join(root, chainDir(hex(s.gid), hex(g.author), hex(g.device)));
      appendRecord(root, s.gid, g.author, g.device, 1, g.sealed);
      const first = join(dir, segmentName(1));
      writeFileSync(first, new Uint8Array(size));
      const r2 = s.item('alice', 'a1', new Uint8Array(16), [['t', 1]]);
      appendRecord(root, s.gid, r2.author, r2.device, 2, r2.sealed);
      assert.deepEqual(readdirSync(dir).sort(), expectNew ? [segmentName(1), segmentName(2)] : [segmentName(1)]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('put-if-absent: the same content is fine, different content is refused; psss.json is checked', () => {
  const root = tmp();
  try {
    initFolder(root);
    initFolder(root);
    checkInfo(root);
    const pid = new Uint8Array(32).fill(1), gid = new Uint8Array(32).fill(2);
    const name = new Uint8Array(8).fill(3);
    putWrap(root, gid, 0, pid, name, new Uint8Array([1, 2, 3]));
    putWrap(root, gid, 0, pid, name, new Uint8Array([1, 2, 3]));
    assert.throws(() => putWrap(root, gid, 0, pid, name, new Uint8Array([9])));
    putWrap(root, gid, 0, pid, new Uint8Array(8).fill(4), new Uint8Array([9])); // another name: another wrap for the same person and epoch
    assert.equal(readWraps(root, gid, 0, pid).length, 2);
    assert.equal(readFileSync(join(root, 'psss.json'), 'utf8'), '{"format":"psss-vault","version":1}\n');
    assert.equal(INFO_JSON.endsWith('\n'), true);
    writeFileSync(join(root, 'psss.json'), '{"format":"psss-vault","version":2}');
    assert.throws(() => checkInfo(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readGroupLog reads frames from every chain and ignores an incomplete last frame', () => {
  const s = new Scenario();
  const g = s.genesis(); const m = s.setRole('alice', 'a1', 'bob', 2, { card: true });
  const root = tmp();
  try {
    initFolder(root);
    appendRecord(root, s.gid, g.author, g.device, 1, g.sealed);
    const p = appendRecord(root, s.gid, m.author, m.device, 2, m.sealed);
    const path = join(root, p);
    writeFileSync(path, Buffer.concat([readFileSync(path), frame(g.sealed).subarray(0, 50)]));
    assert.equal(readGroupLog(root, s.gid).length, 2);
    assert(existsSync(path));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a membership record is written alone in a .mseg and the next content record starts a new .seg', () => {
  const s = new Scenario();
  const g = s.genesis('a1'); const m = s.setRole('alice', 'a1', 'bob', 2, { card: true });
  const i1 = s.item('alice', 'a1', new Uint8Array(16), [['t', 1]]);
  const root = tmp();
  try {
    initFolder(root);
    const dir = join(root, chainDir(hex(s.gid), hex(g.author), hex(g.device)));
    appendRecord(root, s.gid, g.author, g.device, 1, g.sealed, true);
    appendRecord(root, s.gid, m.author, m.device, 2, m.sealed, true);
    appendRecord(root, s.gid, i1.author, i1.device, 3, i1.sealed, false);
    assert.deepEqual(readdirSync(dir).sort(), [segmentName(1, true), segmentName(2, true), segmentName(3)]);
    assert.equal(readGroupLog(root, s.gid).length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readFrames: boundaries', () => {
  assert.deepEqual(readFrames(new Uint8Array(0)), { frames: [], incompleteTail: 0, stopped: null });
  assert.equal(readFrames(new Uint8Array([0, 0, 0])).incompleteTail, 3);
  assert.equal(readFrames(new Uint8Array([0, 0, 0, 1, 7])).frames.length, 1);
  assert.equal(readFrames(new Uint8Array([0, 0, 0, 2, 7])).frames.length, 0);
});
