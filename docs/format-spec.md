# Psss vault format, version 1: byte-level specification

**Status: draft 1, 2026-11-23. Not reviewed, not implemented in the app.** The design and its reasons are in [vault format](format.md); this document says exactly what the bytes are, so that two people can implement it without talking to each other. Test vectors and a reference implementation are in `Tests/Format/`. The draft assumes two decisions the owner has not confirmed: post-quantum key wrapping (yes) and reusing the age envelope (no). Everything is open to change until the independent review.

The words MUST, SHOULD and MAY are used as in RFC 2119. “Group” is the keyed unit with members; a person's vault is every group they belong to.

## 1. Primitives

Fixed for version 1. There is no negotiation and no algorithm field. A change of algorithm is a new format version.

| Purpose | Primitive |
| --- | --- |
| Hash | SHA-256 |
| Key derivation | HKDF-SHA256 (RFC 5869) |
| Record and slot encryption | ChaCha20-Poly1305 (RFC 8439), 32-byte key, 12-byte nonce, 16-byte tag |
| Signatures | Ed25519 (RFC 8032) |
| Wrapping a key to a person or device | HPKE (RFC 9180), base mode, single-shot, with KEM X-Wing (ML-KEM-768 with X25519, KEM id `0x647a`), KDF HKDF-SHA256 (`0x0001`) and AEAD AES-256-GCM (`0x0002`). This is CryptoKit's `XWingMLKEM768X25519_SHA256_AES_GCM_256` and `KEM.MLKEM768_X25519` in Python's `cryptography`. |
| Password hashing | Argon2id (RFC 9106), version `0x13` |
| Structured data | CBOR (RFC 8949) in the deterministic form of section 2 |

All integers written outside CBOR are unsigned and big-endian. `||` is concatenation. A label such as `"psss/v1/record"` is its ASCII bytes with no terminator. `HKDF(ikm, salt, info)` always outputs 32 bytes.

## 2. Deterministic CBOR

Signed and hashed structures are CBOR restricted as follows. A decoder MUST reject anything else.

- Types allowed: unsigned integer, byte string, text string (UTF-8, NFC), array, map, `false`, `true`, `null`. No negative integers, floats, tags, indefinite lengths or `undefined`.
- Integers and lengths use the shortest encoding.
- Map keys are unsigned integers, or text strings where this document says so. Keys of one map are all of one kind, are unique, and are sorted by the bytewise order of their encodings.
- A map defined in this document MUST NOT carry keys it does not define, except where “open map” is stated.

## 3. Identities and keys

### 3.1 Person

A person is a 32-byte **person secret** `PS`, generated at random. From it:

```
sign_seed = HKDF(PS, salt = empty, info = "psss/v1/person/sign")     Ed25519 private seed
kem_seed  = HKDF(PS, salt = empty, info = "psss/v1/person/kem")      X-Wing private key (32-byte seed)
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

A device is a random 16-byte `device_id`. It labels a chain of records (section 4.4) and nothing else. A device that cannot be certain of the last sequence number it wrote, for example after being restored from a backup, MUST take a new `device_id`.

### 3.3 Group

```
gid = SHA-256("psss/v1/gid" || creator_pid || genesis_nonce)        genesis_nonce: 32 random bytes
```

A group has one 32-byte **group key** per **epoch**. Epochs count from 0. `K_e` is the key of epoch `e`, generated at random.

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

`salt` is 32 random bytes, so every record has its own key and the fixed nonce is never reused.

### 4.2 Plaintext and padding

```
plaintext = u32(len(body)) || body || zero bytes
```

The plaintext is padded with zero bytes to the next multiple of 256 bytes when that is at most 4096, and otherwise to the next multiple of 4096. A reader MUST reject a record whose padding is not all zero or whose length is not a permitted size. `body` is at most 1 MiB.

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
| 7 | `kind` | Section 5 and 6 |
| 8 | `payload` | A map defined by `kind` |
| 9 | `sig` | 64 bytes |

```
sig = Ed25519(author's sign_seed, "psss/v1/record-sig" || header || body_without_9)
```

`body_without_9` is the same map without key 9, in deterministic form. The signature covers the header, so a record cannot be moved to another group or epoch, and a member who holds the group key cannot alter or re-seal another member's record.

### 4.4 Chains

A chain is all records in one group with the same `author` and `device`. Within a chain `seq` increases by one and `prev` links each record to the one before. A reader that holds two different records with the same `author`, `device` and `seq` MUST treat the chain as forked: it keeps both for display to the person, accepts neither into state, and accepts nothing later in that chain.

A reader accepts a record into state only when every earlier record of its chain is present or covered by a checkpoint (section 5.3). A gap means storage is behind, which is reported as “behind”, never as an error.

### 4.5 Clock and order

`wall_ms` is milliseconds since 1970-01-01 UTC. When writing, a device sets `wall_ms` to the larger of its own time and the largest `wall_ms` it has accepted in this group; `counter` is one more than the largest counter it has seen for that `wall_ms`, or 0.

Records are ordered by the tuple `(wall_ms, counter, author, device, seq)`, compared element by element, byte strings bytewise. This order is total. A reader SHOULD hold back, and show to the person, a record whose `wall_ms` is more than 24 hours ahead of its own time.

## 5. Content records

### 5.1 Item change, kind 16

```
payload = { 1: item_id (16 random bytes), 2: set, 3: clear }
set     = open map: field name (text) → value          may be empty
clear   = array of field names, sorted, unique          may be empty
```

A field name MUST NOT be in both. A value is any CBOR allowed by section 2 and is opaque to merging: a field is the unit that wins or loses whole. Things that must never be half-merged are therefore one field with a map as its value: a passkey, a verification code's secret with its settings, a card number with its expiry. Field names and their values are defined by the item schema, which is a separate document and not part of this draft.

**State.** For each item and field, the current value is the one set or cleared by the accepted record that is greatest in the order of section 4.5. Values that lost are history. Folding the same set of records in any order gives the same state, and folding a record twice changes nothing.

**Deleting.** The reserved field `deleted` holds the `wall_ms` of the deletion. An item is in Recently Deleted when `deleted` is set and no other field of the item was set or cleared by a record later in the order. An edit that is later than a delete therefore brings the item back, which is the rule that an edit beats a delete.

### 5.2 Attachments

A field value may refer to an attachment: `{ 1: key (32 random bytes), 2: size, 3: [chunk_id, …] }`. A chunk is at most 1 MiB of the file, sealed as `ChaCha20-Poly1305(key, nonce = u96(chunk index), aad = "psss/v1/chunk", data)`, and `chunk_id = SHA-256(sealed chunk)`. Chunks are stored by id beside the records and fetched when the attachment is opened.

### 5.3 Checkpoint, kind 32

```
payload = { 1: covered, 2: mhead, 3: items }
covered = array of [author, device, seq, record_id], sorted         the last record covered in each chain
mhead   = record_id of the newest membership record included
items   = array of [item_id, { field name → [value_or_null, [wall_ms, counter, author, device, seq]] }], sorted by item_id
```

A checkpoint states the folded state of everything it covers, with the winning clock of each field, so later records still merge correctly. `null` records a cleared field. Only a manager may write a checkpoint. After a reader accepts one, the content records it covers MAY be deleted from every location; membership records are never deleted. This is how a permanent delete removes a secret and how the log stays small. A reader that still holds covered records SHOULD check them against the checkpoint and show a mismatch to the person.

## 6. Membership records

Membership records form one chain per group, separate from the device chains: each carries `mprev`, the `record_id` of the membership record before it. Roles are `0` removed, `1` reader, `2` writer, `3` manager.

### 6.1 Genesis, kind 1

```
payload = { 1: genesis_nonce, 2: card of the creator, 3: commit(0) }
```

The first record of a group: epoch 0, `seq` 1, no `mprev`. The creator is a manager. A reader MUST check that `gid` in the header equals the derivation in section 3.3 from `author` and `genesis_nonce`.

### 6.2 Member, kind 2

```
payload = { 1: mprev, 2: card or pid, 3: role, 4: cut }
cut     = array of [device, seq], sorted                             present only when the role is lowered
```

Adds a person (with their card), changes a role, or removes a person (with their `pid` and role 0). The author MUST be a manager at `mprev`. When a role is lowered, `cut` lists the last record the author accepted in each of that person's chains; readers ignore that person's content records beyond the cut. This stops a removed person, who still holds old keys, from writing into the past.

### 6.3 Epoch, kind 3

```
payload = { 1: mprev, 2: e, 3: commit(e), 4: K_(e-1) }
```

Starts epoch `e`. It is sealed under `K_e` and carries the previous key, so a member who can read epoch `e` can read everything before it. A record that removes a person MUST be followed in the chain by an epoch record from the same author. Lowering a writer to a reader needs no new epoch, since a reader may still read. Writers MUST seal new records under the newest epoch they have accepted.

### 6.4 Replacing a person's secret, kind 4

```
payload = { 1: mprev, 2: old pid, 3: new card }
```

Written by a manager, or by the person themselves signed with the old key. The new `pid` takes the old one's role. It MUST be followed by an epoch record, since the old secret could read the current key.

### 6.5 Validity and forks

A reader verifies the chain from genesis: each record's author holds the needed role as of its `mprev`, and each epoch record's commitment matches the key the reader unwrapped. A content record is accepted when its author was a writer or manager at some point in its epoch and it is not beyond a cut.

When two membership records name the same `mprev`, exactly one continues the chain: if one of them removes or lowers the author of the other, it wins; otherwise the one with the smaller `record_id` wins. The other record and everything after it on that branch is ignored, and its author's device writes it again on the winning chain if it is still allowed to.

## 7. Wrapped keys

### 7.1 A group key wrapped to a member

```
info = "psss/v1/group-key" || gid || u32(e) || recipient_pid
wrap = HPKE.SealBase(recipient kem_pk, info, aad = empty, plaintext = K_e)      enc (1120 bytes) || ciphertext (48 bytes)
```

A wrap is not signed. The reader trusts `K_e` only after it opens the epoch record (or genesis) for `e` and the commitment there matches. Storage that substitutes a wrap can deny access and cannot make a member use a key of its choosing.

### 7.2 Slots: the person secret wrapped to an unlock secret

A slot is a deterministic CBOR map `{ 1: 1, 2: type, 3: pid, 4: slot_id (16 random bytes), 5: params, 6: ciphertext }`. `aad` below is the same map without key 6.

| Type | Unlock secret | `params` | `ciphertext` |
| --- | --- | --- | --- |
| 1 | Vault password | `{ 1: salt (16 bytes), 2: memory in KiB, 3: passes, 4: lanes }` | `kek = Argon2id(password as UTF-8 NFC, salt, params, 32 bytes)`, then `ChaCha20-Poly1305(HKDF(kek, salt = slot_id, info = "psss/v1/slot/password"), 12 zero bytes, aad, PS)` |
| 2 | Recovery kit | `{}` | `ChaCha20-Poly1305(HKDF(kit, salt = slot_id, info = "psss/v1/slot/kit"), 12 zero bytes, aad, PS)` |
| 3 | Another device | `{ 1: device kem_pk }` | `HPKE.SealBase(device kem_pk, info = "psss/v1/slot/device" || pid || slot_id, aad, PS)` |

- Argon2id defaults are 131072 KiB (128 MiB), 3 passes, 4 lanes. A reader MUST refuse less than 65536 KiB or fewer than 2 passes, except when running test vectors. The AutoFill extension never opens a password slot.
- A recovery kit is 20 random bytes. It is shown as `RK1-` followed by its 32 characters in Crockford base32, in groups of four.
- On Apple devices `PS` is by default also kept as an item in iCloud Keychain. That is a matter for the platform, not a slot, and is not part of this format.

## 8. Storage

A location stores opaque objects. It needs three operations: list what is new, get, and put if absent. Nothing a location does requires it to understand a record.

### 8.1 Folder

```
Personal.psss/
  psss.json                                   {"format":"psss-vault","version":1}
  people/<pid>/slots/<slot_id>.slot
  groups/<gid>/keys/<epoch>/<pid>.key         the wrap of section 7.1
  groups/<gid>/log/<pid>-<device>/<first seq, 10 digits>.seg
  groups/<gid>/blobs/<first 2 hex digits>/<chunk_id>
```

Identifiers are lowercase hexadecimal; the epoch is decimal. A segment is a sequence of frames, `u32(len(sealed)) || sealed`, holding consecutive records of one chain. Only the device that owns a chain writes its segments. It appends to the newest one and starts a new one once it passes 64 KiB, after which the old one never changes. Because no file has two writers, a file-sync service has nothing to conflict on. A reader MUST ignore an incomplete final frame, which is an upload in progress.

Membership records are written to the author's chain like any other record. Slots and wraps are written once and never changed; a new slot or wrap is a new file.

### 8.2 Server

Paths are relative to a base address; requests carry a bearer credential that is outside this format.

- `GET /v1/groups/<gid>/records?after=<cursor>` returns record ids in the order the server received them, and a new cursor.
- `GET /v1/groups/<gid>/records/<record_id>` returns the sealed record.
- `PUT /v1/groups/<gid>/records/<record_id>` stores it. The server MUST check that the id is the SHA-256 of the body, and answers success if it already has it.

Wraps, slots and chunks use the same three operations under `keys/`, `slots/` and `blobs/`. A server never deletes on a client's request except for records covered by a checkpoint, which it cannot verify and so MAY refuse.

### 8.3 CloudKit

One zone per group and one database record per sealed record, named by `record_id`, with the wraps beside them; a shared group is that zone with a `CKShare`. The exact record types and fields are set by the sync spike and are not yet part of this draft.

## 9. What a reader must check, in order

1. The header: magic, a `gid` it knows, an epoch it holds a key for.
2. The AEAD tag, the padding and the deterministic form of the body.
3. `author`, then the signature over header and body.
4. For membership records, section 6.5. For content records, the author's role in that epoch and the cuts.
5. The chain: `seq`, `prev`, no fork, no gap.

A record that fails steps 1 to 3 is discarded. A record that fails step 4 is kept and ignored. A record that fails step 5 waits.

## 10. Not yet specified

- The item schema: field names and value shapes for logins, cards, notes, passkeys and verification codes, and how an item moves between groups.
- The invitation and device approval exchanges (the code and the confirmation words in the approved mocks).
- The backup copy file and the KeePass export mapping.
- CloudKit record types (section 8.3).
- Limits: the largest group, how often to checkpoint, how long a fork or a held-back record is shown.

## 11. Known weaknesses to put to the reviewer

- The fork rule for membership (section 6.5) is new and is the part most likely to be wrong.
- A checkpoint is trusted on a manager's signature; a reader that no longer holds the covered records cannot check it.
- Storage can withhold the newest records of any chain. A reader can only say “behind”.
- A removed person keeps every key up to their removal and everything they read.
- File and folder names in a folder location show person and device identifiers, the number of records and when they were written.
- X-Wing is specified in an Internet-Draft. The three implementations named in section 1 must be shown to interoperate on the test vectors before anything depends on them.
