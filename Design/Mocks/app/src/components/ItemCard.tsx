import { useState } from 'react';
import { DOTS, type Item } from '../data';
import { EditRow, FieldRow } from './FieldRow';
import { InfoButton, topics } from './InfoButton';
import { CodeDigits, ItemIcon } from './Rows';

export interface CodeEdit {
  /** The code setting as drafted in the editor: a setup key, or null for none. */
  draft: string | null;
  add: () => void;
  remove: () => void;
}

/** What an item is called when it has no name of its own: the site, the card, the start of the note. */
export function fallbackName(item: Item): string {
  const get = (l: string) => item.fields.find((f) => f.label === l)?.value;
  if (item.kind === 'login') return get('Website') ?? get('Username') ?? 'Login';
  if (item.kind === 'card') {
    const brand = item.brand === 'American Express' ? 'Amex' : item.brand;
    return brand && item.last4 ? `${brand} •• ${item.last4}` : 'Card';
  }
  if (item.kind === 'note') return (get('Note') ?? 'Note').split(/[.\n]/)[0].slice(0, 28);
  return get('Website') ?? get('Username') ?? 'Custom item';
}

/** The first card of each kind, in the order the fields are asked for. The same in view, edit and new. */
const firstCard: Record<Item['kind'], string[]> = {
  login: ['Website', 'Username', 'Password'],
  card: ['Card number', 'Expiry', 'Security code', 'Name on card'],
  note: ['Note'],
  custom: ['Website', 'Username', 'Value'],
};
/** Values that are hidden on the page and typed in the monospaced face. */
const secrets = ['Password', 'Card number', 'Security code', 'Value'];
const inFirst = (label: string, kind: Item['kind']) => firstCard[kind].includes(label);
/** The fields of the first card that the item has, in order. A field that was never filled in has no row. */
function mainFields(item: Item) {
  return firstCard[item.kind].flatMap((l) => item.fields.filter((f) => f.label === l));
}

/** The icon and name stand above the card, on the page itself. */
function Identity({ item, unnamed, editing }: { item: Item; unnamed?: boolean; editing?: boolean }) {
  return (
    <div className="ident">
      <ItemIcon item={item} big />
      {editing ? (
        // While editing, the heading itself is the name field. With no name of its own it shows, in grey, what the item is called anyway.
        <input className="t namefield" defaultValue={unnamed ? '' : item.name} placeholder={fallbackName(item)} aria-label="Name" />
      ) : (
        <div className="t">{unnamed ? fallbackName(item) : item.name}</div>
      )}
    </div>
  );
}

/**
 * The item page: the icon and name above, then one card per group. One
 * component for logins, cards, notes and custom items, view and edit.
 */
export function ItemCard({ item, mode = 'view', shown, copied, code, onSetUpCode, onDelete, note = true, bubble, unnamed, onPasteCodeImage }: {
  item: Item;
  mode?: 'view' | 'edit';
  /** Labels of fields that start shown. */
  shown?: string[];
  /** Label of a field that starts with its checkmark. */
  copied?: string;
  /** The editor's draft of the code setting (edit). */
  code?: CodeEdit;
  onSetUpCode?: () => void;
  onDelete?: () => void;
  /** The line saying copies are cleared (view only). */
  note?: boolean;
  /** Start with a help bubble open: the clipboard line's (view), the setup key's (edit). */
  bubble?: boolean;
  /** Draw the item without a name of its own: it is called by its site, card or first words. */
  unnamed?: boolean;
  onPasteCodeImage?: () => void;
}) {
  if (mode === 'edit') return <Editor item={item} code={code} onDelete={onDelete} unnamed={unnamed} bubble={bubble} onPasteCodeImage={onPasteCodeImage} />;

  const isLogin = item.kind === 'login';
  const row = (f: Item['fields'][number]) => <FieldRow key={f.label} {...f} shown={shown?.includes(f.label)} copied={copied === f.label} />;
  // A login's code and everything about it is one group, after the password.
  const codeRow = !isLogin ? null : item.brokenCode ? (
    <FieldRow key="code" label="Verification code" value="Psss can't make a code from this setup key. Replace it with a new key from the website." noCopy action={<button className="btn sq" onClick={onSetUpCode}>Replace Code…</button>} />
  ) : item.code ? (
    <FieldRow key="code" label="Code" value={item.code} copied={copied === 'Code'} display={<CodeDigits code={item.code} big />} />
  ) : (
    <FieldRow key="code" label="Verification code" value="None" noCopy display={<span className="s">None</span>} action={<button className="btn sq" onClick={onSetUpCode}>Set Up Code…</button>} />
  );
  const main = mainFields(item).map(row);
  const rest = item.fields.filter((f) => !inFirst(f.label, item.kind)).map(row);

  return (
    <div>
      <Identity item={item} unnamed={unnamed} />
      <div className="icard">{main}</div>
      {note && (
        <div className="gf">Copies are cleared after 60 seconds. <InfoButton topic={topics.clipboard} open={bubble} /></div>
      )}
      {codeRow && (
        <>
          <div className="gh">Verification code</div>
          <div className="icard">
            {codeRow}
            {item.code && (
              <>
                <FieldRow label="Setup key" value="JBSW Y3DP EHPK 3PXP" secret />
                <div className="frow"><button className="btn sq">Copy Setup Link</button><button className="btn sq">Show QR Code</button></div>
              </>
            )}
          </div>
          {item.code && <div className="gf">The setup key, the link and the QR code move this code to another authenticator. Anyone who has one of them can make your codes, so treat them like a password.</div>}
        </>
      )}
      {rest.length > 0 && <div className="icard">{rest}</div>}
      {item.passkey && (
        <>
          <div className="gh">Passkey <InfoButton topic={topics.passkey} /></div>
          <div className="icard">
            <FieldRow label="Saved 12 Mar 2026" value={`for ${item.name.toLowerCase()}.example`} noCopy />
          </div>
          <div className="gf">Sign in on {item.name.toLowerCase()}.example with this passkey. It never leaves your vault.</div>
        </>
      )}
    </div>
  );
}

function Editor({ item, code, onDelete, unnamed, bubble, onPasteCodeImage }: { item: Item; code?: CodeEdit; onDelete?: () => void; unnamed?: boolean; bubble?: boolean; onPasteCodeImage?: () => void }) {
  const [local, setLocal] = useState<string | null>(item.code ? DOTS : null);
  const draft = code ? code.draft : local;
  const add = code ? code.add : () => setLocal('x');
  const remove = code ? code.remove : () => setLocal(null);
  const isLogin = item.kind === 'login';
  const notes = item.fields.find((f) => f.label === 'Notes');
  return (
    <>
      <Identity item={item} unnamed={unnamed} editing />
      {/* The same groups, in the same order, as the page being edited. */}
      <div className="icard">
        {/* Every field of the kind has its place in the editor, filled in or not. */}
        {firstCard[item.kind].map((label) => {
          const secret = secrets.includes(label);
          return <EditRow key={label} label={label} value={item.fields.find((f) => f.label === label)?.value} secret={secret && item.kind !== 'custom'} mono={secret} />;
        })}
      </div>
      {isLogin && (
        <>
          <div className="gh">Verification code <InfoButton topic={topics.setupKey} open={bubble} /></div>
          <div className="icard">
            <EditRow
              label="Setup key (optional)"
              value={draft ? DOTS : ''}
              placeholder="Setup key or otpauth:// link"
              mono
              action={<button className="btn sq acc" onClick={add}>{draft ? 'Replace code' : 'Add code'}</button>}
              below={(onPasteCodeImage || draft) && <>
                {onPasteCodeImage && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span>From QR code in screenshot</span>
                    <button className="btn" onClick={onPasteCodeImage}>
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="10" height="11" rx="2" /><rect x="6" y="1.5" width="4" height="3" rx="1" /></svg>
                      Paste
                    </button>
                  </div>
                )}
                {draft && <button className="btn sq red" onClick={remove}>Remove code</button>}
              </>}
            />
          </div>
        </>
      )}
      {item.kind !== 'note' && (
        <div className="icard">
          <EditRow label="Notes (optional)" value={notes?.value} />
        </div>
      )}
      {onDelete && (
        <>
          <div className="delwrap"><button className="btn sq" onClick={onDelete}>Move to Recently Deleted</button></div>
          <div className="delnote">You can bring it back for 30 days.</div>
        </>
      )}
    </>
  );
}
