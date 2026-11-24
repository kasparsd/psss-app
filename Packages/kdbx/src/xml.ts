// A small XML reader and writer, hand written because Node has none. It keeps what it does not understand: the tree
// holds every element, attribute and leaf text, in order. It has no DTD: DOCTYPE is refused, and only the five
// predefined entities and character references exist, so nothing can expand. Nesting and element count are limited.
import { Corrupt, InvalidArgument, LimitExceeded } from './errors.ts';
import { hasInvalidXmlCharacters, stripInvalidXmlCharacters } from './characters.ts';

export interface XmlNode {
  name: string;
  attributes: [string, string][];
  children: XmlNode[];
  /** Text of a leaf element. A container carries no text (whitespace between children is formatting, not content). */
  text: string;
}

export function xml(name: string, text = '', attributes: [string, string][] = [], children: XmlNode[] = []): XmlNode {
  return { name, attributes, children, text };
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

export function attr(node: XmlNode, name: string): string | undefined {
  return node.attributes.find(([n]) => n === name)?.[1];
}

export interface XmlLimits {
  maxDepth: number;
  maxNodes: number;
}

const NAME = /[^\s/>=<"'&]+/y;
const SPACE = /\s*/y;

function isXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff);
}

function decode(raw: string): string {
  let s = raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw;
  if (!s.includes('&')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf('&', i);
    if (amp === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, amp);
    const semi = s.indexOf(';', amp);
    if (semi === -1 || semi - amp > 12) throw new Corrupt('XML: a bare "&" or an entity that is not closed');
    const ref = s.slice(amp + 1, semi);
    switch (ref) {
      case 'amp': out += '&'; break;
      case 'lt': out += '<'; break;
      case 'gt': out += '>'; break;
      case 'quot': out += '"'; break;
      case 'apos': out += "'"; break;
      default: {
        const m = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(ref);
        if (!m) throw new Corrupt(`XML: undefined entity "&${ref.slice(0, 12)};" (there is no DTD)`);
        const cp = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2]!, 10);
        if (!isXmlChar(cp)) throw new Corrupt('XML: a character reference to a character XML cannot hold');
        out += String.fromCodePoint(cp);
      }
    }
    i = semi + 1;
  }
  return out;
}

export function parseXml(input: string, limits: XmlLimits): XmlNode {
  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = input.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let count = 0;

  const text = (segment: string) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (segment.trim() !== '') throw new Corrupt('XML: text outside the root element');
      return;
    }
    if (top.children.length === 0) top.text += decode(segment);
  };

  while (pos < n) {
    const lt = input.indexOf('<', pos);
    if (lt === -1) {
      text(input.slice(pos));
      break;
    }
    if (lt > pos) text(input.slice(pos, lt));
    pos = lt;
    if (input.startsWith('<!--', pos)) {
      const end = input.indexOf('-->', pos + 4);
      if (end === -1) throw new Corrupt('XML: a comment is not closed');
      pos = end + 3;
    } else if (input.startsWith('<![CDATA[', pos)) {
      const end = input.indexOf(']]>', pos + 9);
      if (end === -1) throw new Corrupt('XML: a CDATA section is not closed');
      const top = stack[stack.length - 1];
      if (!top) throw new Corrupt('XML: CDATA outside the root element');
      if (top.children.length === 0) top.text += input.slice(pos + 9, end);
      pos = end + 3;
    } else if (input.startsWith('<?', pos)) {
      const end = input.indexOf('?>', pos + 2);
      if (end === -1) throw new Corrupt('XML: a processing instruction is not closed');
      pos = end + 2;
    } else if (input.startsWith('<!', pos)) {
      throw new Corrupt('XML: DOCTYPE and other declarations are not allowed (no DTD support)');
    } else if (input.startsWith('</', pos)) {
      NAME.lastIndex = pos + 2;
      const m = NAME.exec(input);
      const top = stack.pop();
      if (!m || !top || m[0] !== top.name) throw new Corrupt('XML: an end tag does not match its start tag');
      SPACE.lastIndex = NAME.lastIndex;
      SPACE.exec(input);
      if (input.charCodeAt(SPACE.lastIndex) !== 0x3e) throw new Corrupt('XML: an end tag is not closed');
      pos = SPACE.lastIndex + 1;
      if (top.children.length > 0) top.text = '';
      if (stack.length === 0) {
        // Only whitespace, comments and processing instructions may follow the root.
        const tail = input.slice(pos).replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
        if (tail.trim() !== '') throw new Corrupt('XML: content after the root element');
        break;
      }
    } else {
      NAME.lastIndex = pos + 1;
      const m = NAME.exec(input);
      if (!m || !/^[A-Za-z_:\u00c0-\uffff]/.test(m[0])) throw new Corrupt('XML: a start tag has no valid name');
      if (stack.length === 0 && root) throw new Corrupt('XML: more than one root element');
      if (stack.length + 1 > limits.maxDepth) {
        throw new LimitExceeded('maxXmlDepth', `XML is nested deeper than ${limits.maxDepth} levels`);
      }
      if (++count > limits.maxNodes) throw new LimitExceeded('maxXmlNodes', `XML has more than ${limits.maxNodes} elements`);
      const node: XmlNode = { name: m[0], attributes: [], children: [], text: '' };
      let p = NAME.lastIndex;
      let selfClosed = false;
      for (;;) {
        SPACE.lastIndex = p;
        SPACE.exec(input);
        p = SPACE.lastIndex;
        const c = input.charCodeAt(p);
        if (Number.isNaN(c)) throw new Corrupt('XML: the file ends inside a start tag');
        if (c === 0x3e) { p++; break; }
        if (c === 0x2f) {
          if (input.charCodeAt(p + 1) !== 0x3e) throw new Corrupt('XML: a "/" inside a start tag');
          p += 2;
          selfClosed = true;
          break;
        }
        NAME.lastIndex = p;
        const a = NAME.exec(input);
        if (!a) throw new Corrupt('XML: a bad attribute');
        SPACE.lastIndex = NAME.lastIndex;
        SPACE.exec(input);
        p = SPACE.lastIndex;
        if (input.charCodeAt(p) !== 0x3d) throw new Corrupt('XML: an attribute without a value');
        SPACE.lastIndex = p + 1;
        SPACE.exec(input);
        p = SPACE.lastIndex;
        const quote = input.charCodeAt(p);
        if (quote !== 0x22 && quote !== 0x27) throw new Corrupt('XML: an attribute value is not quoted');
        const end = input.indexOf(String.fromCharCode(quote), p + 1);
        if (end === -1) throw new Corrupt('XML: an attribute value is not closed');
        const raw = input.slice(p + 1, end);
        if (raw.includes('<')) throw new Corrupt('XML: "<" inside an attribute value');
        if (node.attributes.some(([name]) => name === a[0])) throw new Corrupt('XML: a repeated attribute');
        node.attributes.push([a[0], decode(raw)]);
        p = end + 1;
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else root = node;
      pos = p;
      if (!selfClosed) {
        stack.push(node);
      } else if (stack.length === 0) {
        const tail = input.slice(pos).replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
        if (tail.trim() !== '') throw new Corrupt('XML: content after the root element');
        break;
      }
    }
  }
  if (!root || stack.length > 0) throw new Corrupt('XML: the document ends before its root element is closed');
  return root;
}

const NEEDS_ESCAPE = /[&<>"\r\n\t]/;

function escape(text: string, attribute: boolean): string {
  if (!NEEDS_ESCAPE.test(text)) return text;
  return text.replace(/[&<>"\r\n\t]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return attribute ? '&quot;' : '"';
      case '\r': return '&#13;';
      case '\n': return attribute ? '&#10;' : '\n';
      default: return attribute ? '&#9;' : '\t';
    }
  });
}

export interface SerializeOptions {
  maxDepth: number;
  /**
   * What to do with characters XML 1.0 cannot hold (controls other than tab, line feed and carriage return, U+FFFE,
   * U+FFFF, lone surrogates) in text and attribute values: throw `InvalidArgument` (default) or drop them.
   */
  invalidCharacters?: 'throw' | 'strip';
  /** Called, in document order, for every leaf element whose Protected attribute is True; returns the text to write. */
  protect?: (node: XmlNode, parent: XmlNode | undefined) => string;
}

export function isProtected(node: XmlNode): boolean {
  const v = attr(node, 'Protected');
  return v !== undefined && v.toLowerCase() === 'true';
}

export function serializeXml(root: XmlNode, o: SerializeOptions): string {
  const out: string[] = ['<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n'];
  const strip = o.invalidCharacters === 'strip';
  const path: string[] = [];
  const clean = (text: string, what: string): string => {
    if (!hasInvalidXmlCharacters(text)) return text;
    if (strip) return stripInvalidXmlCharacters(text);
    throw new InvalidArgument(`${what} in <${path.join('/')}> holds a character XML cannot store (a control character other than tab, line feed or carriage return, U+FFFE, U+FFFF or a lone surrogate)`);
  };
  const write = (node: XmlNode, parent: XmlNode | undefined, depth: number) => {
    path.push(node.name);
    if (depth >= o.maxDepth) throw new LimitExceeded('maxXmlDepth', `the database nests deeper than ${o.maxDepth} levels`);
    const indent = '\t'.repeat(depth);
    let open = `${indent}<${node.name}`;
    for (const [k, v] of node.attributes) open += ` ${k}="${escape(clean(v, `the attribute ${k}`), true)}"`;
    if (node.children.length === 0) {
      let text = node.text;
      if (o.protect && isProtected(node)) text = o.protect(node, parent);
      const written = o.protect && isProtected(node) ? text : clean(text, 'the text');
      out.push(written === '' ? `${open}/>\n` : `${open}>${escape(written, false)}</${node.name}>\n`);
    } else {
      out.push(`${open}>\n`);
      for (const c of node.children) write(c, node, depth + 1);
      out.push(`${indent}</${node.name}>\n`);
    }
    path.pop();
  };
  write(root, undefined, 0);
  return out.join('');
}

/** Visits every element in document order (no recursion, so depth cannot overflow the stack). */
export function walkXml(root: XmlNode, visit: (node: XmlNode, parent: XmlNode | undefined) => void): void {
  const stack: [XmlNode, XmlNode | undefined][] = [[root, undefined]];
  while (stack.length > 0) {
    const [node, parent] = stack.pop()!;
    visit(node, parent);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push([node.children[i]!, node]);
  }
}
