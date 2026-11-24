import { EXIT_USAGE } from '../errors.ts';
import { displayPath } from '../io.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const verify: Command = {
  name: 'verify',
  summary: 'Check every record and report; exit 2 if anything is wrong',
  usage: 'verify [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 0 },
  details: ['Reports and never repairs, since a repair would be a write made by a tool that has just found something wrong.'],
  async run(ctx) {
    await ctx.open();
    const svc = await ctx.service();
    const report = ctx.unwrap(await svc.verify());
    const ok = report.problems.length === 0;
    if (hasJson(ctx.values)) {
      ctx.json({ ok, records: report.records, locations: report.locations, problems: report.problems });
      return ok ? 0 : EXIT_USAGE;
    }
    let text = `Checked ${plural(report.records, 'record', 'records')} in ${plural(report.locations, 'location', 'locations')}.\n`;
    if (ok) {
      text += 'All of them match. Nothing is missing that this\ncomputer has seen before.\n';
      ctx.out(text);
      return 0;
    }
    let last: string | undefined;
    for (const p of report.problems) {
      const where = displayPath(ctx.io, p.location);
      if (p.kind === 'changed') {
        text +=
          p.count === 1
            ? `1 record in ${where} was changed after\nit was written. It is ignored.\n`
            : `${p.count.toLocaleString('en-US')} records in ${where} were changed after\nthey were written. They are ignored.\n`;
      } else if (p.kind === 'missing') {
        const subject = last === p.location ? 'That location' : where;
        text += `${subject} is missing records this computer saw before.\nIt may have been rolled back.\n`;
      } else {
        text += `${p.message}\n`;
        if (ctx.settings.verbose && p.detail) text += `Detail: ${p.detail}\n`;
      }
      last = p.location;
    }
    ctx.out(text);
    return EXIT_USAGE;
  },
};

export default verify;
