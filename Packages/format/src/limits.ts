// Every numeric boundary of the specification in one place. The library reads these at call time, so the mutation tests
// (test/boundaries.test.ts) can move one and check that some vector notices.
export const limits = {
  paddingThreshold: 4096, // 4.2: multiples of 256 up to here, multiples of 4096 beyond
  paddingStep: 256,
  paddingBigStep: 4096,
  maxBody: 1_048_576, // 4.2
  maxSealed: 1_052_760, // 4.1 (also the frame limit of 8.1)
  holdBackMs: 10 * 60 * 1000, // 4.5 (draft 3: ten minutes)
  maxDepth: 16, // 2
  extensionKey: 128, // 2: integer keys of this value and above, in a body and in a payload, are kept and ignored
  argonMinMemory: 65_536, // 7.2, KiB
  argonMinPasses: 2,
  argonMinLanes: 1, // 7.2 (draft 3): zero lanes refused
  argonMinMemoryPerLane: 8, // 7.2 (draft 3): less than 8 KiB per lane refused
  argonMaxMemory: 1_048_576,
  argonMaxPasses: 16,
  argonMaxLanes: 16,
  chunkSize: 1_048_576, // 5.2
  purgeAfterMs: 30 * 24 * 3600 * 1000, // 5.1: the app's rule, timed on the purging device's own clock
  // The item schema (docs/format-schema.md, draft 1)
  nameBytes: 64, // schema 1: a field name is at most 64 bytes
  textBytes: 65_536, // schema 1: a text value
  notesBytes: 262_144, // schema 1: notes
  websites: 64, // schema 1
  customFields: 128,
  attachments: 64,
  tags: 64,
  otpDigitsMin: 4, // schema 2 (draft 2): digits of a verification code
  otpDigitsMax: 10,
  otpPeriodMin: 1, // schema 2 (draft 2): period in seconds
  otpPeriodMax: 86_400,
  historyKept: 10, // schema 4: previous-password entries a checkpoint keeps (with the writes the list needs)
  historyShown: 10, // schema 4: previous passwords shown
};
export const defaults = { ...limits };

/** Rules that are not numbers, as switches the mutation tests can flip (test/boundaries.test.ts, "rules"): each one has a
 *  vector that must fail when it is flipped. In normal use they never change. */
export const rules = {
  /** 5.1 an edit counts against `deleted` only when strictly later (false: later or equal) */
  deletedStrict: true,
  /** 6.5 step 2, the order of comparison of the tuple (author, device, seq) (draft 4: no record_id); a minus sign reverses one element */
  tieBreak: 'author,device,seq' as string,
  /** 6.5 step 1: when every candidate is dropped, keep them all (false: take the greatest) */
  keepAllWhenAllDropped: true,
  /** 6.3, 6.4: K_(e-1) is checked against commit(e-1) */
  checkPreviousKey: true,
  /** 4.1, 9: the salt is recomputed and compared */
  checkSalt: true,
  /** 1.2: S less than the group order */
  checkScalarLessThanL: true,
  /** 7.2: the two kit check bytes */
  checkKitCheckBytes: true,
  /** 7.2 (draft 4): the last four bits of the kit text are zero */
  checkKitTrailingBits: true,
  /** 6.4 (draft 4): the header of a record of kind 3, 4 or 5 names the epoch it starts */
  checkHeaderEpoch: true,
  /** 4.1, 9 step 2 (draft 4): the salt is checked before the author and the signature (false: after them) */
  saltBeforeSignature: true,
  /** 6.4 (draft 4): the cut of a remove or replace record reaches only epochs before the one it starts (false: that epoch too) */
  cutEndsBeforeNewEpoch: true,
  /** 5.3 (draft 4): records of one set_id that differ in author, in device, or in parts, or two different records with one part, belong to no set (one switch each) */
  setSameAuthor: true,
  setSameDevice: true,
  setSameParts: true,
  setUniquePart: true,
  /** 5.3: a field of a checkpoint carries at least its winning write */
  checkpointFieldHasWrite: true,
  /** 6.3 (draft 5): a record that starts an epoch must bring a key that differs from the previous one */
  newKeyDiffers: true,
  /** 6.3 (draft 5, revised): nor may it repeat the key of any earlier epoch (those before the previous one) */
  newKeyDiffersFromEarlier: true,
  /** 7.2 (draft 5): the trailing bits of the kit text are checked before its check bytes (false: after) */
  kitTrailingBeforeCheck: true,
  /** 5.4 (draft 5): a purge request is answered by a complete checkpoint that names the item at or after the request's place (false: names it at all) */
  answerNeedsPlace: true,
  /** schema 1: a value of the wrong shape is treated as if the field were cleared (false: the value is used as it is) */
  wrongShapeIsCleared: true,
  /** schema 6: only a write to a content field brings a deleted item back (false: any other field, as in specification 5.1) */
  deletedUsesContentOnly: true,
  /** schema 4 (draft 2): history_hidden leaves out writes strictly before its place */
  historyHiddenApplies: true,
  /** schema 4 (draft 2): an entry equal to the current password or to a newer entry is left out, which also leaves out a write equal to the one after it (false: it is shown) */
  previousUnique: true,
  /** schema 4 (draft 2): a checkpoint keeps, besides the entries' writes, the write after each (which dates it) and the one just before the winner (false: only the entries' writes) */
  retentionKeepsNeighbours: true,
  /** schema 5: an imported item keeps the source's `edited` date until a content field is written later (false: always the latest content write) */
  importedEditedKept: true,
  /** schema 1: shown in order of (pos, field name) (false: by pos only, ties in arrival order) */
  positionTiesByName: true,
  /** 5.4 (draft 4): a purge request covers the writes up to its own place in the order (false: every write of the item) */
  purgeUpToOwnPlace: true,
};
export const defaultRules = { ...rules };
