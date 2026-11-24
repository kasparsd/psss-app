// Messages between the psss command and the app. One JSON object per line over a local socket.
// The command holds no key and reads no vault file: everything it knows comes from these answers.

export const VERSION = 1;

/** What the caller wants done with a secret, from least to most exposed. */
export type Use =
  | 'fetch' // the psss command sends it to the item's own website and returns the answer
  | 'run' // one program the caller named receives it in its environment; asked for every time
  | 'code' // a verification code, valid for seconds, is returned
  | 'show' // the value itself is returned
  | 'save'; // a new item is stored; nothing is read

export type Ref = { item: string; field: string };

export type Request = { v: number; requester: string } & (
  | { op: 'status' }
  | { op: 'list' }
  | { op: 'use'; use: 'run'; refs: Ref[]; program: string; argv: string[] }
  | { op: 'use'; use: 'fetch'; refs: Ref[]; url: string; method: string; as: string; body: boolean }
  | { op: 'use'; use: 'code'; refs: Ref[] }
  | { op: 'use'; use: 'show'; refs: Ref[] }
  | { op: 'save'; title: string; username?: string; site?: string; field: string; value?: string; generate?: boolean }
);

export type Listed = { ref: string; title: string; username: string; sites: string[]; fields: string[]; uses: string[] };

export type Response =
  | { ok: true; locked?: boolean; items?: Listed[]; values?: string[]; username?: string; code?: string; ref?: string }
  | { ok: false; error: 'locked' | 'not_allowed' | 'refused' | 'bad_request'; message: string };

/** The same words whether the item is missing, the person said no, or the field does not exist. */
export const NOT_ALLOWED = 'Psss did not allow this.';

const PREFIX = 'psss://';

/** psss://<item>/<field>. The item is a title or an identifier; both parts are percent-decoded. */
export function parseRef(text: string): Ref | null {
  if (!text.startsWith(PREFIX)) return null;
  const rest = text.slice(PREFIX.length);
  const cut = rest.lastIndexOf('/');
  if (cut <= 0 || cut === rest.length - 1) return null;
  try {
    const item = decodeURIComponent(rest.slice(0, cut));
    const field = decodeURIComponent(rest.slice(cut + 1));
    if (!item.trim() || !field.trim()) return null;
    return { item, field };
  } catch {
    return null;
  }
}

export function formatRef(item: string, field: string): string {
  return PREFIX + encodeURIComponent(item).replaceAll('%20', ' ') + '/' + encodeURIComponent(field);
}
