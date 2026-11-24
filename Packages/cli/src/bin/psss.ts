#!/usr/bin/env node
import { run } from '../cli.ts';

// A folder that was deleted while the shell stayed in it has no name any more: say so plainly instead of a stack trace.
let cwd: string | undefined;
try {
  cwd = process.cwd();
} catch {
  process.stderr.write('The folder you are in no longer exists, so psss cannot tell where to look.\nChange to another folder and run it again.\n');
}

// The vault service is loaded on first use, so --help and usage errors never load the crypto.
const code = cwd === undefined ? 1 : await run(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  cwd,
  env: process.env,
  isTTY: { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) },
  platform: process.platform,
  inheritStdio: true,
  service: async (options) => (await import('../vault-service.ts')).createVaultService(options),
});
process.exitCode = code;
