// `psss file get | put | list`: files attached to an item (certificates, key files, statements). Docs: docs/cli.md, "Items and files". Frames A18.
//
// A file is named like a field: psss://Example/ca.pem is the attachment called ca.pem of the item Example. Get never writes outside the place
// it is told, never over a file without --force, always with mode 0600, and never inside the vault folder (as export refuses too).

import { closeSync, linkSync, openSync, renameSync, rmSync, statSync, writeSync, existsSync, readFileSync } from 'node:fs';
import { lstatSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ATTACHMENT_MAX_BYTES } from '../../../vault/src/index.ts';
import { CliError, EXIT_FAILED, ValidationError } from '../errors.ts';
import { displayPath } from '../io.ts';
import { formatReference, shellQuote } from '../reference.ts';
import { printable } from '../text.ts';
import { checkDelivery, deliveryJson } from './delivery.ts';
import { findItem, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import { jsonName, plural } from './kdbx-report.ts';
import { sizeText } from './item.ts';

const NAME_BYTES = 255;
const bytes = (t: string) => Buffer.byteLength(t, 'utf8');
/** Cuts a name to `max` bytes at a character boundary, keeping a short extension (`report-…-end.pdf` stays `.pdf`). */
function shorten(name: string, max: number): string {
  if (bytes(name) <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && bytes(name.slice(dot)) <= 16 ? name.slice(dot) : '';
  let stem = [...name.slice(0, name.length - ext.length)];
  while (stem.length > 1 && bytes(stem.join('')) + bytes(ext) > max) stem.pop();
  return stem.join('') + ext;
}

/**
 * A file name made safe to create in a folder on any system: the part after the last separator; control, format (zero-width and direction),
 * line-separator and lone-surrogate characters and the characters Windows forbids (: < > " | ? *) become `_`; no trailing dot or space; never
 * empty, `.` or `..`; a Windows device name (CON, NUL, aux.txt, COM1.txt, ...) gets a `_` in front; at most 255 bytes, keeping its extension.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  let clean = base.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}:<>"|?*]/gu, '_').trim().replace(/[. ]+$/, '');
  if (clean === '') return 'attachment';
  if (/^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\..*)?$/i.test(clean)) clean = `_${clean}`;
  return shorten(clean, NAME_BYTES);
}

const isDirectory = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Writes the bytes to `target` with mode 0600, under a temporary name first. Without `force` an existing file (or link) is never touched. */
function writeSafely(target: string, data: Uint8Array, force: boolean): 'written' | 'exists' {
  if (!force && existsSyncOrLink(target)) return 'exists';
  const tmp = path.join(path.dirname(target), `.psss-${randomBytes(6).toString('hex')}.tmp`); // short, so a name of 255 bytes still fits beside it
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    let at = 0;
    while (at < data.length) at += writeSync(fd, data, at, Math.min(data.length - at, 1 << 20));
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    if (force) renameSync(tmp, target);
    else {
      try {
        linkSync(tmp, target); // fails if the name appeared meanwhile: never replaces
      } finally {
        rmSync(tmp, { force: true });
      }
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    throw e;
  }
  return 'written';
}

function existsSyncOrLink(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

const get: Command = {
  name: 'file get',
  summary: 'Write an attached file to a place, or to standard output',
  usage: 'file get <reference> [--output <path>] [--force] [--json]',
  options: {
    output: { type: 'string', valueName: 'path', description: 'A file to write, or a folder to put the file in under its own name' },
    force: { type: 'boolean', description: 'Replace a file that is already there' },
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'The reference names the file like a field: "psss://Example/ca.pem" is the file called ca.pem of the item Example.',
    'Without --output the bytes go to standard output when it is not a terminal (psss file get … > ca.pem), and at a terminal psss refuses, since file bytes would scramble it.',
    '--output <folder> (or --output .) writes the file there under its own name. A name with slashes in it, such as ../../etc/passwd, becomes just its last part (passwd), so a file never lands outside the folder you chose.',
    'A file that exists is never replaced without --force. The new file is readable by you only (mode 0600). Psss will not write it inside the vault folder or any place the vault is kept in, since that would sync it.',
  ],
  async run(ctx) {
    const { ref, selector } = resolveReference(ctx, ctx.positionals[0]!, 'field');
    const wantedName = ref.field!;
    const out = ctx.values.output === undefined ? undefined : String(ctx.values.output);
    const json = hasJson(ctx.values);
    if (out === undefined && ctx.io.isTTY.stdout) {
      throw new ValidationError(`psss file get would print the bytes of a file into your terminal. Name a place instead, such as: psss file get ${shellQuote(formatReference(ref))} --output .`);
    }
    if (out === undefined && json) throw new ValidationError('--json describes the file and cannot go with writing it to standard output. Add --output <path>.');
    if (out === '') throw new ValidationError('--output needs a path.');
    await ctx.open();
    const svc = await ctx.service();
    const file = ctx.unwrap(await svc.readFile(selector, wantedName));
    if (out === undefined) {
      ctx.io.stdout.write(Buffer.from(file.data) as unknown as string);
      return 0;
    }
    const shownPath = (p: string) => printable(displayPath(ctx.io, p), 200);
    const abs = path.resolve(ctx.io.cwd, out);
    const target = isDirectory(abs) || /[\\/]$/.test(out) ? path.join(abs, safeFileName(file.name)) : abs;
    if (/[\\/]$/.test(out) && !isDirectory(abs)) throw new CliError(`${shownPath(abs)} is not a folder that exists. Nothing was written.`, EXIT_FAILED);
    const inside = ctx.unwrap(await svc.vaultPlaceOf(target));
    if (inside !== null) {
      throw new CliError(
        `${shownPath(target)} is inside ${shownPath(inside)}, a place this vault is kept in and shared from.\nA file saved there would sync with the vault. Choose another place, outside the vault folder.\nNothing was written.`,
        EXIT_FAILED,
      );
    }
    let state: 'written' | 'exists';
    try {
      state = writeSafely(target, file.data, ctx.values.force === true);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const why = code === 'ENOENT' ? 'that folder does not exist' : code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code === 'ENOSPC' ? 'the disk is full' : code === 'EISDIR' ? 'that is a folder' : 'it could not be written';
      throw new CliError(`Psss cannot write ${shownPath(target)} (${why}). Nothing was written.`, EXIT_FAILED);
    }
    if (state === 'exists') {
      throw new CliError(`${shownPath(target)} already exists, so nothing was written.\nChoose another name, or add --force to replace it.`, EXIT_FAILED);
    }
    const shown = shownPath(target);
    if (json) ctx.json({ file: shown, name: jsonName(file.name), size: file.data.length, item: { id: file.item.id, title: jsonName(file.item.title), group: jsonName(file.item.group) } });
    else ctx.out(`Wrote ${shown} (${sizeText(file.data.length)}) from "${printable(file.item.title)}".\nIt is readable by you only.\n`);
    return 0;
  },
};

const put: Command = {
  name: 'file put',
  summary: 'Attach a file to an item',
  usage: 'file put <reference> <path> [--name <text>] [--force] [--json]',
  options: {
    name: { type: 'string', valueName: 'text', description: 'Store it under this name instead of the file\'s own' },
    force: { type: 'boolean', description: 'Replace a file of the same name the item already has' },
    ...jsonOption,
  },
  args: { min: 2, max: 2 },
  details: [
    'Attaches the file at <path> to the item. The stored name is the last part of the path (or --name), never empty and never with slashes.',
    `A file is at most ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MiB and an item holds at most 64 files. The file is sealed in 1 MiB pieces and the pieces are stored in every place the vault is kept in`,
    'before the record that names them, so a stop half way leaves nothing broken behind.',
    'An item that already has a file of that name is not changed unless --force is given. Standard output is the reference of the file, such as psss://Example/ca.pem.',
  ],
  async run(ctx) {
    const { selector } = resolveReference(ctx, ctx.positionals[0]!, 'item');
    const source = path.resolve(ctx.io.cwd, ctx.positionals[1]!);
    const shown = displayPath(ctx.io, source);
    let size: number;
    try {
      const st = statSync(source);
      if (!st.isFile()) throw new CliError(`${shown} is not a file. Nothing was changed.`, EXIT_FAILED);
      size = st.size;
    } catch (e) {
      if (e instanceof CliError) throw e;
      throw new CliError(`There is no file at ${shown}${(e as NodeJS.ErrnoException).code === 'EACCES' ? ' that psss may read' : ''}. Nothing was changed.`, EXIT_FAILED);
    }
    if (size > ATTACHMENT_MAX_BYTES) {
      throw new CliError(`${shown} is ${sizeText(size)}, larger than the ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MiB an attached file can be. Nothing was changed.`, EXIT_FAILED);
    }
    const name = ctx.values.name === undefined ? path.basename(source) : String(ctx.values.name);
    if (bytes(name) > NAME_BYTES) {
      throw new ValidationError(`"${printable(name, 40)}" is ${bytes(name)} bytes long, and a file name in an item can be at most ${NAME_BYTES}. Choose a shorter one with --name.`);
    }
    if (name.trim() === '' || /[\\/]/.test(name) || /[\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') {
      throw new ValidationError(`"${printable(name, 40)}" cannot be the name of a file in an item: it is empty, or has a slash or a control character. Choose one with --name.`);
    }
    const vault = await ctx.open({ changes: true });
    const svc = await ctx.service();
    const item = await findItem(ctx, svc, 'file put', selector, false);
    let data: Uint8Array;
    try {
      data = new Uint8Array(readFileSync(source));
    } catch {
      throw new CliError(`${shown} cannot be read. Nothing was changed.`, EXIT_FAILED);
    }
    const done = ctx.unwrap(await svc.putFile({ id: item.id }, name, data, { replace: ctx.values.force === true }));
    const delivery = await checkDelivery(ctx);
    if (done.replaced) ctx.err(`Replaced the earlier file called "${printable(done.name)}".\n`);
    const reference = formatReference({ item: done.item.title === '' ? { id: done.item.id } : { title: done.item.title }, field: done.name });
    if (hasJson(ctx.values)) {
      ctx.json({ reference, item: { id: done.item.id, title: jsonName(done.item.title), group: jsonName(done.item.group) }, name: jsonName(done.name), size: done.size, replaced: done.replaced, delivery: deliveryJson(delivery) });
      return 0;
    }
    if (ctx.io.isTTY.stderr === true) ctx.err(`Attached "${printable(done.name)}" (${sizeText(done.size)}) to ${printable(done.item.title || 'the item')} in ${vault.name}.\n`);
    ctx.out(`${reference}\n`);
    return 0;
  },
};

const list: Command = {
  name: 'file list',
  summary: 'List the files attached to an item',
  usage: 'file list <reference> [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 1 },
  async run(ctx) {
    const typed = ctx.positionals[0];
    if (typed === undefined) throw missingReferenceError(ctx, 'file list', 'item', false);
    const { selector } = resolveReference(ctx, typed, 'item');
    await ctx.open();
    const svc = await ctx.service();
    let found = await svc.files(selector);
    if (!found.ok && found.kind === 'notFound' && found.what === 'item') {
      const again = await svc.files(selector, { deleted: true });
      if (again.ok) found = again;
    }
    const files = ctx.unwrap(found);
    if (hasJson(ctx.values)) {
      ctx.json({ item: { id: files.item.id, title: jsonName(files.item.title), group: jsonName(files.item.group) }, files: files.files.map((f) => ({ name: jsonName(f.name), size: f.size })) });
      return 0;
    }
    if (files.files.length === 0) {
      ctx.out(`"${printable(files.item.title)}" has no files.\n`);
      return 0;
    }
    const w = Math.max(...files.files.map((f) => printable(f.name, 80).length)) + 3;
    ctx.out(`${files.files.map((f) => `${printable(f.name, 80).padEnd(w)}${sizeText(f.size)}`).join('\n')}\n`);
    return 0;
  },
};

void plural;
void existsSync;

const file: Command = {
  name: 'file',
  summary: 'Get, put and list files attached to items',
  usage: 'file <get|put|list>',
  options: {},
  args: { min: 0, max: 0 },
  subcommands: [get, put, list],
  async run() {
    return 2;
  },
};

export default file;
