// Errors of the vault layer. A reader of the format never throws for bad records (they are reported by verify()); these are for what
// the caller did wrong or what the environment refused: a bad reference, the wrong password, no write access, a file that cannot be written.

export interface Candidate {
  /** the item id in lowercase hexadecimal: what `psss://id:<hex>/field` takes */
  id: string;
  title?: string;
  group: string;
  groupId: string;
  username?: string;
  url?: string;
  deleted: boolean;
}

export class VaultError extends Error {
  code: string;
  /** set when `code` is `ambiguous`: every item the reference could mean */
  candidates?: Candidate[];
  constructor(code: string, message = '', candidates?: Candidate[]) {
    super(message ? `${code}: ${message}` : code);
    this.code = code;
    if (candidates) this.candidates = candidates;
  }
}

/** A value is larger than one record can carry. `limit` and `size` are in bytes (UTF-8); `field` names the field. Nothing is written. */
export class ValueTooLarge extends VaultError {
  field: string;
  limit: number;
  size?: number;
  constructor(field: string, limit: number, size?: number, message?: string) {
    super('value_too_large', message ?? `${field} is ${size} bytes; the most one record can carry for it is ${limit} bytes (${Math.round(limit / 1024)} KiB). Large values are not split across records.`);
    this.name = 'ValueTooLarge';
    this.field = field; this.limit = limit;
    if (size !== undefined) this.size = size;
  }
}
