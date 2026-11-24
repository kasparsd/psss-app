import get from './get.ts';
import init from './init.ts';
import list from './list.ts';
import { plannedCommands } from './planned.ts';
import restore from './restore.ts';
import rm from './rm.ts';
import run from './run.ts';
import set from './set.ts';
import status from './status.ts';
import sync from './sync.ts';
import verify from './verify.ts';
import type { Command } from './command.ts';

const byName = new Map<string, Command>([...[init, status, get, set, list, rm, restore, run, sync, verify], ...plannedCommands].map((c) => [c.name, c]));

/** Every command, in the order the help lists them. */
export const commands: Command[] = [
  'init',
  'status',
  'get',
  'set',
  'list',
  'search',
  'rm',
  'restore',
  'run',
  'code',
  'generate',
  'sync',
  'verify',
  'doctor',
  'history',
  'import',
  'export',
  'item',
  'file',
  'vault',
  'group',
  'member',
  'device',
  'location',
  'key',
].map((name) => {
  const command = byName.get(name);
  if (!command) throw new Error(`command ${name} is not registered`);
  return command;
});
