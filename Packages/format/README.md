# @psss/format

A reference implementation and test vectors for the Psss vault format, version 1, written against draft 3 of the spec.
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
  - `record.ts` sealed records, padding, body and payload shapes, clock (sections 4 and 5), the salt derivation, and the reader checks of section 9 steps 1 to 3.
  - `fold.ts` folding item changes, `deleted`, history, checkpoints in parts, purge (sections 5.1, 5.3 and 5.4).
  - `remember.ts` what a device remembers of each chain and location, and the rollback check (section 4.4).
  - `group.ts` chains, membership, cuts, epochs started by remove and replace, the two-step fork rule, and the whole reader (`evaluateGroup`) with section 9 steps 4 and 5.
  - `slots.ts` wrapped group keys, the three slot types, the recovery kit text with check bytes, attachment chunks (sections 5.2 and 7).
  - `folder.ts` the folder layout: one new file per write, gathering, `.tmp-` files (section 8.1).
- `scripts/make-vectors.ts` (with `vec-*.ts`) writes `vectors/*.json`. `scripts/minted.json` holds the few inputs that cannot be derived (see below).
- `test/` `node:test` suites: vectors (regenerate byte for byte, check each vector, coverage, error codes), known-answer tests for the primitives, folder tests, numeric-boundary mutation tests (`boundaries.test.ts`), and seeded property tests. `test/compute.ts` maps every vector type to its expected output; `test/scenario.ts` builds deterministic groups.
- `vectors/` the vectors, one JSON file per area. Every vector has `name`, `description`, `type`, `input` and `expected`; all byte strings are lowercase hex.

## Run

From the repository root: `scripts/test-format.sh`.
It finds Node 24 (the `node` on `PATH` if it is 24, otherwise the newest `~/.nvm/versions/node/v24.*`), and runs the tests; it exits non-zero on any failure.
The vector regeneration test takes about half a minute; the permutation property test about twenty seconds.
One vector derives Argon2id at 1 GiB and runs only with `PSSS_HEAVY=1`; the mutation tests run it with the Argon2id work skipped.

## Vectors

Every vector has `name`, `description`, `type`, `input`, `expected`; byte strings are lowercase hex.
`test/compute.ts` maps each `type` to the library call that produces `expected`.
A failure is `{"error": {"code": ..., "disposition": ...}}` (CBOR errors have a `code` only).
Codes are stable identifiers; the tests fail if a vector or source file uses a code missing from the table below.
Tampered vectors (bit flips and so on) are asserted at generation time to differ from the original input.

## Error codes

| Code | Disposition | Meaning |
|---|---|---|
| `bad_magic` | discard | 4.1: the first bytes of a sealed record are not the magic. |
| `too_short` | discard | 4.1: shorter than magic, ciphertext and tag. |
| `too_large` | discard | 4.1: longer than the largest sealed record (1,052,760 bytes). |
| `bad_tag` | discard | 4.1: the AEAD tag does not verify. |
| `bad_padding` | discard | 4.2: padding is not zero bytes, or the length is not what `size(n)` gives. |
| `bad_size` | discard | 4.2: the size field and the plaintext do not agree. |
| `body_too_large` | discard | 4.2: body longer than 1,048,576 bytes. |
| `bad_body` | discard | 4.3: the body is not valid deterministic CBOR. |
| `bad_body_schema` | discard | 4.3: valid CBOR with wrong keys or types for a body. |
| `bad_payload` | discard | 5: the payload does not fit the record kind. |
| `bad_author` | discard | 3.2, 4.4: the author is not a valid card, or the card is not the one the record names. |
| `bad_salt` | discard | 4.1, 9: the salt in the header is not `HKDF(K_epoch, SHA-256(body without key 9), "psss/v1/salt")`. |
| `bad_signature` | discard | 4.4: the Ed25519 signature does not verify, or the section 1.2 checks fail (S >= L, small-order key, non-canonical or off-curve points). |
| `bad_public_key` | reject | 1.2: a public key that is not 32 bytes (or fails the section 1.2 checks). |
| `bad_signature_encoding` | reject | 1.2: a signature that is not 64 bytes. |
| `bad_card_signature` | reject | 3.2: the card self-signature does not verify. |
| `bad_card` | - | 3.2: a card with wrong shape (CBOR level). |
| `bad_person_secret` | reject | 3.1: a person secret of the wrong length. |
| `no_key` | wait | 4.1, 9: the group key for the record epoch is not held yet. |
| `bad_slot` | reject | 7.2: slot with wrong shape, zero lanes, or too little memory per lane. |
| `unknown_slot` | ignore | 7.1: unknown slot version or type; skipped. |
| `argon2_too_weak` | reject | 7.2: Argon2id parameters below the lower limits (memory, passes, lanes, memory per lane). |
| `argon2_too_strong` | reject | 7.2: Argon2id parameters above the upper limits; nothing is derived. |
| `ps_does_not_match_pid` | reject | 7: the secret a slot opens to does not derive the pid the slot is for. |
| `wrong_unlock_for_slot_type` | reject | 7: a password given to a kit or device slot, and so on. |
| `bad_unlock` | reject | 7: the unlock secret does not open the slot. |
| `bad_hpke` | reject | 6.3: HPKE open failed (wrong key, enc, aad or tag). |
| `bad_wrap` | reject | 6.3: a wrapped group key that does not open or does not match the commitment. |
| `bad_kit_prefix` | reject | 7.3: kit text does not start with the expected prefix. |
| `bad_kit_length` | reject | 7.3: kit text has the wrong number of characters (36 in nine groups). |
| `bad_kit_check` | reject | 7.3: the two check bytes do not match the kit. The four trailing zero bits are not tested (finding). |
| `bad_kit_character` | reject | 7.3: a character outside the kit alphabet after normalisation. |
| `chunk_count_mismatch` | reject | 5.2: number of chunks does not match the attachment descriptor. |
| `chunk_id_mismatch` | reject | 5.2: chunk id does not match its content. |
| `chunk_tag` | reject | 5.2: a chunk fails to authenticate. |
| `bad_chunk_size` | reject | 5.2: a chunk longer than 1,048,576 bytes, or a non-final chunk that is shorter. |
| `size_mismatch` | reject | 5.2: the opened total does not equal the stated size. |

CBOR decoder reasons (no disposition; the caller decides): `truncated`, `trailing_bytes`, `non_shortest`, `unsorted_keys`, `not_sorted`, `duplicate_key`, `indefinite_length`, `break`, `float`, `tag`, `simple_value`, `undefined`, `negative_integer`, `integer_out_of_range`, `invalid_utf8`, `reserved_additional_info`, `too_deep`, `malformed`, `unsupported_type`, `mixed_key_kinds`, `bad_key_type`, `missing_key`, `unknown_key`.

Chain reasons: `gap`, `prev_mismatch`.
Content statuses: `accepted`, `ignored:beyond_cut`, `ignored:mhead_not_on_chain`, `ignored:not_writer`, `ignored:not_manager`, `ignored:wrong_epoch`, `ignored:wrong_epoch_key`, `waits:mhead_unknown`.
Ignored-record reasons in a group view: `lost_fork`, `off_chain`, `unreached`.
Fork rule, the step that decided: `dropped_by_other_candidate` (step 1), `all_dropped_least` (step 1 dropped every candidate, so all are kept), `least_author_device_seq` (step 2). The note also names `decided_by`: `author`, `device`, `seq` or `record_id`.
Membership refusals (the reason a membership record is ignored): `commit_mismatch`, `previous_key_mismatch`, `wrong_epoch`, `not_a_member`, `not_membership`, `author_not_manager`, `author_not_manager_or_the_person`, `new_pid_is_member`, `raise_needs_new_epoch`, `lowering_needs_cut`, `cut_without_lowering`, `card_for_a_member`, `pid_for_a_non_member`, `genesis_epoch`, `genesis_seq`, `gid_mismatch`, `card_is_not_the_creators`, `duplicate_genesis`.
Rollback reasons (`remember.check`, section 4.4): `less` (a location offers a chain with a smaller last `seq` than remembered) and `different` (the record at a remembered `seq` is another record).
A group whose genesis `min_reader` is above the supported version 1 is reported as `unsupported` with an empty view.

## Numeric boundaries

`test/boundaries.test.ts` moves each limit in `src/limits.ts` one step each way and requires the named vectors to stop passing.
A boundary no vector notices is one an implementation can get wrong unnoticed.

| Boundary | Spec | Limit | Mutation: vectors that must fail |
|---|---|---|---|
| Padding: 256-byte steps up to | 4.2 | `paddingThreshold` | +256: `padding/length-4097`, `padding/record-4097` <br> -512: `padding/length-3840`, `padding/record-3840` |
| Padding: step of 256 | 4.2 | `paddingStep` | +1: `padding/length-1`, `padding/record-255` <br> -1: `padding/length-1`, `padding/record-256` |
| Padding: step of 4096 beyond that | 4.2 | `paddingBigStep` | +1: `padding/length-8192`, `padding/record-8192` <br> -1: `padding/length-8192`, `padding/record-8193` |
| Largest body, 1,048,576 bytes | 4.2 | `maxBody` | +1: `record/body-one-over`, `record/open/body-over-1mib` <br> -1: `record/largest-body` |
| Largest sealed record, 1,052,760 bytes (also the frame limit of 8.1) | 4.1, 8.1 | `maxSealed` | +1: `record/sealed-longer-than-largest`, `folder/frame-length-one-over-largest` <br> -1: `record/largest-body`, `record/sealed-exactly-largest-bad-body`, `folder/frame-length-exactly-largest-incomplete` |
| Hold back more than 10 minutes ahead | 4.5 | `holdBackMs` | +1: `clock/held-back/one-ms-over`, `group/held-back-one-ms-over` <br> -1: `clock/held-back/exactly-10-minutes`, `group/held-back-exactly-10-minutes` |
| Extension keys from 128 up (body and payload) | 2 | `extensionKey` | +1: `record/open/extension-key-128-in-body`, `record/open/extension-key-128-in-payload` <br> -1: `record/open/extension-key-127-in-body`, `record/open/extension-key-127-in-payload` |
| CBOR nesting of 16 levels | 2 | `maxDepth` | +1: `cbor/reject/depth-17-arrays`, `cbor/reject/depth-17-maps` <br> -1: `cbor/accept/depth-16-arrays`, `cbor/accept/depth-16-maps` |
| Argon2id at least 65,536 KiB | 7.2 | `argonMinMemory` | +1: `slot/argon2-at-minimum` <br> -1: `slot/argon2-memory-one-below-minimum` |
| Argon2id at least 2 passes | 7.2 | `argonMinPasses` | +1: `slot/argon2-at-minimum` <br> -1: `slot/argon2-passes-one-below-minimum` |
| Argon2id at least 1 lane | 7.2 | `argonMinLanes` | +1: `slot/argon2-at-minimum` <br> -1: `slot/argon2-lanes-zero` |
| Argon2id at least 8 KiB of memory per lane | 7.2 | `argonMinMemoryPerLane` | +1: `slot/argon2-memory-per-lane-at-minimum` <br> -1: `slot/argon2-memory-below-eight-per-lane` |
| Argon2id at most 1,048,576 KiB | 7.2 | `argonMaxMemory` | +1: `slot/argon2-memory-one-above-maximum`, `slot/argon2-test-switch-keeps-upper-limits` <br> -1: `slot/argon2-at-maximum-memory` |
| Argon2id at most 16 passes | 7.2 | `argonMaxPasses` | +1: `slot/argon2-passes-one-above-maximum` <br> -1: `slot/argon2-at-maximum-passes` |
| Argon2id at most 16 lanes | 7.2 | `argonMaxLanes` | +1: `slot/argon2-lanes-one-above-maximum` <br> -1: `slot/argon2-at-maximum-lanes` |
| Attachment chunk of 1,048,576 bytes | 5.2 | `chunkSize` | +1: `attachment/one-chunk-and-a-byte`, `attachment/last-chunk-too-long` <br> -1: `attachment/exactly-one-chunk`, `attachment/two-full-chunks` |
| Purge a deleted item after 30 days on the purging device's clock | 5.1 | `purgeAfterMs` | +1: `clock/purge-due/exactly-30-days` <br> -1: `clock/purge-due/one-ms-short` |

## Rules that are not numbers

`test/boundaries.test.ts` also flips each switch in `rules` (`src/limits.ts`) and requires the named vectors to stop passing.

| Rule | Spec | Mutation | Vectors that must fail |
|---|---|---|---|
| `deletedStrict` | 5.1 | `false`: "strictly later" read as "later or equal" for the deleted rule | `fold/delete-in-same-record-as-edit` |
| `tieBreak` | 6.5 | `"device,author,seq,record_id"`: device compared before author | `group/fork-2-author-before-device` |
| `tieBreak` | 6.5 | `"author,-device,seq,record_id"`: device order reversed | `group/fork-2-same-author-device-decides` |
| `tieBreak` | 6.5 | `"-author,device,seq,record_id"`: author order reversed | `group/fork-2-least-author` |
| `tieBreak` | 6.5 | `"author,device,-seq,record_id"`: seq order reversed | `group/fork-2-same-author-and-device-seq-decides` |
| `tieBreak` | 6.5 | `"author,device,seq"`: final record_id comparison dropped | `group/resolve-record-id-high-first` |
| `tieBreak` | 6.5 | `"author,device,seq,-record_id"`: record_id order reversed | `group/resolve-record-id-low-first`, `group/resolve-record-id-high-first` |
| `keepAllWhenAllDropped` | 6.5 | `false`: step 1 that drops every candidate keeps none | `group/fork-1-mutual-removal-keeps-all`, `group/fork-three-candidates-cycle` |
| `checkPreviousKey` | 6.3, 6.4 | `false`: K_(e-1) not checked against commit(e-1) | `group/previous-key-mismatch-epoch`, `group/previous-key-mismatch-remove`, `group/previous-key-mismatch-replace` |
| `checkSalt` | 4.1, 9 | `false`: salt not recomputed by the reader | `record/open/salt-does-not-match-body`, `record/open/moved-header-new-salt`, `group/chain-same-body-different-salt-is-rejected` |
| `checkScalarLessThanL` | 1.2 | `false`: S not required to be less than the group order | `signature/s-plus-l`, `signature/s-equals-l`, `signature/s-top-bit-set` |
| `checkKitCheckBytes` | 7.2 | `false`: kit check bytes not tested | `kit/parse-check-bytes-wrong-one-data-character`, `kit/parse-check-bytes-wrong-one-check-character` |

The final `record_id` comparison of the fork rule cannot arise through `evaluateGroup`: the same author, device and seq with different `record_id` is a chain fork, and neither record is accepted.
It is covered by the unit-level `group.resolve_membership` vectors named above.
`S < L` is distinguishable only through the `signature.verify` result, because Node rejects `S >= L` itself and returns the same code at record level.

## Regenerate the vectors

`node scripts/make-vectors.ts` (or `npm run vectors`) rewrites `vectors/`. The tests fail until the committed files match what it writes.
Hand-written expectations are compared with the library at generation time; the generator stops if they differ.
These are the CBOR encodings, padding lengths, clock order, many rejection codes, the status of each record and the final field values of the group scenarios, the fold cases and the checkpoint cases (`expectGroup` and `stateView` in `scripts/vec-common.ts`).

## Minted data

Node cannot supply the randomness of an ML-KEM encapsulation, so wraps and device slots use a fixed ML-KEM ciphertext from `scripts/minted.json` and a fixed X25519 ephemeral key.
`node scripts/make-vectors.ts --mint` replaces the two ML-KEM ciphertexts (the vectors then change).
`external_wrap`, `external_device_slot_ct` and `external_hpke_blob` were sealed by another implementation (Python `cryptography` 50, outside this repository) and are open-only vectors.
To renew them: `node scripts/make-vectors.ts --external-input > in.json`, seal each with Python (HPKE with aad needs the private `cryptography.hazmat.bindings._rust.openssl.hpke._encrypt_with_aad`, because the public API has no aad), write `{wrap, device_slot, generic}` as hex to a file, then `node scripts/make-vectors.ts --set-external file.json`.
The salt derivation and the kit check bytes were also recomputed in Python (`hashlib`, `hmac`) and agree with the library.

## Not covered

- The server protocol (8.2) and CloudKit (8.3), the item schema, invitations and device approval, the backup copy, limits (10).
- ML-KEM-768 encapsulation with chosen randomness (Node does not offer it).
- Independent X-Wing known-answer values: none are stated. HPKE has the RFC 9180 A.1.1 key-schedule KAT.
- Hostile file systems (symlinks, case folding, partial writes other than a truncated final frame, a crash between the `.tmp-` write and the rename).
- Nesting depth counts the outermost container as level 1 (spec draft 3 says so).
- The 1 GiB Argon2id vector is skipped unless `PSSS_HEAVY` is set.
- The final `record_id` fork comparison and the `S < L` check are covered only by the named vectors above, not by a numeric mutation.
- The four trailing zero bits of a kit text are not tested.
