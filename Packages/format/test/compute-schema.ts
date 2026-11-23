// compute(type, input) for the vector types of vectors/schema.json (docs/format-schema.md). Kept apart from compute.ts only for size.
import { fromHex, hex } from '../src/bytes.ts';
import { cmap, decode, encode, type CborValue, type CMap } from '../src/cbor.ts';
import { checkpointItems, checkpointWritesOf, fold, type Change, type Entry, type State } from '../src/fold.ts';
import { sha256 } from '../src/prims.ts';
import { compareKeys, type OrderKey } from '../src/record.ts';
import * as S from '../src/schema.ts';
import { fromNotation, toNotation, type N } from './notation.ts';

type J = Record<string, any>;
const F = fromHex;
const H = hex;

/** `a` and `b` are `{ text_repeat: [text, count] }` for a long text: expanded here so that a vector stays small. */
const BYTES_KEYS = ['secret', 'credentialId', 'privateKey', 'userHandle', 'baseline'];
const NOTATION_KEYS = ['text', 'uint', 'bytes', 'array', 'map', 'bool', 'null'];
/** An argument of a builder call in a vector: a notation object (text, bytes, ...), a `text_repeat`, a plain object whose byte fields are hex, or a JSON value as it is. */
const argOf = (a: any): any => {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return a;
  if ('text_repeat' in a) return a.text_repeat[0].repeat(a.text_repeat[1]);
  if (NOTATION_KEYS.some((k) => Object.hasOwn(a, k))) return fromNotation(a as N);
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, BYTES_KEYS.includes(k) ? F(v as string) : v]));
};
const noteOf = (v: any): any => (v && typeof v === 'object' && 'text_repeat' in v ? { text: v.text_repeat[0].repeat(v.text_repeat[1]) } : v);

/** A change of a vector: readable (`set` as name and notation pairs), turned into the specification's change. */
export function changeFrom(c: J, item: Uint8Array): Change & { cleared?: string[] } {
  const set = (c.set as [string, N][]).map(([n, v]) => [n, fromNotation(noteOf(v))] as [string, CborValue]);
  return { key5: [c.clock[0], c.clock[1], F(c.author), F(c.device), c.seq], payload: S.changePayload(item, set, c.clear ?? []) };
}

const ITEM_DEFAULT = '01'.repeat(16);
const itemOf = (i: J): Uint8Array => F(i.item ?? ITEM_DEFAULT);

/** The view JSON of a vector: only the keys named by `show` (all that are defined if none). Bytes are hex. */
export function viewJson(v: S.ItemView, show?: string[]): J {
  const o: J = {
    type: v.type, type_raw: v.typeRaw, title: v.title, title_bytes: v.title === undefined ? undefined : new TextEncoder().encode(v.title).length, notes_bytes: v.notes === undefined ? undefined : new TextEncoder().encode(v.notes).length, display_title: v.displayTitle, username: v.username, password: v.password, password_rules: v.passwordRules,
    otp: v.otp && { secret: H(v.otp.secret), digits: v.otp.digits, period: v.otp.period, algorithm: v.otp.algorithm, issuer: v.otp.issuer, account: v.otp.account },
    passkey: v.passkey && { credential_id: H(v.passkey.credentialId), private_key: H(v.passkey.privateKey), relying_party: v.passkey.relyingParty, user_name: v.passkey.userName, user_handle: H(v.passkey.userHandle), created: v.passkey.created },
    cardholder: v.cardholder, card: v.card, card_code: v.cardCode, card_pin: v.cardPin, notes: v.notes,
    websites: v.websites.map((w) => ({ field: w.field, address: w.address })),
    custom_fields: v.customFields.map((c) => ({ field: c.field, label: c.label, value: c.value, concealed: c.concealed })),
    attachments: v.attachments.map((a) => ({ field: a.field, file_name: a.fileName })),
    tags: v.tags.map((t) => t.text),
    previous: v.previousPasswords.map((p) => ({ value: p.value, replaced: p.replaced, from: p.from })),
    password_note: v.passwordNote ?? undefined, added: v.added, added_estimated: v.addedEstimated, edited: v.edited, edited_raw: v.editedRaw, deleted: v.deleted, deleted_at: v.deletedAt,
    moved: v.moved && { gid: H(v.moved.gid), when: v.moved.when }, moved_from: v.movedFrom && { gid: H(v.movedFrom.gid), when: v.movedFrom.when }, shown: v.shown, invalid: v.invalid, unknown: v.unknown, carried: [...v.carry.keys()].sort(),
  };
  const keys = show ?? Object.keys(o);
  const out: J = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export const settingsJson = (v: S.SettingsView): J => ({ ...(v.name !== undefined ? { name: v.name } : {}), gone: v.gone, invalid: v.invalid, unknown: v.unknown });

/** How many writes of each field of the item a checkpoint carries. */
const carries = (items: CborValue[]): J => {
  const out: J = {};
  for (const it of items as [Uint8Array, CMap][]) for (const [n, ws] of it[1]) out[n as string] = (ws as CborValue[]).length;
  return out;
};

const fieldsOf = (st: State, item: Uint8Array) => st.get(H(item)) ?? new Map<string, Entry[]>();

export function computeSchema(type: string, i: J): J {
  switch (type) {
    case 'schema.view': {
      const item = itemOf(i);
      const changes = (i.changes as J[]).map((c) => changeFrom(c, item));
      const cps = ((i.checkpoints ?? []) as J[]).map((c) => checkpointItems(fold((c.include as number[]).map((n) => changes[n]!))));
      const parsed = cps.map((c) => checkpointWritesOf(cmap([[1, new Uint8Array(0)], [5, decode(encode(c)) as CborValue], [6, []]])));
      const runs: J[] = i.runs ?? [{ changes: changes.map((_, n) => n), checkpoints: [] }];
      const views = runs.map((r) => {
        const st = fold((r.changes as number[]).map((n) => changes[n]!), (r.checkpoints as number[]).map((n) => parsed[n]!));
        const fields = fieldsOf(st, item);
        return i.as === 'settings' ? settingsJson(S.viewSettings(fields)) : viewJson(S.viewItem(fields), i.show);
      });
      const out: J = i.runs ? { views } : { view: views[0] };
      if (cps.length) out.carries = cps.map(carries);
      return out;
    }
    case 'schema.build': {
      try {
        const item = itemOf(i);
        let existing: Partial<S.Counts> | undefined;
        let view: S.ItemView | undefined;
        if (i.changes) view = S.viewItem(fieldsOf(fold((i.changes as J[]).map((c) => changeFrom(c, item))), item));
        if (i.existing) existing = Object.fromEntries(Object.entries(i.existing as Record<string, number>).map(([k, n]) => [k, Array.from({ length: n }, (_, x) => ({ field: `x/${x}` }))]));
        const c = new S.ItemChange(existing ?? (view && { ...view, tags: view.tags.flatMap((t) => t.fields.map((f) => ({ field: f }))) }));
        for (const op of i.ops as J[]) {
          if (op.m === 'newItem') { for (const [k, v] of S.ItemChange.newItem(argOf(op.a[0])).set) c.set.set(k, v); }
          else if (op.m === 'clearPreviousPasswords') c.clearPreviousPasswords(view!);
          else (c as any)[op.m](...((op.a ?? []) as any[]).map(argOf));
        }
        const bytes = encode(c.payload(item));
        if (i.brief) return { set_names: [...c.set.keys()].sort(), clear: [...c.clear].sort(), payload_length: bytes.length };
        return { set: Object.fromEntries([...c.set].map(([k, v]) => [k, toNotation(v)])), clear: [...c.clear].sort(), payload_sha256: H(sha256(bytes)) };
      } catch (e) {
        if (e instanceof S.SchemaError) return { error: { code: e.code } };
        throw e;
      }
    }
    case 'schema.position': {
      try {
        if (i.existing) { const p = S.positionAtEnd(i.existing); return { valid: S.validPosition(p), after_all: (i.existing as string[]).every((x) => x < p) }; }
        const p = S.positionBetween(i.a ?? null, i.b ?? null);
        return { valid: S.validPosition(p), between: (i.a == null || i.a < p) && (i.b == null || p < i.b) };
      } catch (e) {
        if (e instanceof S.SchemaError) return { error: { code: e.code } };
        throw e;
      }
    }
    case 'schema.name': {
      const c = S.classifyName(i.name, !!i.settings);
      return c.kind === 'invalid' ? { class: 'invalid' } : c.kind === 'fixed' ? { class: 'fixed', known: c.known } : { class: 'repeated', family: c.family, id: c.id, known: c.known };
    }
    case 'schema.shape': return { ok: S.shapeOk(i.name, fromNotation(noteOf(i.value) as N), !!i.settings) };
    case 'schema.gone_name': return { field: `gone/${S.goneId(i.kind, i.id)}` };
    case 'schema.move': {
      const item = itemOf(i);
      const src = (i.changes as J[]).map((c) => changeFrom(c, item));
      const view = S.viewItem(fieldsOf(fold(src), item));
      const tgt = ((i.target_changes ?? []) as J[]).map((c) => changeFrom(c, item));
      const r = S.moveRecords(view, F(i.from_gid), F(i.to_gid), i.now, i.target_changes ? { target: fieldsOf(fold(tgt), item) } : {});
      const plain = (m: Map<string, CborValue>) => Object.fromEntries([...m].map(([k, v]) => [k, toNotation(v)]));
      // The target group folds the first record and shows the item; the source folds the second and hides it.
      const by = { author: i.by.author, device: i.by.device };
      const t = changeFrom({ clock: [i.now, 0], ...by, seq: 1000, set: [], clear: [] }, item);
      t.payload = S.changePayload(item, r.target.set, r.target.clear);
      const s2 = changeFrom({ clock: [i.now + 1, 0], ...by, seq: 1001, set: [], clear: [] }, item);
      s2.payload = S.changePayload(item, r.source.set, r.source.clear);
      const tv = S.viewItem(fieldsOf(fold([...tgt, t]), item));
      const sv = S.viewItem(fieldsOf(fold([...src, s2]), item));
      const want = (i.values ?? []) as string[];
      return {
        target_set: [...r.target.set.keys()].sort(), target_clear: [...r.target.clear].sort(), target_values: Object.fromEntries(want.map((k) => [k, plain(r.target.set)[k]])),
        source_set: plain(r.source.set), source_clear: r.source.clear,
        target_view: viewJson(tv, i.show), source_view: viewJson(sv, ['shown', 'moved']),
      };
    }
    case 'schema.classify': {
      const side = (s: J): S.InGroup => ({ gid: F(s.gid), fields: fieldsOf(fold((s.changes as J[]).map((c) => changeFrom(c, itemOf(i)))), itemOf(i)) });
      const r = S.classifyInTwoGroups(side(i.a), side(i.b));
      const o: J = { kind: r.kind };
      if (r.kind !== 'separate') { o.from = H(r.from); o.to = H(r.to); }
      if (r.kind === 'move_in_progress') o.mark_on = H(r.markOn);
      return o;
    }
    default: throw new Error(`unknown schema vector type ${type}`);
  }
}
