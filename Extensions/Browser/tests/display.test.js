// Display.line: vault names and logins from a hostile file are shown as one short, safe line (the popup uses textContent only).
import test from 'node:test';
import assert from 'node:assert/strict';
import display from '../src/display.js';

const { Display } = display;

test('plain text is untouched', () => {
  assert.equal(Display.line('Passwords'), 'Passwords');
  assert.equal(Display.line('Café ☕ 日本語'), 'Café ☕ 日本語');
});

test('newlines, tabs and runs of spaces become one space', () => {
  assert.equal(Display.line('Work\nvault\r\n\t  two'), 'Work vault two');
  assert.equal(Display.line('  padded  '), 'padded');
  assert.equal(Display.line('a\u2028b\u2029c\u00a0d'), 'a b c d');
});

test('bidirectional controls and zero-width characters are removed', () => {
  assert.equal(Display.line('Work\u202egpj.exe'), 'Workgpj.exe');
  assert.equal(Display.line('Wo\u2066rk\u2069'), 'Work');
  assert.equal(Display.line('a\u200bb\u200fc\u061cd\ufeffe'), 'abcde');
  assert.equal(Display.line('\u202e\u202d\u2066'), '');
});

test('control characters never reach the page as markup or escapes', () => {
  assert.equal(Display.line('\u0000\u0007x\u001b[31m'), 'x [31m');
  assert.equal(Display.line('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');  // text only: textContent shows it literally
});

test('long values are cut with an ellipsis, by characters a person sees', () => {
  const long = 'x'.repeat(500);
  const cut = Display.line(long, 32);
  assert.equal([...cut].length, 32);
  assert.ok(cut.endsWith('…'));
  const flags = '🇱🇻'.repeat(100);
  assert.equal(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(Display.line(flags, 10))).length, 10);
  assert.equal(Display.line('x'.repeat(5_000_000), 20).length, 20, 'a megabyte-sized name costs a bounded amount');
});

test('non-strings are safe', () => {
  assert.equal(Display.line(undefined), '');
  assert.equal(Display.line(null), '');
  assert.equal(Display.line(42), '42');
});
