import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ValidationError } from '../errors.ts';
import { displayPath } from '../io.ts';
import type { ExportResult } from '../service.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';
import { kdbxCredentials, kdbxKeyOption } from './kdbx-key.ts';
import { plural, warnIssues } from './kdbx-report.ts';

/** The lines for a person (frame A9). A line appears only when it has something to say. */
export function exportText(r: ExportResult, shown: string): string {
  const lines: string[] = [];
  lines.push(`${r.dryRun ? 'Would write' : 'Wrote'} ${shown} with ${plural(r.items, 'item')}.`);
  if (r.deleted > 0) lines.push(`${plural(r.deleted, 'item')} from Recently Deleted ${r.deleted === 1 ? 'is' : 'are'} in its Recycle Bin.`);
  if (r.doesNotTravel.length > 0) lines.push(`Not in a KeePass file: ${r.doesNotTravel.join(', ')}.`);
  if (r.refusedFields > 0) lines.push(`${plural(r.refusedFields, 'field')} ${r.refusedFields === 1 ? 'was' : 'were'} left out. Add --strip-invalid to write ${r.refusedFields === 1 ? 'it' : 'them'} without the characters a KeePass file cannot hold.`);
  if (r.dryRun) lines.push('Nothing was written.');
  return `${lines.join('\n')}\n`;
}

const exportCommand: Command = {
  name: 'export',
  summary: 'Write a copy as a KeePass file',
  usage: 'export --format kdbx <file> [--dry-run] [--force] [--strip-invalid] [--kdbx-key-file <path>] [--json]',
  options: {
    format: { type: 'string', valueName: 'format', description: 'The file format. Only kdbx (KeePass 2) is written so far' },
    'dry-run': { type: 'boolean', description: 'Build and check the file and write nothing' },
    force: { type: 'boolean', description: 'Replace the file if it is already there' },
    'strip-invalid': { type: 'boolean', description: 'Remove characters a KeePass file cannot hold, instead of leaving the field out' },
    ...kdbxKeyOption,
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'Writes every item of every group this computer can read as a KeePass 2 file (KDBX 4.1), reads it back and checks it, and says what the file does not carry.',
    'The new file has its own password: asked without echo, piped in, or read from the file named by PSSS_KDBX_PASSWORD_FILE. A file that exists is never replaced without --force.',
    'The file holds every secret in the clear to anyone who knows that password. Keep it only as long as you need it. It cannot be written inside the vault folder or any place the vault is kept in, since that would sync it.',
  ],
  async run(ctx) {
    const format = ctx.values.format;
    if (format === undefined) throw new ValidationError('Say which format to write: psss export --format kdbx <file>');
    if (format !== 'kdbx') throw new ValidationError(`psss export writes only kdbx (a KeePass 2 file) so far, not "${String(format)}".`);
    const file = ctx.positionals[0];
    if (file === undefined || file === '') throw new ValidationError('psss export needs the file to write, such as: psss export --format kdbx ~/Desktop/Personal.kdbx');
    const dryRun = ctx.values['dry-run'] === true;
    await ctx.open(dryRun ? { readOnly: true } : {});
    const svc = await ctx.service();
    // A dry run still builds and reads back the file, so it needs a key of its own; it asks for none.
    const credentials = dryRun
      ? { password: randomBytes(12).toString('hex') }
      : await kdbxCredentials(ctx, { prompt: 'the new file', name: 'the new file' });
    const result = ctx.unwrap(
      await svc.exportKdbx({ file, credentials, dryRun, force: ctx.values.force === true, stripInvalid: ctx.values['strip-invalid'] === true }),
    );
    const shown = displayPath(ctx.io, path.resolve(ctx.io.cwd, file));
    if (hasJson(ctx.values)) {
      const { file: _abs, ...rest } = result;
      ctx.json({ file: shown, ...rest });
      return 0;
    }
    warnIssues(ctx, result.issues);
    ctx.out(exportText(result, shown));
    return 0;
  },
};

export default exportCommand;
