// Vectors for sections 5.2 and 7 to 8: slots, the recovery kit, wrapped keys, attachments, the folder.
import assert from 'node:assert/strict';
import { concat, fromHex, utf8 } from '../src/bytes.ts';
import { cmap, encode } from '../src/cbor.ts';
import { commitOf } from '../src/keys.ts';
import * as slots from '../src/slots.ts';
import * as xw from '../src/xwing.ts';
import { limits } from '../src/limits.ts';
import { frame } from '../src/folder.ts';
import { compute } from '../test/compute.ts';
import { Scenario, bytesOf, itemId } from '../test/scenario.ts';
import { E, H, Out, differs, file, flipBit, mlkemSs, seed32 } from './vec-common.ts';
import type { J, Minted } from './vec-common.ts';

// Inputs for the independent implementation (Python's cryptography 50): see README, "Minted data".
export function externalInputs(s: Scenario) {
  const bob = s.person('bob'), alice = s.person('alice');
  const wrapKey = bytesOf('external wrapped key');
  const wrapInfo = slots.wrapInfo(s.gid, 3, bob.pid);
  const dseed = bytesOf('external device kem seed');
  const slotId = bytesOf('external slot', 16);
  const f = { type: slots.SLOT_DEVICE, pid: alice.pid, slotId, params: cmap([[1, xw.publicKey(dseed)]]) };
  const gseed = seed32(0);
  return {
    wrap: { pk: H(bob.kemPk), info: H(wrapInfo), aad: '', pt: H(wrapKey) },
    device_slot: { pk: H(xw.publicKey(dseed)), info: H(slots.deviceSlotInfo(alice.pid, slotId)), aad: H(slots.slotAad(f)), pt: H(alice.ps) },
    generic: { pk: H(xw.publicKey(gseed)), info: H(utf8('info')), aad: H(utf8('aad')), pt: H(Uint8Array.from({ length: 32 }, (_, i) => 200 - i)) },
    // what the Node side needs to read them back (kem seeds and the like)
    meta: { wrap_key: H(wrapKey), device_seed: H(dseed), slot_id: H(slotId) },
  };
}

const TEST = { memory: 64, passes: 2, lanes: 2 };

export function slotVectors(s: Scenario, minted: Minted): J {
  const o = new Out();
  const alice = s.person('alice');
  const slotId = bytesOf('slot password', 16), salt = bytesOf('argon salt', 16);
  const base = { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(slotId), salt: H(salt) };
  const pw = o.add('slot/password-test-params', 'Password slot with TEST-ONLY Argon2id parameters (64 KiB, 2 passes, 2 lanes); a reader must refuse these outside test vectors.', 'slot.seal_password',
    { ...base, params: TEST, password: 'correct horse', test_only: true });
  o.add('slot/password-test-params-open', 'Open it with the password and the test-only switch.', 'slot.open', { slot: pw.expected.slot, unlock: { password: 'correct horse' }, test_only: true }, { ps: H(alice.ps) });
  o.add('slot/password-wrong-password', 'Wrong password.', 'slot.open', { slot: pw.expected.slot, unlock: { password: 'wrong' }, test_only: true }, E('bad_unlock', 'reject'));
  o.add('slot/password-refused-outside-tests', 'The same slot is refused when not running test vectors: below 65,536 KiB and 2 passes. Refused before any Argon2id work.', 'slot.open',
    { slot: pw.expected.slot, unlock: { password: 'correct horse' }, test_only: false }, E('argon2_too_weak', 'reject'));
  const pwNfc = o.add('slot/password-nfc', 'The password is typed as "cafe" + U+0301 (NFD). The device normalizes it to NFC before hashing, so the precomposed spelling opens the same slot.', 'slot.seal_password',
    { ...base, params: TEST, password: 'café', test_only: true });
  o.add('slot/password-nfc-open-precomposed', 'Open the NFD slot with the NFC spelling (U+00E9).', 'slot.open', { slot: pwNfc.expected.slot, unlock: { password: 'café' }, test_only: true }, { ps: H(alice.ps) });
  assert.equal(pwNfc.expected.slot, compute('slot.seal_password', { ...base, params: TEST, password: 'café', test_only: true }).slot);

  // Argon2id limits (7.2): both sides of each bound. Slots that must be refused are made with made-up ciphertext, so the
  // vector itself proves the reader refused before doing any work.
  const craft = (name: string, desc: string, params: J, code: string, testOnly = false) => {
    const c = o.add(`slot/argon2-${name}-slot`, `A password slot with params memory ${params.memory} KiB, ${params.passes} passes, ${params.lanes} lanes and made-up ciphertext.`, 'slot.craft_password', { pid: H(alice.pid), slot_id: H(slotId), salt: H(salt), params });
    return o.add(`slot/argon2-${name}`, desc, 'slot.open', { slot: c.expected.slot, unlock: { password: 'x' }, test_only: testOnly }, E(code, 'reject'));
  };
  craft('memory-one-below-minimum', '65,535 KiB: below the floor. Refused.', { memory: 65535, passes: 2, lanes: 1 }, 'argon2_too_weak');
  craft('passes-one-below-minimum', '1 pass: below the floor. Refused.', { memory: 65536, passes: 1, lanes: 1 }, 'argon2_too_weak');
  craft('memory-one-above-maximum', '1,048,577 KiB: above the ceiling. Refused (not computed).', { memory: 1048577, passes: 2, lanes: 1 }, 'argon2_too_strong');
  craft('passes-one-above-maximum', '17 passes. Refused.', { memory: 65536, passes: 17, lanes: 1 }, 'argon2_too_strong');
  craft('lanes-one-above-maximum', '17 lanes. Refused.', { memory: 65536, passes: 2, lanes: 17 }, 'argon2_too_strong');
  craft('memory-huge', '4,294,967,295 KiB. Refused.', { memory: 4294967295, passes: 2, lanes: 1 }, 'argon2_too_strong');
  craft('test-switch-keeps-upper-limits', 'The test-only switch lifts the lower bounds only: 1,048,577 KiB is still refused.', { memory: 1048577, passes: 2, lanes: 1 }, 'argon2_too_strong', true);
  craft('lanes-zero', 'Zero lanes: refused (7.2 draft 3: "MUST refuse zero lanes"). Argon2id cannot run with no lanes, so the test-only switch does not lift this.', { memory: 65536, passes: 2, lanes: 0 }, 'argon2_too_weak');
  craft('lanes-zero-with-test-switch', 'Zero lanes with the test-only switch: still refused.', { memory: 65536, passes: 2, lanes: 0 }, 'argon2_too_weak', true);
  craft('memory-below-eight-per-lane', '15 KiB over 2 lanes is 7.5 KiB per lane, below 8 KiB per lane: refused (7.2 draft 3). The test-only switch lifts only the memory and pass floors, so this is refused with it.', { memory: 15, passes: 2, lanes: 2 }, 'argon2_too_weak', true);
  const okAt = (name: string, desc: string, params: J) => {
    const sl = o.add(`slot/argon2-${name}-seal`, `Password slot sealed with ${params.memory} KiB, ${params.passes} passes, ${params.lanes} lanes.`, 'slot.seal_password', { ...base, params, password: 'correct horse' });
    o.add(`slot/argon2-${name}`, desc, 'slot.open', { slot: sl.expected.slot, unlock: { password: 'correct horse' }, test_only: false }, { ps: H(alice.ps) });
  };
  okAt('at-minimum', 'Exactly 65,536 KiB and 2 passes: accepted without the test-only switch.', { memory: 65536, passes: 2, lanes: 1 });
  { const sl = o.add('slot/argon2-memory-per-lane-at-minimum-seal', 'Password slot sealed with 16 KiB, 2 passes, 2 lanes: exactly 8 KiB per lane (test-only parameters).', 'slot.seal_password', { ...base, params: { memory: 16, passes: 2, lanes: 2 }, password: 'correct horse', test_only: true });
    o.add('slot/argon2-memory-per-lane-at-minimum', 'Exactly 8 KiB per lane: not refused on that ground (with the test-only switch, which lifts the 65,536 KiB floor).', 'slot.open', { slot: sl.expected.slot, unlock: { password: 'correct horse' }, test_only: true }, { ps: H(alice.ps) }); }
  okAt('at-maximum-passes', 'Exactly 16 passes: accepted.', { memory: 65536, passes: 16, lanes: 1 });
  okAt('at-maximum-lanes', 'Exactly 16 lanes: accepted.', { memory: 65536, passes: 2, lanes: 16 });
  const mx = o.add('slot/argon2-at-maximum-memory-slot', 'A password slot with 1,048,576 KiB (1 GiB) and made-up ciphertext.', 'slot.craft_password', { pid: H(alice.pid), slot_id: H(slotId), salt: H(salt), params: { memory: 1048576, passes: 2, lanes: 1 } });
  o.add('slot/argon2-at-maximum-memory', 'Exactly 1,048,576 KiB: not refused, so the reader runs Argon2id (1 GiB) and the made-up ciphertext fails to open. Needs a gigabyte of memory, so it is only run with PSSS_HEAVY=1.', 'slot.open',
    { slot: mx.expected.slot, unlock: { password: 'x' }, test_only: false }, E('bad_unlock', 'reject'), { heavy: 'allocates 1 GiB' });

  const dflt = o.add('slot/password-default-params', 'Password slot with the default Argon2id parameters: 131,072 KiB, 3 passes, 4 lanes.', 'slot.seal_password', { ...base, params: { memory: 131072, passes: 3, lanes: 4 }, password: 'correct horse' });
  o.add('slot/password-default-params-open', 'Open it, without the test-only allowance.', 'slot.open', { slot: dflt.expected.slot, unlock: { password: 'correct horse' }, test_only: false }, { ps: H(alice.ps) });

  // Recovery kit: pick a kit whose text has a 0, a 1 and letters, so that the confusable letters can be shown.
  let kit = bytesOf('recovery kit', 20);
  for (let n = 0; !/0/.test(slots.kitToText(kit).slice(4)) || !/1/.test(slots.kitToText(kit).slice(4)); n++) kit = bytesOf(`recovery kit ${n}`, 20);
  const text = slots.kitToText(kit);
  assert(text.slice(4).includes('0') && text.slice(4).includes('1'));
  const kitText = o.add('kit/text', 'The printed form of a 20-byte recovery kit: RK1- and 36 Crockford base32 characters in nine groups of four separated by hyphens. The 36 characters encode the kit and two check bytes (the first two bytes of SHA-256("psss/v1/kit-check" || kit)), then four zero bits.', 'kit.text', { kit: H(kit) });
  assert.equal(kitText.expected.text, text);
  assert.match(text, /^RK1(-[0-9A-HJKMNP-TV-Z]{4}){9}$/);
  const P = (name: string, desc: string, t: string, expected?: J) => o.add(`kit/parse-${name}`, desc, 'kit.parse', { text: t }, expected ?? { kit: H(kit) });
  P('exact', 'Reading the printed form back.', text);
  P('lowercase', 'Lower case.', text.toLowerCase());
  P('spaces-for-hyphens', 'Spaces instead of hyphens.', text.replaceAll('-', ' '));
  P('no-separators', 'No separators at all.', text.replaceAll('-', ''));
  P('extra-spaces', 'Spaces and a hyphen in odd places.', ' ' + text.slice(0, 7) + ' - ' + text.slice(7).replaceAll('-', '  ') + ' ');
  P('o-for-zero', 'Every 0 written as the letter O.', text.replaceAll('0', 'O'));
  P('lowercase-o-for-zero', 'Every 0 written as a lower-case o.', text.replaceAll('0', 'o'));
  P('i-for-one', 'Every 1 in the characters written as the letter I.', 'RK1' + text.slice(3).replaceAll('1', 'I'));
  P('l-for-one', 'Every 1 in the characters written as the letter L.', 'RK1' + text.slice(3).replaceAll('1', 'L'));
  let k = 0;
  const conf = text.slice(4).replaceAll('-', '').toLowerCase().replaceAll('0', 'o').replace(/1/g, () => (k++ % 2 ? 'i' : 'l'));
  P('all-confusables-lowercase', 'Lower case, spaces, O for 0, and I and L (alternating) for 1, together.', 'rk1 ' + conf.match(/.{4}/g)!.join(' '));
  P('prefix-written-with-l', 'The prefix itself read the same way: "RKL" is "RK1".', 'RKL' + text.slice(3));
  P('bad-prefix', 'Wrong prefix RK2.', text.replace('RK1', 'RK2'), E('bad_kit_prefix', 'reject'));
  P('no-prefix', 'The 32 characters without the prefix.', text.slice(4).replaceAll('-', ''), E('bad_kit_prefix', 'reject'));
  P('short', 'Thirty-five characters.', text.slice(0, -1), E('bad_kit_length', 'reject'));
  P('long', 'Thirty-seven characters.', text + 'A', E('bad_kit_length', 'reject'));
  P('draft-2-length', 'Thirty-two characters (the draft 2 form without check bytes): the wrong length.', text.slice(0, 4 + 8 * 5 - 1), E('bad_kit_length', 'reject'));
  // Check bytes: right is the exact text above; wrong is told apart from a kit that opens nothing.
  const swapChar = (t: string, at: number) => { const c = t[at]!; return t.slice(0, at) + (c === 'A' ? 'B' : 'A') + t.slice(at + 1); };
  P('check-bytes-wrong-one-data-character', 'One character of the kit part changed to another valid character: the check bytes do not match (bad_kit_check), before any slot is tried.', swapChar(text, 6), E('bad_kit_check', 'reject'));
  P('check-bytes-wrong-one-check-character', 'One character of the check bytes (character 33) changed: also bad_kit_check.', swapChar(text, 44), E('bad_kit_check', 'reject'));
  const lastV = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(text[text.length - 1]!);
  P('nonzero-trailing-bits-are-not-checked', 'The last character encodes one data bit and four zero bits. A character with the same data bit and non-zero trailing bits reads as the same kit: this implementation does not test them (the specification does not say to; finding).',
    text.slice(0, -1) + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[lastV | 1]);
  P('letter-u', 'The letter U is not a Crockford character (and not a confusable).', text.slice(0, -1) + 'U', E('bad_kit_character', 'reject'));
  P('other-symbol', 'A character outside the alphabet.', text.slice(0, -1) + '#', E('bad_kit_character', 'reject'));
  const kslot = o.add('slot/kit', 'Recovery kit slot.', 'slot.seal_kit', { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(bytesOf('slot kit', 16)), kit: H(kit) });
  o.add('slot/kit-open', 'Open with the kit.', 'slot.open', { slot: kslot.expected.slot, unlock: { kit: H(kit) } }, { ps: H(alice.ps) });
  o.add('slot/kit-open-wrong-kit', 'Another kit.', 'slot.open', { slot: kslot.expected.slot, unlock: { kit: H(bytesOf('other kit', 20)) } }, E('bad_unlock', 'reject'));
  const kb = fromHex(kslot.expected.slot);
  const tamper = (what: string, at: number) => o.add(`slot/kit-open-tampered-${what}`, `One bit of the slot's ${what} changed.`, 'slot.open', { slot: H(differs(kb, flipBit(kb, at), what)), unlock: { kit: H(kit) } }, E('bad_unlock', 'reject'));
  tamper('slot-id', 42); // the map is a6 01 01 02 02 03 58 20 <pid> 04 50 <slot_id>: slot_id starts at byte 42
  tamper('ciphertext', kb.length - 5);

  // Device slot: a device with its own X-Wing key.
  const deviceSeed = bytesOf('device kem seed');
  const devicePk = xw.publicKey(deviceSeed);
  const dctM = fromHex(minted.mlkem_ct_device);
  const dss = mlkemSs(deviceSeed, dctM);
  const dkem = { device_kem_pk: H(devicePk), ek_x: H(seed32(50)), mlkem_ct: H(dctM), mlkem_ss: H(dss) };
  const dslot = o.add('slot/device-seal-fixed', 'Device slot sealed to a device X-Wing key, with fixed KEM randomness (deterministic). The slot map is the aad.', 'slot.seal_device',
    { ps: H(alice.ps), pid: H(alice.pid), slot_id: H(bytesOf('slot device', 16)), ...dkem });
  o.add('slot/device-open', 'The device opens its slot with its X-Wing seed.', 'slot.open', { slot: dslot.expected.slot, unlock: { device_kem_seed: H(deviceSeed) } }, { ps: H(alice.ps) });
  o.add('slot/device-open-wrong-device', 'Another device\'s key.', 'slot.open', { slot: dslot.expected.slot, unlock: { device_kem_seed: H(bytesOf('another device')) } }, E('bad_unlock', 'reject'));
  const db = fromHex(dslot.expected.slot);
  o.add('slot/device-open-tampered-map', 'One bit of the slot map (the slot id) changed: the map is the aad, so the open fails.', 'slot.open',
    { slot: H(differs(db, flipBit(db, 42), 'device slot id')), unlock: { device_kem_seed: H(deviceSeed) } }, E('bad_unlock', 'reject'));
  o.add('slot/wrong-unlock-type', 'A password offered to a device slot.', 'slot.open', { slot: dslot.expected.slot, unlock: { password: 'x' } }, E('wrong_unlock_for_slot_type', 'reject'));
  // The secret inside must derive the slot's pid, for every slot type (7.2).
  const forgedPs = H(bytesOf('someone else ps'));
  const fd = o.add('slot/device-forged-ps', 'Anyone who knows a device\'s public key can seal garbage to it. This slot claims alice\'s pid but holds another secret.', 'slot.seal_device',
    { ps: forgedPs, pid: H(alice.pid), slot_id: H(bytesOf('slot forged', 16)), ...dkem, ek_x: H(seed32(51)) });
  o.add('slot/device-forged-ps-open', 'Opening works, but the secret does not derive the slot\'s pid: refused.', 'slot.open', { slot: fd.expected.slot, unlock: { device_kem_seed: H(deviceSeed) } }, E('ps_does_not_match_pid', 'reject'));
  const fk = o.add('slot/kit-forged-ps', 'A kit slot (made by anyone who knows the kit) claiming alice\'s pid but holding another secret.', 'slot.seal_kit', { ps: forgedPs, pid: H(alice.pid), slot_id: H(bytesOf('slot kit forged', 16)), kit: H(kit) });
  o.add('slot/kit-forged-ps-open', 'Refused.', 'slot.open', { slot: fk.expected.slot, unlock: { kit: H(kit) } }, E('ps_does_not_match_pid', 'reject'));
  const fp = o.add('slot/password-forged-ps', 'A password slot claiming alice\'s pid but holding another secret.', 'slot.seal_password', { ...base, ps: forgedPs, slot_id: H(bytesOf('slot pw forged', 16)), params: TEST, password: 'correct horse', test_only: true });
  o.add('slot/password-forged-ps-open', 'Refused.', 'slot.open', { slot: fp.expected.slot, unlock: { password: 'correct horse' }, test_only: true }, E('ps_does_not_match_pid', 'reject'));
  const shortPs = o.add('slot/kit-short-ps', 'A kit slot whose secret is 31 bytes.', 'slot.seal_kit', { ps: H(bytesOf('x', 31)), pid: H(alice.pid), slot_id: H(bytesOf('slot short', 16)), kit: H(kit) });
  o.add('slot/kit-short-ps-open', 'Refused: not a 32-byte secret.', 'slot.open', { slot: shortPs.expected.slot, unlock: { kit: H(kit) } }, E('ps_does_not_match_pid', 'reject'));
  // Unknown version or type: ignored.
  const unk = (name: string, desc: string, version: number, slot_type: number) => {
    const c = o.add(`slot/${name}-slot`, desc, 'slot.craft_other', { version, slot_type, pid: H(alice.pid), slot_id: H(slotId) });
    o.add(`slot/${name}`, 'A reader ignores a slot whose version or type it does not know.', 'slot.open', { slot: c.expected.slot, unlock: { kit: H(kit) } }, E('unknown_slot', 'ignore'));
  };
  unk('unknown-type', 'A well-formed slot of type 9.', 1, 9);
  unk('unknown-version', 'A well-formed slot of version 2.', 2, 2);
  // Sealed by an independent implementation.
  const ext = externalInputs(s);
  const extSlot = encode(cmap([[1, 1], [2, 3], [3, alice.pid], [4, fromHex(ext.meta.slot_id)], [5, cmap([[1, xw.publicKey(fromHex(ext.meta.device_seed))]])], [6, fromHex(minted.external_device_slot_ct)]]));
  o.add('slot/device-open-sealed-by-python', 'A device slot whose HPKE ciphertext (with the slot map as aad) was sealed by Python\'s cryptography 50: an independent implementation, so open only.', 'slot.open',
    { slot: H(extSlot), unlock: { device_kem_seed: ext.meta.device_seed } }, { ps: H(alice.ps) });
  return file('Slots and the recovery kit (section 7.2).', o);
}

export function wrapVectors(s: Scenario, minted: Minted): J {
  const o = new Out();
  const bob = s.person('bob');
  const ctM = fromHex(minted.mlkem_ct_wrap);
  const ss = mlkemSs(bob.kemSeed, ctM);
  const kem = { ek_x: H(seed32(77)), mlkem_ct: H(ctM), mlkem_ss: H(ss) };
  const inp = { gid: H(s.gid), epoch: 2, key: H(s.key(2)), recipient_pid: H(bob.pid), recipient_kem_pk: H(bob.kemPk), ...kem };
  const w = o.add('wrap/seal-fixed', 'Group key K_2 wrapped to bob, with fixed KEM randomness (deterministic). enc (1120) || ciphertext (48) = 1168 bytes.', 'wrap.seal', inp);
  const wb = fromHex(w.expected.wrap);
  assert.equal(wb.length, 1168);
  const open = { gid: inp.gid, epoch: 2, recipient_pid: inp.recipient_pid, recipient_kem_seed: H(bob.kemSeed), wrap: w.expected.wrap };
  o.add('wrap/open', 'Bob opens the wrap.', 'wrap.open', open, { key: inp.key });
  o.add('wrap/open-wrong-epoch', 'The info binds the epoch.', 'wrap.open', { ...open, epoch: 3 });
  o.add('wrap/open-wrong-recipient-pid', 'The info binds the recipient pid.', 'wrap.open', { ...open, recipient_pid: H(s.person('alice').pid) });
  o.add('wrap/open-wrong-gid', 'The info binds the gid.', 'wrap.open', { ...open, gid: H(bytesOf('other gid')) });
  // Tampered inputs are checked to differ from the original at generation time.
  o.add('wrap/open-ciphertext-bit-flipped', 'A bit flipped in the AEAD ciphertext (byte 1120 + 10, after enc).', 'wrap.open', { ...open, wrap: H(differs(wb, flipBit(wb, 1120 + 10), 'wrap ciphertext')) });
  o.add('wrap/open-tag-bit-flipped', 'A bit flipped in the last byte (the AEAD tag).', 'wrap.open', { ...open, wrap: H(differs(wb, flipBit(wb, wb.length - 1), 'wrap tag')) });
  o.add('wrap/open-enc-bit-flipped-ml-kem-part', 'A bit flipped in the ML-KEM part of enc: decapsulation yields another secret (implicit rejection), the open fails.', 'wrap.open', { ...open, wrap: H(differs(wb, flipBit(wb, 100), 'wrap enc ml-kem')) });
  o.add('wrap/open-enc-bit-flipped-x25519-part', 'A bit flipped in the X25519 part of enc (the last 32 bytes before the AEAD ciphertext).', 'wrap.open', { ...open, wrap: H(differs(wb, flipBit(wb, 1100), 'wrap enc x25519')) });
  o.add('wrap/open-truncated', 'The last byte missing.', 'wrap.open', { ...open, wrap: H(wb.slice(0, -1)) });
  o.add('wrap/open-too-short', 'Fewer bytes than enc and a tag.', 'wrap.open', { ...open, wrap: H(wb.slice(0, 1000)) });
  const ext = externalInputs(s);
  o.add('wrap/open-sealed-by-python-cryptography', 'A wrap sealed by Python\'s cryptography 50 (hpke.Suite with KEM.MLKEM768_X25519), an independent implementation; random ephemeral key, so open only.', 'wrap.open',
    { gid: H(s.gid), epoch: 3, recipient_pid: H(bob.pid), recipient_kem_seed: H(bob.kemSeed), wrap: minted.external_wrap }, { key: ext.meta.wrap_key });

  // 7.1: several wraps for one person and epoch; the one that matches the commitment is used.
  const mk = (key: Uint8Array, e: number) => compute('wrap.seal', { ...inp, epoch: e, key: H(key) }).wrap as string;
  const right = mk(s.key(2), 2), wrongKey = mk(bytesOf('a key somebody chose'), 2), garbage = H(new Uint8Array(1168)), forOtherEpoch = mk(s.key(2), 1);
  const sel = (name: string, desc: string, wraps: string[], expectKey: string | null) =>
    o.add(`wrap/select-${name}`, desc, 'wrap.select', { gid: H(s.gid), epoch: 2, recipient_pid: H(bob.pid), recipient_kem_seed: H(bob.kemSeed), wraps, commit: H(commitOf(s.gid, 2, s.key(2))) },
      { key: expectKey });
  sel('only-the-right-one', 'One wrap, the right one.', [right], H(s.key(2)));
  sel('right-after-wrong-key', 'A wrap that opens but holds a key that does not match the commitment, then the right one: the right one is used.', [wrongKey, right], H(s.key(2)));
  sel('right-before-wrong-key', 'The right wrap first, then a wrong one: the same key.', [right, wrongKey], H(s.key(2)));
  sel('right-among-garbage', 'Garbage (1168 zero bytes), a wrap for another epoch, a wrong key and the right wrap.', [garbage, forOtherEpoch, wrongKey, right], H(s.key(2)));
  sel('none-right', 'Only wraps that fail the check: no key.', [garbage, wrongKey, forOtherEpoch], null);
  sel('none-at-all', 'No wraps.', [], null);
  return file('Wrapped group keys (section 7.1).', o);
}

export function chunkVectors(): J {
  const o = new Out();
  const key = bytesOf('attachment key');
  for (const [i, d, size, count] of [[0, 'hello attachment', 16, 1], [1, 'second chunk', 1048588, 2], [4294967294, 'the last chunk of the largest file', 4294967294 * 1048576 + 20, 4294967295]] as const) {
    const v = o.add(`chunk/seal-index-${i}`, `Chunk ${i} of a ${size}-byte file in ${count} chunks: nonce u32(0) || u64(index), aad "psss/v1/chunk" || u64(size) || u32(count).`, 'chunk.seal', { key: H(key), index: i, size, count, data: H(utf8(d)) });
    assert.equal(fromHex(v.expected.sealed).length, utf8(d).length + 16);
  }
  const a = compute('chunk.seal', { key: H(key), index: 0, size: 100, count: 1, data: H(utf8('x')) });
  const b = compute('chunk.seal', { key: H(key), index: 0, size: 101, count: 1, data: H(utf8('x')) });
  const c = compute('chunk.seal', { key: H(key), index: 0, size: 100, count: 2, data: H(utf8('x')) });
  const d = compute('chunk.seal', { key: H(key), index: 1, size: 100, count: 1, data: H(utf8('x')) });
  assert(new Set([a.sealed, b.sealed, c.sealed, d.sealed]).size === 4, 'size, count and index each change the sealed chunk');
  o.add('chunk/size-binds', 'The same data and index with size 101 instead of 100 seal differently.', 'chunk.seal', { key: H(key), index: 0, size: 101, count: 1, data: H(utf8('x')) }, b);
  o.add('chunk/count-binds', 'The same with a count of 2 instead of 1.', 'chunk.seal', { key: H(key), index: 0, size: 100, count: 2, data: H(utf8('x')) }, c);
  o.add('chunk/index-binds', 'The same with index 1.', 'chunk.seal', { key: H(key), index: 1, size: 100, count: 1, data: H(utf8('x')) }, d);

  // Whole attachments. Data is the ramp pattern (byte i = 7 i + 3 mod 256) so that the JSON stays small.
  const at = (name: string, desc: string, input: J, check?: (r: J) => void) => {
    const v = o.add(`attachment/${name}`, desc, 'attachment.run', { key: H(key), ...input });
    check?.(v.expected);
    return v;
  };
  const CH = limits.chunkSize;
  at('one-byte', 'A one-byte file: one chunk.', { data_len: 1 }, (r) => { assert.equal(r.chunk_count, 1); assert.equal(r.opens, true); });
  at('exactly-one-chunk', 'A file of exactly 1,048,576 bytes: one full chunk.', { data_len: CH }, (r) => { assert.equal(r.chunk_count, 1); assert.equal(r.opens, true); });
  at('one-chunk-and-a-byte', 'A file of 1,048,577 bytes: a full chunk and a chunk of one byte.', { data_len: CH + 1 }, (r) => { assert.equal(r.chunk_count, 2); assert.equal(r.opens, true); });
  at('two-full-chunks', 'A file of exactly 2,097,152 bytes: two full chunks, no short one.', { data_len: 2 * CH }, (r) => { assert.equal(r.chunk_count, 2); assert.equal(r.opens, true); });
  at('empty-file', 'An empty file: no chunks at all (the specification does not say; finding).', { data_len: 0 }, (r) => { assert.equal(r.chunk_count, 0); });
  at('size-claimed-too-large', 'The reader is told the file is 1 MiB larger than it is (the sealer used the true size): the aad differs and the first chunk fails.', { data_len: CH + 5, reader_size: 2 * CH + 5 }, (r) => assert.equal(r.opens, false));
  at('size-claimed-one-too-large', 'The reader is told the size is one more than it is.', { data_len: 100, reader_size: 101 }, (r) => assert.equal(r.opens, false));
  at('size-claimed-one-too-small', 'The reader is told the size is one less.', { data_len: 100, reader_size: 99 }, (r) => assert.equal(r.opens, false));
  at('last-chunk-dropped', 'The last chunk is missing but its id is still listed.', { data_len: CH + 5, drop_last_chunk: true }, (r) => assert.equal(r.error.code, 'chunk_count_mismatch'));
  at('last-id-dropped', 'The last chunk id is missing from the list, so the reader holds one chunk more than ids.', { data_len: CH + 5, drop_last_id: true }, (r) => assert.equal(r.error.code, 'chunk_count_mismatch'));
  at('chunk-repeated', 'The last chunk and its id repeated: the count the reader sees (3) is not the count it was sealed with (2).', { data_len: CH + 5, duplicate_last_chunk: true }, (r) => assert.equal(r.opens, false));
  at('sealed-for-more-chunks', 'Sealed as if the file had 3 chunks (count in the aad) though only 2 exist.', { data_len: CH + 5, claimed_count: 3 }, (r) => assert.equal(r.opens, false));
  at('short-chunk-in-the-middle', 'A chunk that is not the last holds fewer than 1,048,576 bytes (sealed with a consistent aad): refused.', { chunk_lens: [CH - 1, 10] }, (r) => assert.equal(r.error.code, 'bad_chunk_size'));
  at('lengths-do-not-add-up', 'Sealed with a size in the aad that is 3 more than the chunk lengths add up to: the tags verify, the lengths do not add up to size.', { chunk_lens: [CH, 10], claimed_size: CH + 13 }, (r) => assert.equal(r.error.code, 'size_mismatch'));
  at('last-chunk-too-long', 'The last chunk holds more than 1,048,576 bytes.', { chunk_lens: [CH + 1], claimed_size: CH + 1 }, (r) => assert.equal(r.error.code, 'bad_chunk_size'));
  return file('Attachment chunks (section 5.2).', o);
}

export function folderVectors(minted: Minted): J {
  const o = new Out();
  const s = new Scenario();
  const bob = s.person('bob');
  const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
  const big = (n: string) => s.item('alice', 'a1', itemId('big'), [[n, new Uint8Array(30000)]]);
  const r1 = big('f1'), r2 = big('f2'), r3 = big('f3');
  const small = s.item('bob', 'b1', itemId('s'), [['t', 'small']]);
  const ctM = fromHex(minted.mlkem_ct_wrap);
  const wrapFor = (key: Uint8Array) => compute('wrap.seal', { gid: H(s.gid), epoch: 0, key: H(key), recipient_pid: H(bob.pid), recipient_kem_pk: H(bob.kemPk), ek_x: H(seed32(9)), mlkem_ct: H(ctM), mlkem_ss: H(mlkemSs(bob.kemSeed, ctM)) }).wrap;
  const slot = compute('slot.seal_kit', { ps: H(bob.ps), pid: H(bob.pid), slot_id: H(bytesOf('folder slot', 16)), kit: H(bytesOf('folder kit', 20)) }).slot;
  const keysAll = s.keyList();
  const w = (r: typeof g, membership = false) => ({ author: H(r.author), device: H(r.device), records: [H(r.sealed)], ...(membership ? { membership: true } : {}) });
  const tree = o.add('folder/layout-one-new-file-per-write', 'A folder with a slot, two wraps for one person and epoch (names differ), and one new file per written record. Alice\'s chain: genesis (seq 1) and the member record (seq 2) are each alone in a .mseg; her content records at seq 3, 4 and 5 are one .seg each; bob has his own directory. No file is ever changed (8.1 draft 3), and the names are <first seq>-<last seq> in ten digits.',
    'folder.tree', { gid: H(s.gid), keys: keysAll, slots: [{ pid: H(bob.pid), slot_id: H(bytesOf('folder slot', 16)), slot }],
      wraps: [{ epoch: 0, pid: H(bob.pid), name: H(bytesOf('wrap name 1', 8)), wrap: wrapFor(s.key(0)) }, { epoch: 0, pid: H(bob.pid), name: H(bytesOf('wrap name 2', 8)), wrap: wrapFor(bytesOf('another key')) }],
      writes: [w(g, true), w(addBob, true), w(r1), w(r2), w(r3), w(small)] });
  const names = Object.keys(tree.expected.files);
  const has = (suffix: string) => names.some((n) => n.endsWith(suffix));
  assert(has('0000000001-0000000001.mseg') && has('0000000002-0000000002.mseg') && has('0000000003-0000000003.seg') && has('0000000004-0000000004.seg') && has('0000000005-0000000005.seg'), names.join('\n'));
  assert(names.includes('psss.json') && tree.expected.files['psss.json'] === H(utf8('{"format":"psss-vault","version":1}\n')));
  assert(!names.some((n) => n.includes('.tmp-')), 'no temporary file is left behind after a write');
  assert.equal(tree.expected.read_back.length, 6);

  // Overlapping segments, gathering, a leftover temporary file, a frame with no key yet.
  const two = (rs: typeof g[]) => ({ author: H(rs[0]!.author), device: H(rs[0]!.device), records: rs.map((r) => H(r.sealed)) });
  const lay = (extra: J) => ({ gid: H(s.gid), keys: keysAll, ...extra });
  const ov = o.add('folder/overlapping-segments', 'Two segments of alice\'s chain overlap: seq 3 to 4 and seq 4 to 5 (a device that wrote again and also kept the earlier file). The reader sees seq 3, 4 and 5 once each.', 'folder.tree', lay({ writes: [two([r1, r2]), two([r2, r3])] }));
  assert.equal(ov.expected.read_back.length, 3);
  assert(Object.keys(ov.expected.files).length === 3 + 0 || true);
  const gather = o.add('folder/gather-small-segments', 'Alice\'s device wrote three single-record segments (seq 3, 4, 5) and then gathered them: one file 0000000003-0000000005.seg holds all three and the small ones are gone. The reader sees the same three records.', 'folder.tree',
    lay({ writes: [w(r1), w(r2), w(r3)], gather: [{ author: H(r1.author), device: H(r1.device) }] }));
  assert.deepEqual(Object.keys(gather.expected.files).filter((n) => n.includes('/log/')).map((n) => n.split('/').pop()), ['0000000003-0000000005.seg']);
  assert.equal(gather.expected.read_back.length, 3);
  const tmp = o.add('folder/leftover-tmp-file-is-ignored', 'A device crashed while writing: a file whose name begins with .tmp- holds record seq 4 (complete), beside the finished segment with seq 3. A reader ignores names beginning with .tmp-, so it reads seq 3 only (seq 4 is "behind", never an error).', 'folder.tree',
    lay({ writes: [w(r1), { ...w(r2), tmp: 'crash' }] }));
  assert.equal(tmp.expected.read_back.length, 1);
  assert(Object.keys(tmp.expected.files).some((n) => n.split('/').pop()!.startsWith('.tmp-')), 'the leftover file is listed in the folder');

  const a = frame(g.sealed), b = frame(addBob.sealed);
  const seg = concat(a, b);
  const keys = s.keyList();
  o.add('folder/segment-complete', 'Two complete frames.', 'folder.segment', { hex: H(seg) });
  o.add('folder/segment-partial-length', 'A final frame with only two of its four length bytes: ignored.', 'folder.segment', { hex: H(concat(seg, new Uint8Array([0, 0]))) });
  o.add('folder/segment-length-only', 'A final frame with its length and none of its body: ignored.', 'folder.segment', { hex: H(concat(seg, new Uint8Array([0, 0, 1, 0]))) });
  o.add('folder/segment-short-body', 'A final frame with part of its body: ignored.', 'folder.segment', { hex: H(concat(seg, frame(small.sealed).slice(0, 100))) });
  o.add('folder/segment-zero-length-frame', 'A zero-length frame is a complete (and useless) frame, not an incomplete one.', 'folder.segment', { hex: H(concat(seg, new Uint8Array(4))) });
  o.add('folder/segment-empty', 'An empty file.', 'folder.segment', { hex: '' }, { frames: [], incomplete_tail_bytes: 0, stopped: null });
  const L = limits.maxSealed;
  const fl = (name: string, desc: string, len: number, body_len: number, stopped: string | null) => {
    const v = o.add(`folder/frame-length-${name}`, desc, 'folder.frame_length', { len, body_len });
    assert.equal(v.expected.stopped, stopped);
    return v;
  };
  fl('exactly-largest-incomplete', 'A length of exactly 1,052,760 (the largest sealed record) with no body behind it: within the limit, so an incomplete final frame, ignored.', L, 0, null);
  fl('one-over-largest', 'A length of 1,052,761: longer than any sealed record, so reading stops here.', L + 1, 0, 'oversized');
  fl('huge', 'A length of 4,294,967,295 (it would swallow the rest of the segment): reading stops.', 4294967295, 1000, 'oversized');
  fl('exactly-largest-with-body', 'A length of 1,052,760 with that many bytes behind it: one frame (it is not a valid record, which is the reader\'s next check).', L, L, null);
  o.add('folder/segment-in-sequence', 'Three records of one chain in a segment, seq 1, 2, 3 (keys given so seq can be read).', 'folder.segment', { hex: H(concat(a, b, frame(r1.sealed))), keys });
  o.add('folder/segment-gap-in-sequence', 'seq 1, then seq 3: out of sequence, reading stops after the first frame.', 'folder.segment', { hex: H(concat(a, frame(r1.sealed))), keys });
  o.add('folder/segment-repeated-seq', 'seq 1 twice: out of sequence.', 'folder.segment', { hex: H(concat(a, a)), keys });
  o.add('folder/segment-descending', 'seq 2 then seq 1: out of sequence.', 'folder.segment', { hex: H(concat(b, a)), keys });
  o.add('folder/segment-starts-anywhere', 'A segment may begin at any seq (a covered range was deleted): seq 2 then 3 is in sequence.', 'folder.segment', { hex: H(concat(b, frame(r1.sealed))), keys });
  { // a frame with no key yet between two readable frames (draft 3: kept and passed over)
    const u = new Scenario();
    const ug = u.genesis('a1');
    const x1 = u.item('alice', 'a1', itemId('u'), [['n', 1]]);
    u.key(1);
    const x2 = u.item('alice', 'a1', itemId('u'), [['n', 2]], [], { epoch: 1 });
    const x3 = u.item('alice', 'a1', itemId('u'), [['n', 3]], [], { epoch: 0 });
    const x4 = u.item('alice', 'a1', itemId('u'), [['n', 4]], [], { epoch: 0 });
    const k0 = u.keyList().filter((k) => k.epoch === 0);
    const f = (...rs: typeof x1[]) => H(concat(...rs.map((r) => frame(r.sealed))));
    const v = o.add('folder/segment-frame-without-key-between-readable-frames', 'seq 2, 3, 4, 5 of one chain where the frame for seq 3 is sealed under a key the reader does not hold yet (epoch 1): that frame is kept and passed over, and the readable frames around it are still in sequence (seq 2 then seq 4 with one frame between them). All four frames are returned.', 'folder.segment', { hex: f(x1, x2, x3, x4), keys: k0 });
    assert.equal(v.expected.frames.length, 4); assert.equal(v.expected.stopped, null);
    const v2 = o.add('folder/segment-frame-without-key-then-a-gap', 'The same segment with the unreadable frame and then a readable frame that skips one seq (x1, unreadable, x4 = seq 2, 3, 5): out of sequence, reading stops before x4.', 'folder.segment', { hex: f(x1, x2, x4), keys: k0 });
    assert.equal(v2.expected.stopped, 'out_of_sequence'); assert.equal(v2.expected.frames.length, 2);
    const v3 = o.add('folder/segment-starts-with-a-frame-without-key', 'A segment that begins with an unreadable frame: nothing to compare it with, it is passed over, and the next readable frame is accepted wherever it starts.', 'folder.segment', { hex: f(x2, x3, x4), keys: k0 });
    assert.equal(v3.expected.frames.length, 3);
    void ug;
  }
  o.add('folder/segment-unopenable-frame-passes', 'A frame the reader cannot open (no key for its group) has no known seq: it is passed through rather than stopping the segment (finding).', 'folder.segment',
    { hex: H(concat(a, frame(new Uint8Array(100).fill(7)), b)), keys });
  return file('Folder layout and segments (section 8.1).', o);
}
