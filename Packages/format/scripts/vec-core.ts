// Vectors for sections 1 to 5: CBOR, people, signatures, X-Wing and HPKE, records, padding, clock, fold, checkpoints.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { concat, fromHex, utf8 } from '../src/bytes.ts';
import { cmap, decode, encode, type CborValue } from '../src/cbor.ts';
import { makeCard } from '../src/keys.ts';
import { KIND, deriveSalt, header, openRecord, padPlaintext, sealPlaintext, bodyMap, signedBytes, paddedLength, keyRing } from '../src/record.ts';
import { ed25519Sign } from '../src/prims.ts';
import { cmp } from '../src/bytes.ts';
import { L } from '../src/edwards.ts';
import * as xw from '../src/xwing.ts';
import { compute } from '../test/compute.ts';
import { Scenario, bytesOf, itemId, itemPayload, BASE_MS } from '../test/scenario.ts';
import type { N } from '../test/notation.ts';
import { CLEARED, E, H, Out, differs, file, flipBit, historyView, itemNames, mlkemSs, nat, seed32, stateView } from './vec-common.ts';
import type { J, Minted } from './vec-common.ts';

// ------------------------------------------------------------------ cbor
export function cborVectors(): J {
  const o = new Out();
  const En = (name: string, desc: string, value: N, h: string) => o.add(`cbor/encode/${name}`, desc, 'cbor.encode', { value }, { hex: h });
  for (const [n, h] of [['0', '00'], ['23', '17'], ['24', '1818'], ['255', '18ff'], ['256', '190100'], ['65535', '19ffff'], ['65536', '1a00010000'],
    ['4294967295', '1affffffff'], ['4294967296', '1b0000000100000000'], ['18446744073709551615', '1bffffffffffffffff']] as const) {
    En(`uint-${n}`, `Unsigned integer ${n} in its shortest encoding.`, { uint: n }, h);
  }
  En('text-empty', 'Empty text string.', { text: '' }, '60');
  En('text-ietf', 'Text string "IETF".', { text: 'IETF' }, '6449455446');
  En('text-nfc-e-acute', 'U+00E9 is two UTF-8 bytes.', { text: 'é' }, '62c3a9');
  En('text-not-nfc-kept', 'Section 2: text is never changed for its normal form. "e" followed by U+0301 encodes as the three bytes it is.', { text: 'e\u0301' }, '6365cc81');
  En('bytes-empty', 'Empty byte string.', { bytes: '' }, '40');
  En('bytes-4', 'Four-byte string.', { bytes: '01020304' }, '4401020304');
  En('array-empty', 'Empty array.', { array: [] }, '80');
  En('array-123', 'Array [1,2,3].', { array: [nat(1), nat(2), nat(3)] }, '83010203');
  En('array-nested', 'Nested arrays.', { array: [nat(1), { array: [nat(2), nat(3)] }, { array: [nat(4), nat(5)] }] }, '8301820203820405');
  En('false', 'false.', { bool: false }, 'f4');
  En('true', 'true.', { bool: true }, 'f5');
  En('null', 'null.', { null: true }, 'f6');
  En('map-empty', 'Empty map.', { map: [] }, 'a0');
  En('map-int-keys-sorted', 'Integer keys given out of order are sorted by their encodings: 1, 10, 24, 256.',
    { map: [[nat(24), nat(0)], [nat(1), nat(0)], [nat(256), nat(0)], [nat(10), nat(0)]] }, 'a40100' + '0a00' + '181800' + '19010000');
  En('map-text-keys-length-first', 'Text keys sort by their encoding, so "b" comes before "aa" (shorter first).',
    { map: [[{ text: 'aa' }, nat(2)], [{ text: 'b' }, nat(1)]] }, 'a2' + '616201' + '62616102');
  En('map-text-keys-upper-before-lower', 'Same length: bytewise, so "B" (0x42) before "a" (0x61).',
    { map: [[{ text: 'a' }, nat(1)], [{ text: 'B' }, nat(2)]] }, 'a2' + '614202' + '616101');
  En('map-text-keys-multibyte', 'Encoded length counts UTF-8 bytes: "z" (1 byte) before U+00E9 (2 bytes).',
    { map: [[{ text: 'é' }, nat(1)], [{ text: 'z' }, nat(2)]] }, 'a2' + '617a02' + '62c3a901');
  En('map-nested', 'Map inside a map value.', { map: [[nat(1), { map: [[{ text: 'k' }, { bytes: 'ff' }]] }]] }, 'a101a1616b41ff');

  const R = (name: string, h: string, reason: string, desc: string) => o.add(`cbor/reject/${name}`, desc, 'cbor.reject', { hex: h }, { error: { code: reason } });
  R('uint-0-in-two-bytes', '1800', 'non_shortest', 'Integer 0 with a one-byte argument.');
  R('uint-23-in-two-bytes', '1817', 'non_shortest', 'Integer 23 with a one-byte argument.');
  R('uint-255-in-three-bytes', '1900ff', 'non_shortest', 'Integer 255 with a two-byte argument.');
  R('uint-65535-in-five-bytes', '1a0000ffff', 'non_shortest', 'Integer 65535 with a four-byte argument.');
  R('uint-in-nine-bytes', '1b00000000ffffffff', 'non_shortest', 'Integer 2^32-1 with an eight-byte argument.');
  R('bytes-length-not-shortest', '580100', 'non_shortest', 'Byte string length 1 written as a one-byte argument.');
  R('negative-integer', '20', 'negative_integer', 'Negative integer -1.');
  R('negative-integer-long', '3863', 'negative_integer', 'Negative integer -100.');
  R('float-half', 'f90000', 'float', 'Half-precision float.');
  R('float-single', 'fa3fc00000', 'float', 'Single-precision float.');
  R('float-double', 'fb3ff0000000000000', 'float', 'Double-precision float.');
  R('undefined', 'f7', 'undefined', 'undefined.');
  R('simple-16', 'f0', 'simple_value', 'Simple value 16.');
  R('simple-32', 'f820', 'simple_value', 'Simple value 32 (one-byte form).');
  R('tag-1', 'c11a514b67b0', 'tag', 'Tag 1 (epoch time).');
  R('tag-0-text', 'c074323031332d30332d32315432303a30343a30305a', 'tag', 'Tag 0 on a text string.');
  R('indefinite-bytes', '5f4100ff', 'indefinite_length', 'Indefinite-length byte string.');
  R('indefinite-text', '7f6161ff', 'indefinite_length', 'Indefinite-length text string.');
  R('indefinite-array', '9f01ff', 'indefinite_length', 'Indefinite-length array.');
  R('indefinite-map', 'bf0100ff', 'indefinite_length', 'Indefinite-length map.');
  R('break-alone', 'ff', 'break', 'A stray break byte.');
  R('reserved-ai-28', '1c', 'reserved_additional_info', 'Reserved additional information 28.');
  R('reserved-ai-30', '1e', 'reserved_additional_info', 'Reserved additional information 30.');
  R('ai-31-on-uint', '1f', 'malformed', 'Additional information 31 on an unsigned integer.');
  R('ai-31-on-tag', 'df', 'malformed', 'Additional information 31 on a tag.');
  R('map-unsorted-int-keys', 'a202000100', 'unsorted_keys', 'Map keys 2 then 1.');
  R('map-duplicate-int-keys', 'a201000100', 'duplicate_key', 'Map key 1 twice.');
  R('map-unsorted-text-keys', 'a2626161006162' + '00', 'unsorted_keys', 'Text keys "aa" then "b": "aa" encodes longer, so it must come second.');
  R('map-duplicate-text-keys', 'a2616100616100', 'duplicate_key', 'Text key "a" twice.');
  R('map-mixed-key-kinds', 'a20100616100', 'mixed_key_kinds', 'Integer key then text key in one map.');
  R('map-bytes-key', 'a1410000', 'bad_key_type', 'Byte string as a map key.');
  R('map-array-key', 'a18000', 'bad_key_type', 'Array as a map key.');
  R('map-bool-key', 'a1f400', 'bad_key_type', 'Boolean as a map key.');
  R('text-invalid-utf8', '62c328', 'invalid_utf8', 'Truncated UTF-8 sequence.');
  R('text-overlong-utf8', '62c080', 'invalid_utf8', 'Overlong encoding of U+0000.');
  R('text-surrogate', '63eda080', 'invalid_utf8', 'UTF-8 encoding of a surrogate.');
  R('trailing-bytes', '0000', 'trailing_bytes', 'Two items where one was expected.');
  R('truncated-array', '8201', 'truncated', 'Array of two with one item.');
  R('truncated-bytes', '4201', 'truncated', 'Byte string shorter than its length.');
  R('truncated-head', '18', 'truncated', 'Argument byte missing.');
  R('empty-input', '', 'truncated', 'No bytes at all.');
  R('huge-array-length', '9bffffffffffffffff', 'truncated', 'Array claiming 2^64-1 items.');
  // Section 2: "Nesting is at most 16 levels deep." Read as: the outermost array or map is level 1 (finding).
  o.add('cbor/accept/depth-16-arrays', 'Sixteen nested arrays: the innermost, empty, is level 16.', 'cbor.accept', { hex: '81'.repeat(15) + '80' });
  R('depth-17-arrays', '81'.repeat(16) + '80', 'too_deep', 'Seventeen nested arrays.');
  o.add('cbor/accept/depth-16-maps', 'Sixteen nested maps (key 1 each time).', 'cbor.accept', { hex: 'a101'.repeat(15) + 'a0' });
  R('depth-17-maps', 'a101'.repeat(16) + 'a0', 'too_deep', 'Seventeen nested maps.');
  o.add('cbor/accept/text-not-nfc', 'Section 2: a reader MUST NOT reject or change text that is not normalized ("e" + U+0301).', 'cbor.accept', { hex: '6365cc81' });
  o.add('cbor/accept/map-key-not-nfc', 'A text key that is not NFC is accepted and kept.', 'cbor.accept', { hex: 'a16365cc8100' });
  o.add('cbor/accept/mixed-values', 'A canonical map decodes and re-encodes to the same bytes.', 'cbor.accept', { hex: 'a30181f6020a03a1626b3081f5' });
  return file('Deterministic CBOR (section 2).', o);
}

// ------------------------------------------------------------------ people, signatures, X-Wing, HPKE
const LE = (n: bigint): Uint8Array => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
const fromLE = (b: Uint8Array): bigint => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!); return n; };

/** The eight points of order dividing 8 as RFC 8032 encodes them. */
export const SMALL_ORDER = [
  '0100000000000000000000000000000000000000000000000000000000000000',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000080',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
];

export function personVectors(s: Scenario, minted: Minted): J {
  const o = new Out();
  const alice = s.person('alice'), bob = s.person('bob');
  for (const [n, p] of [['alice', alice], ['bob', bob]] as const) o.add(`person/derive-${n}`, `Person ${n}: sign_seed, kem_seed, pid, kem_pk and card from a fixed secret.`, 'person.derive', { ps: H(p.ps) });
  const card = encode(makeCard(alice));
  o.add('card/verify-ok', 'A correctly signed card.', 'card.verify', { card: H(card) });
  o.add('card/verify-bad-signature', 'The last bit of the signature flipped.', 'card.verify', { card: H(differs(card, flipBit(card, card.length - 1), 'card sig')) });
  o.add('card/verify-bad-kem-pk', 'One bit of kem_pk flipped: the signature covers it.', 'card.verify', { card: H(differs(card, flipBit(card, 60), 'card kem_pk')) });
  o.add('card/verify-wrong-pid', 'bob\'s pid with alice\'s kem_pk and signature.', 'card.verify',
    { card: H(encode(cmap([[1, bob.pid], [2, alice.kemPk], [3, makeCard(alice).get(3) as Uint8Array]]))) });
  o.add('card/verify-extra-key', 'A card with an undefined key 4.', 'card.verify', { card: H(encode(cmap([...makeCard(alice) as Map<number, CborValue>, [4, 0]]))) });
  o.add('card/verify-missing-sig', 'A card without key 3.', 'card.verify', { card: H(encode(cmap([[1, alice.pid], [2, alice.kemPk]]))) });
  o.add('card/verify-short-kem-pk', 'kem_pk of 1215 bytes.', 'card.verify', { card: H(encode(cmap([[1, alice.pid], [2, alice.kemPk.slice(1)], [3, new Uint8Array(64)]]))) });
  const sig = makeCard(alice).get(3) as Uint8Array;
  const sPlusL = concat(sig.slice(0, 32), LE(fromLE(sig.slice(32)) + L));
  o.add('card/verify-s-not-reduced', 'The card signature with S replaced by S + L: the same equation holds, but section 1.2 requires S < L.', 'card.verify',
    { card: H(encode(cmap([[1, alice.pid], [2, alice.kemPk], [3, sPlusL]]))) }, E('bad_card_signature', 'reject'));
  o.add('card/verify-small-order-pid', 'A card whose pid is the identity point, with the all-zero signature a forger would use.', 'card.verify',
    { card: H(encode(cmap([[1, fromHex(SMALL_ORDER[0]!)], [2, alice.kemPk], [3, concat(fromHex(SMALL_ORDER[0]!), new Uint8Array(32))]]))) }, E('bad_card_signature', 'reject'));

  // Section 1.2: RFC 8032 test 1 (empty message) is a valid signature; the others break one rule each.
  const pk = fromHex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const good = fromHex('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
  const R0 = good.slice(0, 32), S0 = fromLE(good.slice(32));
  const SV = (name: string, desc: string, pkH: string, sigB: Uint8Array, expected: string, msg = '') =>
    o.add(`signature/${name}`, desc, 'signature.verify', { pk: pkH, msg, sig: H(sigB) }, { result: expected });
  SV('valid', 'RFC 8032 test 1: a valid signature of the empty message.', H(pk), good, 'ok');
  SV('wrong-message', 'The same signature over another message: an ordinary failure.', H(pk), good, 'bad_signature', H(utf8('x')));
  SV('s-plus-l', 'S + L: still satisfies the verification equation, rejected because S is not less than L (1.2).', H(pk), concat(R0, LE(S0 + L)), 'scalar_not_reduced');
  SV('s-equals-l', 'S = L exactly.', H(pk), concat(R0, LE(L)), 'scalar_not_reduced');
  SV('s-l-minus-1', 'S = L - 1: the largest S the rule allows. Passes the checks and then fails the equation.', H(pk), concat(R0, LE(L - 1n)), 'bad_signature');
  SV('s-top-bit-set', 'S with its top bit set (well above L).', H(pk), concat(R0, flipBit(good.slice(32), 31, 0x80)), 'scalar_not_reduced');
  SV('r-non-canonical', 'R written with y = p + 1 (a non-canonical encoding of y = 1).', H(pk), concat(fromHex('eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'), good.slice(32)), 'bad_signature_encoding');
  SV('r-off-curve', 'R is not a point of the curve.', H(pk), concat(fromHex('0200000000000000000000000000000000000000000000000000000000000000'), good.slice(32)), 'bad_signature_encoding');
  SV('pk-non-canonical-y', 'Public key with y = p (non-canonical).', 'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', good, 'bad_public_key');
  SV('pk-non-canonical-identity', 'Public key y = p + 1: a non-canonical encoding of the identity.', 'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', good, 'bad_public_key');
  SV('pk-sign-bit-on-zero-x', 'Identity point with the sign bit set (x = 0 cannot be negative).', '0100000000000000000000000000000000000000000000000000000000000080', good, 'bad_public_key');
  SV('pk-off-curve', 'Public key that is not a point of the curve.', '0200000000000000000000000000000000000000000000000000000000000000', good, 'bad_public_key');
  SV('pk-short', 'Public key of 31 bytes.', H(pk.slice(1)), good, 'bad_public_key');
  SMALL_ORDER.forEach((h, n) => SV(`pk-small-order-${n + 1}`, `Public key ${h.slice(0, 8)}...: a point of order dividing 8, with R = identity and S = 0.`, h,
    concat(fromHex(SMALL_ORDER[0]!), new Uint8Array(32)), 'small_order_public_key', H(utf8('forged'))));

  // The expected gid is written out here with node:crypto directly (draft 4: the lowest reader version is bound in as u32), not with the library.
  const gidByHand = (pid: Uint8Array, nonce: Uint8Array, k0: Uint8Array, minReader?: number) => {
    const sha = (...xs: Uint8Array[]) => createHash('sha256').update(Buffer.concat(xs)).digest();
    const tail = minReader === undefined ? [] : [Buffer.from([minReader >>> 24, (minReader >>> 16) & 255, (minReader >>> 8) & 255, minReader & 255])];
    return new Uint8Array(sha(utf8('psss/v1/gid'), pid, nonce, sha(utf8('psss/v1/gid-key'), k0), ...tail));
  };
  const gidIn = (k0: Uint8Array, min_reader: number) => ({ creator_pid: H(alice.pid), genesis_nonce: H(s.nonce), k0: H(k0), min_reader });
  o.add('gid/alice', 'gid from a creator pid, a genesis nonce, K_0 and min_reader 1 (3.3, draft 4).', 'gid', gidIn(s.key(0), 1), { gid: H(gidByHand(alice.pid, s.nonce, s.key(0), 1)) });
  o.add('gid/other-k0', 'The same creator and nonce with another K_0 give another gid: the first key is bound in.', 'gid', gidIn(bytesOf('another first key'), 1), { gid: H(gidByHand(alice.pid, s.nonce, bytesOf('another first key'), 1)) });
  o.add('gid/min-reader-2', 'The same creator, nonce and K_0 with min_reader 2 give another gid: the lowest reader version is bound in (3.3, 6.1).', 'gid', gidIn(s.key(0), 2), { gid: H(gidByHand(alice.pid, s.nonce, s.key(0), 2)) });
  o.add('gid/min-reader-largest', 'min_reader 4294967295, the largest value u32 holds.', 'gid', gidIn(s.key(0), 4294967295), { gid: H(gidByHand(alice.pid, s.nonce, s.key(0), 4294967295)) });
  assert.notEqual(H(gidByHand(alice.pid, s.nonce, s.key(0))), H(gidByHand(alice.pid, s.nonce, s.key(0), 1)), 'the draft-3 formula (without min_reader) gives another gid');
  for (const e of [0, 1, 4294967295]) o.add(`commit/epoch-${e}`, `Key commitment for epoch ${e}.`, 'commit', { gid: H(s.gid), epoch: e, key: H(s.key(0)) });

  // X-Wing and HPKE with a fixed KEM output (README: Node cannot fix ML-KEM encapsulation randomness).
  const sd = seed32(0);
  o.add('xwing/keygen-seed-0-31', 'X-Wing public key (1216 bytes) from the 32-byte seed 00..1f.', 'xwing.keygen', { seed: H(sd) });
  const pkx = xw.publicKey(sd);
  const ctM = fromHex(minted.mlkem_ct_wrap);
  const kem = { pk: H(pkx), ek_x: H(seed32(100)), mlkem_ct: H(ctM), mlkem_ss: H(mlkemSs(sd, ctM)) };
  const enc = o.add('xwing/encapsulate-fixed', 'X-Wing encapsulation with fixed X25519 ephemeral and a fixed ML-KEM encapsulation.', 'xwing.encapsulate', kem);
  o.add('xwing/decapsulate', 'The same ciphertext decapsulates to the same shared secret.', 'xwing.decapsulate', { seed: H(sd), ct: enc.expected.ct }, { ss: enc.expected.ss });
  const info = utf8('test info'), aad = utf8('test aad'), pt = seed32(200);
  const seal = o.add('hpke/seal-fixed', 'HPKE base-mode single-shot seal with a non-empty aad, KEM id 0x647a, HKDF-SHA256, AES-256-GCM, fixed KEM randomness.', 'hpke.seal',
    { ...kem, info: H(info), aad: H(aad), pt: H(pt) });
  o.add('hpke/open', 'Open the sealed blob above.', 'hpke.open', { seed: H(sd), info: H(info), aad: H(aad), blob: seal.expected.blob }, { pt: H(pt) });
  o.add('hpke/open-wrong-aad', 'Wrong aad: open fails.', 'hpke.open', { seed: H(sd), info: H(info), aad: H(utf8('other')), blob: seal.expected.blob });
  o.add('hpke/open-empty-aad-for-aad-seal', 'The blob was sealed with a non-empty aad; opening with an empty one fails.', 'hpke.open', { seed: H(sd), info: H(info), aad: '', blob: seal.expected.blob });
  o.add('hpke/open-wrong-info', 'Wrong info: open fails.', 'hpke.open', { seed: H(sd), info: H(utf8('other')), aad: H(aad), blob: seal.expected.blob });
  const blobB = fromHex(seal.expected.blob);
  o.add('hpke/open-enc-bit-flipped', 'A bit of the encapsulated key (enc) flipped: the shared secret changes and the open fails.', 'hpke.open',
    { seed: H(sd), info: H(info), aad: H(aad), blob: H(differs(blobB, flipBit(blobB, 5), 'hpke enc')) });
  o.add('hpke/open-ciphertext-bit-flipped', 'A bit of the AEAD ciphertext flipped.', 'hpke.open',
    { seed: H(sd), info: H(info), aad: H(aad), blob: H(differs(blobB, flipBit(blobB, 1120 + 3), 'hpke ct')) });
  o.add('hpke/open-tag-bit-flipped', 'A bit of the AEAD tag flipped.', 'hpke.open',
    { seed: H(sd), info: H(info), aad: H(aad), blob: H(differs(blobB, flipBit(blobB, blobB.length - 1), 'hpke tag')) });
  // A blob sealed by Python's cryptography 50 with a non-empty aad (the aad path is not in its public API: see README).
  o.add('hpke/open-sealed-by-python-with-aad', 'A blob sealed by Python\'s cryptography 50 with aad "aad" and info "info": an independent implementation, so open only.', 'hpke.open',
    { seed: H(seed32(0)), info: H(utf8('info')), aad: H(utf8('aad')), blob: minted.external_hpke_blob }, { pt: H(Uint8Array.from({ length: 32 }, (_, i) => 200 - i)) });
  return file('Person, card, signature checks, gid, commitment, X-Wing and HPKE (sections 1 and 3).', o);
}

// ------------------------------------------------------------------ records
const payloadHex = (id: Uint8Array, set: [string, CborValue][], clear: string[] = []) => H(encode(itemPayload(id, set, clear)));

function recordInput(s: Scenario, who: string, dev: string, seq: number, prev: Uint8Array | null, clock: [number, number], payload: string, over: J = {}): J {
  const p = s.person(who);
  return { signer_ps: H(p.ps), gid: H(s.gid), epoch: 0, key: H(s.key(0)),
           author: H(p.pid), device: H(s.device(dev)), seq, prev: prev ? H(prev) : null, clock, kind: KIND.item, mhead: H(bytesOf('vector mhead')), payload, ...over, tag: undefined };
}

/** Length of the plaintext before padding, without sealing anything. */
function plainLen(base: J, payload: string): number {
  const f = { author: fromHex(base.author), device: fromHex(base.device), seq: base.seq, prev: base.prev ? fromHex(base.prev) : null,
              clock: base.clock as [number, number], kind: base.kind, payload: fromHex(payload), mhead: fromHex(base.mhead) };
  const body = bodyMap({ ...f, payload: decode(fromHex(payload)) });
  body.set(9, new Uint8Array(64));
  return 4 + encode(body).length;
}

function fitPayload(target: number, base: J): string {
  for (const name of ['f', 'ff', 'fff', 'ffff']) {
    for (let len = 0; len < 20000; len++) {
      const ph = payloadHex(itemId('pad'), [[name, new Uint8Array(len)]]);
      const n = plainLen(base, ph);
      if (n === target) return ph;
      if (n > target) break;
    }
  }
  throw new Error(`cannot hit ${target}`);
}

export function recordVectors(s: Scenario): J {
  const o = new Out();
  const keys = s.keyList().filter((k) => k.epoch === 0);
  o.add('record/key', 'Per-record key rk = HKDF(K_epoch, salt, "psss/v1/record").', 'record.key', { key: H(s.key(0)), salt: H(bytesOf('vector salt')) });
  const base = recordInput(s, 'alice', 'a1', 1, null, [BASE_MS, 0], payloadHex(itemId('1'), [['title', 'Hello'], ['url', 'https://example.com']], ['old']));
  const sealed = o.add('record/seal-item', 'A sealed item-change record end to end: header, body (with mhead), signature, padding, record id.', 'record.seal', base);
  assert.deepEqual(sealed.expected.opens, { ok: true });
  const open = (name: string, desc: string, sealedHex: string, ks = keys, expected?: J) => o.add(`record/open/${name}`, desc, 'record.open', { keys: ks, sealed: sealedHex }, expected);
  open('ok', 'The record above opens (mhead is returned).', sealed.expected.sealed);
  const sealedB = fromHex(sealed.expected.sealed);
  const flipAt = (i: number) => H(differs(sealedB, flipBit(sealedB, i), `sealed byte ${i}`));
  open('bad-magic', 'First byte of the magic flipped (step 1): discarded.', flipAt(0), keys, E('bad_magic', 'discard'));
  open('unknown-gid', 'The reader knows no group with this gid (step 1): it waits.', sealed.expected.sealed, [{ gid: H(bytesOf('other gid')), epoch: 0, key: H(s.key(0)) }], E('no_key', 'wait'));
  open('no-key-for-epoch', 'The reader holds no key for epoch 0 (step 1): it waits.', sealed.expected.sealed, [{ gid: H(s.gid), epoch: 1, key: H(s.key(1)) }], E('no_key', 'wait'));
  open('gid-bit-flipped', 'One bit of the gid flipped: no key for that gid (step 1): it waits.', flipAt(10), keys, E('no_key', 'wait'));
  open('bad-tag', 'Last ciphertext byte flipped (step 2): discarded.', flipAt(sealedB.length - 1), keys, E('bad_tag', 'discard'));
  open('salt-bit-flipped', 'One bit of the salt flipped: another record key (step 2).', flipAt(50), keys, E('bad_tag', 'discard'));
  open('epoch-bit-flipped', 'The epoch in the header changed to 1: no key for epoch 1, so the record waits.', flipAt(39), keys.concat([]), E('no_key', 'wait'));
  open('too-short', 'Fewer than 88 bytes (header and tag).', H(sealedB.slice(0, 80)), keys, E('too_short', 'discard'));

  // Hand-crafted plaintexts under the same key.
  const salt = bytesOf('vector crafted');
  const hdr = header(s.gid, 0, salt);
  const mkBody = (mod: (m: Map<number | string, CborValue>) => void, sign = true) => {
    const f = { author: s.person('alice').pid, device: s.device('a1'), seq: 1, prev: null, clock: [BASE_MS, 0] as [number, number], kind: KIND.item,
                payload: itemPayload(itemId('1'), [], []), mhead: bytesOf('vector mhead') };
    const m = bodyMap(f);
    mod(m);
    const sig = ed25519Sign(s.person('alice').signSeed, signedBytes(hdr, m));
    if (sign) m.set(9, sig);
    return m;
  };
  const m0 = mkBody(() => {});
  const enc0 = encode(m0);
  const crafted = (name: string, desc: string, plain: Uint8Array, code: string, disp = 'discard') =>
    open(name, desc, H(sealPlaintext(s.gid, 0, s.key(0), salt, plain)), keys, E(code, disp));
  const padded = padPlaintext(enc0);
  const nonzero = padded.slice(); nonzero[nonzero.length - 1] = 1;
  crafted('padding-not-zero', 'A non-zero byte in the padding.', nonzero, 'bad_padding');
  const wide = new Uint8Array(padded.length + 256); wide.set(padded);
  crafted('padding-not-minimal', 'Padded to a permitted size, but longer than size(n) gives.', wide, 'bad_size');
  crafted('size-not-permitted', 'Plaintext one byte short of a permitted size.', padded.slice(0, padded.length - 1), 'bad_size');
  const longLen = padded.slice(); new DataView(longLen.buffer).setUint32(0, padded.length);
  crafted('length-exceeds-plaintext', 'u32(len(body)) larger than the plaintext.', longLen, 'bad_size');
  const huge = padded.slice(); new DataView(huge.buffer).setUint32(0, (1 << 20) + 1);
  crafted('body-over-1mib', 'u32(len(body)) of 1 MiB + 1 in a small plaintext: refused before anything else is read.', huge, 'body_too_large');
  const nonShortest = concat(Uint8Array.of(...enc0.slice(0, 2)), Uint8Array.of(0x18, 0x01), enc0.slice(3));
  crafted('body-not-deterministic', 'The version written as 18 01 instead of 01.', padPlaintext(nonShortest), 'bad_body');
  const trailing = padPlaintext(concat(enc0, Uint8Array.of(0)));
  crafted('body-trailing-byte', 'One extra byte after the body map, inside the declared length.', trailing, 'bad_body');
  const sch = (name: string, desc: string, mod: (m: Map<number | string, CborValue>) => void) => crafted(name, desc, padPlaintext(encode(mkBody(mod))), 'bad_body_schema');
  sch('body-unknown-key', 'The body carries key 11, which is not defined.', (m) => m.set(11, 0));
  sch('body-version-2', 'v is 2.', (m) => m.set(1, 2));
  sch('body-prev-with-seq-1', 'seq is 1 but prev is not null.', (m) => m.set(5, new Uint8Array(32)));
  sch('body-content-without-mhead', 'A content record (kind 16) without mhead.', (m) => m.delete(10));
  sch('body-mhead-not-32-bytes', 'mhead of 31 bytes.', (m) => m.set(10, new Uint8Array(31)));
  sch('body-author-short', 'author of 31 bytes.', (m) => m.set(2, new Uint8Array(31)));
  sch('body-seq-zero', 'seq 0.', (m) => m.set(4, 0));
  sch('body-clock-three-elements', 'clock with three elements.', (m) => m.set(6, [1, 2, 3]));
  const memberWithMhead = (() => {
    const f = { author: s.person('alice').pid, device: s.device('a1'), seq: 1, prev: null, clock: [BASE_MS, 0] as [number, number], kind: KIND.epoch, payload: cmap([]) };
    const m = bodyMap(f); m.set(10, bytesOf('x')); m.set(9, new Uint8Array(64)); return m;
  })();
  crafted('body-membership-with-mhead', 'A membership record (kind 3) that carries mhead: membership records carry mprev instead.', padPlaintext(encode(memberWithMhead)), 'bad_body_schema');

  // Signature failures.
  const forged = compute('record.seal', { ...base, signer_ps: H(s.person('mallory').ps), tag: 'forged' });
  open('bad-signature-wrong-signer', 'Body names alice as author but is signed with mallory\'s key.', forged.sealed, keys, E('bad_signature', 'discard'));
  const zeroSig = compute('record.seal', { ...base, sig_override: H(new Uint8Array(64)) });
  open('bad-signature-zero', 'An all-zero signature.', zeroSig.sealed, keys, E('bad_signature', 'discard'));
  const validSig = fromHex(sealed.expected.sig);
  const bigS = compute('record.seal', { ...base, sig_override: H(concat(validSig.slice(0, 32), LE(fromLE(validSig.slice(32)) + L))) });
  open('bad-signature-s-not-reduced', 'The valid signature with S replaced by S + L: section 1.2 rejects it although the equation holds.', bigS.sealed, keys, E('bad_signature', 'discard'));
  const identityAuthor = compute('record.seal', { ...base, author: SMALL_ORDER[0], sig_override: H(concat(fromHex(SMALL_ORDER[0]!), new Uint8Array(32))), tag: 'identity' });
  open('author-small-order', 'The author is the identity point and the signature is the forger\'s (R = identity, S = 0): the author is refused (1.2).', identityAuthor.sealed, keys, E('bad_author', 'discard'));
  const real = openRecord(sealedB, keyRing([[s.gid, 0, s.key(0)]]));
  const realBody = encode(real.body);
  const without9 = new Map(real.body); without9.delete(9);
  const derivedFor = (k: Uint8Array) => deriveSalt(k, without9 as never);
  open('moved-header-new-salt', 'The same signed body re-sealed with another salt: the salt is not the one derived from the key and the body, so it is discarded before the signature is looked at (bad_salt, 4.1).',
    H(sealPlaintext(s.gid, 0, s.key(0), bytesOf('moved salt'), padPlaintext(realBody))), keys, E('bad_salt', 'discard'));
  open('moved-header-new-epoch', 'The same signed body re-sealed into epoch 1 with the salt derived for that key: the salt matches, but the signature covers the header, so it cannot be moved to another epoch.',
    H(sealPlaintext(s.gid, 1, s.key(1), derivedFor(s.key(1)), padPlaintext(realBody))), s.keyList(), E('bad_signature', 'discard'));
  const otherGid = bytesOf('other group');
  open('moved-header-new-group', 'The same signed body re-sealed into another group with the derived salt: cannot be moved.',
    H(sealPlaintext(otherGid, 0, s.key(0), derivedFor(s.key(0)), padPlaintext(realBody))), [...keys, { gid: H(otherGid), epoch: 0, key: H(s.key(0)) }], E('bad_signature', 'discard'));

  // The salt (4.1, 9 step 2): derived from the key and the body, recomputed by the reader.
  const bodyWithout9Hex = H(encode(bodyMap({ author: s.person('alice').pid, device: s.device('a1'), seq: 1, prev: null, clock: [BASE_MS, 0], kind: KIND.item,
    payload: itemPayload(itemId('1'), [['title', 'Hello'], ['url', 'https://example.com']], ['old']), mhead: bytesOf('vector mhead') })));
  const salted = o.add('record/salt-derived', 'salt = HKDF(ikm = K_epoch, salt = SHA-256(body_without_9), info = "psss/v1/salt"), for the body of record/seal-item.', 'record.salt', { key: H(s.key(0)), body_without_9: bodyWithout9Hex });
  assert.equal(salted.expected.salt, sealed.expected.salt, 'the salt record/seal-item used is the derived one');
  const twice = o.add('record/same-body-sealed-twice', 'The same body sealed twice gives the same sealed record and the same record_id (4.1 deterministic sealing, 4.4 identity).', 'record.seal_twice', base);
  assert.equal(twice.expected.same, true); assert.equal(twice.expected.record_id, sealed.expected.record_id);
  const otherBody = o.add('record/different-body-different-record', 'A body that differs in one field (the title) gives a different salt, a different sealed record and a different record_id.', 'record.seal_twice',
    { ...base, payload: payloadHex(itemId('1'), [['title', 'Hellp'], ['url', 'https://example.com']], ['old']) });
  assert.notEqual(otherBody.expected.record_id, sealed.expected.record_id); assert.notEqual(otherBody.expected.salt, sealed.expected.salt);
  const oddSalt = compute('record.seal', { ...base, salt: H(bytesOf('a random salt')) });
  open('salt-does-not-match-body', 'A record properly signed (the signature covers the header with the odd salt) but sealed with a salt that is not the derived one: the reader recomputes the salt and discards the record (bad_salt).', oddSalt.sealed, keys, E('bad_salt', 'discard'));
  // The order of the checks of 9 step 2 (draft 4): tag, padding, body, payload shape, salt, author, signature. Each record below fails two checks.
  const odd = H(bytesOf('a random salt'));
  open('order-payload-shape-before-salt', 'A record that fails two checks: its payload is malformed (an item payload with only key 1) and its salt is not the derived one. The payload shape is checked first: bad_payload.',
    compute('record.seal', { ...base, payload: H(encode(cmap([[1, itemId('1')]]))), salt: odd, tag: 'order' }).sealed, keys, E('bad_payload', 'discard'));
  open('order-salt-before-signature', 'A record that fails two checks: its salt is not the derived one and its signature is all zeros. The salt is checked first: bad_salt.',
    compute('record.seal', { ...base, salt: odd, sig_override: H(new Uint8Array(64)), tag: 'order2' }).sealed, keys, E('bad_salt', 'discard'));
  open('order-salt-before-author', 'A record that fails two checks: its salt is not the derived one and its author is the identity point (with the forger\'s signature). The salt is checked first: bad_salt, not bad_author.',
    compute('record.seal', { ...base, author: SMALL_ORDER[0], sig_override: H(concat(fromHex(SMALL_ORDER[0]!), new Uint8Array(32))), salt: odd, tag: 'order3' }).sealed, keys, E('bad_salt', 'discard'));
  // Same body, different key: the derived salt follows the key.
  assert.notEqual(derivedFor(s.key(0)).join(), derivedFor(s.key(1)).join());

  // Extension keys (section 2): integer keys of 128 and above in a body and in a payload are kept, signed and ignored.
  const extPayload = (keys: [number | string, CborValue][]) => H(encode(cmap([[1, itemId('1')], [2, new Map([['title', 'Hello']]) as CborValue], [3, []], ...keys as [number, CborValue][]])));
  const BIG = '18446744073709551615';
  const extValue = H(encode('x'));
  const openExt = (label: string, extra: J) => compute('record.seal', { ...base, ...extra, tag: label });
  for (const [k, desc] of [['127', 'key 127, the largest key that is not an extension key'], ['128', 'key 128, the smallest extension key'], ['4294967296', 'key 2^32'], [BIG, 'key 2^64 - 1']] as const) {
    const inBody = openExt(`body ${k}`, { extensions: [[k, extValue]] });
    const ok = k !== '127';
    const bo = open(`extension-key-${k}-in-body`, `A body carrying ${desc}: ${ok ? 'kept and ignored; the signature covers it, and it verifies' : 'not an extension key and not defined: the body is malformed'}.`, inBody.sealed, keys,
      ok ? undefined : E('bad_body_schema', 'discard'));
    if (ok) { assert(bo.expected.ok, JSON.stringify(bo.expected)); assert.deepEqual(bo.expected.ok.extension_keys, [k]); assert.deepEqual(bo.expected.ok.payload_extension_keys, []); }
    const pk = k === BIG ? BigInt(k) : Number(k);
    const inPayload = openExt(`payload ${k}`, { payload: extPayload([[pk as never, 'x']]) });
    const po = open(`extension-key-${k}-in-payload`, `An item payload carrying ${desc}: ${ok ? 'kept and ignored' : 'not defined: the payload is malformed'}.`, inPayload.sealed, keys, ok ? undefined : E('bad_payload', 'discard'));
    if (ok) { assert.deepEqual(po.expected.ok.payload_extension_keys, [k]); assert.deepEqual(po.expected.ok.extension_keys, []); }
  }
  // The signature covers extension keys: change the value of one and keep the old signature (with the salt recomputed so only the signature is wrong).
  const signedExt = openRecord(fromHex(openExt('cover', { extensions: [['128', extValue]] }).sealed), keyRing([[s.gid, 0, s.key(0)]]));
  const edited = new Map(signedExt.body); edited.set(128, 'y');
  const editedWithout9 = new Map(edited); editedWithout9.delete(9);
  open('extension-key-value-changed-after-signing', 'The signed record with the value of extension key 128 changed, the old signature kept and the salt recomputed: the signature no longer verifies (bad_signature), so extension keys are covered by it.',
    H(sealPlaintext(s.gid, 0, s.key(0), deriveSalt(s.key(0), editedWithout9 as never), padPlaintext(encode(edited)))), keys, E('bad_signature', 'discard'));
  // Payload shape.
  const pay = (tag: string, payload: CborValue) => compute('record.seal', { ...base, payload: H(encode(payload)), tag });
  open('payload-field-in-set-and-clear', 'A field named in both set and clear (5.1).', pay('both', cmap([[1, itemId('1')], [2, new Map([['a', 1]]) as CborValue], [3, ['a']]])).sealed, keys, E('bad_payload', 'discard'));
  open('payload-clear-unsorted', 'clear = ["aa","b"]: not sorted by encoding (b first); an unsorted array is rejected.', pay('unsorted', cmap([[1, itemId('1')], [2, new Map() as CborValue], [3, ['aa', 'b']]])).sealed, keys, E('bad_payload', 'discard'));
  open('payload-clear-duplicate', 'clear = ["a","a"]: not strictly ascending.', pay('dup', cmap([[1, itemId('1')], [2, new Map() as CborValue], [3, ['a', 'a']]])).sealed, keys, E('bad_payload', 'discard'));
  open('payload-deleted-not-integer', 'The reserved field deleted set to a text string.', pay('del', cmap([[1, itemId('1')], [2, new Map([['deleted', 'yes']]) as CborValue], [3, []]])).sealed, keys, E('bad_payload', 'discard'));
  open('payload-set-key-not-text', 'A set map with an integer key.', pay('intkey', cmap([[1, itemId('1')], [2, new Map([[1, 1]]) as CborValue], [3, []]])).sealed, keys, E('bad_payload', 'discard'));
  const unknownKind = compute('record.seal', { ...base, kind: 99, payload: H(encode(cmap([[1, 2]]))), tag: 'k99' });
  open('unknown-kind-opens', 'Kind 99 (content, so it carries mhead) passes steps 1 and 2: kept, takes its place in its chain, no other effect (4.3).', unknownKind.sealed);

  // Padding boundaries: exact plaintext sizes before padding (u32 length plus body).
  const pbase = recordInput(s, 'alice', 'a1', 1, null, [BASE_MS, 0], '');
  for (const n of [255, 256, 257, 511, 512, 513, 2048, 2049, 3000, 3840, 3841, 4094, 4095, 4096, 4097, 8192, 8193]) {
    const v = o.add(`padding/record-${n}`, `Record whose plaintext is exactly ${n} bytes before padding.`, 'record.seal', { ...pbase, payload: fitPayload(n, pbase) });
    assert.equal(v.expected.plaintext_len_before_padding, n);
    assert.equal(v.expected.padded_len, paddedLength(n));
    assert.equal(v.expected.sealed_len, 72 + v.expected.padded_len + 16);
    assert.deepEqual(v.expected.opens, { ok: true });
  }
  for (const [n, p] of [[1, 256], [255, 256], [256, 256], [257, 512], [511, 512], [512, 512], [513, 768], [3840, 3840], [3841, 4096], [4095, 4096], [4096, 4096],
                        [4097, 8192], [8192, 8192], [8193, 12288], [1048576, 1048576], [1048577, 1052672], [1048580, 1052672]] as const) {
    o.add(`padding/length-${n}`, `Padded length of a ${n}-byte plaintext.`, 'padding.length', { plaintext_len: n }, { padded: p });
  }

  // The largest record (4.1, 4.2): body of exactly 1,048,576 bytes, and one byte more.
  const big = (len: number, _tag: string) => ({ signer_ps: H(s.person('alice').ps), gid: H(s.gid), epoch: 0, key: H(s.key(0)),
    author: H(s.person('alice').pid), device: H(s.device('a1')), seq: 1, clock: [BASE_MS, 0], mhead: H(bytesOf('vector mhead')), item: H(itemId('big')), bytes_len: len });
  const probe = 1_000_000;
  const want = probe + (1048576 - (compute('record.seal_large', big(probe, 'probe')).body_len as number)); // the length head is constant in this range
  assert.equal(compute('record.seal_large', big(want, 'probe2')).body_len, 1048576, 'a payload of the exact size exists');
  const largest = o.add('record/largest-body', `A body of exactly 1,048,576 bytes (one field of ${want} bytes, ramp pattern): the largest allowed. The sealed record is 1,052,760 bytes, the largest sealed record.`, 'record.seal_large', big(want, 'max'));
  assert.equal(largest.expected.sealed_len, 1052760);
  assert.deepEqual(largest.expected.opens, { ok: true });
  const over = o.add('record/body-one-over', `A body of 1,048,577 bytes (field of ${want + 1} bytes). The sealed length is the same as the largest, so only the length rule refuses it.`, 'record.seal_large', big(want + 1, 'over'));
  assert.equal(over.expected.body_len, 1048577);
  assert.deepEqual(over.expected.opens, E('body_too_large', 'discard'));
  const craft = (name: string, desc: string, plaintext_len: number, declared_body_len: number) =>
    o.add(`record/${name}`, desc, 'record.craft', { gid: H(s.gid), epoch: 0, key: H(s.key(0)), salt: H(bytesOf('vector craft')), plaintext_len, declared_body_len });
  const longer = craft('sealed-longer-than-largest', 'A sealed record of 1,052,761 bytes: one more than the largest. Refused as too large.', 1052673, 0);
  assert.equal(longer.expected.sealed_len, 1052761);
  assert.deepEqual(longer.expected.opens, E('too_large', 'discard'));
  const exact = craft('sealed-exactly-largest-bad-body', 'A sealed record of exactly 1,052,760 bytes whose body is not a CBOR map: passes the length rule and fails later.', 1052672, 1048576);
  assert.equal(exact.expected.sealed_len, 1052760);
  assert.deepEqual(exact.expected.opens, E('bad_body', 'discard'));
  return file('Sealed records, padding and the reader checks of section 9 steps 1 and 2 (section 4).', o);
}
// ------------------------------------------------------------------ clock
export function clockVectors(s: Scenario): J {
  const o = new Out();
  const a = H(s.person('alice').pid), b = H(s.person('bob').pid), d1 = H(s.device('d1')), d2 = H(s.device('d2'));
  const c = (wall: number, counter: number, author: string, device: string, seq: number) => ({ wall, counter, author, device, seq });
  o.add('clock/order/wall-first', 'wall_ms dominates the counter.', 'clock.order', { clocks: [c(2, 0, a, d1, 1), c(1, 9, a, d1, 1)] }, { order: [1, 0] });
  o.add('clock/order/counter', 'Equal wall_ms: counter decides.', 'clock.order', { clocks: [c(5, 2, a, d1, 1), c(5, 1, b, d1, 1), c(5, 3, a, d1, 1)] }, { order: [1, 0, 2] });
  o.add('clock/order/author-bytes', 'Equal wall_ms and counter: author, compared bytewise.', 'clock.order', { clocks: [c(5, 0, b, d1, 1), c(5, 0, a, d1, 1)] }, { order: a < b ? [1, 0] : [0, 1] });
  o.add('clock/order/device', 'Same author: device, bytewise.', 'clock.order', { clocks: [c(5, 0, a, d2, 1), c(5, 0, a, d1, 1)] }, { order: d1 < d2 ? [1, 0] : [0, 1] });
  o.add('clock/order/seq', 'Same chain: seq.', 'clock.order', { clocks: [c(5, 0, a, d1, 3), c(5, 0, a, d1, 2)] }, { order: [1, 0] });
  o.add('clock/order/bytes-not-hex-text', 'Author 0x0a.. against 0x9f..: bytewise numeric order.', 'clock.order',
    { clocks: [c(5, 0, '9f' + '00'.repeat(31), d1, 1), c(5, 0, '0a' + 'ff'.repeat(31), d1, 1)] }, { order: [1, 0] });
  o.add('clock/order/large-values', 'wall_ms and counter beyond 32 bits.', 'clock.order', { clocks: [c(4294967296, 0, a, d1, 1), c(4294967295, 4294967296, a, d1, 1)] }, { order: [1, 0] });
  o.add('clock/next/own-time-ahead', 'Own time later than anything accepted: counter 0.', 'clock.next', { now_ms: 1000, seen: [[900, 4]] }, { clock: [1000, 0] });
  o.add('clock/next/equal-wall', 'Own time equals the largest accepted wall_ms: counter one more.', 'clock.next', { now_ms: 900, seen: [[900, 4], [800, 9]] }, { clock: [900, 5] });
  o.add('clock/next/behind', 'Own clock behind: take the largest accepted wall_ms, counter one more than the largest there.', 'clock.next', { now_ms: 100, seen: [[900, 4], [900, 2], [800, 9]] }, { clock: [900, 5] });
  o.add('clock/next/nothing-seen', 'Nothing accepted.', 'clock.next', { now_ms: 7, seen: [] }, { clock: [7, 0] });
  const ten = 600000;
  o.add('clock/held-back/exactly-10-minutes', 'Exactly 10 minutes ahead: not more than 10 minutes, so not held back.', 'clock.held_back', { wall_ms: 1000 + ten, now_ms: 1000 }, { held_back: false });
  o.add('clock/held-back/one-ms-over', '10 minutes and 1 ms ahead: held back.', 'clock.held_back', { wall_ms: 1001 + ten, now_ms: 1000 }, { held_back: true });
  o.add('clock/held-back/one-ms-under', '10 minutes less 1 ms ahead.', 'clock.held_back', { wall_ms: 999 + ten, now_ms: 1000 }, { held_back: false });
  o.add('clock/held-back/24h-is-far-over', 'Draft 2 allowed 24 hours; a record 24 hours ahead is now held back.', 'clock.held_back', { wall_ms: 1000 + 86400000, now_ms: 1000 }, { held_back: true });
  o.add('clock/held-back/past', 'In the past.', 'clock.held_back', { wall_ms: 5, now_ms: 1000 }, { held_back: false });
  // Purging a deleted item (5.1): 30 days on the purging device's own clock from when it accepted the delete; the value in the record plays no part.
  const days30 = 30 * 86400000;
  o.add('clock/purge-due/exactly-30-days', 'The device accepted the delete 30 days ago to the millisecond: due (this implementation reads "30 days" as at least 30 days).', 'clock.purge_due', { accepted_ms: 5000, now_ms: 5000 + days30 }, { due: true });
  o.add('clock/purge-due/one-ms-short', '30 days less 1 ms after acceptance: not due.', 'clock.purge_due', { accepted_ms: 5000, now_ms: 5000 + days30 - 1 }, { due: false });
  o.add('clock/purge-due/just-accepted-however-old-the-record', 'Timed from when the device accepted the delete, never from a time in the record: a delete record whose own time is years old, accepted just now, is not due.', 'clock.purge_due', { accepted_ms: 1_700_000_000_000, now_ms: 1_700_000_000_000 }, { due: false });
  return file('Clock and total order (section 4.5).', o);
}

// ------------------------------------------------------------------ fold
export function foldVectors(s: Scenario): J {
  const o = new Out();
  const A = s.person('alice').pid, B = s.person('bob').pid, d1 = s.device('d1'), d2 = s.device('d2');
  const I = itemId('i1'), I2 = itemId('i2');
  const [LO, HI] = cmp(A, B) < 0 ? [A, B] : [B, A]; // the smaller and the greater pid
  const ch = (who: Uint8Array, dev: Uint8Array, seq: number, wall: number, counter: number, item: Uint8Array, set: [string, CborValue][], clear: string[] = []) =>
    ({ clock: [wall, counter], author: H(who), device: H(dev), seq, payload: payloadHex(item, set, clear) });
  const run = (name: string, desc: string, cs: J[], orders?: number[][]) => o.add(`fold/${name}`, desc, 'fold.run', { changes: cs, ...(orders ? { orders } : {}) });

  run('different-fields', 'Two records set different fields of one item: both fields keep their values.', [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 11, 0, I, [['url', 'U']])]);
  run('same-field', 'Same field set twice: the later one wins, the earlier is history.', [ch(A, d1, 1, 10, 0, I, [['title', 'old']]), ch(B, d1, 1, 20, 0, I, [['title', 'new']])]);
  run('same-field-reversed-input', 'The same two records listed in the other order give the same state.', [ch(B, d1, 1, 20, 0, I, [['title', 'new']]), ch(A, d1, 1, 10, 0, I, [['title', 'old']])]);
  run('tie-wall-counter-author', 'Equal wall_ms and counter: the greater author (bytewise) wins.', [ch(LO, d1, 1, 10, 0, I, [['f', 'from the smaller author']]), ch(HI, d1, 1, 10, 0, I, [['f', 'from the greater author']])]);
  run('tie-counter', 'Equal wall_ms: the greater counter wins even from the smaller author.', [ch(A, d1, 1, 10, 1, I, [['f', 'counter 1']]), ch(B, d1, 1, 10, 0, I, [['f', 'counter 0']])]);
  run('clear-after-set', 'A later clear beats an earlier set: the field is cleared and the value is history.', [ch(A, d1, 1, 10, 0, I, [['note', 'x']]), ch(B, d1, 1, 20, 0, I, [], ['note'])]);
  run('set-after-clear', 'A later set beats an earlier clear.', [ch(A, d1, 1, 10, 0, I, [], ['note']), ch(B, d1, 1, 20, 0, I, [['note', 'back']])]);
  run('set-and-clear-different-fields-one-record', 'One record sets one field and clears another.', [ch(A, d1, 1, 10, 0, I, [['a', 1], ['b', 2]]), ch(A, d1, 2, 20, 0, I, [['a', 3]], ['b'])]);
  run('null-value-vs-clear', 'A field set to the value null is not the same as a cleared field: the first has current null and cleared false, the second cleared true.',
    [ch(A, d1, 1, 10, 0, I, [['f', null]]), ch(A, d1, 2, 11, 0, I, [], ['g'])]);
  run('delete-after-edit', 'deleted later than every other field: the item is in Recently Deleted.', [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]])]);
  run('edit-after-delete', 'An edit later than the delete brings the item back.', [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]]), ch(A, d1, 2, 30, 0, I, [['title', 'T2']])]);
  run('clear-after-delete', 'A later clear of another field also counts as an edit.', [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]]), ch(A, d1, 2, 30, 0, I, [], ['title'])]);
  run('delete-in-same-record-as-edit', 'A record that sets deleted and another field: the other field is not strictly later than deleted (same write position), so the item stays deleted.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'T'], ['deleted', 10]])]);
  run('delete-tie-with-edit-by-greater-author', 'An edit with the same wall_ms and counter as the delete but a greater author (and the delete by the smaller) sorts later: strictly later, so the item is back.',
    [ch(LO, d1, 1, 10, 0, I, [['deleted', 10]]), ch(HI, d1, 1, 10, 0, I, [['title', 'T']])]);
  run('delete-tie-with-edit-by-smaller-author', 'The same, but the edit has the smaller author: it sorts earlier than the delete, so the item stays deleted.',
    [ch(HI, d1, 1, 10, 0, I, [['deleted', 10]]), ch(LO, d1, 1, 10, 0, I, [['title', 'T']])]);
  run('delete-value-plays-no-part', 'The value of deleted is a time shown to the person and does not decide anything: a later write with a smaller value wins.',
    [ch(A, d1, 1, 10, 0, I, [['deleted', 5000]]), ch(B, d1, 1, 20, 0, I, [['deleted', 1]])]);
  run('clear-deleted-field', 'Clearing deleted undeletes the item.', [ch(A, d1, 1, 10, 0, I, [['deleted', 10]]), ch(A, d1, 2, 20, 0, I, [], ['deleted'])]);
  run('delete-twice', 'Deleted set twice: the later write wins; still deleted.', [ch(A, d1, 1, 10, 0, I, [['deleted', 10]]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]])]);
  run('two-items', 'Records for two items stay separate.', [ch(A, d1, 1, 10, 0, I, [['t', 1]]), ch(A, d1, 2, 11, 0, I2, [['t', 2]])]);
  run('structured-values', 'Values are opaque: a map value wins or loses whole.',
    [ch(A, d1, 1, 10, 0, I, [['passkey', new Map<number | string, CborValue>([[1, new Uint8Array([1, 2])], [2, 'rp']]) as CborValue]]),
     ch(B, d1, 1, 20, 0, I, [['passkey', new Map<number | string, CborValue>([[1, new Uint8Array([3])]]) as CborValue]])]);
  const four = [ch(A, d1, 1, 10, 0, I, [['title', 'a'], ['url', 'u1']]), ch(B, d2, 1, 12, 0, I, [['title', 'b']], ['note']), ch(A, d1, 2, 14, 0, I, [['note', 'n']]), ch(B, d2, 2, 16, 0, I, [['url', 'u2']])];
  run('three-orders-one-state', 'The same four records folded in three different orders (listed) give one state.', four, [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]);
  const dup = ch(A, d1, 1, 10, 0, I, [['title', 'T']]);
  run('duplicate-record', 'The same record twice changes nothing.', [dup, { ...dup }, ch(B, d1, 1, 11, 0, I, [['title', 'U']])]);
  // ---- expected states written by hand (the reasoning is in the description of each vector); the library is asserted to agree.
  const names = itemNames(['i1', I], ['i2', I2]);
  const state = (name: string) => stateView(o.list.find((v) => v.name === `fold/${name}`)!.expected.state, names);
  const hist = (name: string, field: string) => historyView(o.list.find((v) => v.name === `fold/${name}`)!.expected.state, H(I), field);
  const one = (fields: J, deleted = false) => ({ i1: { deleted, fields } });
  assert.deepEqual(state('different-fields'), one({ title: 'T', url: 'U' }));
  assert.deepEqual(state('same-field'), one({ title: 'new' })); assert.deepEqual(hist('same-field', 'title'), ['old']);
  assert.deepEqual(state('tie-wall-counter-author'), one({ f: 'from the greater author' }));
  assert.deepEqual(state('tie-counter'), one({ f: 'counter 1' }));
  assert.deepEqual(state('clear-after-set'), one({ note: CLEARED })); assert.deepEqual(hist('clear-after-set', 'note'), ['x']);
  assert.deepEqual(state('set-after-clear'), one({ note: 'back' })); assert.deepEqual(hist('set-after-clear', 'note'), [CLEARED]);
  assert.deepEqual(state('null-value-vs-clear'), one({ f: null, g: CLEARED }));
  assert.deepEqual(state('delete-after-edit'), one({ title: 'T', deleted: 20 }, true));
  assert.deepEqual(state('edit-after-delete'), one({ title: 'T2', deleted: 20 }, false));
  assert.deepEqual(state('clear-after-delete'), one({ title: CLEARED, deleted: 20 }, false));
  assert.deepEqual(state('delete-in-same-record-as-edit'), one({ title: 'T', deleted: 10 }, true));
  assert.deepEqual(state('delete-tie-with-edit-by-greater-author'), one({ deleted: 10, title: 'T' }, false));
  assert.deepEqual(state('delete-tie-with-edit-by-smaller-author'), one({ deleted: 10, title: 'T' }, true));
  assert.deepEqual(state('delete-value-plays-no-part'), one({ deleted: 1 }, true));
  assert.deepEqual(state('clear-deleted-field'), one({ deleted: CLEARED }, false));
  assert.deepEqual(state('structured-values'), one({ passkey: { '1': '0x03' } }));
  assert.deepEqual(state('two-items'), { i1: { deleted: false, fields: { t: 1 } }, i2: { deleted: false, fields: { t: 2 } } });
  assert.deepEqual(state('duplicate-record'), one({ title: 'U' })); assert.deepEqual(hist('duplicate-record', 'title'), ['T']);
  // The four that had no hand-written state yet.
  assert.deepEqual(state('same-field-reversed-input'), one({ title: 'new' })); assert.deepEqual(hist('same-field-reversed-input', 'title'), ['old']);
  assert.deepEqual(state('set-and-clear-different-fields-one-record'), one({ a: 3, b: CLEARED }));
  assert.deepEqual(hist('set-and-clear-different-fields-one-record', 'a'), [1]); assert.deepEqual(hist('set-and-clear-different-fields-one-record', 'b'), [2]);
  assert.deepEqual(state('delete-twice'), one({ deleted: 20 }, true)); assert.deepEqual(hist('delete-twice', 'deleted'), [10]);
  { // four records: title b (12) beats a (10); url u2 (16) beats u1 (10); note cleared at 12 and set again at 14
    const v = o.list.find((x) => x.name === 'fold/three-orders-one-state')!;
    const want = one({ title: 'b', url: 'u2', note: 'n' });
    assert.deepEqual(state('three-orders-one-state'), want);
    for (const st of v.expected.states_by_order) assert.deepEqual(stateView(st, names), want);
  }
  return file('Folding item changes into state (section 5.1).', o);
}

// ------------------------------------------------------------------ checkpoint
export function checkpointVectors(s: Scenario): J {
  const o = new Out();
  const A = s.person('alice').pid, B = s.person('bob').pid, d1 = s.device('d1'), d2 = s.device('d2');
  const I = itemId('i1'), I2 = itemId('i2');
  const ch = (who: Uint8Array, dev: Uint8Array, seq: number, wall: number, counter: number, item: Uint8Array, set: [string, CborValue][], clear: string[] = []) =>
    ({ clock: [wall, counter], author: H(who), device: H(dev), seq, payload: payloadHex(item, set, clear) });
  const names = itemNames(['i1', I], ['i2', I2]);
  const clk = (c: J) => ({ wall: c.clock[0], counter: c.clock[1], author: c.author, device: c.device, seq: c.seq });
  const changes = [ch(A, d1, 1, 10, 0, I, [['title', 'old'], ['url', 'u']]), ch(B, d2, 1, 12, 0, I, [['title', 'mid']]), ch(A, d1, 2, 14, 0, I, [], ['url']),
                   ch(B, d2, 2, 15, 0, I2, [['t', 1], ['deleted', 15]]),
                   ch(A, d1, 3, 20, 0, I, [['title', 'new']]), ch(B, d2, 3, 11, 0, I, [['title', 'late but earlier than the checkpoint winner']]), ch(B, d2, 4, 30, 0, I2, [['t', 2]])];
  const covered = [{ author: H(A), device: H(d1), seq: 2, record_id: H(bytesOf('rec A2')) }, { author: H(B), device: H(d2), seq: 2, record_id: H(bytesOf('rec B2')) }];
  const cp0 = { include: [0, 1, 2, 3], covered };
  const v1 = o.add('checkpoint/fold-on-top', 'A checkpoint restates the winning writes of four records; then a later edit, a record with an older clock (loses to the checkpointed winner) and an edit of a deleted item (revives it). Run 0 folds the checkpoint and the three later records, run 1 folds all seven records and no checkpoint, run 2 folds both: all three give one state except that history before the checkpoint exists only without it.',
    'checkpoint.run', { changes, checkpoints: [cp0], runs: [{ changes: [4, 5, 6], checkpoints: [0] }, { changes: [0, 1, 2, 3, 4, 5, 6], checkpoints: [] }, { changes: [0, 1, 2, 3, 4, 5, 6], checkpoints: [0] }] });
  const cur = (st: J) => JSON.stringify(Object.fromEntries(Object.entries(st).map(([k, v]: [string, any]) => [k, { deleted: v.deleted, fields: Object.fromEntries(Object.entries(v.fields).map(([f, x]: [string, any]) => [f, [x.current, x.cleared, x.clock]])) }])));
  assert.equal(cur(v1.expected.states[0]), cur(v1.expected.states[1]));
  assert.equal(cur(v1.expected.states[1]), cur(v1.expected.states[2]));
  o.add('checkpoint/nothing-after', 'A checkpoint alone.', 'checkpoint.run', { changes, checkpoints: [cp0], runs: [{ changes: [], checkpoints: [0] }] });

  // Set to null against cleared: a checkpoint restates the write, so the two differ across a checkpoint.
  const nullSet = [ch(A, d1, 1, 10, 0, I, [['f', null]])];
  const cleared = [ch(A, d1, 1, 10, 0, I, [], ['f'])];
  const nc = o.add('checkpoint/null-versus-cleared', 'A field set to the value null and a cleared field give different checkpoint payloads ([1, clock, null] against [0, clock]) and different states after folding them.',
    'checkpoint.run', { changes: [...nullSet, ...cleared], checkpoints: [{ include: [0], covered: [] }, { include: [1], covered: [] }], runs: [{ changes: [], checkpoints: [0] }, { changes: [], checkpoints: [1] }] });
  assert.notEqual(nc.expected.payloads[0], nc.expected.payloads[1]);
  assert.notDeepEqual(nc.expected.states[0], nc.expected.states[1]);
  o.add('checkpoint/null-then-later-set', 'A cleared field restated by a checkpoint still loses to a later set, and a later clear still beats a restated null.', 'checkpoint.run',
    { changes: [...cleared, ch(B, d2, 1, 20, 0, I, [['f', 'later']]), ...nullSet, ch(B, d2, 2, 30, 0, I, [], ['f'])], checkpoints: [{ include: [0], covered: [] }, { include: [2], covered: [] }],
      runs: [{ changes: [1], checkpoints: [0] }, { changes: [3], checkpoints: [1] }] });

  // Overlapping checkpoints in both orders.
  const ov = [ch(A, d1, 1, 10, 0, I, [['title', 'a'], ['url', 'u1']]), ch(B, d2, 1, 12, 0, I, [['title', 'b']]), ch(A, d1, 2, 14, 0, I, [['note', 'n']], ['url']), ch(B, d2, 2, 16, 0, I2, [['t', 1]])];
  const ovv = o.add('checkpoint/overlapping-both-orders', 'Two checkpoints that overlap (the first restates records 0 to 2, the second records 1 to 3) folded in both orders, alone and on top of the records, all give the state of the four records.',
    'checkpoint.run', { changes: ov, checkpoints: [{ include: [0, 1, 2], covered: [] }, { include: [1, 2, 3], covered: [] }],
      runs: [{ changes: [], checkpoints: [0, 1] }, { changes: [], checkpoints: [1, 0] }, { changes: [0, 1, 2, 3], checkpoints: [] }, { changes: [3, 2, 1, 0], checkpoints: [1, 0] }, { changes: [0], checkpoints: [0, 1] }] });
  assert.deepEqual(ovv.expected.states[0], ovv.expected.states[1]);
  assert.equal(cur(ovv.expected.states[0]), cur(ovv.expected.states[2]));
  assert.equal(cur(ovv.expected.states[0]), cur(ovv.expected.states[3]));
  // Permanent delete.
  const pg = [ch(A, d1, 1, 10, 0, I, [['password', 'secret one']]), ch(A, d1, 2, 20, 0, I, [['password', 'secret two']]), ch(A, d1, 3, 30, 0, I, [['password', 'secret three']]), ch(B, d2, 1, 15, 0, I2, [['t', 1]])];
  const pv = o.add('checkpoint/purged', 'purged names an item and a place in the order: every write of that item up to that place is forgotten, in the checkpoint, in the records still held and in records folded later; a write after it survives. Run 0: the checkpoint alone; run 1: with the records.',
    'checkpoint.run', { changes: pg, checkpoints: [{ include: [0, 1, 2, 3], covered: [], purged: [{ item: H(I), clock: clk(pg[1]!) }] }], runs: [{ changes: [], checkpoints: [0] }, { changes: [0, 1, 2], checkpoints: [0] }] });
  assert.deepEqual(Object.keys(pv.expected.states[0]).length, 2);
  assert.equal(pv.expected.states[0][H(I)].fields.password.current, H(encode('secret three')));
  assert.equal(pv.expected.states[0][H(I)].fields.password.history.length, 0);
  o.add('checkpoint/purged-everything', 'purged up to the item\'s last write removes the item altogether.', 'checkpoint.run',
    { changes: pg, checkpoints: [{ include: [0, 1, 2, 3], covered: [], purged: [{ item: H(I), clock: clk(pg[2]!) }] }], runs: [{ changes: [0, 1, 2], checkpoints: [0] }] });
  o.add('checkpoint/purged-two-places', 'Two purged entries for one item: the later place applies.', 'checkpoint.run',
    { changes: pg, checkpoints: [{ include: [0, 1, 2, 3], covered: [], purged: [{ item: H(I), clock: clk(pg[0]!) }, { item: H(I), clock: clk(pg[1]!) }] }], runs: [{ changes: [], checkpoints: [0] }] });
  // ---- a checkpoint in three parts (5.3): writes fold as soon as a part is accepted; covered and purged only when the set is complete.
  const I3 = itemId('i3');
  const pc = [ch(A, d1, 1, 10, 0, I, [['password', 'secret one']]), ch(A, d1, 2, 20, 0, I, [['password', 'secret two']]), ch(A, d1, 3, 30, 0, I, [['password', 'secret three']]),
              ch(B, d2, 1, 15, 0, I2, [['t', 1]]), ch(B, d2, 2, 16, 0, I3, [['t', 9]])];
  const setId = H(bytesOf('three part set', 16));
  const sp = (part: number, include: number[], extra: J = {}) => ({ include, covered: [], set: { id: setId, part, parts: 3 }, ...extra });
  const parts = [sp(0, [0, 1, 2], { history: 2, purged: [{ item: H(I), clock: clk(pc[1]!) }] }), sp(1, [3]), sp(2, [4])];
  const tp = o.add('checkpoint/three-parts-every-order-and-with-one-missing', 'One checkpoint in three records (part 0 carries item i1 with its two earlier writes and purges i1 up to its second write; parts 1 and 2 carry i2 and i3). Runs 0 to 2 fold all three parts in three different orders: the set is complete, the purge takes effect (the first two passwords are forgotten) and all three give one state. Run 3 has part 2 missing and run 5 part 1 missing: their writes fold, the purge does not take effect (all three passwords stay). Run 4 has part 0 missing: i2 and i3 fold, nothing else.',
    'checkpoint.run', { changes: pc, checkpoints: parts, runs: [{ changes: [], checkpoints: [0, 1, 2] }, { changes: [], checkpoints: [2, 1, 0] }, { changes: [], checkpoints: [1, 0, 2] },
                                                                  { changes: [], checkpoints: [0, 1] }, { changes: [], checkpoints: [1, 2] }, { changes: [], checkpoints: [0, 2] }] });
  const nm = itemNames(['i1', I], ['i2', I2], ['i3', I3]);
  const st = (n: number) => stateView(tp.expected.states[n], nm);
  const completeState = { i1: { deleted: false, fields: { password: 'secret three' } }, i2: { deleted: false, fields: { t: 1 } }, i3: { deleted: false, fields: { t: 9 } } };
  for (const n of [0, 1, 2]) assert.deepEqual(st(n), completeState);
  assert.deepEqual(historyView(tp.expected.states[0], H(I), 'password'), []);
  assert.deepEqual(st(3), { i1: { deleted: false, fields: { password: 'secret three' } }, i2: { deleted: false, fields: { t: 1 } } });
  assert.deepEqual(historyView(tp.expected.states[3], H(I), 'password'), ['secret one', 'secret two']);
  assert.deepEqual(st(4), { i2: { deleted: false, fields: { t: 1 } }, i3: { deleted: false, fields: { t: 9 } } });
  assert.deepEqual(st(5), { i1: { deleted: false, fields: { password: 'secret three' } }, i3: { deleted: false, fields: { t: 9 } } });
  // History carried by a checkpoint, and a write it leaves out.
  const hv = o.add('checkpoint/history-carried-and-left-out', 'A checkpoint that carries the winning password and one earlier write (history 1). Run 0 folds it alone, as after the covered records were deleted: the history is "secret two" and the write left out ("secret one") is forgotten. Run 1 folds it with the records: both earlier writes are history.',
    'checkpoint.run', { changes: pc.slice(0, 3), checkpoints: [{ include: [0, 1, 2], covered: [], history: 1 }], runs: [{ changes: [], checkpoints: [0] }, { changes: [0, 1, 2], checkpoints: [0] }] });
  assert.deepEqual(historyView(hv.expected.states[0], H(I), 'password'), ['secret two']);
  assert.deepEqual(historyView(hv.expected.states[1], H(I), 'password'), ['secret one', 'secret two']);
  assert.deepEqual(stateView(hv.expected.states[0], nm), { i1: { deleted: false, fields: { password: 'secret three' } } });
  // Hand-written final states for three more checkpoint cases.
  assert.deepEqual(stateView(v1.expected.states[0], names), { i1: { deleted: false, fields: { title: 'new', url: CLEARED } }, i2: { deleted: false, fields: { t: 2, deleted: 15 } } });
  assert.deepEqual(stateView(v1.expected.states[1], names), stateView(v1.expected.states[0], names));
  assert.deepEqual(stateView(nc.expected.states[0], names), { i1: { deleted: false, fields: { f: null } } });
  assert.deepEqual(stateView(nc.expected.states[1], names), { i1: { deleted: false, fields: { f: CLEARED } } });
  assert.deepEqual(stateView(pv.expected.states[0], names), { i1: { deleted: false, fields: { password: 'secret three' } }, i2: { deleted: false, fields: { t: 1 } } });
  assert.deepEqual(stateView(pv.expected.states[1], names), stateView(pv.expected.states[0], names));
  // The five that had no hand-written state yet.
  const vstate = (v: J, n: number) => stateView(v.expected.states[n], names);
  assert.deepEqual(vstate(o.list.find((x) => x.name === 'checkpoint/nothing-after')!, 0), { i1: { deleted: false, fields: { title: 'mid', url: CLEARED } }, i2: { deleted: true, fields: { t: 1, deleted: 15 } } });
  const ntls = o.list.find((x) => x.name === 'checkpoint/null-then-later-set')!;
  assert.deepEqual(vstate(ntls, 0), { i1: { deleted: false, fields: { f: 'later' } } }); assert.deepEqual(historyView(ntls.expected.states[0], H(I), 'f'), [CLEARED]);
  assert.deepEqual(vstate(ntls, 1), { i1: { deleted: false, fields: { f: CLEARED } } }); assert.deepEqual(historyView(ntls.expected.states[1], H(I), 'f'), [null]);
  for (let n = 0; n < 5; n++) assert.deepEqual(vstate(ovv, n), { i1: { deleted: false, fields: { title: 'b', note: 'n', url: CLEARED } }, i2: { deleted: false, fields: { t: 1 } } }, `overlapping run ${n}`);
  assert.deepEqual(vstate(o.list.find((x) => x.name === 'checkpoint/purged-everything')!, 0), { i2: { deleted: false, fields: { t: 1 } } });
  assert.deepEqual(vstate(o.list.find((x) => x.name === 'checkpoint/purged-two-places')!, 0), { i1: { deleted: false, fields: { password: 'secret three' } }, i2: { deleted: false, fields: { t: 1 } } });
  void seed32;
  return file('Checkpoints (section 5.3): restated writes, null and cleared, overlap, permanent delete.', o);
}
