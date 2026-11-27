import { copy } from './copy';
import type { Pictures } from './Gallery';
import type { Topic, TopicGroup } from './Topics';
import { fillPictures } from './pictures/fill';
import { codeFillPictures } from './pictures/codeFill';
import { codeSetupPictures } from './pictures/codeSetup';
import { cardsPictures } from './pictures/cards';
import { undoPictures } from './pictures/undo';
import { searchPictures } from './pictures/search';
import { keepVaultPictures } from './pictures/keepVault';
import { browserGroup } from './pictures/browser';
import { menuBarGroup } from './pictures/menuBar';

/** A topic from the words in copy.ts and its pictures. */
function topic(id: keyof typeof copy.demos, pictures: Pictures): Topic {
  const d = copy.demos[id] as { id: string; title: string; status: 'works' | 'coming'; statusNote?: string };
  const p = id === 'keep-vault'
    ? { quote: copy.keepVault.heading, elsewhere: copy.keepVault.elsewhere, saves: copy.keepVault.saves, source: undefined }
    : copy.pains.find((x) => x.demo === id)!;
  return { id: d.id, quote: p.quote, elsewhere: p.elsewhere, source: p.source, saves: p.saves, title: d.title, status: d.status, statusNote: d.statusNote, pictures };
}

/** The list on the page, grouped by where it happens. Add a group here and it is on the page. */
export function topicGroups(): TopicGroup[] {
  return [
    {
      id: 'signing-in',
      heading: 'Signing in',
      lead: 'Psss fills in through the system’s own AutoFill, above the keyboard.',
      topics: [topic('fill', fillPictures()), topic('code-fill', codeFillPictures())],
    },
    {
      id: 'in-the-app',
      heading: 'In the app',
      lead: 'On iPhone, iPad and Mac.',
      topics: [
        topic('code-setup', codeSetupPictures()),
        topic('cards', cardsPictures()),
        topic('undo', undoPictures()),
        topic('search', searchPictures()),
        topic('keep-vault', keepVaultPictures()),
      ],
    },
    browserGroup(),
    menuBarGroup(),
  ];
}
