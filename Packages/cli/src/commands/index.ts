import code from './code.ts';
import exportCommand from './export.ts';
import file from './file.ts';
import generate from './generate.ts';
import item from './item.ts';
import get from './get.ts';
import history from './history.ts';
import importCommand from './import.ts';
import init from './init.ts';
import list from './list.ts';
import { plannedCommands } from './planned.ts';
import restore from './restore.ts';
import rm from './rm.ts';
import run from './run.ts';
import search from './search.ts';
import set from './set.ts';
import status from './status.ts';
import sync from './sync.ts';
import verify from './verify.ts';
import type { Command } from './command.ts';

const byName = new Map<string, Command>([...[init, status, get, set, list, search, rm, restore, run, code, sync, verify, history, importCommand, exportCommand, generate, item, file], ...plannedCommands].map((c) => [c.name, c]));

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
