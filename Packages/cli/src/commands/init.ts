import path from 'node:path';
import { defaultKeyFile } from '../config.ts';
import { choose, readSecret } from '../input.ts';
import { ValidationError } from '../errors.ts';
import { displayPath } from '../io.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';

const EXAMPLE = 'psss set --create "psss://Example API/token"';

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || /[\\/\u0000-\u001f]/.test(trimmed) || trimmed.length > 100) {
    throw new ValidationError(
      `"${name}" cannot be a vault name. Use a short name without "/" or "\\", such as: psss init Personal`,
    );
  }
  return trimmed;
}

const init: Command = {
  name: 'init',
  summary: "Create a vault and this computer's key",
  usage: 'init <name> [--vault <folder>] [--key-file <file>] [--no-recovery] [--json]',
  options: {
    'no-recovery': { type: 'boolean', description: 'Do not ask about, or warn about, a way back if the key file is lost' },
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'Creates <name>.psss, a folder of encrypted files, and this computer\'s key file.',
    'In a terminal it then asks how you want a way back if the key file is lost.',
    'With no terminal it asks nothing and warns on standard error.',
    'The key file is one file per vault in the user config folder and never inside the vault folder.',
  ],
  async run(ctx) {
    if (ctx.positionals.length === 0) {
      throw new ValidationError('psss init needs a name for the vault, such as: psss init Personal');
    }
    const name = checkName(ctx.positionals[0]);
    // The key must never sit inside the vault folder: it would travel with the vault through a synced folder.
    if (ctx.settings.vault !== undefined) {
      const folder = path.resolve(ctx.io.cwd, ctx.settings.vault, `${name}.psss`);
      const key = path.resolve(ctx.io.cwd, ctx.settings.keyFile ?? defaultKeyFile(ctx.io, name));
      const rel = path.relative(folder, key);
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        throw new ValidationError(
          `The key file ${displayPath(ctx.io, key)} is inside the vault folder ${displayPath(ctx.io, folder)}.\nA key beside the vault would travel with it. Choose a key file outside the vault folder, or another place for the vault.`,
        );
      }
    }
    const svc = await ctx.service();
    const created = ctx.unwrap(await svc.create({ name }));
    const where = displayPath(ctx.io, created.path);
    const keyPath = displayPath(ctx.io, created.key.path);
    const noRecovery = ctx.values['no-recovery'] === true;

    if (hasJson(ctx.values)) {
      ctx.json({
        vault: { name: created.name, path: created.path },
        key: { path: created.key.path, ownerOnly: created.key.ownerOnly, created: created.key.created },
        wayBack: [],
      });
    } else if (ctx.interactive) {
      ctx.out(
        `Created the vault "${created.name}".\n\n` +
          `  Where   ${where}\n` +
          `          A folder of encrypted files. Nothing is uploaded.\n` +
          `  Key     ${keyPath}\n` +
          `          This computer's key. Without it nobody can open the\n` +
          `          vault, not even Psss.\n\n`,
      );
      if (noRecovery) {
        ctx.out(`Next: ${EXAMPLE}\n`);
      } else {
        const index = await choose(ctx.io, 'How do you want a way back if that file is lost?', ['A vault password', 'Not now'], 'Choose 1 or 2: ');
        let done = 'Done. Add a way back later with: psss key password set\n';
        if (index === 0) {
          const first = await readSecret(ctx.io, 'Vault password (not shown): ');
          const again = await readSecret(ctx.io, 'Again (not shown): ');
          if (first !== again) {
            throw new ValidationError('The two passwords differ, so none was set. The vault was created; add one with: psss key password set');
          }
          ctx.unwrap(await svc.setPassword(first));
          done = 'Done. The vault also opens with that password.\n';
        }
        ctx.out(`\n${done}Next: ${EXAMPLE}\n`);
      }
    } else {
      const only = created.key.ownerOnly ? ' (readable by you only)' : '';
      ctx.out(`Created the vault "${created.name}" in ${where}\nKey file: ${keyPath}${only}\n`);
    }

    if (!noRecovery && !ctx.interactive) {
      ctx.err(
        'warning: that key file is the only way into the vault.\n' +
          'Run psss key password set, or pass --no-recovery\n' +
          'to stop this warning.\n',
      );
    }
    return 0;
  },
};

export default init;
