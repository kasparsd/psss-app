import { useState } from 'react';
import { DOTS, type Item } from '../data';
import { EditRow, FieldRow } from './FieldRow';
import { InfoButton, topics } from './InfoButton';
import { ItemIcon } from './Rows';

export interface CodeEdit {
  /** The code setting as drafted in the editor: a setup key, or null for none. */
  draft: string | null;
  add: () => void;
  remove: () => void;
}

/**
 * The item card: icon centred above the name at the top, then field rows.
 * One component for logins, cards, notes and custom items, view and edit.
 */
export function ItemCard({ item, mode = 'view', shown, copied, code, onSetUpCode, onDelete, note = true }: {
  item: Item;
  mode?: 'view' | 'edit';
  /** Labels of fields that start shown. */
  shown?: string[];
  /** Label of a field that starts with its checkmark. */
  copied?: string;
  /** The live code for a login, if any (view) or the editor's draft (edit). */
  code?: CodeEdit;
  onSetUpCode?: () => void;
  onDelete?: () => void;
  /** The line saying copies are cleared (view only). */
  note?: boolean;
}) {
  const header = (
    <div className="ident">
      <ItemIcon item={item} big />
      <div className="t">{item.name}</div>
    </div>
  );

  if (mode === 'edit') return <Editor item={item} header={header} code={code} onDelete={onDelete} />;

  const isLogin = item.kind === 'login';
  const fields = item.fields.map((f) => {
    const row = <FieldRow key={f.label} {...f} shown={shown?.includes(f.label)} copied={copied === f.label} />;
    return row;
  });
  // The code row sits after the password on a login.
  let withCode = fields;
  if (isLogin) {
    const i = item.fields.findIndex((f) => f.label === 'Password');
    const codeRow = item.brokenCode ? (
      <FieldRow key="code" label="Verification code" value="Can't make a code" noCopy action={<button className="btn sq" onClick={onSetUpCode}>Replace Code…</button>} />
    ) : item.code ? (
      <FieldRow key="code" label="Verification code" value={item.code} copied={copied === 'Verification code'} display={<span className="fval codeval">{item.code}</span>} />
    ) : (
      <FieldRow key="code" label="Verification code" value="None" noCopy display={<span className="s">None</span>} action={<button className="btn sq" onClick={onSetUpCode}>Set Up Code…</button>} />
    );
    withCode = [...fields.slice(0, i + 1), codeRow, ...fields.slice(i + 1)];
  }
  return (
    <>
      <div className="icard">
        {header}
        {withCode}
      </div>
      {note && (
        <div className="s" style={{ padding: '0 4px 10px' }}>
          Copies are cleared after 60 seconds. <InfoButton topic={topics.clipboard} />
        </div>
      )}
    </>
  );
}

function Editor({ item, header, code, onDelete }: { item: Item; header: React.ReactNode; code?: CodeEdit; onDelete?: () => void }) {
  const [local, setLocal] = useState<string | null>(item.code ? DOTS : null);
  const draft = code ? code.draft : local;
  const add = code ? code.add : () => setLocal('x');
  const remove = code ? code.remove : () => setLocal(null);
  const isLogin = item.kind === 'login';
  return (
    <>
      <div className="icard">
        {header}
        <EditRow label="Name" value={item.name} />
        {item.fields.map((f) =>
          isLogin && f.label === 'Notes' ? (
            <EditRow key={f.label} label={f.label} value={f.value} />
          ) : (
            <EditRow key={f.label} label={f.label} value={f.value} secret={f.secret && item.kind !== 'custom'} />
          ),
        )}
        {isLogin && (
          <EditRow
            label="Verification code (optional)"
            info={<InfoButton topic={topics.setupKey} />}
            value={draft ? DOTS : ''}
            placeholder="Setup key or otpauth:// link"
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
