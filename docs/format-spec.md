# Psss vault format, version 1: byte-level specification

**Status: draft 5, 2026-11-23. Not reviewed, not implemented in the app.** The design and its reasons are in [vault format](format.md); this document says exactly what the bytes are, so that two people can implement it without talking to each other. Test vectors and a reference implementation for Node 24 are in `Packages/format/`. Post-quantum key wrapping is decided (2026-11-23, with a floor of iOS 26 and macOS 26). The draft still assumes one decision the owner has not confirmed: not reusing the age envelope. Everything is open to change until the independent review.

Draft 2 answered the 36 findings of the first independent implementation. Draft 3 answered the 12 findings of the second pass and the direction review of the same day. Drafts 4 and 5 answer the later passes and their independent validation. The [lists of changes](#12-changes) are at the end. `Packages/format/README.md` says which draft the reference implementation follows.

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
- Nesting is at most 16 levels deep. The outermost array or map is level 1, so sixteen arrays inside one another are allowed and seventeen are not.
- A map defined in this document MUST NOT carry keys it does not define, with two exceptions: where “open map” is stated, and **extension keys**. In a record body and in a payload, integer keys of 128 and above are reserved for later versions: a reader keeps them, covers them with the signature check like any other key, and otherwise ignores them. This is how a later version adds a field without breaking a reader of this one.
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

A device is a random 16-byte `device_id`. It labels a chain of records (section 4.4) and nothing else. Every process that writes records has its own: on Apple platforms the app and the AutoFill extension are two, because two writers on one chain would fork it. A device that cannot be certain of the last sequence number it wrote, for example after being restored from a backup, or whose chain has forked, MUST take a new `device_id`.

A device that is let in by another device (slot type 3) has its own X-Wing key pair, generated at random and kept in the platform's key store. It is used for that slot only.

### 3.3 Group

```
gid = SHA-256("psss/v1/gid" || creator_pid || genesis_nonce || SHA-256("psss/v1/gid-key" || K_0) || u32(min_reader))
```

`genesis_nonce` is 32 random bytes. A group has one 32-byte **group key** per **epoch**, generated at random. Epochs count from 0 and `K_e` is the key of epoch `e`. `min_reader` is defined in section 6.1. Binding `K_0` and `min_reader` into the identifier means a group has only one possible first key and one possible lowest reader version.

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

```
salt = HKDF(ikm = K_epoch, salt = SHA-256(body_without_9), info = "psss/v1/salt")
```

`salt` is derived from the group key and the body before it is signed (section 4.3), not drawn at random. Every distinct body therefore has its own record key, the fixed nonce is never reused even if a device's random numbers fail, and sealing is deterministic: the same body always gives the same sealed record and the same `record_id`. A reader MUST recompute `salt` after opening, before it checks the signature, and reject a record where it differs, which also ties the record to the one group key it was sealed under. A sealed record is at most 1,052,760 bytes, which is the header, the largest plaintext and the tag.

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

- **The same record twice.** Sealing is deterministic (section 4.1), so writing the same body again produces the same record with the same `record_id`. A record is identified by its `record_id`.
- **A fork.** Two records with the same `author`, `device` and `seq` and different bodies fork the chain at that `seq`. A reader accepts the records before the fork, accepts neither of the two and nothing after them, and shows the fork to the person. The device takes a new `device_id` and writes its changes again. Storage that withholds one of the two can hide a fork from a reader; that reader converges when it receives the other.
- **Remembering.** For each chain and each location, a device keeps the `seq` and `record_id` of the last record it accepted. When a location later offers less than that, or a different record at a `seq` already accepted, the device reports the location as rolled back and does not treat the older state as current. Offering less is not a rollback when a complete, accepted checkpoint covers the remembered `seq`, since those records may rightly have been deleted. This memory is the device's own and is not part of the format; a device that lost it, for example after a restore, has a new `device_id` and starts with none.
- **A gap.** A reader accepts a record only when every earlier record of its chain is present or covered by a checkpoint (section 5.3). A record whose `prev` does not match the record it holds at `seq - 1` waits like one whose predecessor is missing. A gap means storage is behind, which is reported as “behind”, never as an error.

### 4.5 Clock and order

`wall_ms` is milliseconds since 1970-01-01 UTC.

- **Reading.** A reader MUST hold back a record whose `wall_ms` is more than 10 minutes ahead of its own time. A held-back record is not accepted, and the rest of its chain waits behind it, until the reader's time catches up. It is shown to the person as held back.
- **Writing.** A device sets `wall_ms` to the larger of its own time and the largest `wall_ms` among the records it has accepted in this group, its own included. `counter` is 0 when that is larger than every accepted `wall_ms`, and otherwise one more than the largest accepted `counter` with that `wall_ms`. Because held-back records are never accepted, one wrong clock cannot drag every other device's clock forward by more than ten minutes. A device whose own clock is far ahead finds its records held back by the others until that time comes, which is the visible sign to fix its clock. If the largest accepted `counter` with that `wall_ms` is already 2^64 − 1, the writer uses `wall_ms + 1` and `counter` 0 instead; any writer can put that counter in a record, so an implementation MUST NOT overflow here.

Records are ordered by the tuple `(wall_ms, counter, author, device, seq)`, compared element by element, byte strings bytewise. This order is total.

## 5. Content records

A content record is accepted when all of these hold; otherwise it is kept and ignored, and still takes its place in its chain:

- `mhead` is on the membership chain the reader has accepted (section 6.5);
- the author is a writer or manager as of `mhead`;
- the epoch in the header is the epoch as of `mhead`, and the record is sealed under the key that epoch's record on the accepted chain commits to;
- the record is not beyond a cut (section 6.2).

An author whose record is ignored because `mhead` lost a fork writes the change again.

### 5.1 Item change, kind 16

```
payload = { 1: item_id (16 random bytes), 2: set, 3: clear }
set     = open map: field name (text) → value          may be empty
clear   = sorted array of field names                    may be empty
```

A field name MUST NOT be in both. A value is any CBOR allowed by section 2 and is opaque to merging: a field is the unit that wins or loses whole. Things that must never be half-merged are therefore one field with a map as its value: a passkey, a verification code's secret with its settings, a card number with its expiry. Field names and their values are defined by the [item schema](format-schema.md), which also says which writes a checkpoint carries as history.

**State.** Each record that sets or clears a field is a **write** of that field, with the record's place in the order of section 4.5. For each item and field, the current value is that of the greatest accepted write. Writes that lost are history. Folding the same set of records in any order gives the same state, and folding a record twice changes nothing.

**Deleting.** The reserved field `deleted` holds an unsigned integer, the time of deletion in milliseconds, which is shown to the person and plays no part in merging. An item is in Recently Deleted when `deleted` is set and no content field of the item has a winning write that is strictly later than the winning write of `deleted`. Which fields are content fields is said by the [item schema](format-schema.md#5-dates); bookkeeping fields are not. A later set or clear of a content field therefore brings the item back, which is the rule that an edit beats a delete. Clearing `deleted` restores the item. When a deleted item is removed for good is the app's rule (30 days in Psss), measured on the purging device's own clock from when it accepted the delete, never from the value in the record.

### 5.2 Attachments

A field value may refer to an attachment: `{ 1: key (32 random bytes), 2: size, 3: [chunk_id, …] }`. Every chunk but the last holds exactly 1,048,576 bytes of the file.

```
sealed chunk = ChaCha20-Poly1305(key, nonce = u32(0) || u64(index), aad = "psss/v1/chunk" || u64(size) || u32(number of chunks), data)
chunk_id     = SHA-256(sealed chunk)
```

`key` MUST be new for every attachment and every changed version of one; reusing it with different data would reuse a nonce. A file of no bytes has no chunks. A reader MUST check that the chunk lengths add up to `size`. Chunks are stored by id beside the records and fetched when the attachment is opened.

### 5.3 Checkpoint, kind 32

```
payload = { 1: set_id (16 random bytes), 2: part, 3: parts, 4: covered, 5: items, 6: purged }
covered = sorted array of [author, device, seq, record_id]            the last record covered in each chain
items   = sorted array of [item_id, { field name → sorted array of writes }]
write   = [1, [wall_ms, counter, author, device, seq], value]         a field that is set
          [0, [wall_ms, counter, author, device, seq]]                a field that is cleared
purged  = sorted array of [item_id, [wall_ms, counter, author, device, seq]]
```

A checkpoint restates writes. Each write in `items` is folded exactly as the write it names, with the same place in the order, so a checkpoint, any number of overlapping checkpoints and the records themselves all fold to the same state in any order. A reader that still holds covered records goes on folding them, and SHOULD show the person any covered record that disagrees with a checkpoint.

- **Who.** The author MUST be a manager as of `mhead`.
- **Parts.** A state too large for one body is written as `parts` records with the same `set_id`, numbered `part` 0 to `parts - 1`. The parts of a set have the same author, device and `parts`, so they are consecutive records of one chain and a missing part makes the later ones wait like any gap; records that share a `set_id` and differ in any of these belong to no set, and neither do two different records with the same `part`. `covered` and `purged` are carried in part 0 and are empty in the others. The writes of each part fold as soon as it is accepted; `covered` and `purged` take effect only when every part of the set is accepted.
- **History.** For each field a checkpoint carries at least the winning write and MAY carry earlier ones. Those earlier writes are the field's history after the records are gone, and are what Previous Passwords reads. The item schema says how many are kept per field; a write that a checkpoint leaves out is forgotten once the records it covers are deleted.
- **Chains.** For a chain named in `covered`, records up to that `seq` count as present, so a reader that never received them can continue the chain from the next one. Where checkpoints overlap, the greatest `seq` per chain applies.
- **Removing records.** Content records covered by a complete, accepted checkpoint MAY be deleted from every location. Membership records are never deleted.
- **Permanent delete.** `purged` names items whose writes up to the given place in the order are to be forgotten. A reader drops those writes from its state and deletes the records that hold them. This is the only way a secret is removed for good, and it is complete only when every location and device has acted on it.

### 5.4 Purge request, kind 33

```
payload = { 1: sorted array of item_id }
```

Any writer may ask for items to be removed for good. The request covers every write of those items up to its own place in the order. Every reader hides those writes at once; a write that is later in the order stays, so an item edited after the request reappears with only what was written since. A manager's device, when it next runs, answers with a checkpoint that purges them; a request is answered once a complete, accepted checkpoint names the item in `purged` at or after the request's place in the order, which is the place of the request record itself. Because the order is by clock, a write made earlier on a device that was offline is covered too when it arrives. In a group of one the person is the manager, so their own device does both. A writer in a shared group can therefore delete for good without being a manager, and the copy on storage goes when a manager's device has been online. This gives a writer no power they lacked: a writer can already clear every field of every item. What a purge adds is that the earlier values go too, which is the point of it.

## 6. Membership records

Membership records form one chain per group, separate from the device chains: each carries `mprev`, the `record_id` of the membership record before it. Roles are `0` removed, `1` reader, `2` writer, `3` manager. A membership record that does not start an epoch is sealed under the epoch as of its `mprev`.

### 6.1 Genesis, kind 1

```
payload = { 1: genesis_nonce, 2: card of the creator, 3: commit(0), 4: min_reader }
```

The first record of a group: epoch 0, `seq` 1, no `mprev`. The creator is a manager. `min_reader` is the lowest format version that may read this group, from `1` to 2^32 − 1, and `1` here; an implementation of a lower version MUST NOT read or write the group and tells the person to update. A reader MUST check that the card's `pid` is `author`, that `gid` in the header equals the derivation in section 3.3 from `author`, `genesis_nonce` and the `K_0` it holds, and that the commitment matches. If a reader holds more than one valid genesis for a `gid`, it uses the one with the smallest `record_id`; they can differ only in the creator's own card, device and clock.

### 6.2 Member, kind 2

```
payload = { 1: mprev, 2: card or pid, 3: role, 4: cut }
cut     = sorted array of [device, seq]
```

Adds a person or changes a role. The author MUST be a manager as of `mprev`. `role` is 1, 2 or 3; removing a person is a separate kind (section 6.4).

- Key 2 is a card when the person is not a member as of `mprev` (never added, or removed), and a `pid` otherwise.
- Key 4 is present when the role is lowered and absent otherwise. It lists the last record the author accepted in each of that person's chains, and may be empty. Content records of that person beyond the cut, and all of their records in chains the cut does not list, are ignored if they are sealed in the epoch of the member record or an earlier one. This stops a person who was lowered from writing into the past, also from a device no one has seen.
- Raising a person's role after it was lowered needs a new epoch first (section 6.3), so that their new records are sealed in an epoch the cut does not reach.

### 6.3 Epoch, kind 3

```
payload = { 1: mprev, 2: e, 3: commit(e), 4: K_(e-1) }
```

Starts epoch `e`, which MUST be one more than the epoch as of `mprev`, with no other change. The author MUST be a manager as of `mprev`. The record is sealed under `K_e` and carries the previous key, so a member who can read epoch `e` can read everything before it. A reader MUST check `K_(e-1)` against `commit(e-1)`, and MUST refuse a record that starts an epoch whose key equals the key of any earlier epoch of the group: `K_e` is new random bytes, and a record that brought back a key a removed person holds would look like a rotation and rotate nothing. A reader knows every earlier key, since each epoch's record carries the one before it. Writers MUST seal new records under the newest epoch they have accepted.

### 6.4 Remove, kind 5, and replace, kind 4

```
remove  = { 1: mprev, 2: pid, 3: cut, 4: e, 5: commit(e), 6: K_(e-1) }
replace = { 1: mprev, 2: old pid, 3: new card, 4: cut, 5: e, 6: commit(e), 7: K_(e-1) }
```

Removing a person and replacing a person's secret each start a new epoch in the same record. The record is sealed under the new key `K_e`, so the removed person, or whoever holds the old secret, cannot read it or anything after it, and there is no moment when the person is gone and the old key is still in use. `e`, the commitment and `K_(e-1)` are as in section 6.3. The header of the record MUST name epoch `e`; a reader refuses a record of kind 3, 4 or 5 whose header names any other epoch. `cut` is always present, may be empty, and applies to the removed or old `pid`: their records beyond it, and all of their records in chains it does not list, are ignored if they are sealed in an epoch before `e`. A person who is removed and later added again writes in the epoch of their return with nothing further needed. Anything they seal in between is ignored by the ordinary rule of section 5, since they are not a member as of its `mhead`.

- **Remove** is written by a manager. The person MUST be a member as of `mprev`.
- **Replace** is written by a manager, or by the person themselves signed with the old key. The new `pid` MUST NOT already be a member and takes the old one's role. Whoever holds a person's secret is that person as far as this format can tell: if a thief replaces the secret first, a manager removes the thief's `pid` and adds the person again.

The author wraps `K_e` to every remaining member (section 7.1) before writing the record.

### 6.5 Validity and forks

A reader verifies the chain from genesis: each record's author holds the needed role as of its `mprev`, and each epoch record's commitment matches the key the reader unwrapped.

When two or more valid membership records name the same `mprev`, exactly one continues the chain. In order:

1. Drop every candidate whose author is removed, lowered or replaced by another candidate. If that drops them all, keep them all.
2. Of those left, the one that is least by `(author, device, seq)` wins. Two candidates cannot share all three, since that would be a fork of one chain and neither would be accepted.

The other candidates and everything after them on their branches are ignored. Their authors write them again on the winning chain if they are still allowed to. The tie-break does not depend on anything an author can vary freely. Two different keys may exist for one epoch number after a fork; only the key committed by the record that starts that epoch on the winning chain is that epoch's key, and a content record sealed under the other is ignored.

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
- **Password.** The password is the UTF-8 bytes of what the person typed, normalized to NFC by the device. Argon2id defaults are 131,072 KiB (128 MiB), 3 passes, 4 lanes. A reader MUST refuse less than 65,536 KiB or fewer than 2 passes, MUST refuse zero lanes or less than 8 KiB of memory per lane, and MUST refuse more than 1,048,576 KiB, 16 passes or 16 lanes, since a slot comes from storage and could otherwise demand unbounded work. An implementation MAY offer an explicit test-only switch that lifts the lower bounds for the published vectors. The AutoFill extension never opens a password slot.
- **Recovery kit.** 20 random bytes. It is shown as `RK1-` followed by 36 characters of Crockford base32 in nine groups of four separated by hyphens. The 36 characters encode the kit followed by the first two bytes of `SHA-256("psss/v1/kit-check" || kit)`, with four zero bits at the end; a reader rejects a text whose last four bits are not zero, and checks that before the check bytes. When reading one, the case of the ASCII letters, hyphens (U+002D) and spaces (U+0020) are ignored and every other character outside the alphabet is refused, so a letter that only becomes `I` or `S` under Unicode case mapping is not accepted; `I` and `L` read as `1` and `O` reads as `0`, in the prefix too. A reader checks the two bytes before trying the kit, so a mistyped kit is told apart from a kit that opens nothing.
- **iCloud Keychain.** On Apple devices `PS` is by default also kept as an item in iCloud Keychain. That is a matter for the platform, not a slot, and is not part of this format.

## 8. Storage

A location stores opaque objects. It needs three operations: list what is new, get, and put if absent. Nothing a location does requires it to understand a record.

### 8.1 Folder

```
Personal.psss/
  psss.json                                                     {"format":"psss-vault","version":1}
  people/<pid>/slots/<slot_id>.slot                             the CBOR map of section 7.2
  groups/<gid>/keys/<epoch>/<pid>-<name>.key                    the 1168 bytes of section 7.1
  groups/<gid>/log/<pid>-<device>/<first seq>-<last seq>.seg    content records
  groups/<gid>/log/<pid>-<device>/<first seq>-<last seq>.mseg   membership records
  groups/<gid>/blobs/<first 2 hex digits>/<chunk_id>
```

- Identifiers are lowercase hexadecimal. The epoch is decimal. A `seq` in a name is ten decimal digits, so a chain holds fewer than 10^10 records. `<name>` is 8 random bytes in hexadecimal, so two wraps never share a path. `psss.json` is read as JSON; a writer produces exactly the bytes shown and a line feed.
- **No file is ever changed.** Each time a device writes, it puts the new records of a chain into a new file: under a name beginning with `.tmp-` first, then renamed to its final name. A file-sync service can deliver an older copy of a file that changes; it cannot do that to a file that never does. A reader ignores names beginning with `.tmp-`.
- A segment is a sequence of frames, `u32(len(sealed)) || sealed`, holding consecutive records of one chain in ascending `seq`. Names are a convenience: a reader takes `author`, `device` and `seq` from the records. A reader MUST stop reading a segment at a frame longer than the largest sealed record or at a record out of sequence, and MUST ignore an incomplete final frame. A frame that cannot be opened yet, for lack of a key, is kept and passed over.
- Segments may overlap. A device MAY gather many small segments of its own chain into one larger file, written the same way, and then delete the small ones. Only the device that owns a chain writes its segments.
- A membership record is written alone in a `.mseg`. A `.seg` whose records are all covered by a complete, accepted checkpoint MAY be deleted by any device; an `.mseg` never is.
- Slots and wraps are written once and never changed.

### 8.2 Server

Paths are relative to a base address; requests carry a bearer credential that is outside this format.

- `GET /v1/groups/<gid>/records?after=<cursor>` returns record ids in the order the server received them, and a new cursor.
- `GET /v1/groups/<gid>/records/<record_id>` returns the sealed record.
- `PUT /v1/groups/<gid>/records/<record_id>` stores it. The server MUST check that the id is the SHA-256 of the body and that the body is no longer than the largest sealed record, and answers success if it already has it.

Wraps, slots and chunks use the same three operations under `keys/`, `slots/` and `blobs/`. A server never deletes on a client's request except for records covered by a checkpoint, which it cannot verify and so MAY refuse.

### 8.3 CloudKit

One zone per group and one database record per sealed record, named by `record_id`, with the wraps beside them; a shared group is that zone with a `CKShare`.

What follows is what the sync spike of 2026-11-23 used and showed to work between a Mac and an iPhone on one Apple Account, in the private database. It is a record of the spike, not yet a requirement: wraps, membership records and sharing were not part of it.

- **Record.** Record type `SealedRecord`. The record name is the `record_id` as 64 lowercase hexadecimal characters. Field `sealed` (bytes) holds the sealed record, and field `v` (integer) is 1. A sealed record can reach 1,052,760 bytes and a database record is limited to 1 MB in all, so above a threshold (700,000 bytes in the spike, a guess) the bytes go in `sealedAsset` (an asset) and `sealed` is left out.
- **Nothing in the clear.** Author, device and `seq` are not stored as fields. The server sees the record name, the padded size, `v` and its own timestamps. The price is that the server cannot say which record is newest in a chain, so a reader fetches by zone change token and works out the chains itself, as with a folder.
- **Saving never overwrites.** A record is saved with the policy that fails when the name exists. An existing name is then compared byte for byte: equal bytes mean the record is already there and count as success, different bytes are an error. This happened three and then five times in 400 saves without the client retrying, so CloudKit resends a request below the client and an implementation MUST treat the first as normal. For a record stored as an asset the server's answer does not carry the bytes, and the record has to be fetched to compare.
- **Fetching** is by zone change token. The token is advanced even when a record in the batch could not be read, and the unread record identifiers are fetched again by name; holding the token back would let one bad record stop all sync. An expired token means fetching the zone from nothing. A request is limited to about 2 MB without assets, so saves are batched under that and a refused batch is split in half.
- **A zone the person deleted** in iCloud settings is reported differently from a zone that never existed and must not be silently recreated.

Measured with polling every half second and no push notifications, in two runs of 200 rounds of both devices changing the same field: 400 of 400 records and the same folded item on both devices each time, no lost edit, no prompt. In the second run every round was simultaneous: a record reached the other device about 1.2 s after it was due (median; 95th percentile about 2 s, worst 3.7 s), of which about half a second is the save, and 197 rounds were decided by `wall_ms` (122 for one device, 75 for the other) and 3 by the device tie-break. In the first run sixty rounds were not simultaneous, because the phone's app was in the background for about two minutes and then caught up; nothing was lost. That stretch is also a finding: on iOS an app stops syncing within seconds of leaving the foreground, so the store needs background time for a save in flight and push notifications to learn of changes.

Not yet shown: a second Apple Account and `CKShare`, push notifications, a record above 1 MB, clocks that disagree (every record in the spike had `counter` 0), a restarted device continuing its own chain, and CloudKit under rate limiting.

## 9. What a reader does with a sealed record

1. **Can it be opened yet?** The header's magic is checked; a wrong one is discarded. A record for a `gid` or an epoch the reader has no key for **waits**: the key may arrive later.
2. **Is it well formed?** The AEAD tag, the padding, the deterministic form of the body, the payload's shape for a known `kind`, the recomputed `salt`, `author`, and the signature over header and body. The checks are made in that order. A record that fails any of these is **discarded**; it can never become valid.
3. **Does its chain reach it?** `seq`, `prev`, no fork, no gap, not held back for its clock. Otherwise it **waits**.
4. **Is it allowed?** For membership records, section 6.5. For content records, the rules at the head of section 5. Otherwise it is **kept and ignored**, and still takes its place in its chain.

A discarded record is as if it had never been written. If a device finds that a record of its own is discarded by others, its chain has a gap there, which it repairs by taking a new `device_id`.

## 10. Not yet specified

- The invitation and device approval exchanges (the code and the confirmation words in the approved mocks).
- The backup copy file and the KeePass export mapping.
- CloudKit record types for wraps, membership and shared groups (section 8.3 has what the spike used for sealed records).
- Error codes, and the order of some checks that can fail together (the three length and magic checks on a sealed record, the recovery kit text checks, the Argon2id limits). Today the vectors fix them and the specification does not; the Swift implementation had to copy them from the vectors.
- Limits: the largest group, how often to checkpoint, how long a fork or a held-back record is shown, and when unused chunks are removed.

## 11. Known weaknesses to put to the reviewer

- The fork rule for membership (section 6.5) is new and is the part most likely to be wrong. Its last tie-break favours whichever manager has the smaller `pid`, always.
- A checkpoint is trusted on a manager's signature. A reader that no longer holds the covered records cannot check it, so a manager can drop another member's changes for readers who never saw them, and `purged` lets a manager remove any item's history. A permanent delete reaches a location only when some device acts on it there, and a device that never comes back keeps what it has.
- Storage can withhold the newest records of any chain, or one side of a fork. A reader can only say “behind”.
- A membership record held back for its clock stops the membership chain for every reader until its time comes, so a manager whose clock is more than ten minutes ahead stalls membership changes, though not content.
- `covered` in a checkpoint makes records a reader never received count as present. A manager can use that to hide a gap or a fork in someone else's chain.
- A removed person keeps every key up to their removal and everything they read. A thief who holds a person's secret is that person until a manager removes them.
- ChaCha20-Poly1305 does not commit to its key. The recomputed `salt` and the signature inside each record are what bind a record to one key; a reviewer should confirm that this is enough, also when two keys exist for one epoch number after a fork.
- One person secret on every device signs and unwraps everything. A lost device is answered by replacing the secret and starting a new epoch in every group. The direction review prefers a certified key per device; the argument against is that every Apple device can read the secret from iCloud Keychain anyway. The reviewer is asked to judge both.
- Sealing is deterministic, so two records with the same body are the same record. A body includes the author, device, `seq` and clock, so this cannot link two different changes; a reviewer should confirm nothing else follows.
- **Deterministic sealing does not hold with CryptoKit (found 2026-11-23, not yet resolved).** Sections 4.1 and 4.4 assume an Ed25519 signer that follows RFC 8032 exactly. CryptoKit's signer adds randomness and has no deterministic mode, so on Apple devices the same body sealed twice gives two valid records with different signatures and different `record_id`s, which section 4.4 would call a fork. Everything else in sealing matches the vectors byte for byte. The choices are: a writer stores each sealed record durably before it leaves the device and never seals a body twice (recommended; the system's signer stays in use); or a first-party deterministic signer in the app, which keeps the text as it is and puts hand-written secret-key arithmetic in the app. The owner has not decided.
- A person card proves who signed it, not that its `kem_pk` works. A wrong one harms only its owner.
- File and folder names in a folder location show person and device identifiers, the number of records and when they were written.
- X-Wing comes from an Internet-Draft. The reference implementation agrees with Python's `cryptography` in both directions and, since 2026-11-23, with CryptoKit: CryptoKit derives the same key pair from the 32-byte seed, opens every wrapped key and device slot in the vectors, and what it seals opens in the reference implementation. CryptoKit takes no randomness from the caller, so the vectors with fixed encapsulation randomness cannot be reproduced by it, only opened. Go is still to be shown.
- CryptoKit's Ed25519 verifier does not make the checks of section 1.2: it accepts signatures under public keys of small order, at a rate of about one in the key's order, which also shows it checks the equation without the cofactor. An implementation on CryptoKit therefore needs its own checks in front of it, as the Swift implementation has. Section 1.2 does not say whether the equation is cofactored; a reviewer should say whether it must.

## 12. Changes

### Since draft 5, from the Swift implementation (2026-11-23)

- **A clock counter at its largest value** moves the writer to the next millisecond (4.5).
- **Recovery kit text** folds the case of ASCII letters only (7.2).
- **CloudKit** (8.3) records what the two-device spike used and measured.
- Not changed, and waiting for the owner: deterministic sealing against CryptoKit's randomized signatures (section 11).

### From draft 4

- **A record that starts an epoch must bring a key that differs from every earlier one** (6.3). Without the rule a removal could pass every check and rotate nothing.
- **Small points.** An upper bound on `min_reader`, the order of the two recovery kit checks, when a purge request counts as answered, and that checkpoint parts are consecutive records of one chain (5.3, 5.4, 6.1, 7.2).

### From draft 3

From the third pass of the independent implementation and its validation:

- **A cut on a remove or replace record** reaches the epochs before the one the record starts, so a person who is added again needs no extra epoch (6.4).
- **A record that starts an epoch must name it in its header**, stated as a rule a reader enforces (6.4).
- **`min_reader` is bound into the group identifier** and is at least 1 (3.3, 6.1).
- **The fork tie-break** ends at `seq`; the comparison of record ids could never be reached (6.5).
- **Checkpoint sets** say what makes parts belong together, and every field carries at least its winning write (5.3).
- **A purge request** covers writes up to its own place in the order, and the reason a writer may make one is given (5.4).
- **Rollback** is not reported for records a checkpoint covers, and where the memory lives is stated (4.4).
- **Order of checks** on opening is fixed, with the salt before the signature, and the wording on discarded records is corrected (4.1, 9).
- **Recovery kit** text with non-zero trailing bits is rejected (7.2).

### From draft 2

From the second pass of the independent implementation and the direction review of 2026-11-23:

- **Sealing is deterministic.** The salt is derived from the group key and the body, which removes the dependence on random numbers, makes “the same record twice” well defined and ties a record to its key (4.1, 4.4).
- **Removing a person and replacing a secret start the new epoch in the same record.** The state “waiting for a new key” and the first step of the fork rule are gone (6.4, 6.5).
- **Checkpoints** can span several records, carry history so that previous passwords survive, and are answered to a **purge request** that any writer may make (5.3, 5.4).
- **Folder files are never changed.** One new file per write, renamed into place, instead of appending to a segment (8.1).
- **Clock.** Records more than ten minutes ahead are held back, not 24 hours, and purging is timed on the reader's own clock (4.5, 5.1).
- **Devices remember** what they last accepted from each location and report a rollback (4.4).
- **Later versions.** Extension keys that old readers keep and ignore, and a lowest reader version in genesis (2, 6.1).
- **Each writing process has its own `device_id`** (3.2).
- **Recovery kit** text carries two check bytes (7.2).
- **Small points.** Nesting level 1 is the outermost container, an empty file has no chunks, a frame that cannot be opened yet is passed over, Argon2id lanes and memory per lane have a lower limit, and a content record must be sealed under the key its epoch commits to (2, 5, 5.2, 7.2, 8.1).

### From draft 1

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
