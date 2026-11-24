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

/** The icon and name stand above the card, on the page itself. */
function Identity({ item }: { item: Item }) {
  return (
    <div className="ident">
      <ItemIcon item={item} big />
      <div className="t">{item.name}</div>
    </div>
  );
}

/**
 * The item page: the icon and name above, then one card per group. One
 * component for logins, cards, notes and custom items, view and edit.
 */
export function ItemCard({ item, mode = 'view', shown, copied, code, onSetUpCode, onDelete, note = true, bubble }: {
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
  /** Start with the clipboard line's help bubble open. */
  bubble?: boolean;
}) {
  if (mode === 'edit') return <Editor item={item} code={code} onDelete={onDelete} />;

  const isLogin = item.kind === 'login';
  const fields = item.fields.map((f) => <FieldRow key={f.label} {...f} shown={shown?.includes(f.label)} copied={copied === f.label} />);
  // A login's code and everything about it is one group, after the password.
  const codeRow = !isLogin ? null : item.brokenCode ? (
    <FieldRow key="code" label="Verification code" value="Psss can't make a code from this setup key. Replace it with a new key from the website." noCopy action={<button className="btn sq" onClick={onSetUpCode}>Replace Code…</button>} />
  ) : item.code ? (
    <FieldRow key="code" label="Code" value={item.code} copied={copied === 'Code'} display={<CodeDigits code={item.code} big />} />
  ) : (
    <FieldRow key="code" label="Verification code" value="None" noCopy display={<span className="s">None</span>} action={<button className="btn sq" onClick={onSetUpCode}>Set Up Code…</button>} />
  );
  const second = (r: { key: string | null }) => r.key === 'Website' || r.key === 'Notes';
  const main = fields.filter((r) => !second(r));
  const rest = fields.filter(second);

  return (
    <div>
      <Identity item={item} />
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

function Editor({ item, code, onDelete }: { item: Item; code?: CodeEdit; onDelete?: () => void }) {
  const [local, setLocal] = useState<string | null>(item.code ? DOTS : null);
  const draft = code ? code.draft : local;
  const add = code ? code.add : () => setLocal('x');
  const remove = code ? code.remove : () => setLocal(null);
  const isLogin = item.kind === 'login';
  return (
    <>
      <Identity item={item} />
      <div className="icard">
        <EditRow label="Name" value={item.name} />
        {item.fields.map((f) =>
          isLogin && f.label === 'Notes' ? (
            <EditRow key={f.label} label={f.label} value={f.value} />
          ) : (
            <EditRow key={f.label} label={f.label} value={f.value} secret={f.secret && item.kind !== 'custom'} mono={f.secret} />
          ),
        )}
        {isLogin && (
          <EditRow
            label="Verification code (optional)"
            info={<InfoButton topic={topics.setupKey} />}
            value={draft ? DOTS : ''}
            placeholder="Setup key or otpauth:// link"
            mono
            action={<button className="btn sq acc" onClick={add}>{draft ? 'Replace code' : 'Add code'}</button>}
            below={draft ? <button className="btn sq red" onClick={remove}>Remove code</button> : undefined}
          />
        )}
      </div>
      {onDelete && (
        <>
          <div className="icard"><div className="delwrap"><button className="btn sq red" onClick={onDelete}>Delete Item</button></div></div>
          <div className="delnote">Moves this item to Recently Deleted. You can bring it back for 30 days.</div>
        </>
      )}
    </>
  );
}
