// @psss/vault: open and write a Psss folder vault over @psss/format, headless. See ../README.md.
export { createVault, openVault, Vault } from './vault.ts';
export type {
  CreateOptions, Delivery, FindResult, GetResult, GroupSummary, HistoryResult, ItemEdits, LocationStatus, NewItem, Issue, OpenOptions, Problem, Scope, ShowResult,
  SyncReport, Unlock, ImportOptions, ImportReport, ImportAction, ExportKdbxOptions, ExportKdbxResult, ExportReport, UnlockSource, VaultInfo, VerifyReport, WriteResult,
} from './vault.ts';
export { ImportInterrupted, VaultError, ValueTooLarge } from './errors.ts';
export { withLock, lockPath, refreshLock } from './lock.ts';
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
export { readKeepass, buildKeepass, shortName, NAME_LENGTH, FIELD_ROLE_ALIASES, DEVIATIONS as KEEPASS_DEVIATIONS } from './keepass.ts';
export type { ReportIssue, IssueKind, ItemSpec } from './keepass.ts';
