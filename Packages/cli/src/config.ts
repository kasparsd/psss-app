// Global options: flag, environment variable and config key, in one table, with one precedence:
// flags, environment, `.psss.json` in the working directory, user config, defaults.
//
// Secrets (PSSS_KEY, PSSS_PASSWORD_FILE) have no config key and no flag. A config file with a key that looks like a secret,
// or any key this table does not know, is rejected with the file and the key named.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, ValidationError } from './errors.ts';
import { displayPath, homeOf } from './io.ts';
import type { CliIo } from './io.ts';

export interface OptionRow {
  /** Long flag, without the dashes. */
  flag: string;
  short?: string;
  type: 'string' | 'boolean';
  env: string;
  /** Config key in the user config; `.psss.json` accepts the keys listed in `projectFile`. */
  configKey?: string;
  /** Whether a committed `.psss.json` may set it. */
  projectFile: boolean;
  valueName?: string;
  description: string;
}

/** The options table. Documented in the README and printed by `psss --help`. */
export const GLOBAL_OPTIONS: readonly OptionRow[] = [
  {
    flag: 'vault',
    type: 'string',
    env: 'PSSS_VAULT',
    configKey: 'vault',
    projectFile: true,
    valueName: 'folder-or-name',
    description: 'The vault to use: its folder or its name. For init, the folder to create it in',
  },
  {
    flag: 'group',
    type: 'string',
    env: 'PSSS_GROUP',
    configKey: 'group',
    projectFile: true,
    valueName: 'name',
    description: 'Look in one group, and create new items there',
  },
  {
    flag: 'key-file',
    type: 'string',
    env: 'PSSS_KEY_FILE',
    configKey: 'keyFile',
    projectFile: false,
    valueName: 'file',
    description: 'This computer\'s key file. Never in a committed .psss.json',
  },
  {
    flag: 'verbose',
    type: 'boolean',
    env: 'PSSS_VERBOSE',
    configKey: 'verbose',
    projectFile: true,
    description: 'Say on standard error which settings were used and where they came from',
  },
  {
    flag: 'yes',
    short: 'y',
    type: 'boolean',
    env: 'PSSS_YES',
    projectFile: false,
    description: 'Answer yes to questions. Never settable by a config file',
  },
];

/** Environment variables that hold secrets. They are read by the command, never printed and never passed on to a program `run` starts. */
export const SECRET_ENV = ['PSSS_KEY', 'PSSS_PASSWORD_FILE', 'PSSS_KDBX_PASSWORD_FILE'] as const;

export interface Settings {
  vault?: string;
  group?: string;
  keyFile?: string;
  verbose: boolean;
  yes: boolean;
  /** PSSS_KEY. A secret: pass it on to the service only. */
  key?: string;
  /** PSSS_PASSWORD_FILE. */
  passwordFile?: string;
  /** Where each setting came from, for --verbose and tests. Never holds a secret. */
  sources: Record<string, string>;
}

type FileValues = { vault?: string; group?: string; keyFile?: string; verbose?: boolean };

const SECRET_KEY = /secret|passw|passphrase|token|credential|api[-_]?key|private|recovery|seed|^key$|^keys$|^key[-_]/i;

export function userConfigPath(io: CliIo): string {
  const platform = io.platform ?? process.platform;
  const home = homeOf(io);
  if (platform === 'win32') {
    const base = io.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(base, 'psss', 'config.json');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'psss', 'config.json');
  const base = io.env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
  return path.posix.join(base, 'psss', 'config.json');
}

function readFileValues(io: CliIo, file: string, label: string, projectFile: boolean): FileValues {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new CliError(`Cannot read ${label} (${displayPath(io, file)}): ${(e as Error).message}`);
  }
  const shown = displayPath(io, file);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ValidationError(`${shown} is not valid JSON.`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ValidationError(`${shown} must hold one JSON object.`);
  }
  const out: FileValues = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key !== 'keyFile' && SECRET_KEY.test(key)) {
      throw new ValidationError(
        `${shown}: the key "${key}" looks like a secret. A config file holds no secrets; give them through the environment (PSSS_KEY, PSSS_PASSWORD_FILE).`,
      );
    }
    const row = GLOBAL_OPTIONS.find((r) => r.configKey === key);
    if (!row) {
      throw new ValidationError(
        `${shown}: unknown key "${key}". Known keys: ${GLOBAL_OPTIONS.filter((r) => r.configKey && (!projectFile || r.projectFile)).map((r) => r.configKey).join(', ')}.`,
      );
    }
    if (projectFile && !row.projectFile) {
      throw new ValidationError(
        `${shown}: "${key}" is not allowed in this file. A key path belongs in the user config (${displayPath(io, userConfigPath(io))}), not in a file that may be committed.`,
      );
    }
    if (row.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string' || value === '') {
      throw new ValidationError(`${shown}: "${key}" must be ${row.type === 'boolean' ? 'true or false' : 'a non-empty string'}.`);
    }
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function parseBoolean(name: string, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(t)) return true;
  if (['', '0', 'false', 'no', 'off'].includes(t)) return false;
  throw new ValidationError(`${name} must be 1 or 0, not "${text}".`);
}

function expandHome(io: CliIo, value: string | undefined): string | undefined {
  if (value === undefined) return value;
  const home = homeOf(io);
  if (home && value === '~') return home;
  if (home && (value.startsWith('~/') || value.startsWith('~\\'))) return path.join(home, value.slice(2));
  return value;
}

export type ParsedValues = Record<string, string | boolean | Array<string | boolean> | undefined>;

export function resolveSettings(io: CliIo, flags: ParsedValues): Settings {
  const projectFile = readFileValues(io, path.join(io.cwd, '.psss.json'), '.psss.json', true);
  const userFile = readFileValues(io, userConfigPath(io), 'the user config', false);
  const settings: Settings = { verbose: false, yes: false, sources: {} };

  for (const row of GLOBAL_OPTIONS) {
    const name = row.configKey ?? row.flag;
    let value: string | boolean | undefined;
    let source = 'default';

    const flag = flags[row.flag];
    const envText = io.env[row.env];
    const fromProject = row.configKey ? (projectFile as Record<string, string | boolean | undefined>)[row.configKey] : undefined;
    const fromUser = row.configKey ? (userFile as Record<string, string | boolean | undefined>)[row.configKey] : undefined;

    if (flag !== undefined && !Array.isArray(flag)) {
      value = flag;
      source = `--${row.flag}`;
    } else if (envText !== undefined && envText !== '') {
      value = row.type === 'boolean' ? parseBoolean(row.env, envText) : envText;
      source = row.env;
    } else if (fromProject !== undefined) {
      value = fromProject;
      source = '.psss.json';
    } else if (fromUser !== undefined) {
      value = fromUser;
      source = 'the user config';
    }
    if (value === undefined) continue;
    (settings as unknown as Record<string, unknown>)[name] = value;
    settings.sources[name] = source;
  }
  settings.vault = expandHome(io, settings.vault);
  settings.keyFile = expandHome(io, settings.keyFile);

  if (io.env.PSSS_KEY) settings.key = io.env.PSSS_KEY;
  if (io.env.PSSS_PASSWORD_FILE) settings.passwordFile = expandHome(io, io.env.PSSS_PASSWORD_FILE);
  return settings;
}

/** One line per setting in use, for --verbose. Names the source, never a secret. */
export function describeSettings(settings: Settings): string[] {
  const lines: string[] = [];
  for (const name of ['vault', 'group', 'keyFile'] as const) {
    const v = settings[name];
    if (v !== undefined) lines.push(`psss: ${name}: ${v} (from ${settings.sources[name]})`);
  }
  if (settings.key !== undefined) lines.push('psss: key: given in PSSS_KEY');
  if (settings.passwordFile !== undefined) lines.push('psss: password file: given in PSSS_PASSWORD_FILE');
  return lines;
}

/** The folder keys and the user config live in: `<config base>/psss`. Linux and macOS: `$XDG_CONFIG_HOME` or `~/.config`. Windows: `%APPDATA%`. */
export function configDir(io: CliIo): string {
  const platform = io.platform ?? process.platform;
  const home = homeOf(io);
  if (platform === 'win32') return path.win32.join(io.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'psss');
  return path.posix.join(io.env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'psss');
}

/** Device state: `$XDG_STATE_HOME/psss` or `~/.local/state/psss` on macOS and Linux, `%LOCALAPPDATA%\psss` on Windows. */
export function stateDir(io: CliIo): string {
  const platform = io.platform ?? process.platform;
  const home = homeOf(io);
  if (platform === 'win32') return path.win32.join(io.env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'psss');
  return path.posix.join(io.env.XDG_STATE_HOME || path.posix.join(home, '.local', 'state'), 'psss');
}

/** One key file per vault: `<configDir>/keys/<vault name>.key`. */
export function defaultKeyFile(io: CliIo, vaultName: string): string {
  const platform = io.platform ?? process.platform;
  return (platform === 'win32' ? path.win32 : path.posix).join(configDir(io), 'keys', `${vaultName}.key`);
}
