import { EXIT_FAILED } from '../errors.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';

const records = (n: number) => `${n} new record${n === 1 ? '' : 's'}`;

const sync: Command = {
  name: 'sync',
  summary: 'Merge with every place the vault is kept',
  usage: 'sync [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 0 },
  details: ['Adds what each location holds that this computer lacks, and what this computer holds that a location lacks. Never replaces.'],
  async run(ctx) {
    await ctx.open({ changes: true });
    const svc = await ctx.service();
    const report = ctx.unwrap(await svc.sync((line) => ctx.err(`${line}\n`)));
    const failed = report.locations.filter((l) => l.error !== undefined);
    if (hasJson(ctx.values)) {
      ctx.json({
        locations: report.locations.map((l) => ({
          label: l.label,
          path: l.path,
          pulled: l.pulled,
          pushed: l.pushed,
          ...(l.error !== undefined ? { error: l.error } : {}),
        })),
      });
      return failed.length > 0 ? EXIT_FAILED : 0;
    }
    let text = '';
    for (const l of report.locations) {
      if (l.error !== undefined) {
        ctx.err(`${l.label} could not be reached: ${l.error}\n`);
      } else if (l.pulled === 0 && l.pushed === 0) {
        text += `${l.label}: nothing new.\n`;
      } else {
        text += `${l.label}: read ${records(l.pulled)}, wrote ${l.pushed}.\n`;
      }
    }
    const total = report.locations.length;
    if (failed.length > 0) {
      text += `Merged with ${total - failed.length} of ${total} locations. Nothing was lost; run psss sync again when the rest are reachable.\n`;
    } else {
      text += `Merged with ${total} location${total === 1 ? '' : 's'}.\n`;
    }
    ctx.out(text);
    return failed.length > 0 ? EXIT_FAILED : 0;
  },
};

export default sync;
