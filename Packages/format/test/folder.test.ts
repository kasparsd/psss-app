import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hex } from '../src/bytes.ts';
import { appendRecord, checkInfo, chainDir, initFolder, putWrap, readFrames, readGroupLog, segmentName, SEGMENT_LIMIT, frame } from '../src/folder.ts';
import { Scenario } from './scenario.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'psss-test-'));

test('a segment that has not passed 64 KiB takes the next record; one that has starts a new segment named by seq', () => {
  const s = new Scenario();
  const g = s.genesis('a1');
  for (const [size, expectNew] of [[SEGMENT_LIMIT, false], [SEGMENT_LIMIT + 1, true]] as const) {
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
    putWrap(root, gid, 0, pid, new Uint8Array([1, 2, 3]));
    putWrap(root, gid, 0, pid, new Uint8Array([1, 2, 3]));
    assert.throws(() => putWrap(root, gid, 0, pid, new Uint8Array([9])));
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

test('readFrames: boundaries', () => {
  assert.deepEqual(readFrames(new Uint8Array(0)), { frames: [], incompleteTail: 0 });
  assert.equal(readFrames(new Uint8Array([0, 0, 0])).incompleteTail, 3);
  assert.equal(readFrames(new Uint8Array([0, 0, 0, 1, 7])).frames.length, 1);
  assert.equal(readFrames(new Uint8Array([0, 0, 0, 2, 7])).frames.length, 0);
});
