# @psss/format

A reference implementation and test vectors for the Psss vault format, version 1.
It is written from `docs/format-spec.md` alone; where that document is silent, ambiguous or wrong, the code takes the most literal reading and says so in a comment that starts with a section number.
The list of such places is in the findings report that came with this package, and each one that changes behaviour is marked "finding" in the code, the vector descriptions or both.

Node 24, TypeScript run directly by Node (type stripping, erasable syntax only), ES modules, `node:crypto` and the standard library only.
No dependencies, no `node_modules`, no build step.

## Layout

- `src/` the library. Pure functions over `Uint8Array`; only `folder.ts` touches the file system.
  - `cbor.ts` deterministic encoder and strict decoder (section 2).
  - `xwing.ts`, `hpke.ts` X-Wing KEM and HPKE base mode, built here on `node:crypto` (Node has neither).
  - `prims.ts` thin wrappers over `node:crypto` (SHA-256, SHA3-256, SHAKE256, HKDF, ChaCha20-Poly1305, AES-GCM, Ed25519, X25519, ML-KEM-768, Argon2id).
  - `keys.ts` person, card, gid, key commitment (section 3).
  - `record.ts` sealed records, padding, body and payload shapes, clock (sections 4 and 5), and the reader checks of section 9 steps 1 to 3.
  - `fold.ts` folding item changes, `deleted`, history, checkpoints (sections 5.1 and 5.3).
  - `group.ts` chains, membership, cuts, the fork rule, and the whole reader (`evaluateGroup`) with section 9 steps 4 and 5.
  - `slots.ts` wrapped group keys, the three slot types, the recovery kit text, attachment chunks (sections 5.2 and 7).
  - `folder.ts` the folder layout (section 8.1).
- `scripts/make-vectors.ts` writes `vectors/*.json`. `scripts/minted.json` holds the few inputs that cannot be derived (see below).
- `test/` `node:test` suites: vectors (regenerate byte for byte, check each vector, coverage), known-answer tests for the primitives, folder tests, and seeded property tests. `test/compute.ts` maps every vector type to its expected output; `test/scenario.ts` builds deterministic groups.
- `vectors/` the vectors, one JSON file per area. Every vector has `name`, `description`, `type`, `input` and `expected`; all byte strings are lowercase hex.

## Run

From the repository root: `scripts/test-format.sh`.
It finds Node 24 (the `node` on `PATH` if it is 24, otherwise the newest `~/.nvm/versions/node/v24.*`), and runs the tests; it exits non-zero on any failure.
The vector regeneration test takes about half a minute, mostly the default Argon2id parameters and the padding searches.

## Regenerate the vectors

`node scripts/make-vectors.ts` (or `npm run vectors`) rewrites `vectors/`. The tests fail until the committed files match what it writes.
Vector expectations that were written by hand (CBOR encodings and rejections, padding lengths, clock order, many rejection reasons) are compared with the library at generation time; the generator stops if they differ.

Node cannot supply the randomness of an ML-KEM encapsulation, so wraps and device slots use a fixed ML-KEM ciphertext from `scripts/minted.json` and a fixed X25519 ephemeral key.
That makes their "seal" vectors deterministic.
`node scripts/make-vectors.ts --mint` replaces the two ML-KEM ciphertexts (the vectors then change).
`external_wrap` in `minted.json` was sealed by another implementation (Python `cryptography` 50, outside this repository) and is an "open" vector only; `--external-input` prints what it wraps.

## Not covered

- The server protocol (section 8.2) and CloudKit (8.3): no implementation, no vectors.
- The item schema, invitations and device approval, the backup copy, limits (section 10).
- ML-KEM-768 encapsulation with chosen randomness: Node does not offer it, so deterministic seal vectors reuse a stored ML-KEM ciphertext.
- Independent X-Wing and HPKE known-answer values from the Internet-Drafts: none are stated in this package. Interoperability was checked against Python `cryptography` 50 only (see the report).
- Multiple concurrent checkpoints with conflicting coverage are merged by a rule of this implementation, not by the spec.
- Hostile file systems (symlinks, case folding, partial writes other than a truncated final frame).
- Nesting depth: the decoder refuses more than 64 levels; the spec sets no limit.
