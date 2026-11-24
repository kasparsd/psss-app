// What every command module has, and the helpers they share.

import { printable } from '../text.ts';
import { CliError, EXIT_FAILED, EXIT_LOCKED, EXIT_NOT_FOUND, EXIT_USAGE, ValidationError } from '../errors.ts';
import { displayPath } from '../io.ts';
import type { CliIo } from '../io.ts';
import type { ParsedValues, Settings } from '../config.ts';
import { formatReference, parseReference, shellQuote, toSelector } from '../reference.ts';
import type { Reference, ReferenceKind } from '../reference.ts';
import type { Failure, ItemSelector, ItemSummary, KdbxProblem, Result, VaultService } from '../service.ts';

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
  valueName?: string;
  description: string;
}

export interface CommandContext {
  io: CliIo;
  values: ParsedValues;
  /** Arguments after the command name, without options. */
  positionals: string[];
  /** Everything after `--`. Only commands with `passthrough` get any. */
  rest: string[];
  settings: Settings;
  /** A person is at a terminal and CI is not set: questions and menus are allowed. */
  interactive: boolean;
  /** Writes to standard output: results and values. */
  out(text: string): void;
  /** Writes to standard error: errors, warnings, progress. */
  err(text: string): void;
  /** Prints a result as JSON on standard output. */
  json(value: unknown): void;
  /** The vault service for this run, made on first use. */
  service(): Promise<VaultService>;
  /** The value of a result, or a CliError with the right words and exit code. */
  unwrap<T>(result: Result<T>, options?: { field?: string; deleted?: boolean }): T;
  /** Opens the vault and returns its name. `readOnly` takes no lock and writes nothing, not even device state (a dry run). `changes` says the
   *  command will change something: a refusal because another psss is busy then adds `Nothing was changed.` (a read-only command does not). */
  open(options?: { readOnly?: boolean; changes?: boolean }): Promise<{ name: string; path: string }>;
}

export interface Command {
  name: string;
  summary: string;
  /** The usage line without `psss `, such as `get <reference>`. */
  usage: string;
  /** Options of this command, besides the global ones. */
  options: Record<string, OptionSpec>;
  /** How many positional arguments it takes. */
  args: { min: number; max: number };
  /** The command says in its own words what is missing (and why), so the generic usage line is not used for it. */
  ownMissingMessage?: boolean;
  /** True when everything after `--` belongs to a program the command starts. */
  passthrough?: boolean;
  /** A command that is a group of verbs (`item show`, `file get`): each is a command named `<group> <verb>`. */
  subcommands?: Command[];
  /** Named in the help but not built yet. */
  planned?: boolean;
  /** Extra lines for `psss <command> --help`. */
  details?: string[];
  run(context: CommandContext): Promise<number>;
}

export const jsonOption: Record<string, OptionSpec> = {
  json: { type: 'boolean', description: 'Print the result as JSON on standard output' },
};

export function hasJson(values: ParsedValues): boolean {
  return values.json === true;
}

/** The text of a failed result and its exit code. */
export function failureError(io: CliIo, failure: Failure, options: { field?: string; deleted?: boolean } = {}): CliError {
  switch (failure.kind) {
    case 'notFound': {
      const vaultName = printable(failure.vault);
      const where = options.deleted ? `in Recently Deleted in ${vaultName}` : `in ${vaultName}`;
      const see = options.deleted ? 'psss list --deleted' : 'psss list';
      if (failure.what === 'group') {
        return new CliError(`There is no group called "${printable(failure.name)}" in ${failure.vault}.`, EXIT_NOT_FOUND);
      }
      if (failure.what === 'file') {
        const files = failure.fields ?? [];
        const has = files.length > 0 ? `It has: ${files.map((f) => printable(f)).join(', ')}.` : 'It has no files.';
        return new CliError(`"${failure.item === undefined ? 'That item' : printable(failure.item)}" has no file called "${printable(failure.name)}".\n${has}`, EXIT_NOT_FOUND);
      }
      if (failure.what === 'field') {
        const fields = failure.fields ?? [];
        const has = fields.length > 0 ? `It has: ${fields.map((f) => printable(f)).join(', ')}.` : 'It has no fields of that kind.';
        return new CliError(`"${failure.item === undefined ? 'That item' : printable(failure.item)}" has no field called "${printable(failure.name)}".\n${has}`, EXIT_NOT_FOUND);
      }
      const what = failure.by === 'id' ? `item with the id "${printable(failure.name)}"` : `item called "${printable(failure.name)}"`;
      const did = failure.hints && failure.hints.length > 0 ? `\nDid you mean: ${failure.hints.map((h) => printable(h)).join(', ')}?` : '';
      return new CliError(`There is no ${what} ${where}.${did}\nSee what is there with: ${see}`, EXIT_NOT_FOUND);
    }
    case 'ambiguous': {
      const rows = failure.candidates.map((c) => ({
        ref: formatReference({ item: { id: c.id }, ...(options.field !== undefined ? { field: options.field } : {}) }),
        title: printable(c.title),
        username: printable(c.username ?? ''),
      }));
      const refW = Math.max(...rows.map((r) => r.ref.length)) + 3;
      const titleW = Math.max(...rows.map((r) => r.title.length)) + 3;
      const lines = rows.map((r) => `  ${r.ref.padEnd(refW)}${r.title.padEnd(titleW)}${r.username}`.trimEnd());
      return new CliError(
        `"${printable(failure.name)}" matches ${failure.candidates.length} items in ${failure.vault}. Use one of these:\n${lines.join('\n')}`,
        EXIT_NOT_FOUND,
      );
    }
    case 'locked': {
      const tail = 'Point PSSS_KEY_FILE at your key file, or use the vault\npassword with PSSS_PASSWORD_FILE.';
      const r = failure.reason;
      const head = `Cannot open the vault "${printable(failure.vault)}".`;
      switch (r.why) {
        case 'keyFileMissing':
          return new CliError(`${head}\nThis computer's key file is missing: ${displayPath(io, r.keyFile)}\n${tail}`, EXIT_LOCKED);
        case 'keyFileUnreadable':
          return new CliError(`${head}\nThis computer's key file cannot be read: ${displayPath(io, r.keyFile)}\n${tail}`, EXIT_LOCKED);
        case 'noKey':
          return new CliError(`${head}\nNo key was found on this computer.\n${tail}`, EXIT_LOCKED);
        case 'locked':
          return new CliError(`${head}\nIt needs its vault password.\nPut it in a file and point PSSS_PASSWORD_FILE at it.`, EXIT_LOCKED);
        case 'noVault': {
          if (r.unreadable && r.path !== undefined) {
            return new CliError(
              `The vault folder ${displayPath(io, r.path)} cannot be read (permission denied).\nCheck who may open that folder, or point PSSS_VAULT at another vault folder.`,
              EXIT_LOCKED,
            );
          }
          const at = r.path === undefined ? '' : ` at ${displayPath(io, r.path)}`;
          return new CliError(
            `There is no vault${at}.\nCreate one with: psss init <name>\nor point PSSS_VAULT at a vault folder.`,
            EXIT_LOCKED,
          );
        }
      }
      break;
    }
    case 'wrongKey': {
      const which = failure.keyFile === undefined ? 'The key you gave' : `The key in ${displayPath(io, failure.keyFile)}`;
      return new CliError(
        `Cannot open the vault "${printable(failure.vault)}".\n${which} does not open it.\nCheck that it is the key for this vault.`,
        EXIT_LOCKED,
      );
    }
    case 'failed':
      return new CliError(failure.message, EXIT_FAILED);
    case 'kdbx':
      return kdbxError(io, failure);
  }
  return new CliError('Something went wrong.', EXIT_FAILED);
}

/** The words and exit code for a KeePass file that cannot be used. Never a password. */
function kdbxError(io: CliIo, f: KdbxProblem): CliError {
  const file = displayPath(io, f.file);
  const none = 'Nothing was changed.';
  switch (f.why) {
    case 'missing':
      return new CliError(`There is no file at ${file}. ${none}`, EXIT_FAILED);
    case 'unreadable':
      return new CliError(`${file} cannot be read. ${none}`, EXIT_FAILED);
    case 'notKdbx':
      return new CliError(`${file} is not a KeePass file (KDBX 3 or 4). ${none}`, EXIT_FAILED);
    case 'wrongKey':
      return new CliError(`The password or key file does not open ${file}. ${none}\nA damaged file looks the same.`, EXIT_LOCKED);
    case 'invalidKey':
      return new CliError(`The key file for ${file} cannot be used${f.detail ? `: ${f.detail}` : ''}. ${none}`, EXIT_LOCKED);
    case 'corrupt':
      return new CliError(`${file} is damaged, so none of it was read. ${none}`, EXIT_FAILED);
    case 'limit':
      return new CliError(`${file} asks for more than Psss will spend to open it (${f.detail ?? 'a safety limit'}). ${none}`, EXIT_FAILED);
    case 'tooLarge':
      return new CliError(`${file} is larger than Psss will read (${f.detail ?? 'over the limit'}). ${none}`, EXIT_FAILED);
    case 'unsupported':
      return new CliError(`${file} uses something Psss does not read yet${f.detail ? `: ${f.detail}` : ''}. ${none}`, EXIT_FAILED);
    case 'exists':
      return new CliError(`${file} already exists, so nothing was written.\nChoose another name, or add --force to replace it.`, EXIT_FAILED);
    case 'notWritable':
      return new CliError(`Psss cannot write ${file}${f.detail ? ` (${f.detail})` : ''}. Nothing was written.`, EXIT_FAILED);
    case 'verifyFailed':
      return new CliError(`The file written to ${file} did not read back the same, so it was removed. Nothing was written.`, EXIT_FAILED);
  }
}

/** The usage error for a missing reference (frame A10). A terminal can be offered a list only where `canOffer` is true. */
export function missingReferenceError(ctx: CommandContext, command: string, kind: ReferenceKind, canOffer: boolean): ValidationError {
  const example = kind === 'field' ? '"psss://Example API/token"' : '"psss://Example API"';
  const head = `psss ${command} needs a reference, such as\n${example}.`;
  if (canOffer && !ctx.interactive) {
    const why = ctx.io.isTTY.stdin && ctx.io.isTTY.stdout ? 'CI is set' : 'No terminal is attached';
    return new ValidationError(`${head} ${why},\nso Psss cannot offer a list to choose from.`);
  }
  return new ValidationError(head);
}

/** Parses a reference argument and applies `--group`. A reference that names another group than `--group` is a contradiction. */
export function resolveReference(ctx: CommandContext, text: string, kind: ReferenceKind): { ref: Reference; selector: ItemSelector } {
  let ref: Reference;
  try {
    ref = parseReference(text, kind);
  } catch (e) {
    if (e instanceof ValidationError && !text.startsWith('psss://')) {
      throw new ValidationError(`${e.message}\nA reference with spaces needs quotes in a shell, as in ${kind === 'field' ? '"psss://Example API/token"' : '"psss://Example API"'}.`);
    }
    throw e;
  }
  const group = ctx.settings.group;
  if (ref.group !== undefined && group !== undefined && ref.group.toLowerCase() !== group.toLowerCase()) {
    throw new ValidationError(`The reference names the group "${printable(ref.group)}" but --group (or PSSS_GROUP) says "${printable(group)}". Use one of them.`);
  }
  return { ref, selector: toSelector(ref) };
}

/**
 * Finds the one item an item-level command (rm, restore) names. A reference such as `psss://Example API/token` reads as group and
 * item; when that group does not exist but the first part is an item, the person gave a field, and the answer says so (exit 2).
 */
export async function findItem(ctx: CommandContext, svc: VaultService, command: string, selector: ItemSelector, deleted: boolean): Promise<ItemSummary> {
  const found = await svc.find(selector, { deleted });
  if (!found.ok && found.kind === 'notFound' && found.what === 'group' && 'title' in selector && selector.group !== undefined) {
    for (const scope of [deleted, !deleted]) {
      const first = await svc.find({ title: selector.group }, { deleted: scope });
      if (first.ok) {
        const use = formatReference({ item: { title: first.value.title } });
        throw new ValidationError(`${command} takes an item, not a field. Use: psss ${command} ${shellQuote(use)}`);
      }
    }
  }
  return ctx.unwrap(found, deleted ? { deleted: true } : {});
}
