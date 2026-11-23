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
};
export const defaults = { ...limits };

/** Rules that are not numbers, as switches the mutation tests can flip (test/boundaries.test.ts, "rules"): each one has a
 *  vector that must fail when it is flipped. In normal use they never change. */
export const rules = {
  /** 5.1 an edit counts against `deleted` only when strictly later (false: later or equal) */
  deletedStrict: true,
  /** 6.5 step 2, the order of comparison of the tuple (author, device, seq, record_id); a minus sign reverses one element */
  tieBreak: 'author,device,seq,record_id' as string,
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
};
export const defaultRules = { ...rules };
