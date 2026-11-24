// The credentials of a KeePass file for `import` and `export`: a file named by --kdbx-key-file, and a password that is typed without echo,
// piped in, or read from the file named by PSSS_KDBX_PASSWORD_FILE. Never an argument. (--key-file already means this computer's vault key.)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, EXIT_FAILED, ValidationError } from '../errors.ts';
import { readSecret } from '../input.ts';
import { displayPath } from '../io.ts';
import type { KdbxCredentials } from '../service.ts';
import type { CommandContext, OptionSpec } from './command.ts';

export const kdbxKeyOption: Record<string, OptionSpec> = {
  'kdbx-key-file': { type: 'string', valueName: 'path', description: 'A key file for the KeePass file (with or without a password)' },
};

export async function kdbxCredentials(ctx: CommandContext, what: { prompt: string; name: string }): Promise<KdbxCredentials> {
  const keyFile = typeof ctx.values['kdbx-key-file'] === 'string' ? (ctx.values['kdbx-key-file'] as string) : undefined;
  if (keyFile === '') throw new ValidationError('--kdbx-key-file needs the path of a key file.');
  const credentials: KdbxCredentials = keyFile !== undefined ? { keyFile } : {};
  const fromFile = ctx.io.env.PSSS_KDBX_PASSWORD_FILE;
  if (fromFile !== undefined && fromFile !== '') {
    const at = path.resolve(ctx.io.cwd, fromFile);
    try {
      credentials.password = readFileSync(at, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new CliError(`The file named by PSSS_KDBX_PASSWORD_FILE cannot be read: ${displayPath(ctx.io, at)}`, EXIT_FAILED);
    }
    if (credentials.password === '' && keyFile === undefined) {
      throw new ValidationError(`The file named by PSSS_KDBX_PASSWORD_FILE is empty, so there is no password for ${what.name}.`);
    }
    return credentials;
  }
  const hint = keyFile !== undefined ? 'not shown, Enter for none' : 'not shown';
  credentials.password = await readSecret(ctx.io, `Password for ${what.prompt} (${hint}): `, {
    allowEmpty: keyFile !== undefined,
    emptyMessage: `No password was given for ${what.name}. Type it when asked, pipe it in, or put it in a file and point PSSS_KDBX_PASSWORD_FILE at it.`,
  });
  return credentials;
}
