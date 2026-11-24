import { basename, resolve } from 'node:path';
import { ValidationError } from '../errors.ts';
import { displayPath } from '../io.ts';
import type { ImportResult } from '../service.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command, CommandContext } from './command.ts';
import { kdbxCredentials, kdbxKeyOption } from './kdbx-key.ts';
import { plural, warnIssues } from './kdbx-report.ts';

/** The lines for a person (frame A9). A line appears only when its count is not zero. */
export function importText(r: ImportResult): string {
  const dry = r.dryRun;
  const lines: string[] = [];
  if (r.added > 0) {
    const att = r.attachments > 0 ? ` and ${plural(r.attachments, 'attachment')}` : '';
    lines.push(`${dry ? 'Would add' : 'Added'} ${plural(r.added, 'item')}${att} to ${r.group}.`);
  } else if (r.updated === 0) {
    lines.push(`Nothing new to add to ${r.group}.`);
  }
  if (r.updated > 0) lines.push(`${dry ? 'Would update' : 'Updated'} ${plural(r.updated, 'item')} that changed in the file.`);
  if (r.unchanged > 0) lines.push(`${plural(r.unchanged, 'item')} ${r.unchanged === 1 ? 'is' : 'are'} already here, unchanged.`);
  if (r.keptYours > 0) lines.push(`${plural(r.keptYours, 'item')} you changed here since the last import ${r.keptYours === 1 ? 'was' : 'were'} left as ${r.keptYours === 1 ? 'it is' : 'they are'}.`);
  if (r.changedInFile > 0) lines.push(`${plural(r.changedInFile, 'item')} changed in the file since the last import. Add --update to bring ${r.changedInFile === 1 ? 'that one' : 'those'} in.`);
  if (r.conflicts > 0) lines.push(`${plural(r.conflicts, 'item')} changed both here and in the file. The versions here were kept.`);
  const deleted = r.skippedDeleted + r.skippedGone;
  if (deleted > 0) lines.push(`${plural(deleted, 'item')} you deleted here ${deleted === 1 ? 'was' : 'were'} not brought back.`);
  if (r.skippedTrash > 0) lines.push(`${plural(r.skippedTrash, 'entry', 'entries')} in the file's Recycle Bin ${r.skippedTrash === 1 ? 'was' : 'were'} left out. Add --include-trash to bring ${r.skippedTrash === 1 ? 'it' : 'them'} in as deleted items.`);
  if (r.inFolders > 0) lines.push(`${plural(r.inFolders, 'item')} ${r.inFolders === 1 ? 'was' : 'were'} in folders. Psss has no folders, so ${r.inFolders === 1 ? 'it is' : 'they are'} in ${r.group} with the rest.`);
  // the flag helps only with characters; a field over the size limit stays out with it
  const invalid = r.invalidFields ?? 0;
  const oversized = r.refusedFields - invalid;
  if (invalid > 0) lines.push(`${plural(invalid, 'field')} ${invalid === 1 ? 'was' : 'were'} not imported for characters a KeePass file cannot hold. Add --strip-invalid to import ${invalid === 1 ? 'it' : 'them'} without those characters.`);
  if (oversized > 0) lines.push(`${plural(oversized, 'field')} ${oversized === 1 ? 'was' : 'were'} not imported because ${oversized === 1 ? 'it is' : 'they are'} over a size or number limit of an item.`);
  if (r.strippedFields > 0) lines.push(`${plural(r.strippedFields, 'field')} had characters removed, as you asked.`);
  if (r.refusedItems > 0) lines.push(`${plural(r.refusedItems, 'item')} ${r.refusedItems === 1 ? 'was' : 'were'} too large or over a limit and not imported.`);
  if (dry) lines.push('Nothing was changed.');
  return `${lines.join('\n')}\n`;
}

/** "Importing 1,200 of 20,000": rewritten in place on a terminal, one line a second otherwise. */
function progressLine(ctx: CommandContext, terminal: boolean): { update: (done: number, total: number) => void; done: () => void } {
  let last = 0;
  let shown = false;
  return {
    update(done, total) {
      const now = Date.now();
      if (done < total && now - last < (terminal ? 250 : 1000)) return;
      last = now;
      const text = `Importing ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
      ctx.err(terminal ? `\r\u001b[2K${text}` : `${text}\n`);
      shown = true;
    },
    done() {
      if (terminal && shown) ctx.err('\r\u001b[2K');
    },
  };
}

const importCommand: Command = {
  name: 'import',
  summary: 'Bring in a KeePass file',
  usage: 'import <file> [--dry-run] [--strip-invalid] [--include-trash] [--update] [--kdbx-key-file <path>] [--progress] [--json]',
  options: {
    'dry-run': { type: 'boolean', description: 'Show what would be added and change nothing' },
    'strip-invalid': { type: 'boolean', description: 'Remove characters a KeePass file cannot hold, instead of leaving the field out' },
    'include-trash': { type: 'boolean', description: "Bring in the file's Recycle Bin as deleted items" },
    update: { type: 'boolean', description: 'Replace items that changed in the file since they were imported and not here' },
    progress: { type: 'boolean', description: 'Show how far a long import has got on standard error, also when it is not a terminal' },
    ...kdbxKeyOption,
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'Reads a KeePass 2 file (KDBX 3 or 4). The password is asked without echo, piped in, or read from the file named by PSSS_KDBX_PASSWORD_FILE.',
    'Importing adds and never replaces: an item already here is left alone, and importing the same file again adds nothing.',
    'Items go to --group, or to the only group this computer can write to. An item you deleted here is not brought back.',
    'An import takes the vault for itself until it is done: another psss that needs the vault meanwhile is told so. If one stops part of the way, run it again: what was added stays.',
  ],
  async run(ctx) {
    const file = ctx.positionals[0];
    if (file === undefined || file === '') throw new ValidationError('psss import needs the KeePass file to read, such as: psss import ~/Downloads/Family.kdbx');
    const dryRun = ctx.values['dry-run'] === true;
    await ctx.open(dryRun ? { readOnly: true } : {});
    const svc = await ctx.service();
    const credentials = await kdbxCredentials(ctx, { prompt: basename(file), name: displayPath(ctx.io, file) });
    // a progress line goes to standard error, for a terminal or when asked, and never into --json
    const asked = ctx.values.progress === true;
    const terminal = ctx.io.isTTY.stderr === true;
    const progress = !hasJson(ctx.values) && (asked || terminal) ? progressLine(ctx, terminal) : undefined;
    const result = ctx.unwrap(
      await svc.importKdbx({
        file,
        credentials,
        ...(progress ? { progress: progress.update } : {}),
        dryRun,
        stripInvalid: ctx.values['strip-invalid'] === true,
        includeTrash: ctx.values['include-trash'] === true,
        update: ctx.values.update === true,
      }),
    );
    progress?.done();
    if (hasJson(ctx.values)) {
      ctx.json({ file: displayPath(ctx.io, resolve(ctx.io.cwd, file)), ...result });
      return 0;
    }
    warnIssues(ctx, result.issues);
    ctx.out(importText(result));
    return 0;
  },
};

export default importCommand;
