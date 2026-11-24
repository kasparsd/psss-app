// Stands in for the Psss app in a terminal of its own, so the psss command can be tried by hand:
//
//   terminal 1:  node scripts/app.ts
//   terminal 2:  export PSSS_SOCKET=…  (printed by terminal 1), then node src/cli.ts run --env TOKEN=psss://Example API/token -- printenv TOKEN
//
// The question the app would ask with a sheet and Touch ID is asked here as a line of text.
// Commands while it runs: lock, unlock, kept, activity, quit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Broker, listen, type Answer, type Ask } from '../src/broker.ts';

const USES: Record<string, string> = {
  run: 'The program receives it. Psss hides it in what the program prints; the program itself can read it. Asked every time.',
  fetch: 'Psss sends it to this website only and gives back the answer. The asker never receives it.',
  code: 'The asker receives a verification code. It stops working within 30 seconds.',
  show: 'The asker receives the value itself and can keep it.',
  save: 'A new item is added to your vault. Nothing is read.',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(fs.readFileSync(path.join(here, '../fixtures/vault.json'), 'utf8'));
const where = process.env.PSSS_SOCKET ?? path.join(os.tmpdir(), 'psss-prototype.sock');
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text: string) => new Promise<string>((resolve) => terminal.question(text, resolve));

let asking: Promise<unknown> = Promise.resolve();

async function approve(ask: Ask): Promise<Answer> {
  console.log('\n────────────────────────────────────────────────────────');
  if (ask.blocked) {
    console.log(`“${ask.requester}” asked to use “${ask.wanted}”.\n  ${ask.detail}\n  ${ask.blocked}`);
    await question('[Enter] Close ');
    return { decision: 'deny' };
  }
  console.log(`“${ask.requester}” wants to ${ask.use === 'save' ? 'save' : 'use'} “${ask.wanted}”`);
  console.log(`  ${ask.fields.join(', ')}: ${ask.detail}\n  ${USES[ask.use]}`);
  let item: string | undefined;
  if (ask.use !== 'save') {
    if (ask.candidates.length === 0) {
      console.log('  Nothing in your vault has this name.');
      return (await question('[Enter] Close '), { decision: 'deny' });
    }
    if (ask.candidates.length > 1) {
      ask.candidates.forEach((c, n) => console.log(`  ${n + 1}. ${c.title}  ${c.username}`));
      const pick = Number(await question('Which one? Number, or Enter for none: '));
      if (!ask.candidates[pick - 1]) return { decision: 'deny' };
      item = ask.candidates[pick - 1].id;
    } else {
      item = ask.candidates[0].id;
    }
  }
  const keep = ask.canKeep ? '   [u] Allow Until Psss Locks' : '';
  const answer = (await question(`[d] Don’t Allow   [o] Allow Once${keep}   (Touch ID in the app) > `)).trim().toLowerCase();
  if (answer === 'o') return { decision: 'once', item };
  if (answer === 'u' && ask.canKeep) return { decision: 'until-lock', item };
  return { decision: 'deny' };
}

const broker = new Broker({
  items,
  // One sheet at a time, as in the app.
  approver: (ask) => {
    const next = asking.then(() => approve(ask));
    asking = next.catch(() => {});
    return next;
  },
});

await listen(broker, where);
console.log(`Psss stand-in is open and unlocked, with ${items.length} fictional items.`);
console.log(`In another terminal:  export PSSS_SOCKET='${where}'`);
console.log('Type lock, unlock, kept, activity or quit here.');

terminal.on('line', (line) => {
  const word = line.trim();
  if (word === 'lock') (broker.lock(), console.log('Locked. Everything that was allowed is forgotten.'));
  else if (word === 'unlock') (broker.unlock(), console.log('Unlocked.'));
  else if (word === 'kept') console.table(broker.kept());
  else if (word === 'activity') console.table(broker.activity.map((a) => ({ ...a, when: new Date(a.when).toLocaleTimeString() })));
  else if (word === 'quit') process.exit(0);
});
