// The XML reader and writer, and what survives a round trip that this package does not model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { getField, parseXml, readKdbx, serializeXml, writeKdbx, xml } from '../src/index.ts';
import type { XmlNode } from '../src/index.ts';
import { BUILD_KEY, Protector, buildKdbx4, minimalXml } from './support.ts';

const limits = { maxDepth: 128, maxNodes: 100_000 };
const parse = (s: string) => parseXml(s, limits);

test('xml: the five entities, character references, CDATA and comments are read; whitespace between children is not content', () => {
  const root = parse('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y=\'q"q\'>\n  <b>&lt;&gt;&amp;&quot;&apos; &#65;&#x42; é</b>\n  <c><![CDATA[<raw & text>]]></c><d/>\n</a>');
  assert.equal(root.text, '', 'a container has no text');
  assert.deepEqual(root.attributes, [['x', '1 & 2'], ['y', 'q"q']]);
  assert.equal(root.children[0]!.text, '<>&"\' AB é');
  assert.equal(root.children[1]!.text, '<raw & text>');
  assert.equal(root.children[2]!.text, '');
});

test('xml: a leaf keeps its whitespace exactly, and a literal CRLF is normalized to LF while &#13; survives', () => {
  const root = parse('<a><b>  x  </b><c>1\r\n2&#13;\n3</c></a>');
  assert.equal(root.children[0]!.text, '  x  ');
  assert.equal(root.children[1]!.text, '1\n2\r\n3');
});

test('xml: writing escapes markup, keeps tabs and newlines in text, escapes them in attributes, and (in strip mode) drops characters XML cannot hold', () => {
  const node = xml('a', '', [['k', 'a"b\n\t&<']], [xml('b', 'x & <y> "z"\n\tend\r\u0001\u{1F600}\uffff')]);
  assert.throws(() => serializeXml(node, { maxDepth: 10 }), { code: 'InvalidArgument' }, 'the default refuses them');
  const text = serializeXml(node, { maxDepth: 10, invalidCharacters: 'strip' });
  assert.ok(text.includes('k="a&quot;b&#10;&#9;&amp;&lt;"'), text);
  assert.ok(text.includes('<b>x &amp; &lt;y&gt; "z"\n\tend&#13;\u{1F600}</b>'), text);
  const back = parse(text);
  assert.equal(back.children[0]!.text, 'x & <y> "z"\n\tend\r\u{1F600}');
  assert.equal(back.attributes[0]![1], 'a"b\n\t&<');
});

test('xml: an empty element is written as a self-closing tag and reads back empty', () => {
  const text = serializeXml(xml('a', '', [], [xml('b'), xml('c', '')]), { maxDepth: 10 });
  assert.ok(text.includes('<b/>') && text.includes('<c/>'));
  assert.equal(parse(text).children.length, 2);
});

test('xml: malformed documents are rejected with Corrupt, never a raw error', () => {
  for (const bad of ['', '   ', '<a>', '<a></b>', '<a><b></a></b>', '<a x=1/>', '<a x="1/>', '<a x="1" x="2"/>', '<a>&bogus;</a>', '<a>&</a>', '<a>&#0;</a>', '<a>&#xD800;</a>',
    '<a/><b/>', '<a/>text', 'text<a/>', '<a><!-- open</a>', '<a><![CDATA[open</a>', '<a', '<a b', '<1a/>', '<a x="<"/>']) {
    assert.throws(() => parse(bad), { code: 'Corrupt' }, JSON.stringify(bad));
  }
});

test('xml: DOCTYPE and entity declarations are refused (there is no DTD, so nothing can expand)', () => {
  const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
  assert.throws(() => parse(laughs), { code: 'Corrupt', message: /DOCTYPE/ });
  assert.throws(() => parse('<a><!ENTITY x "y"></a>'), { code: 'Corrupt' });
});

test('xml: nesting beyond the limit is LimitExceeded, even a hundred thousand levels deep, without overflowing the stack', () => {
  assert.doesNotThrow(() => parse('<a>'.repeat(128) + '</a>'.repeat(128)));
  assert.throws(() => parse('<a>'.repeat(129) + '</a>'.repeat(129)), { code: 'LimitExceeded', detail: 'maxXmlDepth' });
  const started = Date.now();
  assert.throws(() => parse('<a>'.repeat(100_000)), { code: 'LimitExceeded' });
  assert.ok(Date.now() - started < 2000, 'rejected quickly');
  assert.throws(() => serializeXml(xml('a', '', [], [xml('b', '', [], [xml('c', '', [], [xml('d')])])]), { maxDepth: 3 }), { code: 'LimitExceeded' });
});

test('xml: too many elements is LimitExceeded', () => {
  assert.throws(() => parseXml('<a>' + '<b/>'.repeat(50) + '</a>', { maxDepth: 10, maxNodes: 20 }), { code: 'LimitExceeded', detail: 'maxXmlNodes' });
});

test('xml: a byte order mark and an XML declaration are accepted', () => {
  assert.equal(parse('﻿<?xml version="1.0" encoding="utf-8"?>\n<a>t</a>').text, 't');
});

// ---- unknown content survives a read then a write -------------------------------------------------------------

function unknownCases(p: Protector): string {
  // The protected values are produced in document order, with ones in unknown elements in between the known ones.
  const entry = (n: number, title: string, password: string, extra: () => string = () => '') =>
    `<Entry><UUID>${Buffer.alloc(16, n).toString('base64')}</UUID><IconID>0</IconID>` +
    `<String><Key>Title</Key><Value>${title}</Value></String>` +
    `<String><Key>Password</Key><Value Protected="True">${p.enc(password)}</Value></String>${extra()}</Entry>`;
  return entry(1, 'First', 'pw-one') +
    entry(2, 'Second', 'pw-two', () =>
      `<Mystery kind="odd"><Deep><Deeper secret="s">text &amp; more</Deeper></Deep>` +
      `<Hidden Protected="True">${p.enc('unmodelled secret')}</Hidden></Mystery><Another/>`) +
    entry(3, 'Third', 'pw-three');
}

test('unknown XML: elements and attributes in Meta, Group, Entry, Root and KeePassFile survive a round trip, and a protected value inside one keeps the stream aligned', () => {
  const streamKey = new Uint8Array(64).fill(0x5a);
  const p = new Protector(streamKey);
  const meta = '<MetaMystery a="1"><X>x</X></MetaMystery>';
  const root = unknownCases(p) + '<GroupMystery g="2"><Y/></GroupMystery>';
  const docXml = minimalXml({ meta, root, top: '<TopMystery>t</TopMystery>' })
    .replace('<Root>', '<Root><RootMystery>r</RootMystery>')
    .replace('<Group>', '<Group extra="attr">')
    .replace('<Meta>', '<Meta metaAttr="m">');
  const file = buildKdbx4(docXml, { streamKey });
  const db = readKdbx(file, BUILD_KEY);
  const second = db.root.entries[1]!;
  assert.equal(getField(db.root.entries[0]!, 'Password'), 'pw-one');
  assert.equal(getField(second, 'Password'), 'pw-two', 'the value after an unknown protected one needs the stream to have advanced');
  assert.equal(getField(db.root.entries[2]!, 'Password'), 'pw-three');
  const hidden = (second.unknown[0] as XmlNode).children[1]!;
  assert.equal(hidden.text, 'unmodelled secret', 'a protected value in an unknown element is decrypted in memory');
  assert.deepEqual(hidden.attributes, [['Protected', 'True']]);

  for (const version of ['4.1', '3.1'] as const) {
    const again = readKdbx(writeKdbx(db, BUILD_KEY, { version, kdf: { type: 'aes', rounds: 5 } }), BUILD_KEY);
    const label = `written as ${version}`;
    assert.deepEqual(again.meta.unknown.find((n) => n.name === 'MetaMystery'), db.meta.unknown.find((n) => n.name === 'MetaMystery'), `${label}: Meta`);
    assert.deepEqual(again.meta.attributes, [['metaAttr', 'm']], `${label}: Meta attribute`);
    assert.deepEqual(again.root.attributes, [['extra', 'attr']], `${label}: Group attribute`);
    assert.deepEqual(again.root.unknown, db.root.unknown, `${label}: Group`);
    assert.deepEqual(again.root.entries[1]!.unknown, second.unknown, `${label}: Entry`);
    assert.deepEqual(again.rootUnknown, db.rootUnknown, `${label}: Root`);
    assert.deepEqual(again.unknown, db.unknown, `${label}: KeePassFile`);
    assert.equal(getField(again.root.entries[2]!, 'Password'), 'pw-three', `${label}: the stream is still aligned after the unknown secret`);
  }
});

test('unknown XML: elements this package does not model but KeePass writes (icons, auto-type, history, binaries) are kept', () => {
  const docXml = minimalXml({
    meta: '<CustomIcons><Icon><UUID>AAAAAAAAAAAAAAAAAAAAAA==</UUID><Data>iVBORw0=</Data></Icon></CustomIcons><MemoryProtection><ProtectNotes>True</ProtectNotes></MemoryProtection>',
    root: '<DefaultAutoTypeSequence>{USERNAME}</DefaultAutoTypeSequence><EnableAutoType>null</EnableAutoType><LastTopVisibleEntry>AAAAAAAAAAAAAAAAAAAAAA==</LastTopVisibleEntry>',
  });
  const db = readKdbx(buildKdbx4(docXml), BUILD_KEY);
  assert.deepEqual(db.meta.unknown.map((n) => n.name), ['CustomIcons', 'MemoryProtection']);
  assert.deepEqual(db.root.unknown.map((n) => n.name), ['DefaultAutoTypeSequence', 'EnableAutoType', 'LastTopVisibleEntry']);
  const back = readKdbx(writeKdbx(db, BUILD_KEY, { kdf: { type: 'aes', rounds: 5 } }), BUILD_KEY);
  assert.deepEqual(back.meta.unknown, db.meta.unknown);
  assert.deepEqual(back.root.unknown, db.root.unknown);
});
