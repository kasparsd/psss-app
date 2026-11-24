// Text from a vault or a file made safe to put on a line of output.

/** The longest name of an item that a line carries. */
const NAME_CHARACTERS = 60;

/**
 * Text from a file made safe to put on a line: cut to `max` characters with an ellipsis, and every control character, line break, direction
 * mark (such as a right-to-left override), zero-width character and lone surrogate written as `\u{202e}` instead of being sent to the terminal.
 * A title in a file cannot forge a line of ours, move the cursor or reorder the text around it.
 */
export function printable(text: string, max = NAME_CHARACTERS): string {
  const chars = [...text];
  const cut = chars.length > max ? [...chars.slice(0, max - 1), '\u2026'] : chars;
  return cut.map((c) => (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c)).join('');
}

/** A name for a `--json` string: control, direction and zero-width characters written as `\u{202e}`, as in a warning, and no cutting. Not for values. */
export const jsonName = (text: string): string => printable(text, Infinity);
