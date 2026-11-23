#!/usr/bin/env node
// The psss command. It holds no key and opens no vault: it asks the running app, which asks the person.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotRunning, ask } from './client.ts';
import { masker, maskAll } from './mask.ts';
import { parseRef, type Ref, type Response } from './protocol.ts';

const HELP = `psss: use what is in your Psss vault from the command line, without printing it.

  psss run --env NAME=psss://item/field -- program [arguments]
      Runs the program with the secret in its environment. Psss hides the secret in what the
      program prints. The program itself can read it, so Psss asks you every time.
  psss fetch [--basic | --header NAME] [-X METHOD] [-H 'Name: value'] [--data TEXT] psss://item/field https://address
      Sends a request with the secret to the website the item is saved for, and prints the answer.
      The secret goes nowhere else.
  psss code item
      Prints the current verification code.
  psss save --title NAME [--username NAME] [--site HOST] [--field NAME] (--generate | --stdin)
      Stores a new item. With --generate Psss makes the password and nobody sees it.
  psss list [--json]
      What you have allowed this terminal or app to use. Names only.
  psss show [--print] psss://item/field
      Prints the secret itself. Refused outside a terminal unless --print is given.
  psss status

Psss asks you in the app, with Touch ID, each time something new is wanted.
`;

/** Headers the request sets from the address. A caller's value would be dropped without a word. */
const FIXED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

/** Exit codes a script or an agent can rely on. */
const OK = 0;
const USAGE = 1;
const NOT_ALLOWED = 3;
const NOT_READY = 4;

function say(text: string): void {
  process.stderr.write(text.endsWith('\n') ? text : text + '\n');
}

/** Prototype only: the caller names itself. The app reads this from the kernel and never from the caller. */
function requester(): string {
  if (process.env.PSSS_PROTO_REQUESTER) return process.env.PSSS_PROTO_REQUESTER;
  try {
    const name = execFileSync('ps', ['-o', 'comm=', '-p', String(process.ppid)], { encoding: 'utf8' }).trim();
    return path.basename(name) || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function send(message: Record<string, unknown>): Promise<Response | number> {
  try {
    return await ask({ requester: requester(), ...message });
  } catch (error) {
    if (error instanceof NotRunning) {
      say('Psss is not open. Open the Psss app and try again.');
      return NOT_READY;
    }
    throw error;
  }
}

function failed(response: Response & { ok: false }): number {
  say(response.message);
  if (response.error === 'locked') return NOT_READY;
  if (response.error === 'not_allowed' || response.error === 'refused') return NOT_ALLOWED;
  return USAGE;
}

function needRef(text: string | undefined): Ref | null {
  const ref = text ? parseRef(text) : null;
  if (!ref) say('Name what to use as psss://item/field, where item is its name in Psss.');
  return ref;
}

/** The real file behind a program name, so the approval sheet can show exactly what will run. */
export function findProgram(name: string): string | null {
  const candidates = name.includes('/') ? [path.resolve(name)] : (process.env.PATH ?? '').split(':').filter(Boolean).map((dir) => path.join(dir, name));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {
      // Try the next one.
    }
  }
  return null;
}

async function run(args: string[]): Promise<number> {
  const split = args.indexOf('--');
  const command = split >= 0 ? args.slice(split + 1) : [];
  const options = split >= 0 ? args.slice(0, split) : args;
  const names: string[] = [];
  const refs: Ref[] = [];
  for (let i = 0; i < options.length; i++) {
    if (options[i] !== '--env' || i + 1 >= options.length) {
      say('Use: psss run --env NAME=psss://item/field -- program [arguments]');
      return USAGE;
    }
    const pair = options[++i];
    const cut = pair.indexOf('=');
    const ref = cut > 0 ? needRef(pair.slice(cut + 1)) : null;
    if (!ref || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.slice(0, cut))) {
      if (cut <= 0 || ref) say('Use: --env NAME=psss://item/field, where NAME is a variable name.');
      return USAGE;
    }
    names.push(pair.slice(0, cut));
    refs.push(ref);
  }
  if (command.length === 0 || refs.length === 0) {
    say('Use: psss run --env NAME=psss://item/field -- program [arguments]');
    return USAGE;
  }
  const program = findProgram(command[0]);
  if (!program) {
    say(`There is no program named ${command[0]}.`);
    return 127;
  }
  const response = await send({ op: 'use', use: 'run', refs, program, argv: [program, ...command.slice(1)] });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  const values = response.values ?? [];
  const env: NodeJS.ProcessEnv = { ...process.env };
  names.forEach((name, index) => (env[name] = values[index]));

  return new Promise((resolve) => {
    const child = spawn(program, command.slice(1), { env, stdio: ['inherit', 'pipe', 'pipe'] });
    const out = masker(values);
    const err = masker(values);
    child.stdout.on('data', (chunk: Buffer) => process.stdout.write(out.push(chunk)));
    child.stdout.on('end', () => process.stdout.write(out.end()));
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(err.push(chunk)));
    child.stderr.on('end', () => process.stderr.write(err.end()));
    child.on('error', () => {
      say(`${command[0]} could not be started.`);
      resolve(126);
    });
    child.on('close', (code, signal) => resolve(code ?? 128 + (signal ? os.constants.signals[signal] ?? 0 : 0)));
  });
}

async function fetchWith(args: string[]): Promise<number> {
  let scheme: 'bearer' | 'basic' | 'header' = 'bearer';
  let headerName = 'Authorization';
  let method = 'GET';
  let body: string | undefined;
  const headers = new Headers();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--basic') scheme = 'basic';
    else if (arg === '--header' && args[i + 1]) {
      scheme = 'header';
      headerName = args[++i];
    } else if (arg === '-X' && args[i + 1]) method = args[++i].toUpperCase();
    else if (arg === '--data' && args[i + 1]) body = args[++i];
    else if (arg === '-H' && args[i + 1]) {
      const pair = args[++i];
      const cut = pair.indexOf(':');
      if (cut <= 0) {
        say("Use: -H 'Name: value'");
        return USAGE;
      }
      try {
        headers.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim());
      } catch {
        say("Use: -H 'Name: value'");
        return USAGE;
      }
    } else rest.push(arg);
  }
  if (rest.length !== 2) {
    say('Use: psss fetch psss://item/field https://address');
    return USAGE;
  }
  const ref = needRef(rest[0]);
  if (!ref) return USAGE;
  // Checked before the app is asked, so the person is never shown a sheet for something that cannot be sent.
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(headerName) || FIXED_HEADERS.has(headerName.toLowerCase())) {
    say(`Psss cannot put a secret in a header named ${JSON.stringify(headerName)}.`);
    return USAGE;
  }
  if ([...headers.keys()].some((name) => FIXED_HEADERS.has(name))) {
    say('Host, Content-Length, Connection and Transfer-Encoding are set from the address. Leave them out.');
    return USAGE;
  }
  if (headers.has(headerName)) {
    say(`Psss sets ${headerName} itself. Leave it out.`);
    return USAGE;
  }
  if (body !== undefined && method === 'GET') method = 'POST';
  if (!/^[A-Z]{1,16}$/.test(method)) {
    say('Use a method made of letters only, such as GET or POST.');
    return USAGE;
  }
  if (scheme === 'header' && !/^[A-Za-z0-9-]{1,64}$/.test(headerName)) {
    say(`Psss cannot put a secret in a header named ${JSON.stringify(headerName)}.`);
    return USAGE;
  }

  const response = await send({ op: 'use', use: 'fetch', refs: [ref], url: rest[1], method, as: scheme === 'header' ? `header:${headerName}` : scheme, body: body !== undefined });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  const secret = (response.values ?? [])[0] ?? '';
  const basic = Buffer.from(`${response.username ?? ''}:${secret}`).toString('base64');
  headers.set(headerName, scheme === 'bearer' ? `Bearer ${secret}` : scheme === 'basic' ? `Basic ${basic}` : secret);

  let answer: globalThis.Response;
  try {
    // A redirect is never followed: the next address may be another site, and the secret must not go there.
    answer = await fetch(rest[1], { method, headers, body, redirect: 'manual' });
  } catch {
    say('The website could not be reached.');
    return USAGE;
  }
  say(`HTTP ${answer.status}`);
  if (answer.status >= 300 && answer.status < 400) {
    say(`The website pointed to ${answer.headers.get('location') ?? 'another address'}. Psss did not follow it.`);
  }
  // A website that repeats what it was sent would hand the secret straight back, so the answer is masked too.
  process.stdout.write(maskAll(Buffer.from(await answer.arrayBuffer()), [secret, basic]));
  return OK;
}

async function code(args: string[]): Promise<number> {
  if (args.length !== 1) {
    say('Use: psss code item');
    return USAGE;
  }
  const item = parseRef(args[0])?.item ?? args[0];
  const response = await send({ op: 'use', use: 'code', refs: [{ item, field: 'code' }] });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  process.stdout.write(response.code + '\n');
  return OK;
}

async function show(args: string[]): Promise<number> {
  const print = args.includes('--print');
  const rest = args.filter((a) => a !== '--print');
  const ref = rest.length === 1 ? needRef(rest[0]) : null;
  if (!ref) {
    if (rest.length !== 1) say('Use: psss show psss://item/field');
    return USAGE;
  }
  if (!process.stdout.isTTY && !print) {
    // Decided before the app is asked, so a script or an agent gets no prompt to click through.
    say('psss show prints the secret itself. Nobody is looking at a terminal here, so it would end up in a file, a log or an AI conversation.');
    say('To use a secret without printing it: psss run, or psss fetch. To print it anyway: psss show --print.');
    return USAGE;
  }
  const response = await send({ op: 'use', use: 'show', refs: [ref] });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  process.stdout.write((response.values ?? [])[0] + '\n');
  return OK;
}

async function save(args: string[]): Promise<number> {
  const options: Record<string, string> = {};
  let generate = false;
  let stdin = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--generate') generate = true;
    else if (arg === '--stdin') stdin = true;
    else if (['--title', '--username', '--site', '--field'].includes(arg) && args[i + 1]) options[arg.slice(2)] = args[++i];
    else {
      say('Use: psss save --title NAME [--username NAME] [--site HOST] [--field NAME] (--generate | --stdin)');
      return USAGE;
    }
  }
  if (!options.title || generate === stdin) {
    say('Give --title, and either --generate (Psss makes the password) or --stdin (the value is read from standard input).');
    return USAGE;
  }
  // The value is never taken from an argument: arguments are visible to every process and kept in shell history.
  const value = stdin ? fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '') : undefined;
  const response = await send({ op: 'save', title: options.title, username: options.username, site: options.site, field: options.field ?? 'password', value, generate });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  process.stdout.write(response.ref + '\n');
  return OK;
}

async function list(args: string[]): Promise<number> {
  const response = await send({ op: 'list' });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  const items = response.items ?? [];
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(items, null, 2) + '\n');
  } else if (items.length === 0) {
    say('Nothing yet. Psss shows here only what you have allowed. Ask for an item by its name, as in psss run --env TOKEN=psss://item/field -- program, and Psss will ask you in the app.');
  } else {
    for (const item of items) {
      process.stdout.write(`${item.title}${item.username ? '  ' + item.username : ''}${item.sites.length ? '  ' + item.sites.join(', ') : ''}\n`);
      process.stdout.write(`  fields: ${item.fields.join(', ')}   allowed until Psss locks: ${item.uses.join(', ')}\n`);
    }
  }
  return OK;
}

async function status(): Promise<number> {
  const response = await send({ op: 'status' });
  if (typeof response === 'number') return response;
  if (!response.ok) return failed(response);
  process.stdout.write(response.locked ? 'Psss is open and locked.\n' : 'Psss is open and unlocked.\n');
  return response.locked ? NOT_READY : OK;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'run':
      return run(args);
    case 'fetch':
      return fetchWith(args);
    case 'code':
      return code(args);
    case 'show':
      return show(args);
    case 'save':
      return save(args);
    case 'list':
      return list(args);
    case 'status':
      return status();
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return OK;
    default:
      say(`psss does not know “${command}”. Try psss help.`);
      return USAGE;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (exit) => {
      process.exitCode = exit;
    },
    (error) => {
      say(`psss stopped: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = USAGE;
    },
  );
}
