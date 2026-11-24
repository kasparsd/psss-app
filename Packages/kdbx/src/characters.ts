// Characters an XML 1.0 file cannot hold: controls other than tab, line feed and carriage return, U+FFFE, U+FFFF and lone
// surrogates. Unprotected strings are written as XML text, so they cannot carry them. Protected strings are encrypted as
// UTF-8 and base64-encoded, so they keep every character UTF-8 can hold (controls and U+FFFE/U+FFFF included); only lone
// surrogates, which UTF-8 cannot represent, are a problem there.
import { walkXml } from './xml.ts';
import type { XmlNode } from './xml.ts';
import type { KdbxDatabase, KdbxEntry, KdbxGroup } from './model.ts';

const NOT_XML_CHAR = /[^\t\n\r -퟿-�\u{10000}-\u{10ffff}]/gu;
const LONE_SURROGATE = /[\ud800-\udfff]/gu; // with the u flag, a paired surrogate is one astral code point and does not match

/** True when `text` holds a character XML cannot store (see the top of this file). */
export function hasInvalidXmlCharacters(text: string): boolean {
  NOT_XML_CHAR.lastIndex = 0;
  return NOT_XML_CHAR.test(text);
}

/** `text` without the characters XML cannot store. */
export function stripInvalidXmlCharacters(text: string): string {
  return hasInvalidXmlCharacters(text) ? text.replace(NOT_XML_CHAR, '') : text;
}

/** Number of lone surrogates in `text` (what a protected value cannot keep). */
export function countLoneSurrogates(text: string): number {
  return text.isWellFormed() ? 0 : (text.match(LONE_SURROGATE)?.length ?? 0);
}

export function stripLoneSurrogates(text: string): string {
  return text.isWellFormed() ? text : text.replace(LONE_SURROGATE, '');
}

function countInvalid(text: string): number {
  return text.match(NOT_XML_CHAR)?.length ?? 0;
}

/** Where a value with such characters is, and how many: never the value itself. */
export interface InvalidCharacterReport {
  /** For example `entry 0123… field "Notes"` or `group 0123… name`; names things, never shows a value. */
  where: string;
  /** How many characters are (or were) affected. */
  count: number;
  /** A protected value: only lone surrogates count here. */
  protected: boolean;
}

/** A name for messages: JSON-escaped (so control characters show as escapes) and cut to 60 characters. */
function shown(name: string): string {
  const j = JSON.stringify(name.length > 60 ? `${name.slice(0, 60)}...` : name).replace(/[￾￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  return j;
}

type Fix = (where: string, value: string, isProtected: boolean) => string;

function visitNodes(nodes: XmlNode[], where: string, fix: Fix): void {
  for (const root of nodes) {
    walkXml(root, (node) => {
      const at = `${where} element <${node.name}>`;
      node.attributes = node.attributes.map(([k, v]) => [k, fix(`${at} attribute ${shown(k)}`, v, false)]);
      if (node.children.length === 0) {
        const prot = node.attributes.some(([k, v]) => k === 'Protected' && v.toLowerCase() === 'true');
        node.text = fix(at, node.text, prot);
      }
    });
  }
}

function visitEntry(e: KdbxEntry, label: string, fix: Fix, nested = false): void {
  e.foregroundColor = fix(`${label} foreground color`, e.foregroundColor, false);
  e.backgroundColor = fix(`${label} background color`, e.backgroundColor, false);
  e.tags = e.tags.map((t) => fix(`${label} tags`, t, false));
  for (const f of e.fields) {
    const n = f.name;
    f.name = fix(`${label} field name ${shown(n)}`, n, false);
    f.value = fix(`${label} field ${shown(n)}`, f.value, f.protected);
  }
  for (const a of e.attachments) a.name = fix(`${label} attachment name ${shown(a.name)}`, a.name, false);
  for (const c of e.customData) {
    const n = c.key;
    c.key = fix(`${label} custom data key ${shown(n)}`, n, false);
    c.value = fix(`${label} custom data ${shown(n)}`, c.value, false);
  }
  e.attributes = e.attributes.map(([k, v]) => [k, fix(`${label} attribute ${shown(k)}`, v, false)]);
  visitNodes([...e.unknown, ...(e.autoType ? [e.autoType] : [])], label, fix);
  // The writer ignores the history of a history entry, so it is not checked either.
  if (!nested) e.history.forEach((h, i) => visitEntry(h, `${label} history ${i + 1}`, fix, true));
}

function visitGroup(g: KdbxGroup, fix: Fix): void {
  const label = `group ${g.uuid}`;
  g.name = fix(`${label} name`, g.name, false);
  g.notes = fix(`${label} notes`, g.notes, false);
  g.tags = g.tags.map((t) => fix(`${label} tags`, t, false));
  for (const c of g.customData) {
    const n = c.key;
    c.key = fix(`${label} custom data key ${shown(n)}`, n, false);
    c.value = fix(`${label} custom data ${shown(n)}`, c.value, false);
  }
  g.attributes = g.attributes.map(([k, v]) => [k, fix(`${label} attribute ${shown(k)}`, v, false)]);
  visitNodes(g.unknown, label, fix);
  for (const e of g.entries) visitEntry(e, `entry ${e.uuid}`, fix);
}

/** Visits every string the writer puts into the XML and stores the fixer's result back. */
function visitDatabase(db: KdbxDatabase, fix: Fix): void {
  const m = db.meta;
  m.generator = fix('database generator', m.generator, false);
  m.name = fix('database name', m.name, false);
  m.description = fix('database description', m.description, false);
  m.defaultUserName = fix('database default user name', m.defaultUserName, false);
  for (const c of m.customData) {
    const n = c.key;
    c.key = fix(`database custom data key ${shown(n)}`, n, false);
    c.value = fix(`database custom data ${shown(n)}`, c.value, false);
  }
  m.attributes = m.attributes.map(([k, v]) => [k, fix(`database attribute ${shown(k)}`, v, false)]);
  visitNodes(m.unknown, 'database', fix);
  visitNodes(db.unknown, 'database', fix);
  visitNodes(db.rootUnknown, 'database', fix);
  // Iterative, so a very deep tree is refused by the depth limit rather than by a stack overflow.
  const stack = [db.root];
  while (stack.length > 0) {
    const g = stack.pop()!;
    visitGroup(g, fix);
    for (let i = g.groups.length - 1; i >= 0; i--) stack.push(g.groups[i]!);
  }
}

function reporter(strip: boolean): { reports: InvalidCharacterReport[]; fix: Fix } {
  const reports: InvalidCharacterReport[] = [];
  const fix: Fix = (where, value, isProtected) => {
    const count = isProtected ? countLoneSurrogates(value) : hasInvalidXmlCharacters(value) ? countInvalid(value) : 0;
    if (count === 0) return value;
    reports.push({ where, count, protected: isProtected });
    if (!strip) return value;
    return isProtected ? stripLoneSurrogates(value) : stripInvalidXmlCharacters(value);
  };
  return { reports, fix };
}

/**
 * Lists the values `writeKdbx` would refuse by default (characters XML cannot store, lone surrogates in protected
 * values), without changing anything. Never includes a value. Empty when the database can be written as it is.
 */
export function findInvalidCharacters(db: KdbxDatabase): InvalidCharacterReport[] {
  const { reports, fix } = reporter(false);
  visitDatabase(db, fix); // the fixer returns every value unchanged here, so nothing is altered
  return reports;
}

/**
 * Removes those characters from the database in place and reports what was changed (never the values). Use it, for
 * example, in an import that should tell the person which values were altered, then write normally.
 */
export function stripInvalidCharacters(db: KdbxDatabase): InvalidCharacterReport[] {
  const { reports, fix } = reporter(true);
  visitDatabase(db, fix);
  return reports;
}
