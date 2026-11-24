// Commands named in docs/cli.md that are not built yet. They appear in the help, marked planned, and print
// "psss <name> is not built yet." on standard error and exit 1. Their arguments are not parsed.

import { CliError, EXIT_FAILED } from '../errors.ts';
import type { Command } from './command.ts';

const PLANNED: Array<[name: string, summary: string, usage: string]> = [
  ['search', 'Find items by text', 'search <text>'],
  ['code', 'Print a verification code', 'code <reference>'],
  ['generate', "Make a password with the app's generator", 'generate'],
  ['doctor', 'Check permissions, the clock, the key and the locations', 'doctor'],
  ['history', "Show an item's previous values, with dates", 'history <reference>'],
  ['import', 'Bring in a KeePass file, then 1Password and CSV', 'import <file>'],
  ['export', 'Write a copy as a KeePass file', 'export --format kdbx <file>'],
  ['item', 'Add, edit, show and purge items', 'item <add|edit|show|purge>'],
  ['file', 'Get and put attachments', 'file <get|put>'],
  ['vault', 'Back up and restore a vault', 'vault <backup|restore>'],
  ['group', 'Create, list and show groups', 'group <create|list|show>'],
  ['member', 'Invite, accept, list and remove members', 'member <invite|accept|list|role|remove>'],
  ['device', 'List, approve and remove devices', 'device <list|approve|remove>'],
  ['location', 'Add, list and remove places the vault is kept', 'location <add|list|remove>'],
  ['key', 'Recovery kit, vault password and key recovery', 'key <kit|password|recover>'],
];

export const plannedCommands: Command[] = PLANNED.map(([name, summary, usage]) => ({
  name,
  summary,
  usage,
  options: {},
  args: { min: 0, max: Number.MAX_SAFE_INTEGER },
  planned: true,
  async run() {
    throw new CliError(`psss ${name} is not built yet.`, EXIT_FAILED);
  },
}));
