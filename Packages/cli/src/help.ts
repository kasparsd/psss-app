import { GLOBAL_OPTIONS } from './config.ts';
import { commands } from './commands/index.ts';
import type { Command } from './commands/command.ts';
import { EXIT_FAILED, EXIT_LOCKED, EXIT_NOT_FOUND, EXIT_OK, EXIT_USAGE } from './errors.ts';

function optionLine(flag: string, short: string | undefined, valueName: string | undefined, description: string, suffix = ''): string {
  const left = `${short ? `-${short}, ` : '    '}--${flag}${valueName ? ` <${valueName}>` : ''}`;
  return `  ${left.padEnd(34)}${description}${suffix ? `\n${' '.repeat(36)}${suffix.trim()}` : ''}`;
}

export function rootHelp(version: string): string {
  const names = commands.map((c) => c.name);
  const width = Math.max(...names.map((n) => n.length)) + 2;
  const lines: string[] = [
    `psss ${version}: use a Psss vault from a terminal, a script or CI.`,
    '',
    'Usage:',
    '  psss <command> [options]',
    '  psss help <command>',
    '',
    'Commands:',
    ...commands.map((c) => `  ${c.name.padEnd(width)}${c.planned ? '(planned) ' : ''}${c.summary}`),
    '',
    'Options for every command:',
    ...GLOBAL_OPTIONS.map((o) => optionLine(o.flag, o.short, o.valueName, o.description, o.configKey ? `[${o.env}, config key: ${o.configKey}${o.projectFile ? '' : ', user config only'}]` : `[${o.env}]`)),
    '  -h, --help                        Show help for psss or for one command',
    '      --version                     Show the version',
    '',
    'Precedence: flags, environment, .psss.json in the working folder, user config, defaults.',
    '--json is an option of each command that produces a result, never a global one.',
    '',
    'Secrets are never arguments or config keys:',
    '  PSSS_KEY                          A key given inline, for CI that can only set variables (the weakest source)',
    '  PSSS_PASSWORD_FILE                A file that holds the vault password',
    '  PSSS_KDBX_PASSWORD_FILE           A file that holds the password of a KeePass file (import, export)',
    '',
    'Exit codes:',
    `  ${EXIT_OK}  done`,
    `  ${EXIT_FAILED}  failed`,
    `  ${EXIT_USAGE}  wrong use, or a failed verify`,
    `  ${EXIT_NOT_FOUND}  no such item, an ambiguous name, or not allowed`,
    `  ${EXIT_LOCKED}  locked, not open, or no key`,
    '',
  ];
  return lines.join('\n');
}

/** The help of a group of verbs: `psss item --help`. */
export function groupHelp(command: Command): string {
  const subs = command.subcommands ?? [];
  const width = Math.max(...subs.map((c) => c.name.length)) + 2;
  return [`Usage: psss ${command.usage}`, '', `${command.summary}.`, '', 'Verbs:', ...subs.map((c) => `  ${c.name.padEnd(width)}${c.summary}`), '', `See one with: psss ${command.name} <verb> --help`, ''].join('\n');
}

export function commandHelp(command: Command): string {
  const lines = [`Usage: psss ${command.usage}`, '', command.summary + (command.planned ? ' (planned, not built yet)' : '') + '.'];
  if (command.details?.length) lines.push('', ...command.details);
  const own = Object.entries(command.options);
  if (own.length > 0) {
    lines.push('', 'Options:');
    for (const [flag, o] of own) lines.push(optionLine(flag, o.short, o.type === 'string' ? (o.valueName ?? 'value') : undefined, o.description));
  }
  lines.push('', 'Every command also takes the options in psss --help (--vault, --group, --key-file, --verbose, --yes).', '');
  return lines.join('\n');
}
