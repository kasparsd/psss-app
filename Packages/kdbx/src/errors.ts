// Every failure of this package is a KdbxError with a stable `code`. Library exceptions never escape: the entry points
// wrap anything unexpected as `Corrupt`.

export type KdbxErrorCode =
  | 'NotKdbx' // not a KeePass 2 file at all (signature)
  | 'Unsupported' // a real feature this package does not implement; `feature` names it
  | 'WrongKey' // the credentials do not open the file (see the README: where the format cannot tell, this is also what damage looks like)
  | 'Corrupt' // the file is damaged, truncated or not well formed
  | 'LimitExceeded' // a safety limit stopped it before it allocated or looped; `limit` names it
  | 'InvalidKey' // the key given is unusable (nothing given, bad key file)
  | 'InvalidArgument'; // the caller asked for something impossible

export class KdbxError extends Error {
  code: KdbxErrorCode;
  /** Unsupported: the feature. LimitExceeded: the name of the limit. */
  detail: string | undefined;
  constructor(code: KdbxErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'KdbxError';
    this.code = code;
    this.detail = detail;
  }
}

export class NotKdbx extends KdbxError {
  constructor(message = 'Not a KeePass 2 database (KDBX): the file signature does not match') {
    super('NotKdbx', message);
    this.name = 'NotKdbx';
  }
}

export class Unsupported extends KdbxError {
  feature: string;
  constructor(feature: string, message?: string) {
    super('Unsupported', message ?? `Unsupported: ${feature}`, feature);
    this.name = 'Unsupported';
    this.feature = feature;
  }
}

export class WrongKey extends KdbxError {
  constructor(message = 'The password or key file does not open this database') {
    super('WrongKey', message);
    this.name = 'WrongKey';
  }
}

export class Corrupt extends KdbxError {
  constructor(message: string) {
    super('Corrupt', `Damaged database: ${message}`);
    this.name = 'Corrupt';
  }
}

export class LimitExceeded extends KdbxError {
  limit: string;
  constructor(limit: string, message: string) {
    super('LimitExceeded', `Limit exceeded (${limit}): ${message}`, limit);
    this.name = 'LimitExceeded';
    this.limit = limit;
  }
}

export class InvalidKey extends KdbxError {
  constructor(message: string) {
    super('InvalidKey', message);
    this.name = 'InvalidKey';
  }
}

export class InvalidArgument extends KdbxError {
  constructor(message: string) {
    super('InvalidArgument', message);
    this.name = 'InvalidArgument';
  }
}

/** Runs `body`; anything that is not a KdbxError becomes Corrupt, so no raw library exception escapes. */
export function typed<T>(body: () => T): T {
  try {
    return body();
  } catch (e) {
    if (e instanceof KdbxError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new Corrupt(`unexpected failure while reading or writing (${message})`);
  }
}
