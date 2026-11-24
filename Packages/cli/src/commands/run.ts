import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { SECRET_ENV } from '../config.ts';
import { CliError, EXIT_FAILED, ValidationError } from '../errors.ts';
import { resolveReference } from './command.ts';
import type { Command } from './command.ts';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Binding {
  name: string;
  reference: string;
}

function binding(text: string, where: string): Binding {
  const at = text.indexOf('=');
  if (at <= 0) throw new ValidationError(`${where}: each entry needs the form NAME=reference, such as DEPLOY_TOKEN="psss://Example API/token".`);
  const name = text.slice(0, at);
  let reference = text.slice(at + 1);
  if (/^(".*"|'.*')$/.test(reference) && reference.length >= 2) reference = reference.slice(1, -1);
  if (!NAME.test(name)) throw new ValidationError(`${where}: "${name}" is not a usable environment variable name. Use letters, digits and "_".`);
  if (!reference.startsWith('psss://')) {
    throw new ValidationError(`${where}: the value of ${name} must be a psss:// reference. A secret is never written in a command.`);
  }
  return { name, reference };
}

function readEnvFile(cwd: string, file: string): Binding[] {
  const full = path.resolve(cwd, file);
  let text: string;
  try {
    text = readFileSync(full, 'utf8');
  } catch (e) {
    throw new CliError(`Cannot read the env file ${file}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (e as Error).message}`);
  }
  const out: Binding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) return;
    out.push(binding(t.replace(/^export\s+/, ''), `${file} line ${i + 1}`));
  });
  return out;
}

const run: Command = {
  name: 'run',
  summary: 'Run a program with secrets in its environment and nowhere else',
  usage: 'run (--env NAME=<reference> | --env-file <file>) ... -- <program> [arguments]',
  options: {
    env: { type: 'string', multiple: true, valueName: 'NAME=reference', description: 'Give the program this variable; repeat for more' },
    'env-file': { type: 'string', multiple: true, valueName: 'file', description: 'A file of NAME=reference lines (blank lines and # comments allowed)' },
  },
  args: { min: 0, max: 0 },
  passthrough: true,
  details: [
    'Every reference is read before the program starts; if one cannot be, nothing runs. The program\'s exit code is passed on.',
    'Psss does not hide what the program itself prints, and a program can read and pass on its own environment.',
    'The program does not receive PSSS_KEY or PSSS_PASSWORD_FILE.',
  ],
  async run(ctx) {
    const envFlags = (ctx.values.env as string[] | undefined) ?? [];
    const fileFlags = (ctx.values['env-file'] as string[] | undefined) ?? [];
    const bindings: Binding[] = [
      ...envFlags.map((e) => binding(e, '--env')),
      ...fileFlags.flatMap((f) => readEnvFile(ctx.io.cwd, f)),
    ];
    if (ctx.rest.length === 0) {
      throw new ValidationError('psss run needs a program after "--", such as:\npsss run --env DEPLOY_TOKEN="psss://Example API/token" -- ./deploy.sh');
    }
    if (bindings.length === 0) {
      throw new ValidationError('psss run needs at least one --env NAME=reference or --env-file file, or there is nothing to give the program.');
    }
    const seen = new Set<string>();
    for (const b of bindings) {
      if (seen.has(b.name)) throw new ValidationError(`${b.name} is set more than once. Give each variable one reference.`);
      seen.add(b.name);
    }
    const parsed = bindings.map((b) => {
      const { ref, selector } = resolveReference(ctx, b.reference, 'field');
      if (ref.field === undefined) throw new ValidationError(`The reference for ${b.name} names a field, such as "psss://Example API/token".`);
      return { name: b.name, selector, field: ref.field };
    });

    await ctx.open();
    const svc = await ctx.service();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx.io.env)) {
      if (v !== undefined && !(SECRET_ENV as readonly string[]).includes(k)) env[k] = v;
    }
    for (const p of parsed) {
      env[p.name] = ctx.unwrap(await svc.get(p.selector, p.field), { field: p.field }).value;
    }
    if (ctx.settings.verbose) ctx.err(`psss: running ${ctx.rest[0]} with ${parsed.map((p) => p.name).join(', ')}\n`);

    const [program, ...args] = ctx.rest;
    return await new Promise<number>((resolve, reject) => {
      const inherit = ctx.io.inheritStdio === true;
      const child = spawn(program, args, { cwd: ctx.io.cwd, env, stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
      if (!inherit) {
        child.stdout!.setEncoding('utf8').on('data', (d: string) => ctx.out(d));
        child.stderr!.setEncoding('utf8').on('data', (d: string) => ctx.err(d));
        const stdin = ctx.io.stdin as { pipe?: (to: unknown) => unknown };
        child.stdin!.on('error', () => {});
        if (!ctx.io.isTTY.stdin && typeof stdin.pipe === 'function') stdin.pipe(child.stdin);
        else child.stdin!.end();
      }
      child.on('error', (e: NodeJS.ErrnoException) => {
        const why = e.code === 'ENOENT' ? 'no such file or program' : e.code === 'EACCES' ? 'it is not executable' : e.message;
        reject(new CliError(`Cannot run "${program}": ${why}.`, EXIT_FAILED));
      });
      child.on('close', (code, signal) => {
        if (code !== null) resolve(code);
        else {
          const n = signal ? ((osConstants.signals as Record<string, number>)[signal] ?? 0) : 0;
          ctx.err(`${program} was stopped by ${signal}.\n`);
          resolve(128 + n);
        }
      });
    });
  },
};

export default run;
