// Every numeric boundary of the specification in one place. The library reads these at call time, so the mutation tests
// (test/boundaries.test.ts) can move one and check that some vector notices.
export const limits = {
  paddingThreshold: 4096, // 4.2: multiples of 256 up to here, multiples of 4096 beyond
  paddingStep: 256,
  paddingBigStep: 4096,
  maxBody: 1_048_576, // 4.2
  maxSealed: 1_052_760, // 4.1 (also the frame limit of 8.1)
  holdBackMs: 24 * 3600 * 1000, // 4.5
  maxDepth: 16, // 2
  argonMinMemory: 65_536, // 7.2, KiB
  argonMinPasses: 2,
  argonMaxMemory: 1_048_576,
  argonMaxPasses: 16,
  argonMaxLanes: 16,
  segmentLimit: 65_536, // 8.1
  chunkSize: 1_048_576, // 5.2
};
export const defaults = { ...limits };
