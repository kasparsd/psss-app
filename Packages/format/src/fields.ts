// Field names of the item schema (docs/format-schema.md, sections 1, 2, 3, 5, 8) and the list of content fields. Kept apart from schema.ts
// so that fold.ts (the delete rule of specification 5.1) can use the schema's predicate without a cycle.
import { limits } from './limits.ts';

export const FIXED_FIELDS = ['type', 'title', 'username', 'password', 'password_over', 'password_rules', 'otp', 'passkey', 'cardholder', 'card', 'card_code', 'card_pin', 'notes',
  'created', 'edited', 'source', 'password_history', 'history_hidden', 'moved', 'moved_from', 'deleted'] as const;
export const SETTINGS_FIELDS = ['name'] as const;
export const REPEATED_FAMILIES = ['web', 'f', 'a', 't'] as const;
const FAMILIES_IN_SETTINGS = ['gone'] as const;

export type NameClass =
  | { kind: 'invalid' }
  | { kind: 'fixed'; name: string; known: boolean }
  | { kind: 'repeated'; family: string; id: string; known: boolean };

/** Schema 1: ASCII, at most 64 bytes, lowercase letters, digits, `_`, `/` and `-`. A name without `/` is fixed. A name `kind/id` is
 *  repeated, with `id` 16 lowercase hexadecimal digits; anything else (more than one `/`, an empty part, a bad id) is invalid. */
export function classifyName(name: string, settings = false): NameClass {
  if (name.length === 0 || name.length > limits.nameBytes || !/^[a-z0-9_/-]+$/.test(name)) return { kind: 'invalid' };
  const parts = name.split('/');
  if (parts.length === 1) return { kind: 'fixed', name, known: (settings ? (SETTINGS_FIELDS as readonly string[]) : (FIXED_FIELDS as readonly string[])).includes(name) };
  if (parts.length > 2 || parts[0] === '' || !/^[0-9a-f]{16}$/.test(parts[1]!)) return { kind: 'invalid' };
  const fams: readonly string[] = settings ? FAMILIES_IN_SETTINGS : REPEATED_FAMILIES;
  return { kind: 'repeated', family: parts[0]!, id: parts[1]!, known: fams.includes(parts[0]!) };
}

/** Schema 5 (draft 2): the content fields, listed. Nothing else is one, including fields this version does not know. */
export const CONTENT_FIXED = ['type', 'title', 'username', 'password', 'password_rules', 'otp', 'passkey', 'cardholder', 'card', 'card_code', 'card_pin', 'notes'] as const;
export const CONTENT_FAMILIES = ['web', 'f', 'a', 't'] as const;

/** Is `name` a content field of an item? (Not in the settings item: there is no edit and no delete there.) */
export function isContentField(name: string): boolean {
  const c = classifyName(name);
  if (c.kind === 'fixed') return (CONTENT_FIXED as readonly string[]).includes(name);
  if (c.kind === 'repeated') return (CONTENT_FAMILIES as readonly string[]).includes(c.family);
  return false;
}
