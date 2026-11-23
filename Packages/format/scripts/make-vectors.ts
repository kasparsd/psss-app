// Generates vectors/*.json deterministically from fixed inputs. Run: node scripts/make-vectors.ts
// No randomness and no clock. The only non-derivable inputs are the ML-KEM-768 encapsulations in scripts/minted.json
// (Node cannot supply the encapsulation randomness) and one wrap sealed by an independent implementation.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { concat, fromHex, hex, utf8 } from '../src/bytes.ts';
import { cmap, encode, type CborValue } from '../src/cbor.ts';
import { checkpointItems, fold } from '../src/fold.ts';
import { commitOf, derivePerson, makeCard, type Person } from '../src/keys.ts';
import { KIND, header, openRecord, padPlaintext, sealPlaintext, sealRecord, bodyMap, signedBytes, paddedLength, keyRing, type Rec } from '../src/record.ts';
import { ed25519Sign, sha256 } from '../src/prims.ts';
import * as xw from '../src/xwing.ts';
import * as slots from '../src/slots.ts';
import { frame } from '../src/folder.ts';
import { compute } from '../test/compute.ts';
import { Scenario, bytesOf, itemId, itemPayload, BASE_MS } from '../test/scenario.ts';
import { toNotation, type N } from '../test/notation.ts';

type J = Record<string, any>;
const here = dirname(fileURLToPath(import.meta.url));
export const VECTOR_DIR = join(here, '..', 'vectors');
const MINTED_PATH = join(here, 'minted.json');
const H = hex;

export interface Minted { mlkem_ct_wrap: string; mlkem_ct_device: string; external_wrap: string }

class Out {
  list: J[] = [];
  names = new Set<string>();
  /** Add a vector. `expected` given by hand is checked against the library; otherwise it is computed. */
  add(name: string, description: string, type: string, input: J, expected?: J): J {
    assert(!this.names.has(name), `duplicate vector name ${name}`);
    this.names.add(name);
    const computed = compute(type, input);
    if (expected) assert.deepEqual(computed, expected, `hand-written expectation differs for ${name}`);
    const v = { name, description, type, input, expected: expected ?? computed };
    this.list.push(v);
    return v;
  }
}
const file = (description: string, o: Out) => ({ description, vectors: o.list });

const nat = (n: number | bigint): N => ({ uint: String(n) });

// ------------------------------------------------------------------ cbor
function cborVectors(): J {
  const o = new Out();
  const E = (name: string, desc: string, value: N, h: string) => o.add(`cbor/encode/${name}`, desc, 'cbor.encode', { value }, { hex: h });
  for (const [n, h] of [['0', '00'], ['23', '17'], ['24', '1818'], ['255', '18ff'], ['256', '190100'], ['65535', '19ffff'], ['65536', '1a00010000'],
    ['4294967295', '1affffffff'], ['4294967296', '1b0000000100000000'], ['18446744073709551615', '1bffffffffffffffff']] as const) {
    E(`uint-${n}`, `Unsigned integer ${n} in its shortest encoding.`, { uint: n }, h);
  }
  E('text-empty', 'Empty text string.', { text: '' }, '60');
  E('text-ietf', 'Text string "IETF".', { text: 'IETF' }, '6449455446');
  E('text-nfc-e-acute', 'U+00E9 (already NFC) is two UTF-8 bytes.', { text: 'é' }, '62c3a9');
  E('bytes-empty', 'Empty byte string.', { bytes: '' }, '40');
  E('bytes-4', 'Four-byte string.', { bytes: '01020304' }, '4401020304');
  E('array-empty', 'Empty array.', { array: [] }, '80');
  E('array-123', 'Array [1,2,3].', { array: [nat(1), nat(2), nat(3)] }, '83010203');
  E('array-nested', 'Nested arrays.', { array: [nat(1), { array: [nat(2), nat(3)] }, { array: [nat(4), nat(5)] }] }, '8301820203820405');
  E('false', 'false.', { bool: false }, 'f4');
  E('true', 'true.', { bool: true }, 'f5');
  E('null', 'null.', { null: true }, 'f6');
  E('map-empty', 'Empty map.', { map: [] }, 'a0');
  E('map-int-keys-sorted', 'Integer keys given out of order are sorted by their encodings: 1, 10, 24, 256.',
    { map: [[nat(24), nat(0)], [nat(1), nat(0)], [nat(256), nat(0)], [nat(10), nat(0)]] }, 'a40100' + '0a00' + '181800' + '19010000');
  E('map-text-keys-length-first', 'Text keys sort by their encoding, so "b" comes before "aa" (shorter first).',
    { map: [[{ text: 'aa' }, nat(2)], [{ text: 'b' }, nat(1)]] }, 'a2' + '616201' + '62616102');
  E('map-text-keys-upper-before-lower', 'Same length: bytewise, so "B" (0x42) before "a" (0x61).',
    { map: [[{ text: 'a' }, nat(1)], [{ text: 'B' }, nat(2)]] }, 'a2' + '614202' + '616101');
  E('map-text-keys-multibyte', 'Encoded length counts UTF-8 bytes: "z" (1 byte) before U+00E9 (2 bytes).',
    { map: [[{ text: 'é' }, nat(1)], [{ text: 'z' }, nat(2)]] }, 'a2' + '617a02' + '62c3a901');
  E('map-nested', 'Map inside a map value.', { map: [[nat(1), { map: [[{ text: 'k' }, { bytes: 'ff' }]] }]] }, 'a101a1616b41ff');

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
  R('text-not-nfc', '6365cc81', 'non_nfc', '"e" followed by a combining acute accent is not NFC.');
  R('map-key-not-nfc', 'a16365cc8100', 'non_nfc', 'A map key that is not NFC.');
  R('trailing-bytes', '0000', 'trailing_bytes', 'Two items where one was expected.');
  R('truncated-array', '8201', 'truncated', 'Array of two with one item.');
  R('truncated-bytes', '4201', 'truncated', 'Byte string shorter than its length.');
  R('truncated-head', '18', 'truncated', 'Argument byte missing.');
  R('empty-input', '', 'truncated', 'No bytes at all.');
  R('huge-array-length', '9bffffffffffffffff', 'truncated', 'Array claiming 2^64-1 items.');
  R('too-deep', '81'.repeat(70) + '00', 'too_deep', 'Seventy nested arrays. The spec sets no depth limit; this implementation refuses beyond 64 (finding).');
  o.add('cbor/accept/mixed-values', 'A canonical map decodes and re-encodes to the same bytes.', 'cbor.accept',
    { hex: 'a30181f6020a03a1626b3081f5' });
  return file('Deterministic CBOR (section 2).', o);
}

// ------------------------------------------------------------------ people, X-Wing, HPKE
const seed32 = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i + n) & 255);

function personVectors(s: Scenario, minted: Minted): J {
  const o = new Out();
  const alice = s.person('alice'), bob = s.person('bob');
  for (const [n, p] of [['alice', alice], ['bob', bob]] as const) o.add(`person/derive-${n}`, `Person ${n}: sign_seed, kem_seed, pid, kem_pk and card from a fixed secret.`, 'person.derive', { ps: H(p.ps) });
  const card = encode(makeCard(alice));
  o.add('card/verify-ok', 'A correctly signed card.', 'card.verify', { card: H(card) });
  const flip = (b: Uint8Array, i: number) => { const c = b.slice(); c[i]! ^= 1; return c; };
  o.add('card/verify-bad-signature', 'The last bit of the signature flipped.', 'card.verify', { card: H(flip(card, card.length - 1)) });
  o.add('card/verify-bad-kem-pk', 'One bit of kem_pk flipped: the signature covers it.', 'card.verify', { card: H(flip(card, 60)) });
  o.add('card/verify-wrong-pid', 'bob\'s pid with alice\'s kem_pk and signature.', 'card.verify',
    { card: H(encode(cmap([[1, bob.pid], [2, alice.kemPk], [3, makeCard(alice).get(3) as Uint8Array]]))) });
  o.add('card/verify-extra-key', 'A card with an undefined key 4.', 'card.verify', { card: H(encode(cmap([...makeCard(alice) as Map<number, CborValue>, [4, 0]]))) });
  o.add('card/verify-missing-sig', 'A card without key 3.', 'card.verify', { card: H(encode(cmap([[1, alice.pid], [2, alice.kemPk]]))) });
  o.add('card/verify-short-kem-pk', 'kem_pk of 1215 bytes.', 'card.verify', { card: H(encode(cmap([[1, alice.pid], [2, alice.kemPk.slice(1)], [3, new Uint8Array(64)]]))) });
  o.add('gid/alice', 'gid from a creator pid and a genesis nonce.', 'gid', { creator_pid: H(alice.pid), genesis_nonce: H(s.nonce) });
  for (const e of [0, 1, 4294967295]) o.add(`commit/epoch-${e}`, `Key commitment for epoch ${e}.`, 'commit', { gid: H(s.gid), epoch: e, key: H(s.key(0)) });

  // X-Wing and HPKE with a fixed KEM output (see README: Node cannot fix ML-KEM encapsulation randomness).
  const sd = seed32(0);
  o.add('xwing/keygen-seed-0-31', 'X-Wing public key (1216 bytes) from the 32-byte seed 00..1f.', 'xwing.keygen', { seed: H(sd) });
  const pk = xw.publicKey(sd);
  const ctM = fromHex(minted.mlkem_ct_wrap);
  const ssM = mlkemSs(sd, ctM);
  const ek = seed32(100);
  const kem = { pk: H(pk), ek_x: H(ek), mlkem_ct: H(ctM), mlkem_ss: H(ssM) };
  const enc = o.add('xwing/encapsulate-fixed', 'X-Wing encapsulation with fixed X25519 ephemeral and a fixed ML-KEM encapsulation.', 'xwing.encapsulate', kem);
  o.add('xwing/decapsulate', 'The same ciphertext decapsulates to the same shared secret.', 'xwing.decapsulate', { seed: H(sd), ct: enc.expected.ct }, { ss: enc.expected.ss });
  const info = utf8('test info'), aad = utf8('test aad'), pt = seed32(200);
  const seal = o.add('hpke/seal-fixed', 'HPKE base-mode single-shot seal, KEM id 0x647a, HKDF-SHA256, AES-256-GCM, with fixed KEM randomness.', 'hpke.seal',
    { ...kem, info: H(info), aad: H(aad), pt: H(pt) });
  o.add('hpke/open', 'Open the sealed blob above.', 'hpke.open', { seed: H(sd), info: H(info), aad: H(aad), blob: seal.expected.blob }, { pt: H(pt) });
  o.add('hpke/open-wrong-aad', 'Wrong aad: open fails.', 'hpke.open', { seed: H(sd), info: H(info), aad: H(utf8('other')), blob: seal.expected.blob });
  o.add('hpke/open-wrong-info', 'Wrong info: open fails.', 'hpke.open', { seed: H(sd), info: H(utf8('other')), aad: H(aad), blob: seal.expected.blob });
  return file('Person, card, gid, commitment, X-Wing and HPKE (sections 1 and 3).', o);
}

function mlkemSs(seed: Uint8Array, ct: Uint8Array): Uint8Array {
  // The ML-KEM-768 shared secret that decapsulation of `ct` yields (generator-side helper only).
  const { mlkemSeed } = xw.expand(seed);
  return mlkemDecaps(mlkemSeed, ct);
}
import { mlkem768FromSeed } from '../src/prims.ts';
const mlkemDecaps = (seed: Uint8Array, ct: Uint8Array) => mlkem768FromSeed(seed).decapsulate(ct);

// ------------------------------------------------------------------ records
const payloadHex = (id: Uint8Array, set: [string, CborValue][], clear: string[] = []) => H(encode(itemPayload(id, set, clear)));

function recordInput(s: Scenario, who: string, dev: string, seq: number, prev: Uint8Array | null, clock: [number, number], payload: string,
                     over: J = {}): J {
  const p = s.person(who);
  return { signer_ps: H(p.ps), gid: H(s.gid), epoch: 0, key: H(s.key(0)), salt: H(bytesOf(`vector salt ${who}${seq}${over.tag ?? ''}`)),
           author: H(p.pid), device: H(s.device(dev)), seq, prev: prev ? H(prev) : null, clock, kind: KIND.item, payload, ...over, tag: undefined };
}

function fitPayload(target: number, base: J): { payload: string; name: string } {
  for (const name of ['f', 'ff', 'fff', 'ffff']) {
    for (let len = 0; len < 20000; len++) {
      const ph = payloadHex(itemId('pad'), [[name, new Uint8Array(len)]]);
      const r = compute('record.seal', { ...base, payload: ph });
      if (r.plaintext_len_before_padding === target) return { payload: ph, name };
      if (r.plaintext_len_before_padding > target) break;
    }
  }
  throw new Error(`cannot hit ${target}`);
}

function recordVectors(s: Scenario): J {
  const o = new Out();
  const keys = s.keyList().filter((k) => k.epoch === 0);
  o.add('record/key', 'Per-record key rk = HKDF(K_epoch, salt, "psss/v1/record").', 'record.key', { key: H(s.key(0)), salt: H(bytesOf('vector salt')) });
  const base = recordInput(s, 'alice', 'a1', 1, null, [BASE_MS, 0], payloadHex(itemId('1'), [['title', 'Hello'], ['url', 'https://example.com']], ['old']));
  const sealed = o.add('record/seal-item', 'A sealed item-change record end to end: header, body, signature, padding, record id.', 'record.seal', base);
  const open = (name: string, desc: string, sealedHex: string, ks = keys, expected?: J) =>
    o.add(`record/open/${name}`, desc, 'record.open', { keys: ks, sealed: sealedHex }, expected);
  open('ok', 'The record above opens.', sealed.expected.sealed);
  const sealedB = fromHex(sealed.expected.sealed);
  const flipAt = (i: number) => { const c = sealedB.slice(); c[i]! ^= 0x01; return H(c); };
  open('bad-magic', 'First byte of the magic flipped (step 1).', flipAt(0), keys, { error: { code: 'bad_magic', step: 1 } });
  open('unknown-gid', 'The reader knows no group with this gid (step 1).', sealed.expected.sealed, [{ gid: H(bytesOf('other gid')), epoch: 0, key: H(s.key(0)) }], { error: { code: 'unknown_gid', step: 1 } });
  open('no-key-for-epoch', 'The reader holds no key for epoch 0 (step 1).', sealed.expected.sealed, [{ gid: H(s.gid), epoch: 1, key: H(s.key(1)) }], { error: { code: 'no_key', step: 1 } });
  open('gid-bit-flipped', 'One bit of the gid flipped: the gid is unknown (step 1).', flipAt(10), keys, { error: { code: 'unknown_gid', step: 1 } });
  open('bad-tag', 'Last ciphertext byte flipped (step 2).', flipAt(sealedB.length - 1), keys, { error: { code: 'bad_tag', step: 2 } });
  open('salt-bit-flipped', 'One bit of the salt flipped: another record key (step 2).', flipAt(50), keys, { error: { code: 'bad_tag', step: 2 } });
  open('too-short', 'Fewer than 88 bytes (step 1).', H(sealedB.slice(0, 80)), keys, { error: { code: 'too_short', step: 1 } });

  // Hand-crafted plaintexts under the same key.
  const salt = bytesOf('vector crafted');
  const goodBody = fromHex(compute('record.seal', base).signed_message); // not a body; replaced below
  void goodBody;
  const bodyBytes = (b: J) => {
    const f = { author: fromHex(b.author), device: fromHex(b.device), seq: b.seq, prev: null, clock: b.clock as [number, number], kind: b.kind, payload: cmap([[1, itemId('1')], [2, new Map() as CborValue], [3, []]]) };
    const m = bodyMap(f);
    const hdr = header(s.gid, 0, salt);
    m.set(9, ed25519Sign(s.person('alice').signSeed, signedBytes(hdr, bodyMap(f))));
    return { m, hdr };
  };
  const { m: m0 } = bodyBytes(base);
  const enc0 = encode(m0);
  const crafted = (name: string, desc: string, plain: Uint8Array, code: string, step = 2) =>
    open(name, desc, H(sealPlaintext(s.gid, 0, s.key(0), salt, plain)), keys, { error: { code, step } });
  const padded = padPlaintext(enc0);
  const nonzero = padded.slice(); nonzero[nonzero.length - 1] = 1;
  crafted('padding-not-zero', 'A non-zero byte in the padding.', nonzero, 'bad_padding');
  const wide = new Uint8Array(padded.length + 256); wide.set(padded);
  crafted('padding-not-minimal', 'Padded to a permitted size, but longer than the rule gives.', wide, 'bad_size');
  const odd = padded.slice(0, padded.length - 1);
  crafted('size-not-permitted', 'Plaintext of 255 bytes: not a permitted size.', odd, 'bad_size');
  const longLen = padded.slice(); new DataView(longLen.buffer).setUint32(0, padded.length);
  crafted('length-exceeds-plaintext', 'u32(len(body)) larger than the plaintext.', longLen, 'bad_length');
  const huge = padded.slice(); new DataView(huge.buffer).setUint32(0, (1 << 20) + 1);
  crafted('body-over-1mib', 'u32(len(body)) of 1 MiB + 1.', huge, 'body_too_large');
  const nonShortest = concat(Uint8Array.of(...enc0.slice(0, 2)), Uint8Array.of(0x18, 0x01), enc0.slice(3));
  crafted('body-not-deterministic', 'The version written as 18 01 instead of 01.', padPlaintext(nonShortest), 'bad_body');
  const extraKey = (() => { const m = new Map(m0); m.set(10, 0); return padPlaintext(encode(m)); })();
  crafted('body-unknown-key', 'The body carries key 10.', extraKey, 'bad_body_schema');
  const v2 = (() => { const m = new Map(m0); m.set(1, 2); return padPlaintext(encode(m)); })();
  crafted('body-version-2', 'v is 2.', v2, 'bad_body_schema');
  const prev1 = (() => { const m = new Map(m0); m.set(5, new Uint8Array(32)); return padPlaintext(encode(m)); })();
  crafted('body-prev-with-seq-1', 'seq is 1 but prev is not null.', prev1, 'bad_body_schema');
  const trailing = padPlaintext(concat(enc0, Uint8Array.of(0)));
  crafted('body-trailing-byte', 'One extra byte after the body map, inside the declared length.', trailing, 'bad_body');

  // Signature failures.
  const forged = compute('record.seal', { ...base, signer_ps: H(s.person('mallory').ps), tag: 'forged' });
  open('bad-signature-wrong-signer', 'Body names alice as author but is signed with mallory\'s key (step 3).', forged.sealed, keys, { error: { code: 'bad_signature', step: 3 } });
  const zeroSig = compute('record.seal', { ...base, sig_override: H(new Uint8Array(64)) });
  open('bad-signature-zero', 'An all-zero signature (step 3).', zeroSig.sealed, keys, { error: { code: 'bad_signature', step: 3 } });
  // Moved header: alice's real body and signature, sealed under a new header by someone who holds the key.
  const real = openRecord(sealedB, keyRing([[s.gid, 0, s.key(0)]]));
  const realBody = encode(real.body);
  open('moved-header-new-salt', 'The same signed body re-sealed with another salt: the signature covers the header (step 3).',
    H(sealPlaintext(s.gid, 0, s.key(0), bytesOf('moved salt'), padPlaintext(realBody))), keys, { error: { code: 'bad_signature', step: 3 } });
  open('moved-header-new-epoch', 'The same signed body re-sealed into epoch 1: cannot be moved to another epoch (step 3).',
    H(sealPlaintext(s.gid, 1, s.key(1), bytesOf('moved salt'), padPlaintext(realBody))), s.keyList(), { error: { code: 'bad_signature', step: 3 } });
  const otherGid = bytesOf('other group');
  open('moved-header-new-group', 'The same signed body re-sealed into another group: cannot be moved (step 3).',
    H(sealPlaintext(otherGid, 0, s.key(0), bytesOf('moved salt'), padPlaintext(realBody))), [...keys, { gid: H(otherGid), epoch: 0, key: H(s.key(0)) }], { error: { code: 'bad_signature', step: 3 } });
  // Payload shape.
  const both = compute('record.seal', { ...base, payload: H(encode(cmap([[1, itemId('1')], [2, new Map([['a', 1]]) as CborValue], [3, ['a']]]))), tag: 'both' });
  open('payload-field-in-set-and-clear', 'A field named in both set and clear (5.1).', both.sealed, keys, { error: { code: 'bad_payload', step: 2 } });
  const unsortedClear = compute('record.seal', { ...base, payload: H(encode(cmap([[1, itemId('1')], [2, new Map() as CborValue], [3, ['aa', 'b']]]))), tag: 'unsorted' });
  open('payload-clear-unsorted', 'clear = ["aa","b"]: not sorted by encoding (b first), read strictly.', unsortedClear.sealed, keys, { error: { code: 'bad_payload', step: 2 } });
  const dupClear = compute('record.seal', { ...base, payload: H(encode(cmap([[1, itemId('1')], [2, new Map() as CborValue], [3, ['a', 'a']]]))), tag: 'dup' });
  open('payload-clear-duplicate', 'clear = ["a","a"]: not unique.', dupClear.sealed, keys, { error: { code: 'bad_payload', step: 2 } });
  const delBad = compute('record.seal', { ...base, payload: payloadHex(itemId('1'), [['deleted', 'yes']]), tag: 'del' });
  open('payload-deleted-not-integer', 'The reserved field deleted set to a text string.', delBad.sealed, keys, { error: { code: 'bad_payload', step: 2 } });
  const unknownKind = compute('record.seal', { ...base, kind: 99, payload: H(encode(cmap([[1, 2]]))), tag: 'k99' });
  open('unknown-kind-opens', 'Kind 99 passes steps 1 to 3; what a reader does with it is not specified (finding).', unknownKind.sealed);

  // Padding boundaries: exact plaintext sizes before padding.
  const pbase = recordInput(s, 'alice', 'a1', 1, null, [BASE_MS, 0], '');
  for (const n of [255, 256, 257, 4095, 4096, 4097, 8192, 8193]) {
    const fit = fitPayload(n, pbase);
    const v = o.add(`padding/record-${n}`, `Record whose plaintext is exactly ${n} bytes before padding.`, 'record.seal', { ...pbase, payload: fit.payload });
    assert.equal(v.expected.plaintext_len_before_padding, n);
    assert.equal(v.expected.padded_len, paddedLength(n));
    assert.equal(v.expected.sealed_len, 72 + v.expected.padded_len + 16);
  }
  for (const [n, p] of [[1, 256], [255, 256], [256, 256], [257, 512], [4095, 4096], [4096, 4096], [4097, 8192], [8192, 8192], [8193, 12288],
                        [1048580, 1052672]] as const) {
    o.add(`padding/length-${n}`, `Padded length of a ${n}-byte plaintext.`, 'padding.length', { plaintext_len: n }, { padded: p });
  }
  return file('Sealed records, padding and the reader checks of section 9 steps 1 to 3 (section 4).', o);
}

// ------------------------------------------------------------------ clock
function clockVectors(s: Scenario): J {
  const o = new Out();
  const a = H(s.person('alice').pid), b = H(s.person('bob').pid), d1 = H(s.device('d1')), d2 = H(s.device('d2'));
  const c = (wall: number, counter: number, author: string, device: string, seq: number) => ({ wall, counter, author, device, seq });
  o.add('clock/order/wall-first', 'wall_ms dominates the counter.', 'clock.order', { clocks: [c(2, 0, a, d1, 1), c(1, 9, a, d1, 1)] }, { order: [1, 0] });
  o.add('clock/order/counter', 'Equal wall_ms: counter decides.', 'clock.order', { clocks: [c(5, 2, a, d1, 1), c(5, 1, b, d1, 1), c(5, 3, a, d1, 1)] }, { order: [1, 0, 2] });
  o.add('clock/order/author-bytes', 'Equal wall_ms and counter: author, compared bytewise.', 'clock.order', { clocks: [c(5, 0, b, d1, 1), c(5, 0, a, d1, 1)] }, { order: a < b ? [1, 0] : [0, 1] });
  o.add('clock/order/device', 'Same author: device, bytewise.', 'clock.order', { clocks: [c(5, 0, a, d2, 1), c(5, 0, a, d1, 1)] }, { order: d1 < d2 ? [1, 0] : [0, 1] });
  o.add('clock/order/seq', 'Same chain: seq.', 'clock.order', { clocks: [c(5, 0, a, d1, 3), c(5, 0, a, d1, 2)] }, { order: [1, 0] });
  o.add('clock/order/bytes-not-hex-text', 'Author 0x0a.. against 0x9f..: bytewise numeric order, not text order of unrelated encodings.', 'clock.order',
    { clocks: [c(5, 0, '9f' + '00'.repeat(31), d1, 1), c(5, 0, '0a' + 'ff'.repeat(31), d1, 1)] }, { order: [1, 0] });
  o.add('clock/order/large-values', 'wall_ms and counter beyond 32 bits.', 'clock.order',
    { clocks: [c(4294967296, 0, a, d1, 1), c(4294967295, 4294967296, a, d1, 1)] }, { order: [1, 0] });
  o.add('clock/next/own-time-ahead', 'Own time later than anything seen: counter 0.', 'clock.next', { now_ms: 1000, seen: [[900, 4]] }, { clock: [1000, 0] });
  o.add('clock/next/equal-wall', 'Own time equals the largest seen wall_ms: counter one more.', 'clock.next', { now_ms: 900, seen: [[900, 4], [800, 9]] }, { clock: [900, 5] });
  o.add('clock/next/behind', 'Own clock behind: take the largest wall_ms seen, counter one more than the largest there.', 'clock.next', { now_ms: 100, seen: [[900, 4], [900, 2], [800, 9]] }, { clock: [900, 5] });
  o.add('clock/next/nothing-seen', 'Nothing seen.', 'clock.next', { now_ms: 7, seen: [] }, { clock: [7, 0] });
  const day = 86400000;
  o.add('clock/held-back/exactly-24h', 'Exactly 24 hours ahead: not more than 24 hours, so not held back.', 'clock.held_back', { wall_ms: 1000 + day, now_ms: 1000 }, { held_back: false });
  o.add('clock/held-back/one-ms-over', '24 hours and 1 ms ahead: held back.', 'clock.held_back', { wall_ms: 1001 + day, now_ms: 1000 }, { held_back: true });
  o.add('clock/held-back/past', 'In the past.', 'clock.held_back', { wall_ms: 5, now_ms: 1000 }, { held_back: false });
  return file('Clock and total order (section 4.5).', o);
}

// ------------------------------------------------------------------ fold
function foldVectors(s: Scenario): J {
  const o = new Out();
  const A = s.person('alice').pid, B = s.person('bob').pid, d1 = s.device('d1'), d2 = s.device('d2');
  const I = itemId('i1'), I2 = itemId('i2');
  let n = 0;
  const ch = (who: Uint8Array, dev: Uint8Array, seq: number, wall: number, counter: number, item: Uint8Array, set: [string, CborValue][], clear: string[] = []) =>
    ({ clock: [wall, counter], author: H(who), device: H(dev), seq, payload: payloadHex(item, set, clear), _n: n++ });
  const strip = (cs: J[]) => cs.map(({ _n, ...r }) => r);
  const run = (name: string, desc: string, cs: J[], orders?: number[][]) => o.add(`fold/${name}`, desc, 'fold.run', { changes: strip(cs), ...(orders ? { orders } : {}) });

  run('different-fields', 'Two records set different fields of one item: both fields keep their values.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 11, 0, I, [['url', 'U']])]);
  run('same-field', 'Same field set twice: the later one wins, the earlier is history.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'old']]), ch(B, d1, 1, 20, 0, I, [['title', 'new']])]);
  run('same-field-reversed-input', 'The same two records listed in the other order give the same state.',
    [ch(B, d1, 1, 20, 0, I, [['title', 'new']]), ch(A, d1, 1, 10, 0, I, [['title', 'old']])]);
  run('tie-wall-counter-author', 'Equal wall_ms and counter: the greater author (bytewise) wins.',
    [ch(A, d1, 1, 10, 0, I, [['f', 'from alice']]), ch(B, d1, 1, 10, 0, I, [['f', 'from bob']])]);
  run('tie-counter', 'Equal wall_ms: the greater counter wins even from the smaller author.',
    [ch(A, d1, 1, 10, 1, I, [['f', 'counter 1']]), ch(B, d1, 1, 10, 0, I, [['f', 'counter 0']])]);
  run('clear-after-set', 'A later clear beats an earlier set: the field is cleared and the value is history.',
    [ch(A, d1, 1, 10, 0, I, [['note', 'x']]), ch(B, d1, 1, 20, 0, I, [], ['note'])]);
  run('set-after-clear', 'A later set beats an earlier clear.',
    [ch(A, d1, 1, 10, 0, I, [], ['note']), ch(B, d1, 1, 20, 0, I, [['note', 'back']])]);
  run('set-and-clear-different-fields-one-record', 'One record sets one field and clears another.',
    [ch(A, d1, 1, 10, 0, I, [['a', 1], ['b', 2]]), ch(A, d1, 2, 20, 0, I, [['a', 3]], ['b'])]);
  run('null-value-vs-clear', 'A field set to the value null is not the same as a cleared field (until a checkpoint, see findings).',
    [ch(A, d1, 1, 10, 0, I, [['f', null]]), ch(A, d1, 2, 11, 0, I, [], ['g'])]);
  run('delete-after-edit', 'deleted later than every other field: the item is in Recently Deleted.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]])]);
  run('edit-after-delete', 'An edit later than the delete brings the item back.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]]), ch(A, d1, 2, 30, 0, I, [['title', 'T2']])]);
  run('clear-after-delete', 'A later clear of another field also counts as an edit.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'T']]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]]), ch(A, d1, 2, 30, 0, I, [], ['title'])]);
  run('delete-in-same-record-as-edit', 'A record that sets deleted and another field: the other field is not later than the delete, so the item stays deleted.',
    [ch(A, d1, 1, 10, 0, I, [['title', 'T'], ['deleted', 10]])]);
  run('clear-deleted-field', 'Clearing deleted undeletes the item.',
    [ch(A, d1, 1, 10, 0, I, [['deleted', 10]]), ch(A, d1, 2, 20, 0, I, [], ['deleted'])]);
  run('delete-twice', 'Deleted set twice: the later value wins; still deleted.',
    [ch(A, d1, 1, 10, 0, I, [['deleted', 10]]), ch(B, d1, 1, 20, 0, I, [['deleted', 20]])]);
  run('two-items', 'Records for two items stay separate.',
    [ch(A, d1, 1, 10, 0, I, [['t', 1]]), ch(A, d1, 2, 11, 0, I2, [['t', 2]])]);
  run('structured-values', 'Values are opaque: a map value wins or loses whole.',
    [ch(A, d1, 1, 10, 0, I, [['passkey', new Map<number | string, CborValue>([[1, new Uint8Array([1, 2])], [2, 'rp']]) as CborValue]]),
     ch(B, d1, 1, 20, 0, I, [['passkey', new Map<number | string, CborValue>([[1, new Uint8Array([3])]]) as CborValue]])]);
  const four = [ch(A, d1, 1, 10, 0, I, [['title', 'a'], ['url', 'u1']]), ch(B, d2, 1, 12, 0, I, [['title', 'b']], ['note']), ch(A, d1, 2, 14, 0, I, [['note', 'n']]),
                ch(B, d2, 2, 16, 0, I, [['url', 'u2']])];
  run('three-orders-one-state', 'The same four records folded in three different orders (listed) give one state.', four, [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]);
  const dup = ch(A, d1, 1, 10, 0, I, [['title', 'T']]);
  run('duplicate-record', 'The same record twice changes nothing.', [dup, { ...dup }, ch(B, d1, 1, 11, 0, I, [['title', 'U']])]);
  return file('Folding item changes into state (section 5.1).', o);
}

// ------------------------------------------------------------------ checkpoint
function checkpointVectors(s: Scenario): J {
  const o = new Out();
  const A = s.person('alice').pid, B = s.person('bob').pid, d1 = s.device('d1'), d2 = s.device('d2');
  const I = itemId('i1'), I2 = itemId('i2');
  const ch = (who: Uint8Array, dev: Uint8Array, seq: number, wall: number, counter: number, item: Uint8Array, set: [string, CborValue][], clear: string[] = []) =>
    ({ clock: [wall, counter], author: H(who), device: H(dev), seq, payload: payloadHex(item, set, clear) });
  const before = [ch(A, d1, 1, 10, 0, I, [['title', 'old'], ['url', 'u']]), ch(B, d2, 1, 12, 0, I, [['title', 'mid']]), ch(A, d1, 2, 14, 0, I, [], ['url']),
                  ch(B, d2, 2, 15, 0, I2, [['t', 1], ['deleted', 15]])];
  const covered = [{ author: H(A), device: H(d1), seq: 2, record_id: H(bytesOf('rec A2')) }, { author: H(B), device: H(d2), seq: 2, record_id: H(bytesOf('rec B2')) }];
  const mhead = H(bytesOf('membership head'));
  const after = [ch(A, d1, 3, 20, 0, I, [['title', 'new']]), ch(B, d2, 3, 11, 0, I, [['title', 'late but earlier than the checkpoint winner']]),
                 ch(B, d2, 4, 30, 0, I2, [['t', 2]])];
  o.add('checkpoint/fold-on-top', 'Checkpoint of four records; then a later edit, a record with an older clock (loses to the checkpointed winner), and an edit of a deleted item (revives it). History before the checkpoint is gone.',
    'checkpoint.fold', { before, after, covered, mhead });
  o.add('checkpoint/nothing-after', 'A checkpoint and no later records.', 'checkpoint.fold', { before, after: [], covered, mhead });
  o.add('checkpoint/null-collision', 'A field set to the value null and a cleared field give identical checkpoint bytes (finding).', 'checkpoint.null_collision',
    { author: H(A), device: H(d1), item: H(I) });
  return file('Checkpoints (section 5.3).', o);
}

// ------------------------------------------------------------------ groups (membership, chains, checkpoints end to end)
function groupVector(o: Out, name: string, desc: string, s: Scenario, recs: Rec[], labels: Record<string, Rec>, extra: J = {}): J {
  const lab: J = {};
  for (const [k, r] of Object.entries(labels)) lab[H(r.id)] = k;
  const people: J = {};
  for (const [k, p] of s.persons) people[k] = H(p.pid);
  const devices: J = {};
  return o.add(`group/${name}`, desc, 'group.evaluate', { gid: H(s.gid), keys: s.keyList(), records: recs.map((r) => H(r.sealed)), ...extra, labels: lab, people, devices });
}

function groupVectors(): J {
  const o = new Out();
  const I = itemId('i1');

  { // lifecycle
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const bob1 = s.item('bob', 'b1', I, [['title', 'Hi']]); const carol1 = s.item('carol', 'c1', I, [['note', 'by a reader']]);
    const dave1 = s.item('dave', 'd1', I, [['x', 1]]);
    const promote = s.setRole('alice', 'a1', 'carol', 2); const carol2 = s.item('carol', 'c1', I, [['note', 'by a writer']]);
    groupVector(o, 'lifecycle-roles', 'Genesis, a writer, a reader. A reader\'s record is ignored; a stranger\'s is ignored; after the reader is promoted within the same epoch the earlier record is accepted too, because the rule is "writer at some point in its epoch".',
      s, [g, addBob, addCarol, bob1, carol1, dave1, promote, carol2], { g, addBob, addCarol, bob1, carol1, dave1, promote, carol2 });
  }
  { // removal with cut
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]); const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b2dev = s.item('bob', 'b2', I, [['n', 7]], [], { epoch: 0 });
    const remove = s.setRole('alice', 'a1', 'bob', 0, { cut: [[s.device('b1'), 1]] });
    s.key(1); const ep = s.newEpoch('alice', 'a1', 1);
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { epoch: 0 });
    const b3new = s.item('bob', 'b3', I, [['n', 9]], [], { epoch: 0 });
    const bLeak = s.item('bob', 'b1', I, [['n', 4]], [], { epoch: 1, seq: 4 });
    const a1 = s.item('alice', 'a1', I, [['title', 'after']]);
    groupVector(o, 'remove-with-cut-and-new-epoch', 'Bob writes twice on device b1 and once on device b2, then is removed with a cut that lists only (b1, seq 1) and an epoch record follows. Bob\'s b1 seq 1 is accepted; b1 seq 2 and 3, and every record on devices b2 and b3 (not in the cut), are beyond the cut; a record sealed in epoch 1 is ignored because bob is not a writer there.',
      s, [g, addBob, b1, b2, b2dev, remove, ep, b3, b3new, bLeak, a1], { g, addBob, b1, b2, b2dev, remove, ep, b3, b3new, bLeak, a1 });
  }
  { // removal without epoch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const remove = s.setRole('alice', 'a1', 'bob', 0, { cut: [] });
    groupVector(o, 'removal-without-epoch-record', 'A removal that is never followed by an epoch record: the removal takes effect and is reported as pending an epoch (the spec says MUST follow, not what a reader does without it).',
      s, [g, addBob, remove], { g, addBob, remove });
  }
  { // lowering writer to reader with cut and no epoch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const lower = s.setRole('alice', 'a1', 'bob', 1, { cut: [[s.device('b1'), 1]] });
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    groupVector(o, 'lower-writer-to-reader', 'A writer lowered to reader needs no new epoch; records beyond the cut are ignored.', s, [g, addBob, b1, lower, b2], { g, addBob, b1, lower, b2 });
  }
  { // invalid membership records
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const head = s.mhead!;
    const keep = <T>(f: () => T): T => { const h = s.mhead; const e = s.epoch; const r = f(); s.mhead = h; s.epoch = e; return r; };
    const byReader = keep(() => s.setRole('carol', 'c1', 'dave', 1, { card: true }));
    const byWriter = keep(() => s.setRole('bob', 'b1', 'dave', 1, { card: true }));
    const addNoCard = keep(() => s.setRole('alice', 'a1', 'dave', 1));
    const lowerNoCut = keep(() => s.setRole('alice', 'a1', 'bob', 1));
    const raiseWithCut = keep(() => s.setRole('alice', 'a1', 'carol', 2, { cut: [[s.device('c1'), 1]] }));
    const removeStranger = keep(() => s.setRole('alice', 'a1', 'erin', 0, { cut: [] }));
    s.key(1); s.key(2);
    const epBadCommit = keep(() => s.seal('alice', 'a1', KIND.epoch, cmap([[1, head], [2, 1], [3, commitOf(s.gid, 1, s.key(2))], [4, s.key(0)]]), { epoch: 1 }));
    const epBadPrev = keep(() => s.seal('alice', 'a1', KIND.epoch, cmap([[1, head], [2, 1], [3, commitOf(s.gid, 1, s.key(1))], [4, s.key(2)]]), { epoch: 1 }));
    const epSkip = keep(() => s.seal('alice', 'a1', KIND.epoch, cmap([[1, head], [2, 2], [3, commitOf(s.gid, 2, s.key(2))], [4, s.key(1)]]), { epoch: 2 }));
    const epByWriter = keep(() => s.seal('bob', 'b1', KIND.epoch, cmap([[1, head], [2, 1], [3, commitOf(s.gid, 1, s.key(1))], [4, s.key(0)]]), { epoch: 1 }));
    const wrongEpoch = keep(() => s.seal('alice', 'a1', KIND.member, cmap([[1, head], [2, makeCard(s.person('dave'))], [3, 1]]), { epoch: 1 }));
    const goodAdd = s.setRole('alice', 'a1', 'dave', 1, { card: true });
    const labels = { g, addBob, addCarol, byReader, byWriter, addNoCard, lowerNoCut, raiseWithCut, removeStranger, epBadCommit, epBadPrev, epSkip, epByWriter, wrongEpoch, goodAdd };
    groupVector(o, 'invalid-membership-records', 'Eleven records that name the current head as mprev and are each invalid for a different reason; they are kept and ignored, and the one valid add continues the chain.',
      s, Object.values(labels), labels);
  }
  { // fork: removal beats a smaller record id
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const head = s.mhead!;
    const bobAdds = s.setRole('bob', 'b1', 'carol', 2, { card: true, mprev: head });
    s.mhead = head;
    const aliceRemoves = s.setRole('alice', 'a1', 'bob', 0, { cut: [], mprev: head, grind: (id) => Buffer.compare(id, bobAdds.id) > 0 });
    s.key(1); const ep = s.newEpoch('alice', 'a1', 1);
    groupVector(o, 'fork-removal-beats-smaller-id', 'Two managers name the same mprev: alice removes bob, bob adds carol. Bob\'s record has the smaller record id, but a record that removes the other\'s author wins.',
      s, [g, addBob, bobAdds, aliceRemoves, ep], { g, addBob, bobAdds, aliceRemoves, ep });
  }
  for (const [tag, aliceSmaller] of [['alice-smaller', true], ['bob-smaller', false]] as const) {
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const head = s.mhead!;
    const first = s.setRole('alice', 'a1', 'carol', 2, { card: true, mprev: head });
    s.mhead = head;
    const second = s.setRole('bob', 'b1', 'dave', 2, { card: true, mprev: head, grind: (id) => (Buffer.compare(id, first.id) < 0) !== aliceSmaller });
    const follow = s.setRole('alice', 'a1', 'erin', 1, { card: true, mprev: (aliceSmaller ? first : second).id });
    groupVector(o, `fork-smaller-id-${tag}`, `Two managers add different people at the same mprev; neither removes the other, so the smaller record id wins (${aliceSmaller ? 'alice' : 'bob'}'s). The loser and anything after it on its branch is ignored.`,
      s, [g, addBob, first, second, follow], { g, addBob, aliceAdds: first, bobAdds: second, follow });
  }
  { // cycle
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const head = s.mhead!;
    const aRem = s.setRole('alice', 'a1', 'bob', 0, { cut: [], mprev: head });
    s.mhead = head;
    const bRem = s.setRole('bob', 'b1', 'alice', 0, { cut: [], mprev: head });
    groupVector(o, 'fork-mutual-removal', 'Each manager removes the other at the same mprev. The spec\'s first clause makes both win; this implementation falls back to the smaller record id (finding).',
      s, [g, addBob, aRem, bRem], { g, addBob, aRem, bRem });
  }
  { // epoch race
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true }); const addDave = s.setRole('alice', 'a1', 'dave', 2, { card: true });
    const removeDave = s.setRole('alice', 'a1', 'dave', 0, { cut: [] });
    const head = s.mhead!;
    s.key(1);
    const bobAdds = s.setRole('bob', 'b1', 'erin', 2, { card: true, mprev: head });
    s.mhead = head;
    const ep = s.newEpoch('alice', 'a1', 1, { mprev: head, grind: (id) => Buffer.compare(id, bobAdds.id) > 0 });
    groupVector(o, 'fork-epoch-record-loses-to-add', 'Alice removes dave and writes the epoch record; bob concurrently adds erin with the removal as mprev. The smaller record id (bob\'s) wins, alice\'s epoch record is ignored and the removal is left without an epoch (finding).',
      s, [g, addBob, addDave, removeDave, bobAdds, ep], { g, addBob, addDave, removeDave, bobAdds, ep });
  }
  { // genesis equivocation
    const s = new Scenario();
    const g1 = s.genesis('a1');
    s.last.clear();
    const g2 = s.genesis('a2', { clock: [BASE_MS + 999, 0] });
    groupVector(o, 'genesis-equivocation', 'Two valid genesis records for one gid (same creator and nonce, written on two devices so that no chain is forked). The fork rule does not cover genesis; the group is reported as forked at the root (finding).', s, [g1, g2], { g1, g2 });
  }
  { // chains
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b2fork = s.item('bob', 'b1', I, [['n', 20]], [], { seq: 2, prev: b1.id });
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { seq: 3, prev: b2.id });
    const c1 = s.item('alice', 'a2', I, [['m', 1]]);
    groupVector(o, 'chain-fork', 'Bob\'s device b1 has two different records with seq 2. Both are kept, neither is accepted, and nothing later in the chain (seq 3) is accepted; seq 1 is. Alice\'s other chain is unaffected.',
      s, [g, addBob, b1, b2, b2fork, b3, c1], { g, addBob, b1, b2, b2fork, b3, c1 });
  }
  { // gap + prev mismatch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b3 = s.item('bob', 'b1', I, [['n', 3]]);
    const x1 = s.item('bob', 'b2', I, [['n', 10]]);
    const x2 = s.item('bob', 'b2', I, [['n', 11]], [], { seq: 2, prev: bytesOf('some other record') });
    groupVector(o, 'chain-gap-and-prev-mismatch', 'Bob\'s b1 chain is missing seq 2 (behind: seq 3 waits). His b2 chain has seq 2 whose prev is not the record the reader holds as seq 1 (waits as well).',
      s, [g, addBob, b1, b3, x1, x2], { g, addBob, b1, b3, x1, x2 });
    void b2;
  }
  { // held back
    const s = new Scenario();
    const g = s.genesis(); const a1 = s.item('alice', 'a1', I, [['n', 1]]);
    const future = s.item('alice', 'a1', I, [['n', 2]], [], { clock: [BASE_MS + 86400000 + 5001, 0] });
    const after = s.item('alice', 'a1', I, [['n', 3]], [], { clock: [BASE_MS + 86400000 + 5002, 0] });
    groupVector(o, 'held-back-future-clock', 'The reader\'s time is BASE_MS + 5 s: a record 24 hours and 1 ms ahead is held back, and so is the one after it (its chain then has a hole).',
      s, [g, a1, future, after], { g, a1, future, after }, { now_ms: BASE_MS + 5000 });
  }
  { // replace a person's secret
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    s.key(1);
    const rep = s.replace('bob', 'b1', 'bob', 'bob2');
    const ep = s.newEpoch('alice', 'a1', 1);
    const bobOld = s.item('bob', 'b1', I, [['n', 666]], [], { epoch: 0, clock: [BASE_MS + 100000, 0] });
    const bob2 = s.item('bob2', 'n1', I, [['n', 2]]);
    groupVector(o, 'replace-secret-by-the-person', 'Bob replaces his own secret (signed with the old key) and alice writes the epoch record. The new pid takes the role. A later record written with the OLD key into the old epoch is still accepted, because kind 4 carries no cut (finding).',
      s, [g, addBob, b1, rep, ep, bobOld, bob2], { g, addBob, b1, rep, ep, bobOld, bob2 });
  }
  { // replace by manager, new pid already member
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const head = s.mhead!;
    const bad1 = s.replace('alice', 'a1', 'bob', 'carol', { mprev: head }); s.mhead = head;
    const bad2 = s.replace('carol', 'c1', 'bob', 'bob2', { mprev: head }); s.mhead = head;
    const ok = s.replace('alice', 'a1', 'bob', 'bob2', { mprev: head });
    groupVector(o, 'replace-secret-rules', 'A replacement naming a pid that is already a member, and one written by someone who is neither a manager nor the person, are ignored; a manager\'s replacement is valid.',
      s, [g, addBob, addCarol, bad1, bad2, ok], { g, addBob, addCarol, bad1, bad2, ok });
  }
  { // checkpoint bridging a deleted range, fixpoint
    const s = new Scenario();
    const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const x1 = s.item('alice', 'a1', I, [['title', 'one']]); const x2 = s.item('alice', 'a1', I, [['url', 'u']]); const x3 = s.item('alice', 'a1', itemId('i2'), [['t', 1]]);
    const addCarol = s.setRole('alice', 'a1', 'carol', 2, { card: true });
    const x4 = s.item('alice', 'a1', I, [['title', 'two']]);
    const b1 = s.item('bob', 'b1', I, [['note', 'n']]);
    // Bob's checkpoint covers alice's chain up to x3 and his own b1.
    const st = fold([x1, x2, x3, b1].map((r) => ({ key5: r.key5, payload: r.payload })));
    const items = checkpointItems(st);
    const covered: [Uint8Array, Uint8Array, number, Uint8Array][] = [[s.person('alice').pid, s.device('a1'), x3.seq, x3.id], [s.person('bob').pid, s.device('b1'), 1, b1.id]];
    const cp = s.seal('bob', 'b1', KIND.checkpoint, cmap([[1, covered.sort((p, q) => Buffer.compare(encode(p as CborValue), encode(q as CborValue))) as CborValue], [2, addBob.id], [3, items]]));
    const after = s.item('carol', 'c1', I, [['note', 'later']]);
    groupVector(o, 'checkpoint-full-history', 'Alice\'s items, a checkpoint by manager bob covering alice\'s chain up to seq 5 and his own first record, then later records. All records present: covered content is folded from the checkpoint, the rest on top.',
      s, [g, addBob, x1, x2, x3, addCarol, x4, b1, cp, after], { g, addBob, x1, x2, x3, addCarol, x4, b1, cp, after });
    groupVector(o, 'checkpoint-covered-records-deleted', 'The same group after the covered content records (alice seq 3 to 5) were deleted from storage. Alice\'s membership record at seq 6 is only accepted because the checkpoint covers the gap, and the checkpoint is only valid because bob\'s role comes from records that survive. The state is unchanged.',
      s, [g, addBob, addCarol, x4, b1, cp, after], { g, addBob, addCarol, x4, b1, cp, after });
    const bogus = s.seal('carol', 'c2', KIND.checkpoint, cmap([[1, [[s.person('alice').pid, s.device('a1'), 99, bytesOf('x')]] as CborValue], [2, addBob.id], [3, []]]));
    groupVector(o, 'checkpoint-by-non-manager', 'A checkpoint written by a writer (not a manager) is ignored and covers nothing.', s, [g, addBob, addCarol, x1, x2, x3, x4, bogus], { g, addBob, addCarol, x1, x2, x3, x4, bogus });
  }
  return file('Chains, membership, the fork rule, cuts and checkpoints end to end (sections 4.4, 5.3, 6, 9).', o);
}

// ------------------------------------------------------------------ slots, wraps, chunks, folder
function slotVectors(s: Scenario, minted: Minted): J {
  const o = new Out();
  const alice = s.person('alice');
  const slotId = bytesOf('slot password', 16), salt = bytesOf('argon salt', 16);
  const test = { memory: 64, passes: 2, lanes: 2 };
  const pw = o.add('slot/password-test-params', 'Password slot with TEST-ONLY Argon2id parameters (64 KiB, 2 passes, 2 lanes); a reader must refuse these outside test vectors.', 'slot.seal_password',
    { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(slotId), salt: H(salt), params: test, password: 'correct horse', test_only: true });
  o.add('slot/password-test-params-open', 'Open it with the password.', 'slot.open', { slot: pw.expected.slot, unlock: { password: 'correct horse' }, test_only: true }, { ps: H(alice.ps) });
  o.add('slot/password-wrong-password', 'Wrong password.', 'slot.open', { slot: pw.expected.slot, unlock: { password: 'wrong' }, test_only: true }, { error: { code: 'bad_unlock', step: 0 } });
  o.add('slot/password-refused-outside-tests', 'The same slot is refused when not running test vectors: below 65536 KiB and 2 passes.', 'slot.open',
    { slot: pw.expected.slot, unlock: { password: 'correct horse' }, test_only: false }, { error: { code: 'argon2_too_weak', step: 0 } });
  const pwNfc = o.add('slot/password-nfc', 'Password "e" + combining acute (NFD). It is normalised to NFC before hashing, so the precomposed spelling opens the same slot.', 'slot.seal_password',
    { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(slotId), salt: H(salt), params: test, password: 'café', test_only: true });
  o.add('slot/password-nfc-open-precomposed', 'Open the NFD slot with the NFC spelling.', 'slot.open', { slot: pwNfc.expected.slot, unlock: { password: 'café' }, test_only: true }, { ps: H(alice.ps) });
  const dflt = o.add('slot/password-default-params', 'Password slot with the default Argon2id parameters: 131072 KiB, 3 passes, 4 lanes.', 'slot.seal_password',
    { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(slotId), salt: H(salt), params: { memory: 131072, passes: 3, lanes: 4 }, password: 'correct horse' });
  o.add('slot/password-default-params-open', 'Open it, without the test-only allowance.', 'slot.open', { slot: dflt.expected.slot, unlock: { password: 'correct horse' }, test_only: false }, { ps: H(alice.ps) });
  const kit = bytesOf('recovery kit', 20);
  const kitText = o.add('kit/text', 'The printed form of a 20-byte recovery kit: RK1- and 32 Crockford base32 characters in groups of four, hyphen-separated (the separator is not in the spec).', 'kit.text', { kit: H(kit) });
  o.add('kit/parse', 'Reading the printed form back.', 'kit.parse', { text: kitText.expected.text }, { kit: H(kit) });
  o.add('kit/parse-lowercase-and-confusables', 'Lower case, spaces for hyphens, and O/I/L for 0/1/1 (Crockford decoding; not in the spec).', 'kit.parse',
    { text: 'rk1-' + kitText.expected.text.slice(4).toLowerCase().replaceAll('-', ' ').replaceAll('0', 'o').replaceAll('1', 'l') }, { kit: H(kit) });
  o.add('kit/parse-bad-prefix', 'Wrong prefix.', 'kit.parse', { text: kitText.expected.text.replace('RK1', 'RK2') }, { error: { code: 'bad_kit_prefix', step: 0 } });
  o.add('kit/parse-short', 'Thirty-one characters.', 'kit.parse', { text: kitText.expected.text.slice(0, -1) }, { error: { code: 'bad_kit_length', step: 0 } });
  const kslot = o.add('slot/kit', 'Recovery kit slot.', 'slot.seal_kit', { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(bytesOf('slot kit', 16)), kit: H(kit) });
  o.add('slot/kit-open', 'Open with the kit.', 'slot.open', { slot: kslot.expected.slot, unlock: { kit: H(kit) } }, { ps: H(alice.ps) });
  o.add('slot/kit-open-wrong-kit', 'Another kit.', 'slot.open', { slot: kslot.expected.slot, unlock: { kit: H(bytesOf('other kit', 20)) } }, { error: { code: 'bad_unlock', step: 0 } });
  const tampered = fromHex(kslot.expected.slot); tampered[10]! ^= 1;
  o.add('slot/kit-open-tampered-header', 'One bit of the slot map changed: the map is the aad.', 'slot.open', { slot: H(tampered), unlock: { kit: H(kit) } });
  // Device slot: a device with its own X-Wing key.
  const deviceSeed = bytesOf('device kem seed');
  const devicePk = xw.publicKey(deviceSeed);
  const dctM = fromHex(minted.mlkem_ct_device);
  const dss = mlkemSs(deviceSeed, dctM);
  const dslot = o.add('slot/device-seal-fixed', 'Device slot sealed to a device X-Wing key, with fixed KEM randomness (deterministic).', 'slot.seal_device',
    { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(bytesOf('slot device', 16)), device_kem_pk: H(devicePk), ek_x: H(seed32(50)), mlkem_ct: H(dctM), mlkem_ss: H(dss) });
  o.add('slot/device-open', 'The device opens its slot with its X-Wing seed.', 'slot.open', { slot: dslot.expected.slot, unlock: { device_kem_seed: H(deviceSeed) } }, { ps: H(alice.ps) });
  o.add('slot/device-open-wrong-device', 'Another device\'s key.', 'slot.open', { slot: dslot.expected.slot, unlock: { device_kem_seed: H(bytesOf('another device')) } });
  o.add('slot/wrong-unlock-type', 'A password offered to a device slot.', 'slot.open', { slot: dslot.expected.slot, unlock: { password: 'x' } }, { error: { code: 'wrong_unlock_for_slot_type', step: 0 } });
  // Slot whose PS does not match its pid (not covered by the spec).
  const forged = o.add('slot/device-forged-ps', 'Anyone who knows a device\'s public key can seal garbage to it. The slot claims alice\'s pid but holds another secret; a reader must check (not in the spec).', 'slot.seal_device',
    { ps: H(bytesOf('someone else ps')), pid: H(alice.pid), slot_id: H(bytesOf('slot forged', 16)), device_kem_pk: H(devicePk), ek_x: H(seed32(51)), mlkem_ct: H(dctM), mlkem_ss: H(dss) });
  o.add('slot/device-forged-ps-open', 'Opening yields a secret that does not derive the slot\'s pid.', 'slot.open', { slot: forged.expected.slot, unlock: { device_kem_seed: H(deviceSeed) } }, { error: { code: 'ps_does_not_match_pid', step: 0 } });
  return file('Slots and the recovery kit (section 7.2).', o);
}

export function externalWrapInput(s: Scenario) {
  const bob = s.person('bob');
  return { gid: H(s.gid), epoch: 3, key: H(bytesOf('external wrapped key')), recipient_pid: H(bob.pid), recipient_kem_seed: H(bob.kemSeed), recipient_kem_pk: H(bob.kemPk) };
}

function wrapVectors(s: Scenario, minted: Minted): J {
  const o = new Out();
  const bob = s.person('bob');
  const ctM = fromHex(minted.mlkem_ct_wrap);
  const ss = mlkemSs(bob.kemSeed, ctM);
  const inp = { gid: H(s.gid), epoch: 2, key: H(s.key(2)), recipient_pid: H(bob.pid), recipient_kem_pk: H(bob.kemPk), ek_x: H(seed32(77)), mlkem_ct: H(ctM), mlkem_ss: H(ss) };
  const w = o.add('wrap/seal-fixed', 'Group key K_2 wrapped to bob, with fixed KEM randomness (deterministic). enc (1120) || ciphertext (48) = 1168 bytes.', 'wrap.seal', inp);
  assert.equal(fromHex(w.expected.wrap).length, 1168);
  const open = { gid: inp.gid, epoch: 2, recipient_pid: inp.recipient_pid, recipient_kem_seed: H(bob.kemSeed), wrap: w.expected.wrap };
  o.add('wrap/open', 'Bob opens the wrap.', 'wrap.open', open, { key: inp.key });
  o.add('wrap/open-wrong-epoch', 'The info binds the epoch.', 'wrap.open', { ...open, epoch: 3 });
  o.add('wrap/open-wrong-recipient-pid', 'The info binds the recipient pid.', 'wrap.open', { ...open, recipient_pid: H(s.person('alice').pid) });
  o.add('wrap/open-wrong-gid', 'The info binds the gid.', 'wrap.open', { ...open, gid: H(bytesOf('other gid')) });
  const bad = fromHex(w.expected.wrap); bad[1200]! ^= 1;
  o.add('wrap/open-bit-flipped', 'A bit flipped in the AEAD ciphertext.', 'wrap.open', { ...open, wrap: H(bad) });
  const ext = externalWrapInput(s);
  o.add('wrap/open-sealed-by-python-cryptography', 'A wrap sealed by Python\'s cryptography 50 (hpke.Suite with KEM.MLKEM768_X25519), an independent implementation; random ephemeral key, so open only.', 'wrap.open',
    { gid: ext.gid, epoch: ext.epoch, recipient_pid: ext.recipient_pid, recipient_kem_seed: ext.recipient_kem_seed, wrap: minted.external_wrap }, { key: ext.key });
  return file('Wrapped group keys (section 7.1).', o);
}

function chunkVectors(): J {
  const o = new Out();
  const key = bytesOf('attachment key');
  for (const [i, d] of [[0, 'hello attachment'], [1, 'second chunk'], [4294967296, 'index beyond 32 bits']] as const) {
    const v = o.add(`chunk/seal-index-${i}`, `Chunk ${i}: nonce u96(index), aad "psss/v1/chunk".`, 'chunk.seal', { key: H(key), index: i, data: H(utf8(d)) });
    o.add(`chunk/open-index-${i}`, 'Opens.', 'chunk.open', { key: H(key), index: i, sealed: v.expected.sealed }, { data: H(utf8(d)) });
  }
  const v = compute('chunk.seal', { key: H(key), index: 0, data: H(utf8('x')) });
  o.add('chunk/open-wrong-index', 'The nonce binds the chunk index.', 'chunk.open', { key: H(key), index: 1, sealed: v.sealed });
  return file('Attachment chunks (section 5.2).', o);
}

function folderVectors(s0: Scenario, minted: Minted): J {
  const o = new Out();
  const s = new Scenario();
  const bob = s.person('bob');
  const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
  // Large records so that the segment passes 64 KiB: two of ~32 KiB.
  const big = (n: string) => s.item('alice', 'a1', itemId('big'), [[n, new Uint8Array(30000)]]);
  const r1 = big('f1'), r2 = big('f2'), r3 = big('f3');
  const small = s.item('bob', 'b1', itemId('s'), [['t', 'small']]);
  const ctM = fromHex(minted.mlkem_ct_wrap);
  const wrap = compute('wrap.seal', { gid: H(s.gid), epoch: 0, key: H(s.key(0)), recipient_pid: H(bob.pid), recipient_kem_pk: H(bob.kemPk), ek_x: H(seed32(9)), mlkem_ct: H(ctM), mlkem_ss: H(mlkemSs(bob.kemSeed, ctM)) }).wrap;
  const slot = compute('slot.seal_kit', { ps: H(bob.ps), pid: H(bob.pid), slot_id: H(bytesOf('folder slot', 16)), kit: H(bytesOf('folder kit', 20)) }).slot;
  const recs = [g, addBob, r1, r2, r3, small];
  o.add('folder/layout-and-segment-rotation', 'A folder with a slot, a wrap and records. Alice\'s chain: two records of about 32 KiB take the first segment past 64 KiB, so seq 5 starts a new segment named by its seq. Reading back lists records per segment in file order.', 'folder.tree',
    { gid: H(s.gid), slots: [{ pid: H(bob.pid), slot_id: H(bytesOf('folder slot', 16)), slot }], wraps: [{ epoch: 0, pid: H(bob.pid), wrap }],
      records: recs.map((r) => ({ author: H(r.author), device: H(r.device), seq: r.seq, sealed: H(r.sealed) })) });
  const a = frame(g.sealed), b = frame(addBob.sealed);
  const seg = concat(a, b);
  o.add('folder/segment-complete', 'Two complete frames.', 'folder.segment', { hex: H(seg) });
  o.add('folder/segment-partial-length', 'A final frame with only two of its four length bytes: ignored.', 'folder.segment', { hex: H(concat(seg, new Uint8Array([0, 0]))) });
  o.add('folder/segment-length-only', 'A final frame with its length and none of its body: ignored.', 'folder.segment', { hex: H(concat(seg, new Uint8Array([0, 0, 1, 0]))) });
  o.add('folder/segment-short-body', 'A final frame with part of its body: ignored.', 'folder.segment', { hex: H(concat(seg, frame(small.sealed).slice(0, 100))) });
  o.add('folder/segment-zero-length-frame', 'A zero-length frame is a complete (and useless) frame, not an incomplete one.', 'folder.segment', { hex: H(concat(seg, new Uint8Array(4))) });
  o.add('folder/segment-empty', 'An empty file.', 'folder.segment', { hex: '' }, { frames: [], incomplete_tail_bytes: 0 });
  void s0;
  return file('Folder layout and segments (section 8.1).', o);
}

// ------------------------------------------------------------------ all
export function buildVectors(minted: Minted): Record<string, J> {
  const s = new Scenario();
  return {
    'cbor.json': cborVectors(),
    'person.json': personVectors(s, minted),
    'record.json': recordVectors(s),
    'clock.json': clockVectors(s),
    'fold.json': foldVectors(s),
    'checkpoint.json': checkpointVectors(s),
    'group.json': groupVectors(),
    'slots.json': slotVectors(s, minted),
    'wraps.json': wrapVectors(s, minted),
    'chunks.json': chunkVectors(),
    'folder.json': folderVectors(s, minted),
  };
}

export const serialize = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export const loadMinted = (): Minted => JSON.parse(readFileSync(MINTED_PATH, 'utf8'));

/** `--mint` regenerates the ML-KEM encapsulations (random). The external wrap must be re-made by hand (README). */
function mint() {
  const s = new Scenario();
  const old: Partial<Minted> = existsSync(MINTED_PATH) ? JSON.parse(readFileSync(MINTED_PATH, 'utf8')) : {};
  const ct = (pk: Uint8Array) => H(mlkemEncap(pk.subarray(0, 1184)).ct);
  const next = { mlkem_ct_wrap: ct(s.person('bob').kemPk), mlkem_ct_device: ct(xw.publicKey(bytesOf('device kem seed'))), external_wrap: old.external_wrap ?? '' };
  writeFileSync(MINTED_PATH, JSON.stringify(next, null, 2) + '\n');
}
import { mlkem768Encapsulate as mlkemEncap } from '../src/prims.ts';

if (import.meta.main) {
  if (process.argv.includes('--mint')) { mint(); console.log('minted'); process.exit(0); }
  if (process.argv.includes('--external-input')) { console.log(JSON.stringify(externalWrapInput(new Scenario()))); process.exit(0); }
  const files = buildVectors(loadMinted());
  mkdirSync(VECTOR_DIR, { recursive: true });
  let total = 0;
  for (const [name, f] of Object.entries(files)) {
    writeFileSync(join(VECTOR_DIR, name), serialize(f));
    total += f.vectors.length;
    console.log(`${name}: ${f.vectors.length} vectors`);
  }
  console.log(`total: ${total}`);
}
void sha256; void toNotation; void sealRecord; void derivePerson; void slots;
