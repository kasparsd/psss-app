/**
 * All the words on the landing page, as data. Components take these as props
 * and hard-code nothing.
 *
 * Truth rules (docs/product.md, docs/positioning.md):
 * - no price, no "Pro", no "no subscription" promise, no guarantee;
 * - nothing about a named competitor without a source link; the reports are
 *   paraphrased from docs/positioning.md, "Firsthand reports", never quoted;
 * - a status is "works" only when docs/roadmap.md or the README says it is
 *   built; when unsure it is "coming".
 *
 * The story says only what the owner said when asking for this page (2026-11-27):
 * built for his wife and kids, to move off 1Password 7, because filling in
 * was the pain in other apps. Why they left 1Password 7 and what went wrong
 * at home are his to add in his own words; nothing is guessed in the text.
 */

/** `works`: runs in today's test builds. `coming`: approved or planned, not built. */
export type Status = 'works' | 'coming';

export interface Link { label: string; href: string }

export interface PainCopy {
  /** Gallery anchor id (the Gallery `id`). */
  demo: string;
  /** The pain card: the visitor's own words. */
  quote: string;
  /** One sentence on what goes wrong elsewhere. Names nobody without a source. */
  elsewhere: string;
  source?: Link;
  /** One line under "What it saves you". */
  saves: string;
}

export interface DemoSlotCopy {
  id: string;
  title: string;
  status: Status;
  statusNote?: string;
}

export const copy = {
  site: {
    skip: 'Skip to the content',
  },

  hero: {
    // The welcome screen's own words (App/Features/WelcomeView.swift), so the page and the app say the same thing.
    headline: 'Psss for your secrets',
    lead: 'The quickest storage and autofill for your logins and passwords, on iPhone, iPad and Mac. Everything is in one encrypted file that you own, with no account and no server.',
  },

  painWall: {
    heading: 'Sound familiar?',
    lead: 'Small moments that go wrong in a password manager. Open the ones you know.',
  },

  pains: [
    {
      demo: 'code-fill',
      quote: 'The password worked. Now it wants a code.',
      elsewhere: 'When the six-digit code lives in another app, you leave the sign-in to fetch it and hope the page is still waiting when you come back.',
      saves: 'No switching apps in the middle of signing in.',
    },
    {
      demo: 'code-setup',
      quote: 'Scan this QR code. With what, exactly? It is on this phone.',
      elsewhere: 'One 1Password user on holiday sent a screenshot of the code to a spouse’s phone and scanned it back from there.',
      source: { label: '1Password forum thread, 2022', href: 'https://www.1password.community/1password-at-home-31/how-to-scan-on-screen-qr-code-in-ios-app-1594' },
      saves: 'No second device, and no retyping a 32-letter key.',
    },
    {
      demo: 'fill',
      quote: 'I have three accounts for this site. It picked the wrong one.',
      elsewhere: 'A Bitwarden user reported that with several accounts on one site, AutoFill chose the wrong password.',
      source: { label: 'Bitwarden community thread', href: 'https://community.bitwarden.com/t/multiple-accounts-autofill-chooses-wrong-password/62931' },
      saves: 'You see which account is which before anything is filled, and you choose.',
    },
    {
      demo: 'cards',
      quote: 'Which Visa is the new one?',
      elsewhere: 'Two cards from the same bank look alike in a list, and the one you need is the one that has not expired.',
      saves: 'The right card in one tap, told apart by its last four digits and its expiry.',
    },
    {
      demo: 'undo',
      quote: 'Wait. Wrong login.',
      elsewhere: 'One wrong tap on Delete, and you are resetting a password you had saved.',
      saves: 'Undo works for ten seconds, and the login waits in Recently Deleted for 30 days after that.',
    },
    {
      demo: 'search',
      quote: 'I know I saved it. What did I call it?',
      elsewhere: 'When you remember the website but not the name you gave the login, a search that reads only titles finds nothing.',
      saves: 'Type what you remember. Choose whether to look in Name, Website or Username.',
    },
  ] satisfies PainCopy[],

  keepVault: {
    heading: 'That’s my vault. It’s still my vault.',
    elsewhere: 'A card saved as plain custom fields in a KeePass file is a list of fields until an app knows it is a card.',
    saves: 'Open the file you already have, see the card as a Card, and the file is still a KeePass file.',
  },

  demos: {
    fill: {
      id: 'fill',
      title: 'Which account?',
      status: 'coming',
      statusNote: 'The AutoFill picker works in test builds; telling accounts for one site apart is still being designed.',
    },
    'code-fill': {
      id: 'code-fill',
      title: 'The code, when it is asked for',
      status: 'works',
      statusNote: 'On iPhone and iPad.',
    },
    'code-setup': {
      id: 'code-setup',
      title: 'A QR code on the same phone',
      status: 'works',
      statusNote: 'Still to be checked on a real iPhone.',
    },
    cards: {
      id: 'cards',
      title: 'Two Visas',
      status: 'works',
      statusNote: 'On iPhone, iPad and Mac.',
    },
    undo: {
      id: 'undo',
      title: 'Undo a delete',
      status: 'works',
    },
    search: {
      id: 'search',
      title: 'Search what you remember',
      status: 'coming',
      statusNote: 'Search across the whole vault works in test builds. Choosing a field is designed, not built.',
    },
    'keep-vault': {
      id: 'keep-vault',
      title: 'Same file, new view',
      status: 'coming',
      statusNote: 'Showing a custom item as a card works in test builds. The sheet is being redrawn to look like this.',
    },
  } satisfies Record<string, DemoSlotCopy>,

  story: {
    heading: 'Why I built Psss',
    paragraphs: [
      'My family ran on 1Password 7 for years. When it was time to move on, I went looking for something my wife and kids could switch to without me becoming their help desk.',
      'Everything I tried kept the passwords safe and got the small moments wrong, most of all filling them in: the wrong account, or a code that lived in another app.',
      'So I wrote the one I wanted them to have. It uses what iPhone, iPad and Mac already do well. Everything is in one encrypted file that we own and other apps can open. There is no account and no server, so nothing of ours sits on somebody else’s computer.',
    ],
    signature: 'Kaspars',
  },

  whatYouGet: {
    heading: 'What you get',
    items: [
      { title: 'One place for everything', text: 'Passwords, passkeys, verification codes, cards and notes.' },
      { title: 'AutoFill that tells you what it is filling', text: 'Sign-ins and codes on iPhone and iPad, through the system’s own AutoFill.' },
      { title: 'Cards you can tell apart', text: 'Last four digits and expiry in the list, expired cards last.' },
      { title: 'Mistakes you can take back', text: 'A ten-second Undo, then Recently Deleted for 30 days.' },
      { title: 'Face ID and Touch ID', text: 'Unlock with your face or finger, or with your vault password.' },
      { title: 'Several vaults', text: 'Open more than one at once and lock them all together.' },
      { title: 'A way in from where you are', text: 'Move in from Apple Passwords or 1Password 7, or open the KeePass file you already have where it is.' },
      { title: 'A way out', text: 'No account to make. Your vault is a standard KeePass file that KeePassXC and Strongbox can open.' },
    ],
  },

  faq: {
    heading: 'Questions',
    items: [
      { q: 'Who can read my passwords?', a: 'You can. The file is encrypted and opens with your vault password, or with Face ID or Touch ID on your device. We run no server and keep no copy, so we cannot read it and cannot recover it for you. Nobody outside has audited the security yet. An audit is planned before version 1.0.' },
      { q: 'Where is my data?', a: 'In a file on your device. Sync through iCloud Drive is coming; when you turn it on, the same encrypted file is kept in your iCloud Drive, and Psss has no server in between.' },
      { q: 'What if I stop using Psss?', a: 'Your passwords are in a standard KeePass file. Open it in KeePassXC, Strongbox or another KeePass app.' },
      { q: 'What does it cost?', a: 'Nothing is decided about pricing yet. Sync through iCloud will be free.' },
      { q: 'When can I try it?', a: 'We do not have a date and would rather not guess. This page will say when it is out.' },
    ],
  },

  footer: {
    lines: [
      'This page uses no cookies, no analytics and no outside scripts or fonts.',
      'Psss is a working name for the app and may change. KeePass and KeePassXC are separate projects. Strongbox, 1Password and Apple Passwords belong to their makers.',
    ],
  },

};

