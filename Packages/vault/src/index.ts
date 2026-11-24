// @psss/vault: open and write a Psss folder vault over @psss/format, headless. See ../README.md.
export { createVault, openVault, Vault } from './vault.ts';
export type {
  CreateOptions, FindResult, GetResult, GroupSummary, HistoryResult, ItemEdits, LocationStatus, NewItem, Issue, OpenOptions, Problem, Scope, ShowResult,
  SyncReport, Unlock, UnlockSource, VaultInfo, VerifyReport, WriteResult,
} from './vault.ts';
export { VaultError, ValueTooLarge } from './errors.ts';
export { withLock, lockPath } from './lock.ts';
export type { LockOptions } from './lock.ts';
export type { Candidate } from './errors.ts';
export { formatReference, parseReference } from './reference.ts';
export type { Reference, Selector } from './reference.ts';
export { generateDeviceKey, keyFileText, parseKeyFile, writeKeyFile } from './keyfile.ts';
export type { DeviceKey } from './keyfile.ts';
export { seededRandom, systemRandom } from './random.ts';
export type { Random } from './random.ts';
export { hotp, totp } from './totp.ts';
export type { DetailField, HistoryEntry, ItemDetail, ItemSummary } from './model.ts';
