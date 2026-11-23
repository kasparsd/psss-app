# Psss vault format, version 1: byte-level specification

**Status: draft 2, 2026-11-23. Not reviewed, not implemented in the app.** The design and its reasons are in [vault format](format.md); this document says exactly what the bytes are, so that two people can implement it without talking to each other. Test vectors and a reference implementation for Node 24 are in `Packages/format/`. The draft assumes two decisions the owner has not confirmed: post-quantum key wrapping (yes) and reusing the age envelope (no). Everything is open to change until the independent review.

Draft 2 answers the 36 findings from the first independent implementation of draft 1; the [list of changes](#12-changes-from-draft-1) is at the end.

The words MUST, SHOULD and MAY are used as in RFC 2119. “Group” is the keyed unit with members; a person's vault is every group they belong to.

## 1. Primitives

Fixed for version 1. There is no negotiation and no algorithm field. A change of algorithm is a new format version.

| Purpose | Primitive |
| --- | --- |
| Hash | SHA-256 |
| Key derivation | HKDF-SHA256 (RFC 5869) |
| Record and slot encryption | ChaCha20-Poly1305 (RFC 8439), 32-byte key, 12-byte nonce, 16-byte tag |
| Signatures | Ed25519 (RFC 8032), with the checks of section 1.2 |
| Wrapping a key to a person or device | HPKE (RFC 9180), base mode, single-shot, with the X-Wing KEM of section 1.1 (KEM id `0x647a`), KDF HKDF-SHA256 (`0x0001`) and AEAD AES-256-GCM (`0x0002`) |
| Password hashing | Argon2id (RFC 9106), version `0x13`, with no secret and no associated data |
| Structured data | CBOR (RFC 8949) in the deterministic form of section 2 |

All integers written outside CBOR are unsigned and big-endian; `u32(x)` and `u64(x)` are 4 and 8 bytes. `||` is concatenation. A label such as `"psss/v1/record"` is its ASCII bytes with no terminator. `HKDF(ikm, salt, info)` always outputs 32 bytes.

### 1.1 X-Wing

X-Wing combines ML-KEM-768 (FIPS 203) with X25519 (RFC 7748), as in draft-connolly-cfrg-xwing-kem, revision 06 and later. Stated here in full so that this document does not depend on a draft:

```
private key   seed, 32 bytes
expanded    = SHAKE-256(seed, 96 bytes)
(pk_M, sk_M) = ML-KEM-768.KeyGen_internal(d = expanded[0..32], z = expanded[32..64])
sk_X        = expanded[64..96]              pk_X = X25519(sk_X, base point)
public key  = pk_M (1184 bytes) || pk_X (32 bytes)                          1216 bytes

encapsulate:  (ss_M, ct_M) = ML-KEM-768.Encaps(pk_M)     ek_X = 32 random bytes
              ct_X = X25519(ek_X, base point)            ss_X = X25519(ek_X, pk_X)
ciphertext  = ct_M (1088 bytes) || ct_X (32 bytes)                          1120 bytes
shared secret = SHA3-256(ss_M || ss_X || ct_X || pk_X || 5c 2e 2f 2f 5e 5c)   32 bytes
```

In HPKE the encapsulated key `enc` is the ciphertext, and `Nsecret` is 32. This is CryptoKit's `XWingMLKEM768X25519_SHA256_AES_GCM_256`, `MLKEM768X25519` in Go's `crypto/hpke` and `KEM.MLKEM768_X25519` in Python's `cryptography`.

### 1.2 Signature checks

A verifier MUST reject a signature whose `S` is not less than the group order, a signature or public key that is not a canonical encoding of a point, and a public key of small order. Without these rules two readers could disagree on whether a record is valid.

## 2. Deterministic CBOR

Signed and hashed structures are CBOR restricted as follows. A decoder MUST reject anything else.

- Types allowed: unsigned integer below 2^64, byte string, text string (valid UTF-8), array, map, `false`, `true`, `null`. No negative integers, floats, tags, indefinite lengths or `undefined`.
- Integers and lengths use the shortest encoding.
- Map keys are unsigned integers, or text strings where this document says so. Keys of one map are all of one kind, are unique, and are in ascending order.
- **Order** always means the bytewise order of the deterministic encodings. For text this puts shorter strings first. An array this document calls “sorted” is in strictly ascending order of its elements' encodings, so it has no duplicates; a reader MUST reject one that is not.
- Nesting is at most 16 levels deep.
- A map defined in this document MUST NOT carry keys it does not define, except where “open map” is stated.
- A writer SHOULD normalize text a person typed to Unicode NFC. A reader MUST NOT reject or change text that is not normalized: normal forms differ between Unicode versions, and two readers must not disagree.

## 3. Identities and keys

### 3.1 Person

A person is a 32-byte **person secret** `PS`, generated at random. From it:

```
sign_seed = HKDF(PS, salt = empty, info = "psss/v1/person/sign")     Ed25519 private seed
kem_seed  = HKDF(PS, salt = empty, info = "psss/v1/person/kem")      X-Wing private key
pid       = the Ed25519 public key (32 bytes)
kem_pk    = the X-Wing public key (1216 bytes)
```

Every device of a person holds `PS`. Records are signed with the person's key, not a device's: a device that holds `PS` could certify itself anyway, so a per-device signing key would add bytes and no security. A lost device is answered by replacing `PS` (section 6.4).

A **person card** tells others how to wrap keys to a person:

```
card = { 1: pid, 2: kem_pk, 3: sig }
sig  = Ed25519(sign_seed, "psss/v1/card" || pid || kem_pk)
```

### 3.2 Device

A device is a random 16-byte `device_id`. It labels a chain of records (section 4.4) and nothing else. A device that cannot be certain of the last sequence number it wrote, for example after being restored from a backup, or whose chain has forked, MUST take a new `device_id`.

A device that is let in by another device (slot type 3) has its own X-Wing key pair, generated at random and kept in the platform's key store. It is used for that slot only.

### 3.3 Group

```
gid = SHA-256("psss/v1/gid" || creator_pid || genesis_nonce || SHA-256("psss/v1/gid-key" || K_0))
```

`genesis_nonce` is 32 random bytes. A group has one 32-byte **group key** per **epoch**, generated at random. Epochs count from 0 and `K_e` is the key of epoch `e`. Binding `K_0` into the identifier means there is only one possible first key for a group.

```
commit(e) = SHA-256("psss/v1/key-commit" || gid || u32(e) || K_e)
```

## 4. Records

### 4.1 Sealed record

```
sealed = header || ciphertext
header = "PSR1" || gid (32) || u32(epoch) || salt (32)                72 bytes
rk         = HKDF(ikm = K_epoch, salt = salt, info = "psss/v1/record")
ciphertext = ChaCha20-Poly1305(key = rk, nonce = 12 zero bytes, aad = header, plaintext)
record_id  = SHA-256(sealed)
```

`salt` is 32 random bytes, so every record has its own key and the fixed nonce is never reused. A sealed record is at most 1,052,760 bytes, which is the header, the largest plaintext and the tag.

### 4.2 Plaintext and padding

```
plaintext = u32(len(body)) || body || zero bytes
n         = 4 + len(body)
size(n)   = 256 × ceil(n / 256)      when that is at most 4096
            4096 × ceil(n / 4096)    otherwise
```

The plaintext is exactly `size(n)` bytes, so a length that is already a multiple stays as it is. A reader MUST reject a record whose plaintext is not exactly `size(n)` bytes or whose padding is not all zero. `body` is at most 1,048,576 bytes.

### 4.3 Body

`body` is a deterministic CBOR map:

| Key | Name | Value |
| --- | --- | --- |
| 1 | `v` | `1` |
| 2 | `author` | `pid` of the signer, 32 bytes |
| 3 | `device` | `device_id`, 16 bytes |
| 4 | `seq` | Position in this chain, from 1 |
| 5 | `prev` | `record_id` of the record with `seq - 1` in this chain, or `null` when `seq` is 1 |
| 6 | `clock` | `[wall_ms, counter]` (section 4.5) |
| 7 | `kind` | Sections 5 and 6 |
| 8 | `payload` | A map defined by `kind` |
| 9 | `sig` | 64 bytes |
| 10 | `mhead` | `record_id` of the newest membership record the author had accepted when writing. Present in content records (kinds 16 and above), absent in membership records, which carry `mprev` instead. |

```
sig = Ed25519(author's sign_seed, "psss/v1/record-sig" || header || body_without_9)
```

`body_without_9` is the same map without key 9, in deterministic form. The signature covers the header, so a record cannot be moved to another group or epoch, and a member who holds the group key cannot alter or re-seal another member's record.

A body whose payload does not have the shape its `kind` requires is malformed. A `kind` this document does not define is not malformed: the record is kept, takes its place in its chain and has no other effect.

### 4.4 Chains

A chain is all records in one group with the same `author` and `device`. Within a chain `seq` increases by one and `prev` links each record to the one before.

- **The same record twice.** Two sealed records with the same body bytes are the same record, whatever their salts. A device MUST NOT seal a body twice. A reader that holds both uses either, and either `record_id` satisfies a `prev`.
- **A fork.** Two records with the same `author`, `device` and `seq` and different bodies fork the chain at that `seq`. A reader accepts the records before the fork, accepts neither of the two and nothing after them, and shows the fork to the person. The device takes a new `device_id` and writes its changes again. Storage that withholds one of the two can hide a fork from a reader; that reader converges when it receives the other.
- **A gap.** A reader accepts a record only when every earlier record of its chain is present or covered by a checkpoint (section 5.3). A record whose `prev` does not match the record it holds at `seq - 1` waits like one whose predecessor is missing. A gap means storage is behind, which is reported as “behind”, never as an error.

### 4.5 Clock and order

`wall_ms` is milliseconds since 1970-01-01 UTC.

- **Reading.** A reader MUST hold back a record whose `wall_ms` is more than 24 hours ahead of its own time. A held-back record is not accepted, and the rest of its chain waits behind it, until the reader's time catches up. It is shown to the person as held back.
- **Writing.** A device sets `wall_ms` to the larger of its own time and the largest `wall_ms` among the records it has accepted in this group, its own included. `counter` is 0 when that is larger than every accepted `wall_ms`, and otherwise one more than the largest accepted `counter` with that `wall_ms`. Because held-back records are never accepted, one wrong clock cannot drag every other device's clock forward by more than a day.

Records are ordered by the tuple `(wall_ms, counter, author, device, seq)`, compared element by element, byte strings bytewise. This order is total.

## 5. Content records

A content record is accepted when all of these hold; otherwise it is kept and ignored, and still takes its place in its chain:

- `mhead` is on the membership chain the reader has accepted (section 6.5);
- the author is a writer or manager as of `mhead`;
- the epoch in the header is the epoch as of `mhead`;
- the record is not beyond a cut (section 6.2).

An author whose record is ignored because `mhead` lost a fork writes the change again.

### 5.1 Item change, kind 16

```
payload = { 1: item_id (16 random bytes), 2: set, 3: clear }
set     = open map: field name (text) → value          may be empty
clear   = sorted array of field names                    may be empty
```

A field name MUST NOT be in both. A value is any CBOR allowed by section 2 and is opaque to merging: a field is the unit that wins or loses whole. Things that must never be half-merged are therefore one field with a map as its value: a passkey, a verification code's secret with its settings, a card number with its expiry. Field names and their values are defined by the item schema, which is a separate document and not part of this draft.

**State.** Each record that sets or clears a field is a **write** of that field, with the record's place in the order of section 4.5. For each item and field, the current value is that of the greatest accepted write. Writes that lost are history. Folding the same set of records in any order gives the same state, and folding a record twice changes nothing.

**Deleting.** The reserved field `deleted` holds an unsigned integer, the time of deletion in milliseconds, which is shown to the person and plays no part in merging. An item is in Recently Deleted when `deleted` is set and no other field of the item has a winning write that is strictly later than the winning write of `deleted`. A later set or clear of any other field therefore brings the item back, which is the rule that an edit beats a delete. Clearing `deleted` restores the item.

### 5.2 Attachments

A field value may refer to an attachment: `{ 1: key (32 random bytes), 2: size, 3: [chunk_id, …] }`. Every chunk but the last holds exactly 1,048,576 bytes of the file.

```
sealed chunk = ChaCha20-Poly1305(key, nonce = u32(0) || u64(index), aad = "psss/v1/chunk" || u64(size) || u32(number of chunks), data)
chunk_id     = SHA-256(sealed chunk)
```

`key` MUST be new for every attachment and every changed version of one; reusing it with different data would reuse a nonce. A reader MUST check that the chunk lengths add up to `size`. Chunks are stored by id beside the records and fetched when the attachment is opened.

### 5.3 Checkpoint, kind 32

```
payload = { 1: covered, 2: items, 3: purged }
covered = sorted array of [author, device, seq, record_id]            the last record covered in each chain
items   = sorted array of [item_id, { field name → write }]
write   = [1, [wall_ms, counter, author, device, seq], value]         a field that is set
          [0, [wall_ms, counter, author, device, seq]]                a field that is cleared
purged  = sorted array of [item_id, [wall_ms, counter, author, device, seq]]
```

A checkpoint restates writes. Each entry of `items` is folded exactly as the write it names, with the same place in the order, so a checkpoint, any number of overlapping checkpoints and the records themselves all fold to the same state in any order. A reader that still holds covered records goes on folding them, and SHOULD show the person any covered record that disagrees with a checkpoint.

- **Who.** The author MUST be a manager as of `mhead`.
- **Chains.** For a chain named in `covered`, records up to that `seq` count as present, so a reader that never received them can continue the chain from the next one. Where checkpoints overlap, the greatest `seq` per chain applies.
- **Removing records.** Content records covered by an accepted checkpoint MAY be deleted from every location. Membership records are never deleted.
- **Permanent delete.** `purged` names items whose writes up to the given place in the order are to be forgotten. A reader drops those writes from its state and deletes the records that hold them. This is the only way a secret is removed for good.

## 6. Membership records

Membership records form one chain per group, separate from the device chains: each carries `mprev`, the `record_id` of the membership record before it. Roles are `0` removed, `1` reader, `2` writer, `3` manager. A membership record other than an epoch record is sealed under the epoch as of its `mprev`.

### 6.1 Genesis, kind 1

```
payload = { 1: genesis_nonce, 2: card of the creator, 3: commit(0) }
```

The first record of a group: epoch 0, `seq` 1, no `mprev`. The creator is a manager. A reader MUST check that the card's `pid` is `author`, that `gid` in the header equals the derivation in section 3.3 from `author`, `genesis_nonce` and the `K_0` it holds, and that the commitment matches. If a reader holds more than one valid genesis for a `gid`, it uses the one with the smallest `record_id`; they can differ only in the creator's own card and clock.

### 6.2 Member, kind 2

```
payload = { 1: mprev, 2: card or pid, 3: role, 4: cut }
cut     = sorted array of [device, seq]
```

Adds a person, changes a role or removes a person. The author MUST be a manager as of `mprev`.

- Key 2 is a card when the person is not a member as of `mprev` (never added, or removed), and a `pid` otherwise. Role 0 for a person who is not a member is invalid.
- Key 4 is present when the role is lowered and absent otherwise. It lists the last record the author accepted in each of that person's chains. Content records of that person beyond the cut, and all of their records in chains the cut does not list, are ignored if they are sealed in the epoch of the member record or an earlier one. This stops a person who was removed or lowered, and who still holds old keys, from writing into the past, also from a device no one has seen.
- Raising a person's role after it was lowered needs a new epoch first, so that their new records are sealed in an epoch the cut does not reach.

### 6.3 Epoch, kind 3

```
payload = { 1: mprev, 2: e, 3: commit(e), 4: K_(e-1) }
```

Starts epoch `e`, which MUST be one more than the epoch as of `mprev`. The author MUST be a manager as of `mprev`. The record is sealed under `K_e` and carries the previous key, so a member who can read epoch `e` can read everything before it. A reader MUST check `K_(e-1)` against `commit(e-1)`.

A removal (section 6.2 with role 0) or a replacement (section 6.4) takes effect at once and leaves the group **waiting for a new key**: until an epoch record follows it on the chain, devices MUST NOT seal new content records. The author of the removal SHOULD write the epoch record immediately, and any manager MAY.

### 6.4 Replacing a person's secret, kind 4

```
payload = { 1: mprev, 2: old pid, 3: new card, 4: cut }
```

Written by a manager, or by the person themselves signed with the old key. The new `pid` MUST NOT already be a member and takes the old one's role. `cut` applies to the old `pid` as in section 6.2. The group then waits for a new key (section 6.3). Whoever holds a person's secret is that person as far as this format can tell: if a thief replaces the secret first, a manager removes the thief's `pid` and adds the person again.

### 6.5 Validity and forks

A reader verifies the chain from genesis: each record's author holds the needed role as of its `mprev`, and each epoch record's commitment matches the key the reader unwrapped.

When two or more valid membership records name the same `mprev`, exactly one continues the chain. In order:

1. If `mprev` is a removal or replacement and one candidate is an epoch record by the author of `mprev`, it wins.
2. Otherwise drop every candidate whose author is removed, lowered or replaced by another candidate. If that drops them all, keep them all.
3. Of those left, the one that is least by `(author, device, seq, record_id)` wins.

The other candidates and everything after them on their branches are ignored. Their authors write them again on the winning chain if they are still allowed to. The tie-break does not depend on anything an author can vary freely, so it cannot be won by trying salts. Two different keys may exist for one epoch number after a fork; only the key committed by the winning epoch record is that epoch's key, and a content record sealed under the other is ignored.

### 6.6 How state is computed

State is a function of the set of records a reader holds, not of the order they arrived in. A reader computes it as a fixed point: starting from genesis, it repeats (a) extend the membership chain with records whose own device chains are complete, (b) accept checkpoints, which may complete further chains, (c) accept content records, until nothing changes. A record that cannot be judged yet waits and is judged again when more records arrive.

## 7. Wrapped keys

### 7.1 A group key wrapped to a member

```
info = "psss/v1/group-key" || gid || u32(e) || recipient_pid
wrap = HPKE.SealBase(recipient kem_pk, info, aad = empty, plaintext = K_e)      enc (1120 bytes) || ciphertext (48 bytes)
```

A wrap is not signed. The reader trusts `K_e` only after it opens the epoch record (or genesis) for `e` and the commitment there matches. Because anyone who can write to a location can leave a wrap for anyone, a location may hold several for one person and epoch: the reader tries each and uses the one that passes that check. Storage that adds or withholds wraps can deny access and cannot make a member use a key of its choosing.

### 7.2 Slots: the person secret wrapped to an unlock secret

A slot is a deterministic CBOR map `{ 1: 1, 2: type, 3: pid, 4: slot_id (16 random bytes), 5: params, 6: ciphertext }`. `aad` below is the same map without key 6. A reader ignores a slot whose version or type it does not know.

| Type | Unlock secret | `params` | `ciphertext` |
| --- | --- | --- | --- |
| 1 | Vault password | `{ 1: salt (16 bytes), 2: memory in KiB, 3: passes, 4: lanes }` | `kek = Argon2id(password, salt, params, 32 bytes)`, then `ChaCha20-Poly1305(HKDF(kek, salt = slot_id, info = "psss/v1/slot/password"), 12 zero bytes, aad, PS)` |
| 2 | Recovery kit | `{}` | `ChaCha20-Poly1305(HKDF(kit, salt = slot_id, info = "psss/v1/slot/kit"), 12 zero bytes, aad, PS)` |
| 3 | Another device | `{ 1: device kem_pk }` | `HPKE.SealBase(device kem_pk, info = "psss/v1/slot/device" || pid || slot_id, aad, PS)` |

- **Every slot.** After opening a slot a reader MUST check that the `PS` inside derives the slot's `pid`. Slots are not signed, and anyone who knows a device's public key can make one.
- **Password.** The password is the UTF-8 bytes of what the person typed, normalized to NFC by the device. Argon2id defaults are 131,072 KiB (128 MiB), 3 passes, 4 lanes. A reader MUST refuse less than 65,536 KiB or fewer than 2 passes, and MUST refuse more than 1,048,576 KiB, 16 passes or 16 lanes, since a slot comes from storage and could otherwise demand unbounded work. An implementation MAY offer an explicit test-only switch that lifts the lower bounds for the published vectors. The AutoFill extension never opens a password slot.
- **Recovery kit.** 20 random bytes, shown as `RK1-` followed by its 32 characters in Crockford base32 in groups of four separated by hyphens. When reading one, case, hyphens and spaces are ignored, `I` and `L` read as `1`, and `O` reads as `0`.
- **iCloud Keychain.** On Apple devices `PS` is by default also kept as an item in iCloud Keychain. That is a matter for the platform, not a slot, and is not part of this format.

## 8. Storage

A location stores opaque objects. It needs three operations: list what is new, get, and put if absent. Nothing a location does requires it to understand a record.

### 8.1 Folder

```
Personal.psss/
  psss.json                                          {"format":"psss-vault","version":1}
  people/<pid>/slots/<slot_id>.slot                  the CBOR map of section 7.2
  groups/<gid>/keys/<epoch>/<pid>-<name>.key         the 1168 bytes of section 7.1
  groups/<gid>/log/<pid>-<device>/<first seq>.seg    content records
  groups/<gid>/log/<pid>-<device>/<first seq>.mseg   membership records
  groups/<gid>/blobs/<first 2 hex digits>/<chunk_id>
```

- Identifiers are lowercase hexadecimal. The epoch is decimal. `<first seq>` is ten decimal digits, so a chain holds fewer than 10^10 records. `<name>` is 8 random bytes in hexadecimal, so two wraps never share a path. `psss.json` is read as JSON; a writer produces exactly the bytes shown and a line feed.
- A segment is a sequence of frames, `u32(len(sealed)) || sealed`, holding consecutive records of one chain in ascending `seq`. Names are a convenience: a reader takes `author`, `device` and `seq` from the records. A reader MUST stop reading a segment at a frame longer than the largest sealed record or out of sequence, and MUST ignore an incomplete final frame, which is an upload in progress.
- Only the device that owns a chain writes its segments. It appends to the newest and starts a new one when the newest has reached 65,536 bytes, after which the old one never changes.
- A membership record is written alone in a segment named `.mseg`, and the device starts a new `.seg` for what follows. A `.seg` whose records are all covered by an accepted checkpoint MAY be deleted whole; an `.mseg` never is.
- Because no file has two writers, a file-sync service has nothing to conflict on. Slots and wraps are written once and never changed.

### 8.2 Server

Paths are relative to a base address; requests carry a bearer credential that is outside this format.

- `GET /v1/groups/<gid>/records?after=<cursor>` returns record ids in the order the server received them, and a new cursor.
- `GET /v1/groups/<gid>/records/<record_id>` returns the sealed record.
- `PUT /v1/groups/<gid>/records/<record_id>` stores it. The server MUST check that the id is the SHA-256 of the body and that the body is no longer than the largest sealed record, and answers success if it already has it.

Wraps, slots and chunks use the same three operations under `keys/`, `slots/` and `blobs/`. A server never deletes on a client's request except for records covered by a checkpoint, which it cannot verify and so MAY refuse.

### 8.3 CloudKit

One zone per group and one database record per sealed record, named by `record_id`, with the wraps beside them; a shared group is that zone with a `CKShare`. The exact record types and fields are set by the sync spike and are not yet part of this draft.

## 9. What a reader does with a sealed record

1. **Can it be opened yet?** The header's magic is checked; a wrong one is discarded. A record for a `gid` or an epoch the reader has no key for **waits**: the key may arrive later.
2. **Is it well formed?** The AEAD tag, the padding, the deterministic form of the body, the payload's shape for a known `kind`, `author`, and the signature over header and body. A record that fails any of these is **discarded**; it can never become valid.
3. **Does its chain reach it?** `seq`, `prev`, no fork, no gap, not held back for its clock. Otherwise it **waits**.
4. **Is it allowed?** For membership records, section 6.5. For content records, the rules at the head of section 5. Otherwise it is **kept and ignored**, and still takes its place in its chain.

A discarded record leaves a gap in its author's chain, which that device repairs by taking a new `device_id`.

## 10. Not yet specified

- The item schema: field names and value shapes for logins, cards, notes, passkeys and verification codes, and how an item moves between groups.
- The invitation and device approval exchanges (the code and the confirmation words in the approved mocks).
- The backup copy file and the KeePass export mapping.
- CloudKit record types (section 8.3).
- Limits: the largest group, how often to checkpoint, how long a fork or a held-back record is shown, and when unused chunks are removed.

## 11. Known weaknesses to put to the reviewer

- The fork rule for membership (section 6.5) is new and is the part most likely to be wrong. Its last tie-break favours whichever manager has the smaller `pid`, always.
- A checkpoint is trusted on a manager's signature. A reader that no longer holds the covered records cannot check it, so a manager can drop another member's changes for readers who never saw them, and `purged` lets a manager remove any item's history.
- Storage can withhold the newest records of any chain, or one side of a fork. A reader can only say “behind”.
- A removed person keeps every key up to their removal and everything they read. A thief who holds a person's secret is that person until a manager removes them.
- ChaCha20-Poly1305 does not commit to its key. The signature inside each record is what binds it; no attack is known, and a reviewer should confirm none follows from two keys existing for one epoch number after a fork.
- A person card proves who signed it, not that its `kem_pk` works. A wrong one harms only its owner.
- File and folder names in a folder location show person and device identifiers, the number of records and when they were written.
- X-Wing comes from an Internet-Draft, and the only independent evidence that the reference implementation is right is that it agrees with Python's `cryptography` in both directions. CryptoKit and Go must be shown to agree on the vectors before anything depends on them. The signature checks of section 1.2 must likewise be shown to hold in each platform's library.

## 12. Changes from draft 1

From the findings of the first independent implementation:

- **Primitives.** X-Wing is written out in full (1.1). Signature checks are stated (1.2). Argon2id has no secret or associated data and has upper limits (7.2).
- **CBOR.** “Sorted” is defined, nesting and integer range are limited, and text is never rejected or changed for its normal form (2).
- **Group identifier** binds the first key, which removes the question of two different first records (3.3, 6.1).
- **Padding** is a formula with a stated boundary, and a largest sealed record is stated (4.1, 4.2).
- **`mhead`** is added to content records, so a record's author, role and epoch are judged at a stated point instead of “at some point in its epoch” (4.3, 5).
- **Chains.** The same body sealed twice is one record, a mismatched `prev` waits, and a fork has a way out (4.4).
- **Clock.** Holding back a record from the future is required, and what counts as “seen” is defined (4.5).
- **Deleting.** The value of `deleted` is typed and plays no part in merging, and “later” is strict (5.1).
- **Attachments.** The key is new per version and the chunk count and size are bound (5.2).
- **Checkpoints** restate writes, so set-to-`null` and cleared differ, overlapping checkpoints merge, and a reader that holds covered records keeps folding them. Permanent delete is explicit (5.3).
- **Membership.** Who may write an epoch record, what a group does while it waits for one, when a card or a `pid` is used, what a cut covers and for how long, and replacement with a cut (6.2 to 6.4).
- **Fork rule** covers three or more candidates, mutual removal and the race between an epoch record and an addition, and can no longer be won by trying salts (6.5).
- **Evaluation** is a fixed point over the records held (6.6), and a record with no key yet waits instead of being discarded (9).
- **Folder.** Wraps have unique names, file contents are stated, membership records sit in their own segments so covered segments can be deleted whole, and a bad frame length cannot swallow a segment (8.1).
- **Slots.** The secret inside is checked against the slot's `pid`, the recovery kit's printed form is fully stated, and the device key is defined (3.2, 7.2).
