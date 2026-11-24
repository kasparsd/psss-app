import { jsonOption, hasJson } from './command.ts';
import type { Command } from './command.ts';
import { displayPath } from '../io.ts';
import type { KeySource } from '../service.ts';

const KEY_TEXT: Record<KeySource, string> = {
  keyFile: "this computer's key file",
  keyEnvironment: 'the key in PSSS_KEY',
  password: 'the vault password',
};

const status: Command = {
  name: 'status',
  summary: 'Show the vault, where it is kept and whether it is up to date',
  usage: 'status [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 0 },
  async run(ctx) {
    await ctx.open();
    const svc = await ctx.service();
    const info = ctx.unwrap(await svc.info());

    if (hasJson(ctx.values)) {
      ctx.json({
        vault: { name: info.name, path: info.path, formatVersion: info.formatVersion },
        groups: info.groups,
        items: info.itemCount,
        key: { source: info.keySource },
        wayBack: info.wayBack,
        locations: info.locations.map((l) => ({ label: l.label, path: l.path, state: l.state })),
      });
      return 0;
    }

    const groups = `${info.groups.length} group${info.groups.length === 1 ? '' : 's'} (${info.groups.join(', ')})`;
    const items = `${info.itemCount} item${info.itemCount === 1 ? '' : 's'}`;
    const back =
      info.wayBack.length === 0
        ? 'none yet. Add one with: psss key password set'
        : info.wayBack.map((w) => (w === 'recoveryKit' ? 'a recovery kit' : 'a vault password')).join(' and ');
    let text = `Vault     ${info.name}   ${groups}, ${items}\nKey       ${KEY_TEXT[info.keySource]}\nWay back  ${back}\nKept in\n`;
    const labelW = Math.max(...info.locations.map((l) => l.label.length)) + 4;
    const rows = info.locations.map((l) => ({ ...l, shown: displayPath(ctx.io, l.path) }));
    const pathW = Math.max(...rows.map((r) => r.shown.length)) + 6;
    for (const r of rows) {
      text += `  ${r.label.padEnd(labelW)}${r.shown.padEnd(pathW)}${r.state === 'upToDate' ? 'Up to date' : 'Behind'}\n`;
    }
    const behind = info.locations.filter((l) => l.state === 'behind').length;
    if (behind > 0) {
      const these = behind === 1 ? 'this location' : 'these locations';
      text +=
        `Behind: psss has not seen everything ${these} ${behind === 1 ? 'holds' : 'hold'}.\n` +
        'It cannot know what a location has not delivered yet.\n' +
        'Run psss sync to merge.\n';
    }
    ctx.out(text);
    return 0;
  },
};

export default status;
