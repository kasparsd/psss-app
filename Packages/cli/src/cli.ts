// psss: the entry point. `run(argv, io)` returns the exit code and never ends the process, so tests run it in process.

import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { configDir, describeSettings, GLOBAL_OPTIONS, resolveSettings, stateDir } from './config.ts';
import type { ParsedValues } from './config.ts';
import { commands } from './commands/index.ts';
import type { Command, CommandContext, OptionSpec } from './commands/command.ts';
import { failureError } from './commands/command.ts';
import { CliError, EXIT_FAILED, EXIT_LOCKED, EXIT_NOT_FOUND, EXIT_OK, EXIT_USAGE, ValidationError } from './errors.ts';
import { commandHelp, rootHelp } from './help.ts';
import { displayPath, homeOf, isInteractive } from './io.ts';
import type { CliIo } from './io.ts';
import type { Failure, OpenedVault, Result, VaultService } from './service.ts';

export { EXIT_OK, EXIT_FAILED, EXIT_USAGE, EXIT_NOT_FOUND, EXIT_LOCKED, ValidationError };
export type { CliIo };
export { commands };

export const VERSION = '0.0.0';

const VALUE_FLAGS = new Set(GLOBAL_OPTIONS.filter((o) => o.type === 'string').map((o) => `--${o.flag}`));

/** Commands that read or write values and so say when the vault has a problem or the key file is open to others (frame A11). */
const WARNING_COMMANDS = new Set(['get', 'list', 'set', 'status', 'run']);

/** What the one warning says the problem touched, by command: `the value above` for get and set (frame A11). */
function problemWarning(command: string, vault: string): string {
  const head = `warning: "${vault}" has a problem, so`;
  const tail = 'Run psss verify to see what is wrong.';
  switch (command) {
    case 'run':
      return `${head} the program ran with a value\nthat may be out of date. ${tail}\n`;
    case 'list':
    case 'status':
      return `${head} the result above may be\nout of date. ${tail}\n`;
    case 'set':
      return `${head} the new value may not show up\nuntil it is fixed. ${tail}\n`;
    default:
      return `${head} the value above may be\nout of date. ${tail}\n`;
  }
}

/** Finds the command name among arguments that may start with global options. Returns its index, or -1. */
function findCommand(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return -1;
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a)) i++;
      continue;
    }
    return i;
  }
  return -1;
}

function unknownRootOption(argv: string[]): string | undefined {
  const known = new Set(['--help', '-h', '--version', '--', ...GLOBAL_OPTIONS.flatMap((o) => [`--${o.flag}`, ...(o.short ? [`-${o.short}`] : [])])]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].split('=')[0];
    if (!flag.startsWith('-')) continue;
    if (!known.has(flag)) return flag;
    if (VALUE_FLAGS.has(argv[i])) i++;
  }
  return undefined;
}

function parseConfig(command: Command): ParseArgsOptionsConfig {
  const config: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
  const add = (name: string, o: { type: 'string' | 'boolean'; short?: string; multiple?: boolean }) => {
    config[name] = { type: o.type, ...(o.short ? { short: o.short } : {}), ...(o.multiple ? { multiple: true } : {}) };
  };
  for (const o of GLOBAL_OPTIONS) add(o.flag, o);
  for (const [name, o] of Object.entries(command.options) as Array<[string, OptionSpec]>) add(name, o);
  return config;
}

function usageError(command: Command, error: unknown): ValidationError {
  const e = error as NodeJS.ErrnoException;
  const named = /'([^']+)'/.exec(e.message)?.[1]?.replace(/\s*<.*>$/, '');
  const help = `See: psss ${command.name} --help`;
  if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return new ValidationError(`Unknown option ${named ?? ''} for psss ${command.name}. ${help}`.replace('  ', ' '));
  if (e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const takes = /does not take an argument/.test(e.message) ? 'does not take a value' : 'needs a value';
    return new ValidationError(`The option ${named ?? ''} ${takes}. ${help}`.replace('  ', ' '));
  }
  return new ValidationError(`${e.message} ${help}`);
}

function writer(stream: { write(chunk: string): unknown }) {
  return (text: string) => {
    stream.write(text);
  };
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const out = writer(io.stdout);
  const err = writer(io.stderr);

  const at = findCommand(argv);
  const before = at < 0 ? argv : argv.slice(0, at);
  if (at < 0) {
    // `psss`, `psss --help`, `psss --vault x`: no command, so the help (or the version).
    const unknown = unknownRootOption(argv);
    if (unknown !== undefined) {
      err(`Unknown option ${unknown}. See: psss --help\n`);
      return EXIT_USAGE;
    }
    out(argv.includes('--version') ? `psss ${VERSION}\n` : rootHelp(VERSION));
    return EXIT_OK;
  }

  const stray = unknownRootOption(before);
  if (stray !== undefined) {
    err(`Unknown option ${stray}. Options that belong to one command, such as --json, go after the command name. See: psss --help\n`);
    return EXIT_USAGE;
  }
  if (before.includes('--version')) {
    out(`psss ${VERSION}\n`);
    return EXIT_OK;
  }
  let name = argv[at];
  let args = [...argv.slice(0, at), ...argv.slice(at + 1)];
  if (name === 'help') {
    const target = args.find((a) => !a.startsWith('-'));
    if (target === undefined) {
      out(rootHelp(VERSION));
      return EXIT_OK;
    }
    name = target;
    args = ['--help'];
  }
  const command = commands.find((c) => c.name === name);
  if (!command) {
    err(`Unknown command "${name}". See the commands with: psss --help\n`);
    return EXIT_USAGE;
  }

  // Everything after `--` belongs to the program a command starts, and is never parsed.
  const dash = args.indexOf('--');
  const rest = command.passthrough && dash >= 0 ? args.slice(dash + 1) : [];
  const own = command.passthrough && dash >= 0 ? args.slice(0, dash) : args;

  if (own.includes('--help') || own.includes('-h')) {
    out(commandHelp(command));
    return EXIT_OK;
  }
  if (command.planned) {
    err(`psss ${command.name} is not built yet.\n`);
    return EXIT_FAILED;
  }

  try {
    let parsed;
    try {
      parsed = parseArgs({ args: own, options: parseConfig(command), allowPositionals: true, strict: true });
    } catch (e) {
      throw usageError(command, e);
    }
    const values = parsed.values as ParsedValues;
    const positionals = parsed.positionals;
    if (positionals.length > command.args.max) {
      // Extra arguments are counted, not repeated: one of them may be a value typed where it must not be.
      const more = positionals.length - command.args.max;
      const allowed = command.args.max === 0 ? 'no arguments' : command.args.max === 1 ? 'one argument' : `at most ${command.args.max} arguments`;
      const hint =
        command.name === 'set'
          ? ' A value is never an argument: pipe it in, or type it when asked.'
          : positionals.some((p) => p.startsWith('psss://'))
            ? ' If a reference has spaces, put it in quotes, as in "psss://Example API/token".'
            : '';
      throw new ValidationError(`psss ${command.name} takes ${allowed}, but ${more} more ${more === 1 ? 'was' : 'were'} not expected.${hint}`);
    }

    const settings = resolveSettings(io, values);
    if (settings.verbose) for (const line of describeSettings(settings)) err(`${line}\n`);

    let service: Promise<VaultService> | undefined;
    let opened: OpenedVault | undefined;
    const warns = WARNING_COMMANDS.has(command.name);
    const context: CommandContext = {
      io,
      values,
      positionals,
      rest,
      settings,
      interactive: isInteractive(io),
      out,
      err,
      json: (value) => out(`${JSON.stringify(value, null, 2)}\n`),
      service: () => {
        service ??= (async () => {
          if (!io.service) {
            throw new CliError('This build of psss cannot open a vault yet: the vault library is not connected to it.', EXIT_FAILED);
          }
          return await io.service({
            ...(settings.vault !== undefined ? { vault: settings.vault } : {}),
            ...(settings.group !== undefined ? { group: settings.group } : {}),
            ...(settings.keyFile !== undefined ? { keyFile: settings.keyFile } : {}),
            ...(settings.key !== undefined ? { key: settings.key } : {}),
            ...(settings.passwordFile !== undefined ? { passwordFile: settings.passwordFile } : {}),
            cwd: io.cwd,
            home: homeOf(io),
            platform: io.platform ?? process.platform,
            configDir: configDir(io),
            stateDir: stateDir(io),
          });
        })();
        return service;
      },
      unwrap<T>(result: Result<T>, options?: { field?: string; deleted?: boolean }): T {
        if (result.ok) return result.value;
        throw failureError(io, result as Failure, options);
      },
      async open(options) {
        const svc = await context.service();
        const value = context.unwrap(await svc.open(options));
        opened = value;
        const key = value.keyFile;
        if (warns && key?.readableByOthers && (io.platform ?? process.platform) !== 'win32') {
          const shown = displayPath(io, key.path);
          err(`warning: ${shown} can be read by\nother users. Run: chmod 600 ${shown}\n`);
        }
        return value;
      },
    };
    const code = await command.run(context);
    if (warns && opened && (opened.issues ?? []).length > 0) err(problemWarning(command.name, opened.name));
    return code;
  } catch (e) {
    if (e instanceof ValidationError) {
      err(`${e.message}\n`);
      return EXIT_USAGE;
    }
    if (e instanceof CliError) {
      err(`${e.message}\n`);
      return e.exitCode;
    }
    err(`psss: unexpected error: ${(e as Error).message}\n`);
    return EXIT_FAILED;
  }
}
