# @psss/format

A reference implementation and test vectors for the Psss vault format, version 1, written against draft 5 of the spec (`docs/format-spec.md`, section 12 lists what each draft changed; the spec points here for which draft this package follows) and draft 3 of the item schema (`docs/format-schema.md`).
It is written from those two documents alone; where that document is silent, ambiguous or wrong, the code takes the most literal reading and says so in a comment that starts with a section number.
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
  - `fold.ts` folding item changes, `deleted`, history, checkpoints in parts, purge (sections 5.1, 5.3 and 5.4). `checkpointItems` takes a retention policy: a number (that many earlier writes of every field) or a function; the default is the schema's.
  - `fields.ts` the field names of the schema (fixed, repeated families, settings item) and the content-field predicate `isContentField` that `fold.ts` uses for the delete rule (schema 5).
  - `retention.ts` the schema's retention policy (schema section 4) and the Previous Passwords rules it shares with the reader. Clear Previous Passwords hides, of the writes of `password` before the winning write of `history_hidden`, all but the last. A checkpoint carries, for `password`, the winner, the write just before it, for each of the first 10 entries its own write and the write after it (which dates it), and the last write before `history_hidden` (the divider, which the table of draft 3 does not list: see the findings); every other field keeps its winner only.
  - `schema.ts` the item schema (`docs/format-schema.md`), pure (see "The item schema" below).
  - `remember.ts` what a device remembers of each chain and location, and the rollback check (section 4.4).
  - `group.ts` chains, membership, cuts, epochs started by remove and replace, the two-step fork rule, and the whole reader (`evaluateGroup`) with section 9 steps 4 and 5.
  - `slots.ts` wrapped group keys, the three slot types, the recovery kit text with check bytes, attachment chunks (sections 5.2 and 7).
  - `folder.ts` the folder layout: one new file per write, gathering, `.tmp-` files (section 8.1).
- `scripts/make-vectors.ts` (with `vec-*.ts`; `vec-schema.ts` writes `vectors/schema.json`) writes `vectors/*.json`. `scripts/minted.json` holds the few inputs that cannot be derived (see below).
- `test/` `node:test` suites: vectors (regenerate byte for byte, check each vector, coverage, error codes), known-answer tests for the primitives, folder tests, numeric-boundary mutation tests (`boundaries.test.ts`), and seeded property tests. `test/compute.ts` maps every vector type to its expected output (`test/compute-schema.ts` the `schema.*` types); `test/scenario.ts` builds deterministic groups; `test/schema.test.ts` holds the seeded property tests of the schema.
- `vectors/` the vectors, one JSON file per area. Every vector has `name`, `description`, `type`, `input` and `expected`; all byte strings are lowercase hex.

## Run

From the repository root: `scripts/test-format.sh`.
It finds Node 24 (the `node` on `PATH` if it is 24, otherwise the newest `~/.nvm/versions/node/v24.*`), and runs the tests; it exits non-zero on any failure.
The vector regeneration test takes about half a minute; the permutation property test about twenty seconds.
One vector derives Argon2id at 1 GiB and runs only with `PSSS_HEAVY=1`; the mutation tests run it with the Argon2id work skipped.

Current counts: 162 tests and 827 vectors (cbor 77, person 51, record 94, clock 19, fold 22, checkpoint 10, group 100, slots 88, wraps 18, chunks 21, folder 23, schema 304).

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
| `bad_kit_check` | reject | 7.2: the two check bytes do not match the kit. |
| `bad_kit_trailing_bits` | reject | 7.2 (draft 4): the last four bits of the 36 characters are not zero. Checked before the check bytes. |
| `bad_kit_character` | reject | 7.3: a character outside the kit alphabet after normalisation. |
| `chunk_count_mismatch` | reject | 5.2: number of chunks does not match the attachment descriptor. |
| `chunk_id_mismatch` | reject | 5.2: chunk id does not match its content. |
| `chunk_tag` | reject | 5.2: a chunk fails to authenticate. |
| `bad_chunk_size` | reject | 5.2: a chunk longer than 1,048,576 bytes, or a non-final chunk that is shorter. |
| `size_mismatch` | reject | 5.2: the opened total does not equal the stated size. |
| `bad_field_name` | - | schema 1: a writer was asked to write a name that is not a field name (not ASCII lowercase letters, digits, `_`, `/`, `-`; longer than 64 bytes; a repeated name whose id is not 16 lowercase hexadecimal digits; more than one `/`). A reader never refuses a name: it keeps the field and does not show it. |
| `bad_value` | - | schema 2, 3, 8: a writer was asked to write a value of the wrong shape for its field. A reader treats such a value as cleared and keeps it. |
| `text_too_long` | - | schema 1: a text of more than 65,536 bytes (writer). |
| `notes_too_long` | - | schema 1: notes of more than 262,144 bytes (writer). |
| `too_many_websites` | - | schema 1: a 65th website (writer). |
| `too_many_custom_fields` | - | schema 1: a 129th custom field (writer). |
| `too_many_attachments` | - | schema 1: a 65th attachment (writer). |
| `too_many_tags` | - | schema 1: a 65th tag (writer). |
| `bad_position` | - | schema 1: a position that is not text of `0-9a-z` that does not end in `0`, or a lower position that does not sort before the upper one. |
| `bad_id` | - | schema 1: an id that is not 8 bytes (`newId`). |
| `no_password` | - | schema 4: Clear Previous Passwords on an item with no current write of `password`. |

CBOR decoder reasons (no disposition; the caller decides): `truncated`, `trailing_bytes`, `non_shortest`, `unsorted_keys`, `not_sorted`, `duplicate_key`, `indefinite_length`, `break`, `float`, `tag`, `simple_value`, `undefined`, `negative_integer`, `integer_out_of_range`, `invalid_utf8`, `reserved_additional_info`, `too_deep`, `malformed`, `unsupported_type`, `mixed_key_kinds`, `bad_key_type`, `missing_key`, `unknown_key`.

Schema errors are raised by writers (`SchemaError`, `code` only). A reader of the schema never refuses anything.

Chain reasons: `gap`, `prev_mismatch`.
Content statuses: `accepted`, `ignored:beyond_cut`, `ignored:mhead_not_on_chain`, `ignored:not_writer`, `ignored:not_manager`, `ignored:wrong_epoch`, `ignored:wrong_epoch_key`, `waits:mhead_unknown`.
Ignored-record reasons in a group view: `lost_fork`, `off_chain`, `unreached`.
Fork rule, the step that decided: `dropped_by_other_candidate` (step 1), `all_dropped_least` (step 1 dropped every candidate, so all are kept), `least_author_device_seq` (step 2). The note also names `decided_by`: `author`, `device` or `seq` (draft 4 ends the tuple at `seq`).
Membership refusals (the reason a membership record is ignored): `commit_mismatch`, `wrong_header_epoch` (6.4: the header of a kind 3, 4 or 5 record does not name the epoch it starts), `new_key_repeats_an_earlier_key` (6.3, draft 5: `K_e` equals the key of any earlier epoch; renamed from `new_key_same_as_previous`), `previous_key_mismatch`, `wrong_epoch`, `not_a_member`, `not_membership`, `author_not_manager`, `author_not_manager_or_the_person`, `new_pid_is_member`, `raise_needs_new_epoch`, `lowering_needs_cut`, `cut_without_lowering`, `card_for_a_member`, `pid_for_a_non_member`, `genesis_epoch`, `genesis_seq`, `gid_mismatch`, `card_is_not_the_creators`, `duplicate_genesis`.
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
| Field name of at most 64 bytes (schema 1) | schema 1 | `nameBytes` | +1: `schema/name/fixed-65-bytes`, `schema/name/repeated-65-bytes`, `schema/build/field-name-65-bytes-refused` <br> -1: `schema/name/fixed-64-bytes`, `schema/name/repeated-64-bytes`, `schema/build/field-name-64-bytes-accepted` |
| Text value of at most 65,536 bytes (schema 1, writer) | schema 1 | `textBytes` | +1: `schema/build/title-65537-bytes-refused` <br> -1: `schema/build/title-65536-bytes-accepted` |
| Notes of at most 262,144 bytes (schema 1, writer) | schema 1 | `notesBytes` | +1: `schema/build/notes-262145-bytes-refused` <br> -1: `schema/build/notes-262144-bytes-accepted` |
| At most 64 websites (schema 1, writer) | schema 1 | `websites` | +1: `schema/build/websites-one-over-refused` <br> -1: `schema/build/websites-last-allowed-accepted` |
| At most 128 custom fields (schema 1, writer) | schema 1 | `customFields` | +1: `schema/build/custom-fields-one-over-refused` <br> -1: `schema/build/custom-fields-last-allowed-accepted` |
| At most 64 attachments (schema 1, writer) | schema 1 | `attachments` | +1: `schema/build/attachments-one-over-refused` <br> -1: `schema/build/attachments-last-allowed-accepted` |
| At most 64 tags (schema 1, writer) | schema 1 | `tags` | +1: `schema/build/tags-one-over-refused` <br> -1: `schema/build/tags-last-allowed-accepted` |
| A checkpoint keeps the writes of the first 10 previous passwords (schema 4) | schema 4 | `historyKept` | +1: `schema/password/checkpoint-keeps-ten-earlier-writes` <br> -1: `schema/password/checkpoint-keeps-ten-earlier-writes` |
| At most 10 previous passwords shown (schema 4) | schema 4 | `historyShown` | +1: `schema/password/twelve-changes-show-ten`, `schema/password/import-history-and-writes-limited-to-ten` <br> -1: `schema/password/twelve-changes-show-ten`, `schema/password/import-history-and-writes-limited-to-ten` |
| Verification code of 4 to 10 digits (schema 2) | schema 2 | `otpDigitsMin` | +1: `schema/shape/otp-digits-4` <br> -1: `schema/shape/otp-digits-3` |
| Verification code of 4 to 10 digits (schema 2), upper end | schema 2 | `otpDigitsMax` | +1: `schema/shape/otp-digits-11` <br> -1: `schema/shape/otp-digits-10` |
| Verification code period of 1 to 86,400 seconds (schema 2) | schema 2 | `otpPeriodMin` | +1: `schema/shape/otp-period-1` <br> -1: `schema/shape/otp-period-0` |
| Verification code period of 1 to 86,400 seconds (schema 2), upper end | schema 2 | `otpPeriodMax` | +1: `schema/shape/otp-period-86401` <br> -1: `schema/shape/otp-period-86400` |

## Rules that are not numbers

`test/boundaries.test.ts` also flips each switch in `rules` (`src/limits.ts`) and requires the named vectors to stop passing.

| Rule | Spec | Mutation | Vectors that must fail |
|---|---|---|---|
| `deletedStrict` | 5.1 | `false`: "strictly later" read as "later or equal" for the deleted rule | `fold/delete-in-same-record-as-edit` |
| `tieBreak` | 6.5 | `"device,author,seq"`: device compared before author | `group/fork-2-author-before-device` |
| `tieBreak` | 6.5 | `"author,-device,seq"`: device order reversed | `group/fork-2-same-author-device-decides` |
| `tieBreak` | 6.5 | `"-author,device,seq"`: author order reversed | `group/fork-2-least-author` |
| `tieBreak` | 6.5 | `"author,device,-seq"`: seq order reversed | `group/fork-2-same-author-and-device-seq-decides` |
| `keepAllWhenAllDropped` | 6.5 | `false`: step 1 that drops every candidate keeps none | `group/fork-1-mutual-removal-keeps-all`, `group/fork-three-candidates-cycle` |
| `checkPreviousKey` | 6.3, 6.4 | `false`: K_(e-1) not checked against commit(e-1) | `group/previous-key-mismatch-epoch`, `group/previous-key-mismatch-remove`, `group/previous-key-mismatch-replace` |
| `checkSalt` | 4.1, 9 | `false`: salt not recomputed by the reader | `record/open/salt-does-not-match-body`, `record/open/moved-header-new-salt`, `group/chain-same-body-different-salt-is-rejected` |
| `checkScalarLessThanL` | 1.2 | `false`: S not required to be less than the group order | `signature/s-plus-l`, `signature/s-equals-l`, `signature/s-top-bit-set` |
| `checkKitCheckBytes` | 7.2 | `false`: kit check bytes not tested | `kit/parse-check-bytes-wrong-one-data-character`, `kit/parse-check-bytes-wrong-one-check-character` |
| `checkKitTrailingBits` | 7.2 | `false`: the last four bits of the kit text not tested | `kit/parse-trailing-bit-1-set`, `kit/parse-trailing-bit-2-set`, `kit/parse-trailing-bit-4-set`, `kit/parse-trailing-bit-8-set`, `kit/parse-trailing-bits-all-set` |
| `checkHeaderEpoch` | 6.4 | `false`: the header of a record of kind 3, 4 or 5 not required to name the epoch it starts | `group/epoch-sealed-under-old-key-with-old-epoch-is-refused`, `group/remove-sealed-under-old-key-with-old-epoch-is-refused`, `group/replace-sealed-under-old-key-with-old-epoch-is-refused` |
| `saltBeforeSignature` | 4.1, 9 | `false`: the salt checked after the author and the signature | `record/open/order-salt-before-signature`, `record/open/order-salt-before-author`, `record/open/moved-header-new-salt` |
| `cutEndsBeforeNewEpoch` | 6.4 | `false`: the cut of a remove or replace record reaches the epoch it starts too | `group/removed-person-added-again-writes-at-once` |
| `setSameAuthor` | 5.3 | `false`: parts of a set not required to have one author | `group/checkpoint-set-parts-by-different-authors` |
| `setSameDevice` | 5.3 | `false`: parts of a set not required to have one device | `group/checkpoint-set-parts-on-different-devices` |
| `setSameParts` | 5.3 | `false`: parts of a set not required to agree on `parts` | `group/checkpoint-set-with-a-record-that-has-another-parts` |
| `setUniquePart` | 5.3 | `false`: two different records with one part not refused | `group/checkpoint-set-with-two-different-part-1-records` |
| `checkpointFieldHasWrite` | 5.3 | `false`: a checkpoint field with no writes accepted | `checkpoint/field-with-no-writes-is-malformed` |
| `newKeyDiffersFromEarlier` | 6.3 | `false`: a record that starts an epoch may repeat the key of an epoch before the previous one | `group/epoch-new-key-equal-to-the-key-two-epochs-back-is-refused`, `group/remove-new-key-equal-to-the-key-two-epochs-back-is-refused`, `group/replace-new-key-equal-to-the-key-two-epochs-back-is-refused` |
| `newKeyDiffers` | 6.3 | `false`: a record that starts an epoch may carry the previous key forward as the new one | `group/epoch-new-key-equal-to-the-previous-one-is-refused`, `group/remove-new-key-equal-to-the-previous-one-is-refused`, `group/replace-new-key-equal-to-the-previous-one-is-refused` |
| `kitTrailingBeforeCheck` | 7.2 | `false`: the kit check bytes tested before the trailing bits | `kit/parse-trailing-bits-and-check-bytes-both-wrong` |
| `answerNeedsPlace` | 5.4 | `false`: a purge request answered by a checkpoint that names the item at any place | `group/purge-request-checkpoint-purges-before` |
| `purgeUpToOwnPlace` | 5.4 | `false`: a purge request hides every write of the item, not only those up to its own place | `group/purge-request-then-a-later-write` |
| `wrongShapeIsCleared` | schema 1 | `false`: a value of the wrong shape used as it is | `schema/field/title/wrong-shape-is-cleared-and-kept`, `schema/field/username/wrong-shape-is-cleared-and-kept`, `schema/field/web/wrong-shape-is-cleared-and-kept` |
| `deletedUsesContentOnly` | schema 6 | `false`: any later field, not only a content field, brings a deleted item back | `schema/deleted/second-import-sets-source-stays-deleted`, `schema/deleted/history-hidden-later-stays-deleted`, `schema/deleted/unknown-fixed-field-later-stays-deleted` |
| `historyHiddenApplies` | schema 4 | `false`: history_hidden not applied | `schema/password/after-clear-previous-passwords`, `schema/password/checkpoint-after-clear-no-longer-carries-hidden-writes` |
| `previousUnique` | schema 4 | `false`: an earlier write equal to the current password or to a newer entry shown as a previous password | `schema/password/previous-must-differ`, `schema/password/entry-equal-to-a-newer-entry-is-left-out`, `schema/password/import-entry-equal-to-a-write-is-left-out` |
| `retentionKeepsNeighbours` | schema 4 | `false`: a checkpoint keeps only the writes of the entries, not the write that dates each nor the one just before the winner | `schema/password/checkpoint-keeps-the-write-that-dates-an-entry`, `schema/password/sequential-note-through-a-checkpoint-with-a-write-before-the-winner-that-is-no-entry` |
| `retentionKeepsDivider` | schema 4 | `false`: a checkpoint may drop the last write of password before the winning history_hidden, which divides hidden from shown | `schema/password/checkpoint-keeps-the-write-that-divides-hidden-from-shown` |
| `tagsUtf8Order` | schema 3 | `false`: tags ordered as JavaScript strings (UTF-16), not as UTF-8 bytes | `schema/tag/order-is-utf8-a-character-above-ffff-after-one-in-e000-to-ffff`, `schema/tag/order-is-utf8-three-characters` |
| `importedEditedKept` | schema 5 | `false`: Edited always the latest content write, never the imported edited date | `schema/dates/imported-untouched`, `schema/dates/imported-then-source-set-again` |
| `positionTiesByName` | schema 1 | `false`: equal positions shown in arrival order, not in order of field name | `schema/web/two-devices-add-offline-same-position`, `schema/web/same-position-three-entries-by-field-name` |

Draft 4 removed the `record_id` comparison from the fork rule: two candidates with the same author, device and seq would be a fork of one chain, and neither is accepted (`group/fork-2-same-author-device-seq-is-a-chain-fork`).
`S < L` is distinguishable only through the `signature.verify` result, because Node rejects `S >= L` itself and returns the same code at record level.

## The item schema

`src/schema.ts` implements `docs/format-schema.md` (draft 3) on top of the folded state of `fold.ts`.
It touches no file and holds no state.

- Names and shapes (sections 1 to 3, 8): `classifyName`, `shapeOk`, `validPosition`, `FIXED_FIELDS`, `REPEATED_FAMILIES`, `SETTINGS_FIELDS`, `goneId` (the first 8 bytes of SHA-256 of the deterministic CBOR array `[kind, id]`), `newId`, `SETTINGS_ITEM_ID`, `isContentField` (the explicit list of schema 5: `type`, `title`, `username`, `password`, `password_rules`, `otp`, `passkey`, `cardholder`, `card`, `card_code`, `card_pin`, `notes` and the families `web/`, `f/`, `a/`, `t/`).
  An `otp` has 4 to 10 digits and a period of 1 to 86,400 seconds; `history_hidden` is the number 1.
  Extra keys inside a value are kept and ignored; no `type` shows as a custom item; a `password_history` of more than 10 entries has the wrong shape.
- Positions: `positionBetween`, `positionAtEnd`.
- Writer: `ItemChange`, one method per field, producing the `set` and `clear` of a kind 16 payload (`changePayload`, `payload`); it refuses what a writer must not write (`SchemaError`), normalises names, labels, titles, notes, cardholder, file names and tags to NFC (not usernames) and never touches a secret.
  `password(value, over)` writes `password_over` in the same record: the place of the write the device saw as the current password, or `null` (the default).
  `restorePassword(value, over)`, `clearPreviousPasswords(view)` (sets `history_hidden` to 1 and clears `password_history`; refuses with `no_password` when there is no current write) and `historyHidden()` are the Previous Passwords writes.
  `website` puts `https://` in front of an address that does not contain `://`.
  `removeTag(view, text)` clears every field that holds the tag's text (compared as NFC) and nothing if there is none.
  `ItemChange.newItem(nowMs)` starts a record with `created` set.
- Reader: `viewItem(fields)` turns one item's folded state into what the app shows (type and fields, websites, custom fields, attachments and tags in order, previous passwords, the two-devices note, Added and Edited, deleted, moved) and `viewSettings` the settings item.
  A value of the wrong shape counts as cleared and is kept, as are unknown fields and names that are not field names; the view lists them (`invalid`, `unknown`, `carry`).
  Tags have no position and show in the bytewise order of their UTF-8.
  The two-devices note (`passwordNote`) is shown when the winning write's `password_over` is not the place of the write just before it among the writes in force; no note when `password_over` is absent, of the wrong shape, or from another record.
  Previous Passwords, newest first: of the writes of `password` before the winning `history_hidden` all but the last are left out; cleared writes and repeated values are not entries; an entry equal to the current password or to a newer entry is left out; each entry is dated by the write that replaced it; then `password_history` entries; at most 10 are shown.
  Added is `created`, or (no valid `created`) the wall time of the earliest write held, and `addedEstimated` says so: a reader treats an item without `created` as having an estimated Added that can only get later after a checkpoint.
  Edited is the latest content write, or `edited` when no content write is later; it is shown only when later than Added (`editedRaw` is the unhidden value, which a move writes).
- Moving (section 7): `moveRecords(view, fromGid, toGid, nowMs, target, reseal?)` gives the two payloads; `target` is the folded state of the item in the group it goes to (or null when that group holds none).
  The target record sets the content, unknown and wrong-shaped fields, `created` (Added), `edited`, `source`, `moved_from`, and `password_over`: the place of the winning `password` write in `target`, or `null`; it clears `moved`, every content field `target` has and the item does not, and `deleted` unless the item is in Recently Deleted (then it sets it); it does not carry `password_history` or `history_hidden`.
  The record in the group it leaves sets `moved`, naming the group it went to.
  `classifyInTwoGroups` recognises moved, move in progress and separate items by `moved_from`: complete when the other copy's `moved` names this group and is later than the `moved_from`, otherwise in progress, no link means separate, and for there-and-back the later `moved_from` decides.
- Retention (section 4): `schemaRetention`, the default policy of `checkpointItems`.
- Delete rule (section 6): `isDeleted(fields, isContent = isContentField)` in `fold.ts`.

What it does not do: sealing an attachment again on a move (it needs the chunks: `moveRecords` takes a `reseal` callback and does nothing else), the 30-day purge of a moved item (the count is the same as for a deleted one: from `moved`'s time), any file or record I/O, any user-interface wording.

Vectors (`vectors/schema.json`, 304), every expectation written by hand in `scripts/vec-schema.ts` (the generator stops if the library disagrees, and stops if any schema vector took its expectation from the library):
field shapes (each fixed and repeated field, accepted and one wrong shape, treated as cleared and kept; `otp` digits and period at both ends of the range), name rules on both sides, positions, every builder (with a hash or length of the payload worked out by an independent encoder in the generator), writer limits, websites added on two devices, ordering (tags as UTF-8, with a character in U+E000 to U+FFFF and one above U+FFFF), custom fields as one unit, a card reissued, previous passwords (twelve changes, through a checkpoint, after Clear Previous Passwords, from an import, after a restore, a stale device clearing later, a clearing that arrives after a checkpoint), the two-devices note (sequential changes, two devices from one base, a third change after both were seen, a restore, a write without `password_over`, and the same through a checkpoint), Added and Edited, deleting (an unknown fixed or repeated field after a delete leaves it deleted), unknown fields, moving (the list of schema 7, a deleted item, an item deleted then edited then moved, an imported item, an arrival that names the password the group holds, there and back with the password unchanged and changed, both with no note), the same `item_id` in two groups (complete, interrupted, there and back, separate), the settings item, and the reader showing what is over a limit.
Three vectors (`schema/sealed/*`, type `schema.sealed`) go from sealed records and a sealed checkpoint through the group reader (`evaluateGroup`) and the schema reader to the view, with the sealed bytes in the vector: two devices each adding a website, Previous Passwords across a checkpoint (read with every record and after the covered records were deleted), and a move to another group and back (sealed in both groups).
Where the schema leaves a choice, the description of the vector says which reading was taken.

`test/schema.test.ts` has the seeded property tests:
any permutation of schema-level changes (duplicates too) gives the same view, for items and for the settings item;
a checkpoint made at any point plus the remaining records (and a checkpoint on top of another) gives the same view as folding everything, previous passwords and the note included, except for these differences, each shown by its own test:
(1) Added, and so Edited as shown, when the item has no `created` (only winners of fields other than `password` are kept; Added can only get later);
(2) the date of a previous password can be later: a write that arrives after the checkpoint and lands inside a run of equal passwords replaces an entry, and the writes of that run the checkpoint left out are gone;
(3) the list from writes can be shorter: a later write that repeats an old entry (for example the old password typed again after the password was removed) takes it out of the list, and the entry beyond the first 10 that should take its place was not kept;
(4) a clearing that arrives after the checkpoint and sorts before a write the checkpoint dropped can leave older passwords shown that the records hide (the checkpoint can only keep the divider it knew of);
(5) a later write of `history_hidden` of the wrong shape, which counts as cleared, shows the hidden passwords again in the records and not through a checkpoint.
Nothing else differs: the entries a checkpoint shows are always the first entries of the full list (shorter by (3), longer by (4)), never other passwords, the note is always the same, and a clearing that is later in the order never shows a password an earlier one hid.
A full list of at most 10 entries from writes is the same after a checkpoint, except for (2), (4) and (5).
The property tests of (1) to (4) were also run over 3,000 seeds when this was written.
When the records after the checkpoint all come later in the order and nothing repeats an old entry, the view is exactly the full one.
Moves: the target record of `moveRecords` shows the item as it was, dates and source included, with no previous passwords and no note.

## Regenerate the vectors

`node scripts/make-vectors.ts` (or `npm run vectors`) rewrites `vectors/`. The tests fail until the committed files match what it writes.
Hand-written expectations are compared with the library at generation time; the generator stops if they differ.
These are the CBOR encodings, padding lengths, clock order, many rejection codes, the status of each record and the final field values of the group scenarios, the fold cases and the checkpoint cases (`expectGroup` and `stateView` in `scripts/vec-common.ts`).
Every fold, checkpoint and group vector states its outcome by hand (the status of each record, or the final field values, with the library asserted to agree), except the three vectors of unsupported or refused genesis records (`group/genesis-min-reader-2`, `group/genesis-min-reader-largest`, `group/genesis-min-reader-0-is-refused`), which assert by hand only that the group is unsupported or has no chain, because the specification does not say what an unsupported group shows beyond that it is neither read nor written.

## Minted data

Node cannot supply the randomness of an ML-KEM encapsulation, so wraps and device slots use a fixed ML-KEM ciphertext from `scripts/minted.json` and a fixed X25519 ephemeral key.
`node scripts/make-vectors.ts --mint` replaces the two ML-KEM ciphertexts (the vectors then change).
`external_wrap`, `external_device_slot_ct` and `external_hpke_blob` were sealed by another implementation (Python `cryptography` 50, outside this repository) and are open-only vectors.
To renew them: `node scripts/make-vectors.ts --external-input > in.json`, seal each with Python (HPKE with aad needs the private `cryptography.hazmat.bindings._rust.openssl.hpke._encrypt_with_aad`, because the public API has no aad), write `{wrap, device_slot, generic}` as hex to a file, then `node scripts/make-vectors.ts --set-external file.json`.
The salt derivation and the kit check bytes were also recomputed in Python (`hashlib`, `hmac`) and agree with the library.

## Not covered

- The server protocol (8.2) and CloudKit (8.3), the attachment re-sealing and purge of a moved item (schema 7), the KeePass mapping (schema 10), invitations and device approval, the backup copy, limits (10).
- ML-KEM-768 encapsulation with chosen randomness (Node does not offer it).
- Independent X-Wing known-answer values: none are stated. HPKE has the RFC 9180 A.1.1 key-schedule KAT.
- Hostile file systems (symlinks, case folding, partial writes other than a truncated final frame, a crash between the `.tmp-` write and the rename).
- Nesting depth counts the outermost container as level 1 (spec draft 3 says so).
- The 1 GiB Argon2id vector is skipped unless `PSSS_HEAVY` is set.
- The `S < L` check is covered only by the named vectors above, not by a numeric mutation.
- Which of the records of an incomplete checkpoint set a real device would show the person is not part of the format. The four conditions for a set (one author, one device, one `parts`, no part twice) each have their own rule mutation and vector.
