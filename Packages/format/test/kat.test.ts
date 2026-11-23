// Known-answer tests for the primitives and the node:crypto wrappers, from RFC values (independent of the vectors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHex, hex, utf8 } from '../src/bytes.ts';
import { aesGcmOpen, aesGcmSeal, argon2id, chachaOpen, chachaSeal, ed25519PublicFromSeed, ed25519Sign, ed25519Verify, hkdf, sha3_256, shake256,
         x25519, x25519PublicFromSeed, mlkem768Encapsulate, mlkem768FromSeed } from '../src/prims.ts';
import * as xw from '../src/xwing.ts';
import * as hpke from '../src/hpke.ts';

test('HKDF-SHA256, RFC 5869 test case 1', () => {
  const okm = hkdf(new Uint8Array(22).fill(0x0b), fromHex('000102030405060708090a0b0c'), fromHex('f0f1f2f3f4f5f6f7f8f9'), 42);
  assert.equal(hex(okm), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
});
test('HKDF-SHA256 with empty salt equals 32 zero bytes of salt (RFC 5869 test case 3 shape)', () => {
  const ikm = new Uint8Array(22).fill(0x0b);
  assert.equal(hex(hkdf(ikm, new Uint8Array(0), new Uint8Array(0), 42)), '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
});
test('Ed25519, RFC 8032 test 1', () => {
  const seed = fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  assert.equal(hex(ed25519PublicFromSeed(seed)), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const sig = ed25519Sign(seed, new Uint8Array(0));
  assert.equal(hex(sig), 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
  assert(ed25519Verify(ed25519PublicFromSeed(seed), new Uint8Array(0), sig));
});
test('ChaCha20-Poly1305, RFC 8439 section 2.8.2 (tag)', () => {
  const key = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = fromHex('070000004041424344454647');
  const aad = fromHex('50515253c0c1c2c3c4c5c6c7');
  const pt = utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
  const ct = chachaSeal(key, nonce, aad, pt);
  assert.equal(hex(ct.slice(-16)), '1ae10b594f09e26a7e902ecbd0600691');
  assert.equal(hex(chachaOpen(key, nonce, aad, ct)), hex(pt));
});
test('Argon2id, RFC 9106 section 5.3', () => {
  const tag = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), { memory: 32, passes: 3, lanes: 4 },
    { secret: new Uint8Array(8).fill(3), ad: new Uint8Array(12).fill(4) });
  assert.equal(hex(tag), '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
});
test('X25519, RFC 7748 section 6.1', () => {
  const a = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bPub = fromHex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  assert.equal(hex(x25519PublicFromSeed(a)), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(hex(x25519(a, bPub)), '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
});
test('SHA3-256 and SHAKE256 of the empty string', () => {
  assert.equal(hex(sha3_256(new Uint8Array(0))), 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
  assert.equal(hex(shake256(new Uint8Array(0), 32)), '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762f');
});
test('AES-256-GCM round trip and tamper', () => {
  const k = new Uint8Array(32).fill(7), n = new Uint8Array(12).fill(1);
  const ct = aesGcmSeal(k, n, utf8('a'), utf8('hello'));
  assert.equal(hex(aesGcmOpen(k, n, utf8('a'), ct)), hex(utf8('hello')));
  assert.throws(() => aesGcmOpen(k, n, utf8('b'), ct));
});
test('ML-KEM-768 from a 64-byte seed: public key size, encapsulate/decapsulate agree', () => {
  const k = mlkem768FromSeed(new Uint8Array(64).fill(3));
  assert.equal(k.pk.length, 1184);
  const e = mlkem768Encapsulate(k.pk);
  assert.equal(e.ct.length, 1088);
  assert.equal(hex(k.decapsulate(e.ct)), hex(e.ss));
});
test('X-Wing: sizes, round trip, seed expansion layout', () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => i);
  const pk = xw.publicKey(seed);
  assert.equal(pk.length, 1216);
  const e = xw.encapsulate(pk);
  assert.equal(e.ct.length, 1120);
  assert.equal(hex(xw.decapsulate(seed, e.ct)), hex(e.ss));
  const ex = xw.expand(seed);
  assert.equal(hex(ex.mlkemSeed) + hex(ex.xSk), hex(shake256(seed, 96)));
  assert.equal(hex(xw.LABEL), '5c2e2f2f5e5c');
});
test('HPKE: random seal and open round trip, wrong key fails', () => {
  const seed = new Uint8Array(32).fill(5);
  const pk = xw.publicKey(seed);
  const blob = hpke.sealBase(pk, utf8('i'), utf8('a'), utf8('hello world'));
  assert.equal(blob.length, 1120 + 11 + 16);
  assert.equal(hex(hpke.openBase(seed, utf8('i'), utf8('a'), blob)), hex(utf8('hello world')));
  assert.throws(() => hpke.openBase(new Uint8Array(32).fill(6), utf8('i'), utf8('a'), blob));
});
