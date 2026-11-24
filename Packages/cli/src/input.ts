// Reading from a person or from a pipe. A value is never an argument: it comes from standard input,
// or from a prompt that does not echo. Questions go to standard error so a pipe on standard out stays clean.

import { StringDecoder } from 'node:string_decoder';
import { CliError, EXIT_FAILED, ValidationError } from './errors.ts';
import type { CliIo, InputStream } from './io.ts';

/** The person ended the question (Ctrl-C, or the input closed where an answer was needed). */
export class Cancelled extends CliError {
  constructor(message = 'Cancelled.') {
    super(message, EXIT_FAILED);
    this.name = 'Cancelled';
  }
}

/** Reads one line from a terminal in its normal (echoing) mode. Returns null when the input ended with nothing. */
export function readLine(stdin: InputStream): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      stdin.pause();
    };
    const onData = (chunk: Uint8Array | string) => {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
      const at = buffer.indexOf('\n');
      if (at < 0) return;
      const line = buffer.slice(0, at).replace(/\r$/, '');
      const rest = buffer.slice(at + 1);
      cleanup();
      if (rest !== '' && stdin.unshift) stdin.unshift(Buffer.from(rest));
      resolve(line);
    };
    const onEnd = () => {
      cleanup();
      resolve(buffer === '' ? null : buffer.replace(/\r$/, ''));
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    stdin.resume();
  });
}

async function readAll(stdin: InputStream): Promise<string> {
  const iterate = stdin[Symbol.asyncIterator];
  if (!iterate) throw new CliError('Standard input cannot be read here.');
  const decoder = new StringDecoder('utf8');
  let text = '';
  for await (const chunk of stdin as AsyncIterable<Uint8Array | string>) {
    text += typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
  }
  return text + decoder.end();
}

function stripOneNewline(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

/**
 * Reads a secret value. Not a terminal: all of standard input, with one trailing newline removed and nothing else touched.
 * A terminal: asks `prompt` on standard error and reads without echo (raw mode, restored on exit and on error).
 * An empty value is a usage error.
 */
export async function readSecret(io: CliIo, prompt: string, options: { allowEmpty?: boolean; emptyMessage?: string } = {}): Promise<string> {
  const value = io.isTTY.stdin ? await readHidden(io, prompt) : stripOneNewline(await readAll(io.stdin));
  if (value === '' && !options.allowEmpty) {
    throw new ValidationError(options.emptyMessage ?? 'No value was given, so nothing was saved. Pipe the value in, or type it when asked.');
  }
  return value;
}

function readHidden(io: CliIo, prompt: string): Promise<string> {
  const stdin = io.stdin;
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let chars: string[] = [];
    let finished = false;
    const finish = (error?: Error, value?: string) => {
      if (finished) return;
      finished = true;
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      try {
        stdin.setRawMode?.(false);
      } finally {
        stdin.pause();
        io.stderr.write('\n');
        chars = [];
        if (error) reject(error);
        else resolve(value ?? '');
      }
    };
    const onData = (chunk: Uint8Array | string) => {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
      let at = 0;
      for (const ch of text) {
        at += ch.length;
        if (ch === '\r' || ch === '\n') {
          const value = chars.join('');
          const rest = text.slice(at);
          finish(undefined, value);
          // Typed ahead (a paste, or a test): what follows belongs to the next question.
          if (rest !== '' && stdin.unshift) stdin.unshift(Buffer.from(rest));
          return;
        }
        if (ch === '\u0003') return finish(new Cancelled());
        if (ch === '\u0004') {
          if (chars.length === 0) return finish(new Cancelled());
          return finish(undefined, chars.join(''));
        }
        if (ch === '\u007f' || ch === '\b') chars.pop();
        else if (ch >= ' ') chars.push(ch);
      }
    };
    const onEnd = () => finish(undefined, chars.join(''));
    const onError = (e: Error) => finish(e);
    try {
      io.stderr.write(prompt);
      stdin.setRawMode?.(true);
      stdin.on('data', onData);
      stdin.on('end', onEnd);
      stdin.on('error', onError);
      stdin.resume();
    } catch (e) {
      finish(e as Error);
    }
  });
}

/** Asks a yes/no question on standard error. Anything but yes is no. Call it only in an interactive run. */
export async function confirm(io: CliIo, question: string): Promise<boolean> {
  io.stderr.write(`${question} [y/N] `);
  const answer = await readLine(io.stdin);
  return answer !== null && /^\s*y(es)?\s*$/i.test(answer);
}

/**
 * Offers numbered choices on standard error and reads a number. Returns the index, or null when the person
 * presses Enter or the input ends. Asks again up to three times for something that is not a number in range.
 */
export async function choose(io: CliIo, heading: string, options: string[], prompt: string): Promise<number | null> {
  io.stderr.write(`${heading}\n`);
  const width = String(options.length).length;
  options.forEach((o, i) => io.stderr.write(`  ${String(i + 1).padStart(width)}  ${o}\n`));
  for (let attempt = 0; attempt < 3; attempt++) {
    io.stderr.write(prompt);
    const answer = await readLine(io.stdin);
    if (answer === null || answer.trim() === '') return null;
    const n = Number(answer.trim());
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  }
  throw new ValidationError(`That is not one of the choices.`);
}
