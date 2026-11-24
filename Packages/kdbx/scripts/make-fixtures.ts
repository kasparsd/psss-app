// Makes the committed fixtures in ../fixtures with keepassxc-cli (KeePassXC 2.8, /opt/homebrew/bin/keepassxc-cli).
// The tests read the committed files and do not need KeePassXC; run this only to remake them:
//   node --disable-warning=ExperimentalWarning scripts/make-fixtures.ts
//
// What KeePassXC 2.8's command line can do, as found on 2026-11-24:
// - `db-create` and `import` write KDBX 3.1 with AES-KDF and AES-256 (there is no option to choose the version or the KDF),
//   and `add` and `edit` keep that version. `rm` and `attachment-import` make it save KDBX 4.1 (AES-KDF, AES-256) instead.
// - There is no command that adds a custom field. `import` of a KeePass 2 XML file is the way: protected strings come in
//   as `ProtectInMemory="True"`, and KeePassXC writes them as protected values of the new database.
// - For files KeePassXC itself saved as KDBX 4, a database is first written by this package as KDBX 4.1 (small Argon2
//   parameters, so the tests stay fast) and then edited with `keepassxc-cli edit`: KeePassXC reads it, keeps the KDF and
//   cipher, and saves it again as KDBX 4.0. Everything after that first write is KeePassXC's own encoding.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getField, readKdbx, readKdbxFormat, writeKdbx, walkEntries } from '../src/index.ts';

const CLI = '/opt/homebrew/bin/keepassxc-cli';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'fixtures');
const PASSWORD = 'fixture-password';

if (!existsSync(CLI)) {
  console.error(`make-fixtures: ${CLI} not found; the committed fixtures are enough to run the tests.`);
  process.exit(1);
}
mkdirSync(join(out, 'keys'), { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.kdbx')) rmSync(join(out, f));
const work = mkdtempSync(join(tmpdir(), 'kdbx-fixtures-'));

function cli(args: string[], input: string): string {
  const r = spawnSync(CLI, args, { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`keepassxc-cli ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const b64u = (n: number) => Buffer.alloc(16, n).toString('base64');

// ------------------------------------------------------------------ the key files (deterministic, hand written)

const keyData = createHash('sha256').update('psss-kdbx fixture key').digest();
const keys: Record<string, Buffer> = {
  'v2.keyx': Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<KeyFile>\n\t<Meta>\n\t\t<Version>2.0</Version>\n\t</Meta>\n\t<Key>\n\t\t<Data Hash="${
      createHash('sha256').update(keyData).digest('hex').slice(0, 8).toUpperCase()}">\n\t\t\t${
      keyData.toString('hex').toUpperCase().replace(/(.{8})/g, '$1 ').trim()}\n\t\t</Data>\n\t</Key>\n</KeyFile>\n`),
  'v1.keyx': Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<KeyFile>\n\t<Meta>\n\t\t<Version>1.00</Version>\n\t</Meta>\n\t<Key>\n\t\t<Data>${keyData.toString('base64')}</Data>\n\t</Key>\n</KeyFile>\n`),
  'raw32.key': keyData,
  'hex64.key': Buffer.from(keyData.toString('hex')),
  'other.txt': Buffer.from('Any file at all can be a key file.\nIts SHA-256 is the key.\n'),
};
for (const [name, data] of Object.entries(keys)) writeFileSync(join(out, 'keys', name), data);

// ------------------------------------------------------------------ the seed XML (what KeePassXC imports)

const times = (c: string, m = c) =>
  `<Times><CreationTime>${c}</CreationTime><LastModificationTime>${m}</LastModificationTime><LastAccessTime>${m}</LastAccessTime>` +
  `<ExpiryTime>${m}</ExpiryTime><Expires>False</Expires><UsageCount>0</UsageCount><LocationChanged>${c}</LocationChanged></Times>`;
const str = (k: string, v: string, prot = false) =>
  `<String><Key>${k}</Key><Value${prot ? ' ProtectInMemory="True"' : ''}>${v}</Value></String>`;
const group = (n: number, name: string, body: string, icon = 48) =>
  `<Group><UUID>${b64u(n)}</UUID><Name>${name}</Name><Notes>${name} notes</Notes><IconID>${icon}</IconID>${times('2021-01-01T00:00:00Z')}` +
  `<IsExpanded>True</IsExpanded>${body}</Group>`;
const entry = (n: number, fields: string, extra = '', t = times('2021-03-04T05:06:07Z')) =>
  `<Entry><UUID>${b64u(n)}</UUID><IconID>0</IconID>${extra}${t}${fields}</Entry>`;
const meta = (name: string) =>
  `<Meta><Generator>psss-kdbx fixtures</Generator><DatabaseName>${name}</DatabaseName><DatabaseDescription>Made by make-fixtures.ts</DatabaseDescription>` +
  `<DefaultUserName>fixture-user</DefaultUserName><MaintenanceHistoryDays>365</MaintenanceHistoryDays>` +
  `<MemoryProtection><ProtectTitle>False</ProtectTitle><ProtectUserName>False</ProtectUserName><ProtectPassword>True</ProtectPassword><ProtectURL>False</ProtectURL><ProtectNotes>False</ProtectNotes></MemoryProtection>` +
  `<RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>${Buffer.alloc(16).toString('base64')}</RecycleBinUUID>` +
  `<HistoryMaxItems>10</HistoryMaxItems><HistoryMaxSize>6291456</HistoryMaxSize>` +
  `<CustomData><Item><Key>fixture-key</Key><Value>fixture-value</Value></Item></CustomData></Meta>`;

const login = entry(0x11,
  str('Title', 'Example Login') + str('UserName', 'alice@example.com') + str('Password', 'hunter2-ünï', true) +
  str('URL', 'https://example.com/login') + str('Notes', 'line one\nline two &amp; &lt;tags&gt; "quotes"') +
  str('Account Number', '12345') + str('PIN', '9876', true) + str('Recovery Codes', 'a1b2-c3d4 e5f6', true),
  `<ForegroundColor>#FF0000</ForegroundColor><BackgroundColor>#00FF00</BackgroundColor><Tags>work;email</Tags>`,
  `<Times><CreationTime>2021-03-04T05:06:07Z</CreationTime><LastModificationTime>2021-03-04T05:06:07Z</LastModificationTime>` +
  `<LastAccessTime>2021-03-04T05:06:07Z</LastAccessTime><ExpiryTime>2030-01-02T03:04:05Z</ExpiryTime><Expires>True</Expires>` +
  `<UsageCount>7</UsageCount><LocationChanged>2021-03-04T05:06:07Z</LocationChanged></Times>`);
const unicode = entry(0x12, str('Title', 'Unicode ☕ title') + str('UserName', 'ünïcödé') + str('Password', 'pässwörd-日本語', true) +
  str('Emoji', '😀 four-byte'));
const vpn = entry(0x13, str('Title', 'Work VPN') + str('UserName', 'bob') + str('Password', 'vpn-secret', true) + str('URL', 'https://vpn.example'),
  '<Tags>vpn</Tags>');
const portal = entry(0x14, str('Title', 'Client Portal') + str('UserName', 'carol') + str('Password', 'portal-secret', true));
const clientNotes = entry(0x15, str('Title', 'Client Notes') + str('Notes', 'kept'));
const seedXml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<KeePassFile>${meta('Fixture')}<Root>` +
  group(0x01, 'Root', login + unicode +
    group(0x02, 'Work', vpn + group(0x03, 'Clients', portal + clientNotes), 5) + group(0x04, 'Empty', '')) + `<DeletedObjects/></Root></KeePassFile>\n`;
writeFileSync(join(out, 'seed.xml'), seedXml);

const smallXml = (title: string) => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<KeePassFile>${meta('Small')}<Root>` +
  group(0x01, 'Root', entry(0x21, str('Title', title) + str('UserName', 'key-user') + str('Password', 'key-secret', true))) +
  `<DeletedObjects/></Root></KeePassFile>\n`;

// ------------------------------------------------------------------ KDBX 3.1 files from `import`

function importFile(xmlFile: string, dbFile: string, password: string | undefined, keyFile?: string) {
  const args = ['import', '-q'];
  if (password !== undefined) args.push('-p');
  if (keyFile) args.push('--set-key-file', keyFile);
  args.push(xmlFile, dbFile);
  cli(args, password !== undefined ? `${password}\n${password}\n` : '');
}

const main = join(out, 'kx31-password.kdbx');
importFile(join(out, 'seed.xml'), main, PASSWORD);
function step(db: string, command: string, extra: string[], target: string, input: string, keyArgs: string[] = []) {
  cli([command, '-q', ...keyArgs, ...extra, db, ...(target ? [target] : [])], input);
}
step(main, 'edit', ['-p', '-u', 'alice@example.net'], 'Example Login', `${PASSWORD}\nsecond-password\n`);
step(main, 'edit', ['-p'], 'Example Login', `${PASSWORD}\nthird-password\n`);
step(main, 'add', ['-u', 'dave', '-p', '--url', 'https://cli.example', '--notes', 'added by keepassxc-cli'], 'Work/Added by CLI', `${PASSWORD}\ncli-secret\n`);
console.log('main after edits:', readKdbxFormat(readFileSync(main)).version);
// `rm` (it makes the Recycle Bin and records where the entry came from) and an attachment make KeePassXC save the
// database as KDBX 4.1, with the same AES-KDF and cipher. That copy is the real KDBX 4.1 file with a recycled entry.
const bin = join(out, 'kx41-recycled-attachment.kdbx');
copyFileSync(main, bin);
step(bin, 'rm', [], 'Work/Clients/Client Portal', `${PASSWORD}\n`);
writeFileSync(join(work, 'report.bin'), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff)));
cli(['attachment-import', '-q', bin, 'Example Login', 'report.bin', join(work, 'report.bin')], `${PASSWORD}\n`);
console.log('kx41 after rm and attachment:', readKdbxFormat(readFileSync(bin)).version);

// ------------------------------------------------------------------ key file variants (KDBX 3.1)

const variants: [string, string, string | undefined, string][] = [
  ['kx31-keyfile-v2.kdbx', 'v2.keyx', undefined, 'Key file v2'],
  ['kx31-password-keyfile.kdbx', 'v2.keyx', PASSWORD, 'Password and key file v2'],
  ['kx31-keyfile-v1.kdbx', 'v1.keyx', undefined, 'Key file v1'],
  ['kx31-keyfile-raw32.kdbx', 'raw32.key', undefined, 'Key file raw 32 bytes'],
  ['kx31-keyfile-hex64.kdbx', 'hex64.key', undefined, 'Key file 64 hex digits'],
  ['kx31-keyfile-other.kdbx', 'other.txt', undefined, 'Key file any other file'],
];
for (const [file, key, password, title] of variants) {
  writeFileSync(join(work, 'small.xml'), smallXml(title));
  importFile(join(work, 'small.xml'), join(out, file), password, join(out, 'keys', key));
}

// ------------------------------------------------------------------ KDBX 4 files saved by KeePassXC

const source = readKdbx(readFileSync(bin), { password: PASSWORD });
function resave(name: string, options: Parameters<typeof writeKdbx>[2], editArgs: string[], input: string) {
  const file = join(out, name);
  writeFileSync(file, writeKdbx(source, { password: PASSWORD }, options));
  step(file, 'edit', editArgs, 'Unicode ☕ title', input);
}
resave('kx41-argon2id-chacha.kdbx',
  { version: '4.1', cipher: 'chacha20', compression: 'gzip', kdf: { type: 'argon2id', memoryKiB: 16384, iterations: 2, parallelism: 2 } },
  ['-p'], `${PASSWORD}\nunicode-new-password\n`);
resave('kx41-argon2d-aes.kdbx',
  { version: '4.1', cipher: 'aes256', compression: 'none', kdf: { type: 'argon2d', memoryKiB: 8192, iterations: 3, parallelism: 1 } },
  ['-u', 'renamed-user'], `${PASSWORD}\n`);

rmSync(work, { recursive: true, force: true });
for (const f of readdirSync(out)) if (f.endsWith('.kdbx')) chmodSync(join(out, f), 0o644);

// ------------------------------------------------------------------ sanity: the codec reads every fixture
const all: [string, { password?: string; keyFile?: Uint8Array }][] = [
  ['kx31-password.kdbx', { password: PASSWORD }], ['kx41-recycled-attachment.kdbx', { password: PASSWORD }], ['kx41-argon2id-chacha.kdbx', { password: PASSWORD }],
  ['kx41-argon2d-aes.kdbx', { password: PASSWORD }],
  ...variants.map(([f, k, p]): [string, { password?: string; keyFile?: Uint8Array }] => [
    f, { ...(p !== undefined ? { password: p } : {}), keyFile: readFileSync(join(out, 'keys', k)) }]),
];
for (const [file, key] of all) {
  const db = readKdbx(readFileSync(join(out, file)), key);
  const titles = [...walkEntries(db)].map((v) => getField(v.entry, 'Title'));
  console.log(`${file}: ${db.format!.version} ${db.format!.cipher} ${JSON.stringify(db.format!.kdf)} entries ${titles.length}`);
}
