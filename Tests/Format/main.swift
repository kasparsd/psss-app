import Foundation
import CryptoKit

// Hostless test of the Swift core of the Psss vault format (App/Core/Format) against the vectors in Packages/format/vectors.
// Run with scripts/test-format-swift.sh. Usage: run <vectors-dir> <output-dir>.
//
// Every vector ends in one of four ways:
//   pass     the result is what the vector says;
//   partial  the result is right as far as it can be checked, and the line says what could not be (these are findings);
//   skip     not run, with the reason;
//   fail     the result differs.
// One line is printed for every vector that is not a plain pass. The exit status is non-zero when anything failed.

// MARK: - Reporting

enum Outcome {
    case pass
    case partial(String)
    case skip(String)
    case fail(String)
}

struct Tally {
    var passed = 0, partial = 0, skipped = 0, failed = 0
}

struct TestFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

nonisolated(unsafe) var tallies: [(file: String, tally: Tally)] = []
nonisolated(unsafe) var currentTally = Tally()
nonisolated(unsafe) var notes: [String] = []

func report(_ name: String, _ outcome: Outcome) {
    switch outcome {
    case .pass: currentTally.passed += 1
    case .partial(let why): currentTally.partial += 1; print("PART \(name): \(why)")
    case .skip(let why): currentTally.skipped += 1; print("SKIP \(name): \(why)")
    case .fail(let why): currentTally.failed += 1; print("FAIL \(name): \(why)")
    }
}

func finishFile(_ file: String) {
    tallies.append((file, currentTally))
    currentTally = Tally()
}

// MARK: - JSON helpers

typealias JSON = [String: Any]

indirect enum JV: Equatable {
    case null, bool(Bool), int(Int64), string(String), array([JV]), object([String: JV])
}

func jv(_ x: Any?) -> JV {
    guard let x else { return .null }
    if x is NSNull { return .null }
    if let n = x as? NSNumber {
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
        return .int(n.int64Value)
    }
    if let s = x as? String { return .string(s) }
    if let a = x as? [Any] { return .array(a.map { jv($0) }) }
    if let d = x as? JSON { return .object(d.mapValues { jv($0) }) }
    return .null
}

func jsonAny(_ v: JV) -> Any {
    switch v {
    case .null: return NSNull()
    case .bool(let b): return b
    case .int(let i): return i
    case .string(let s): return s
    case .array(let a): return a.map(jsonAny)
    case .object(let o): return o.mapValues(jsonAny)
    }
}

extension Dictionary where Key == String, Value == Any {
    func string(_ key: String) throws -> String {
        guard let s = self[key] as? String else { throw TestFailure("vector has no text field \(key)") }
        return s
    }
    func hex(_ key: String) throws -> Data {
        guard let s = self[key] as? String, let d = Data(formatHex: s) else { throw TestFailure("vector has no hex field \(key)") }
        return d
    }
    func optionalHex(_ key: String) throws -> Data? {
        guard let value = self[key], !(value is NSNull) else { return nil }
        guard let s = value as? String, let d = Data(formatHex: s) else { throw TestFailure("bad hex field \(key)") }
        return d
    }
    func uint(_ key: String) throws -> UInt64 {
        guard let n = self[key] as? NSNumber else { throw TestFailure("vector has no number field \(key)") }
        return n.uint64Value
    }
    func object(_ key: String) throws -> JSON {
        guard let o = self[key] as? JSON else { throw TestFailure("vector has no object field \(key)") }
        return o
    }
    func array(_ key: String) throws -> [Any] {
        guard let a = self[key] as? [Any] else { throw TestFailure("vector has no array field \(key)") }
        return a
    }
    func bool(_ key: String) -> Bool { (self[key] as? NSNumber)?.boolValue ?? false }
}

struct Vector {
    let name: String
    let description: String
    let type: String
    let input: JSON
    let expected: JSON
}

func loadVectors(_ dir: URL, _ file: String) -> [Vector]? {
    guard let data = try? Data(contentsOf: dir.appendingPathComponent(file + ".json")),
          let root = try? JSONSerialization.jsonObject(with: data) as? JSON, let list = root["vectors"] as? [JSON] else { return nil }
    return list.compactMap { v in
        guard let name = v["name"] as? String, let type = v["type"] as? String, let input = v["input"] as? JSON,
              let expected = v["expected"] as? JSON else { return nil }
        return Vector(name: name, description: v["description"] as? String ?? "", type: type, input: input, expected: expected)
    }
}

// MARK: - Comparing results

/// Compares a result with the vector's `expected`. `softCodes`: when the vector expects a refusal and the code differs from ours
/// (the specification does not define codes for these), that is a partial result, not a failure.
func judge<T>(_ result: Result<T, Error>, _ expected: JSON, softCodes: Bool = false, compare: (T) throws -> Outcome) throws -> Outcome {
    if let want = expected["error"] as? JSON {
        let wantCode = (want["code"] as? String) ?? ""
        let wantDisposition = want["disposition"] as? String
        switch result {
        case .success: return .fail("expected \(wantCode), got success")
        case .failure(let error):
            guard let error = error as? FormatError else { return .fail("expected \(wantCode), got \(error)") }
            if error.code == wantCode && (wantDisposition == nil || error.disposition?.rawValue == wantDisposition) { return .pass }
            if error.code == wantCode { return .fail("expected \(wantCode) with disposition \(wantDisposition ?? "-"), got \(error)") }
            return softCodes ? .partial("refused as it must be, but with code \(error.code) where the vector says \(wantCode)")
                             : .fail("expected \(wantCode), got \(error)")
        }
    }
    switch result {
    case .failure(let error): return .fail("unexpected error \(error)")
    case .success(let value): return try compare(value)
    }
}

/// Fails with the first field that differs.
func compareFields(_ got: [String: String], _ expected: JSON, keys: [String]? = nil) -> Outcome {
    for key in keys ?? got.keys.sorted() {
        let want: String
        if let text = expected[key] as? String { want = text } else if let number = expected[key] as? NSNumber { want = number.stringValue }
        else { return .fail("vector has no field \(key)") }
        guard got[key] == want else { return .fail("\(key): got \(abbreviate(got[key] ?? "nil")), want \(abbreviate(want))") }
    }
    return .pass
}

func abbreviate(_ s: String) -> String { s.count > 80 ? String(s.prefix(40)) + "…" + String(s.suffix(20)) + " (\(s.count / 2) bytes)" : s }

// MARK: - CBOR values from the JSON of cbor.json

func cborFromJSON(_ x: Any) throws -> CBORValue {
    guard let d = x as? JSON else { throw TestFailure("not a CBOR value object") }
    if let s = d["uint"] as? String, let n = UInt64(s) { return .uint(n) }
    if let s = d["text"] as? String { return .text(s) }
    if let s = d["bytes"] as? String, let b = Data(formatHex: s) { return .bytes(b) }
    if let a = d["array"] as? [Any] { return .array(try a.map(cborFromJSON)) }
    if let m = d["map"] as? [[Any]] {
        return .map(try m.map { pair in
            guard pair.count == 2 else { throw TestFailure("bad map pair") }
            return CBORMapEntry(try cborFromJSON(pair[0]), try cborFromJSON(pair[1]))
        })
    }
    if let b = d["bool"] as? Bool { return .bool(b) }
    if d["null"] != nil { return .null }
    throw TestFailure("unknown CBOR value form \(d.keys)")
}

// MARK: - A reference HPKE for the vectors with fixed randomness
//
// CryptoKit cannot be given the ephemeral randomness of an encapsulation, so the vectors that fix it cannot be reproduced
// with CryptoKit's HPKE. This is the key schedule of RFC 9180 (base mode) and the X-Wing combiner of section 1.1, written in
// the test from the RFC and the specification over CryptoKit's HKDF, SHA3-256, X25519 and AES-GCM. It is not part of the
// library.

enum RefHPKE {
    static let suiteID = Data("HPKE".utf8) + Data([0x64, 0x7a, 0x00, 0x01, 0x00, 0x02])
    static let xwingLabel = Data([0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c])

    static func i2osp2(_ n: Int) -> Data { Data([UInt8(n >> 8), UInt8(n & 255)]) }

    static func labeledExtract(salt: Data, label: String, ikm: Data) -> Data {
        let full = Data("HPKE-v1".utf8) + suiteID + Data(label.utf8) + ikm
        return Data(HKDF<SHA256>.extract(inputKeyMaterial: SymmetricKey(data: full), salt: salt))
    }

    static func labeledExpand(prk: Data, label: String, info: Data, length: Int) -> Data {
        let full = i2osp2(length) + Data("HPKE-v1".utf8) + suiteID + Data(label.utf8) + info
        return HKDF<SHA256>.expand(pseudoRandomKey: SymmetricKey(data: prk), info: full, outputByteCount: length).withUnsafeBytes { Data($0) }
    }

    /// X-Wing encapsulation with the ML-KEM part and the X25519 ephemeral given: returns (ciphertext, shared secret).
    static func encapsulate(publicKey: Data, ekX: Data, mlkemCiphertext: Data, mlkemSharedSecret: Data) throws -> (ct: Data, ss: Data) {
        let pkX = Data(publicKey[(publicKey.startIndex + 1184)..<(publicKey.startIndex + 1216)])
        let ephemeral = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: ekX)
        let ctX = ephemeral.publicKey.rawRepresentation
        let ssX = try ephemeral.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: pkX))
            .withUnsafeBytes { Data($0) }
        let ss = FormatCrypto.sha3_256(mlkemSharedSecret, ssX, ctX, pkX, xwingLabel)
        return (mlkemCiphertext + ctX, ss)
    }

    static func seal(publicKey: Data, ekX: Data, mlkemCiphertext: Data, mlkemSharedSecret: Data, info: Data, aad: Data, plaintext: Data) throws -> Data {
        let (enc, sharedSecret) = try encapsulate(publicKey: publicKey, ekX: ekX, mlkemCiphertext: mlkemCiphertext, mlkemSharedSecret: mlkemSharedSecret)
        let pskIDHash = labeledExtract(salt: Data(), label: "psk_id_hash", ikm: Data())
        let infoHash = labeledExtract(salt: Data(), label: "info_hash", ikm: info)
        let context = Data([0]) + pskIDHash + infoHash
        let secret = labeledExtract(salt: sharedSecret, label: "secret", ikm: Data())
        let key = labeledExpand(prk: secret, label: "key", info: context, length: 32)
        let nonce = labeledExpand(prk: secret, label: "base_nonce", info: context, length: 12)
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        return enc + box.ciphertext + box.tag
    }
}

// MARK: - Shared state between files

nonisolated(unsafe) var knownPersons: [Data: Person] = [:]       // by pid, from person.derive vectors
nonisolated(unsafe) var knownDeviceSeeds: [Data: Data] = [:]     // device kem_pk to seed, from slot.open vectors

let heavy = ProcessInfo.processInfo.environment["PSSS_HEAVY"] == "1"

// MARK: - cbor.json

func runCBOR(_ v: Vector) throws -> Outcome {
    switch v.type {
    case "cbor.encode":
        let result = Result { try FormatCBOR.encode(try cborFromJSON(v.input["value"] as Any)) }
        return try judge(result, v.expected) { compareFields(["hex": $0.formatHex], v.expected) }
    case "cbor.reject":
        let result = Result { try FormatCBOR.decode(try v.input.hex("hex")) }
        return try judge(result, v.expected, softCodes: true) { _ in .fail("accepted") }
    case "cbor.accept":
        let result = Result { try FormatCBOR.decode(try v.input.hex("hex")) }
        return try judge(result, v.expected) { value in
            guard value == (try cborFromJSON(v.expected["value"] as Any)) else { return .fail("decoded value differs") }
            return compareFields(["reencoded": try FormatCBOR.encode(value).formatHex], v.expected)
        }
    default:
        return .skip("unknown type \(v.type)")
    }
}

// MARK: - person.json

func cryptoKitAlone(publicKey: Data, message: Data, signature: Data) -> String {
    guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else { return "rejects the public key" }
    return key.isValidSignature(signature, for: message) ? "ACCEPTS" : "rejects"
}

func runPerson(_ v: Vector) throws -> Outcome {
    switch v.type {
    case "person.derive":
        let person = try Person(secret: try v.input.hex("ps"))
        knownPersons[person.pid] = person
        let basic = compareFields(["sign_seed": person.signSeed.formatHex, "kem_seed": person.kemSeed.formatHex,
                                   "pid": person.pid.formatHex, "kem_pk": person.kemPublicKey.formatHex], v.expected)
        guard case .pass = basic else { return basic }
        let wantCard = try v.expected.hex("card"), wantSig = try v.expected.hex("card_sig")
        guard (try PersonCard.verify(wantCard)).pid == person.pid else { return .fail("the vector's card does not verify") }
        let injected = try person.card(signer: { _ in wantSig })
        guard injected == wantCard else { return .fail("card framing differs even with the vector's signature") }
        let own = try person.card()
        guard (try? PersonCard.verify(own)) != nil else { return .fail("a card signed by CryptoKit does not verify") }
        if own == wantCard { return .pass }
        return .partial("card_sig differs: CryptoKit's Ed25519 signature is randomized (finding F1); the card verifies and its framing matches byte for byte with the vector's signature")
    case "card.verify":
        let result = Result { try PersonCard.verify(try v.input.hex("card")) }
        return try judge(result, v.expected) { card in compareFields(["pid": card.pid.formatHex], v.expected) }
    case "signature.verify":
        let pk = try v.input.hex("pk"), msg = try v.input.hex("msg"), sig = try v.input.hex("sig")
        let got = Ed25519Strict.verify(publicKey: pk, message: msg, signature: sig).rawValue
        let want = try v.expected.string("result")
        let alone = cryptoKitAlone(publicKey: pk, message: msg, signature: sig)
        if want != "ok" && alone == "ACCEPTS" { notes.append("signature.verify \(v.name): CryptoKit alone ACCEPTS this (expected \(want)); the section 1.2 checks in Ed25519Strict refuse it") }
        if got == want { return .pass }
        if want != "ok" && got != "ok" { return .partial("refused, but as \(got) where the vector says \(want)") }
        return .fail("got \(got), want \(want)")
    case "gid":
        let gid = GroupIdentity.gid(creatorPID: try v.input.hex("creator_pid"), genesisNonce: try v.input.hex("genesis_nonce"),
                                    k0: try v.input.hex("k0"), minReader: UInt32(try v.input.uint("min_reader")))
        return compareFields(["gid": gid.formatHex], v.expected)
    case "commit":
        let commit = GroupIdentity.commit(gid: try v.input.hex("gid"), epoch: UInt32(try v.input.uint("epoch")), key: try v.input.hex("key"))
        return compareFields(["commit": commit.formatHex], v.expected)
    case "xwing.keygen":
        let seed = try v.input.hex("seed")
        let key = try XWingMLKEM768X25519.PrivateKey(seedRepresentation: seed, publicKey: nil)
        guard key.seedRepresentation == seed else { return .fail("seedRepresentation is not the seed") }
        return compareFields(["pk": key.publicKey.rawRepresentation.formatHex], v.expected)
    case "xwing.encapsulate":
        let pk = try v.input.hex("pk")
        let (ct, ss) = try RefHPKE.encapsulate(publicKey: pk, ekX: try v.input.hex("ek_x"), mlkemCiphertext: try v.input.hex("mlkem_ct"),
                                               mlkemSharedSecret: try v.input.hex("mlkem_ss"))
        guard case .pass = compareFields(["ct": ct.formatHex, "ss": ss.formatHex], v.expected) else {
            return .fail("the combiner of section 1.1 does not reproduce the vector")
        }
        return .partial("CryptoKit cannot be given fixed encapsulation randomness; the combiner of 1.1 was reproduced from the vector's ML-KEM output with CryptoKit X25519 and SHA3-256 (the decapsulate vector covers CryptoKit itself)")
    case "xwing.decapsulate":
        let key = try XWingMLKEM768X25519.PrivateKey(seedRepresentation: try v.input.hex("seed"), publicKey: nil)
        let ss = try key.decapsulate(try v.input.hex("ct")).withUnsafeBytes { Data($0) }
        return compareFields(["ss": ss.formatHex], v.expected)
    case "hpke.seal":
        let blob = try RefHPKE.seal(publicKey: try v.input.hex("pk"), ekX: try v.input.hex("ek_x"), mlkemCiphertext: try v.input.hex("mlkem_ct"),
                                    mlkemSharedSecret: try v.input.hex("mlkem_ss"), info: try v.input.hex("info"), aad: try v.input.hex("aad"),
                                    plaintext: try v.input.hex("pt"))
        guard case .pass = compareFields(["blob": blob.formatHex], v.expected) else { return .fail("reference HPKE does not reproduce the vector") }
        return .partial("CryptoKit cannot be given fixed encapsulation randomness; reproduced with a reference HPKE (RFC 9180 key schedule) written in the test; the hpke.open vectors cover CryptoKit's opening of these bytes")
    case "hpke.open":
        let result = Result { try XWingHPKE.open(seed: try v.input.hex("seed"), info: try v.input.hex("info"), aad: try v.input.hex("aad"), blob: try v.input.hex("blob")) }
        return try judge(result, v.expected) { compareFields(["pt": $0.formatHex], v.expected) }
    default:
        return .skip("unknown type \(v.type)")
    }
}

// MARK: - record.json

func recordFields(_ input: JSON) throws -> RecordFields {
    let clock = try input.array("clock")
    guard clock.count == 2, let wall = (clock[0] as? NSNumber)?.uint64Value, let counter = (clock[1] as? NSNumber)?.uint64Value else {
        throw TestFailure("bad clock")
    }
    return RecordFields(author: try input.hex("author"), device: try input.hex("device"), seq: try input.uint("seq"),
                        prev: try input.optionalHex("prev"), clock: RecordClock(wallMs: wall, counter: counter),
                        kind: try input.uint("kind"), mhead: try input.optionalHex("mhead"),
                        payload: try FormatCBOR.decode(try input.hex("payload")))
}

func optionalHexAny(_ d: Data?) -> Any { d.map { $0.formatHex as Any } ?? NSNull() }

func openedJSON(_ r: OpenedRecord) throws -> JSON {
    [
        "epoch": Int(r.epoch), "author": r.author.formatHex, "device": r.device.formatHex, "seq": Int(r.seq),
        "prev": optionalHexAny(r.prev), "clock": [Int(r.clock.wallMs), Int(r.clock.counter)], "kind": Int(r.kind),
        "mhead": optionalHexAny(r.mhead), "record_id": r.recordID.formatHex,
        "payload": try FormatCBOR.encode(r.payload).formatHex, "extension_keys": r.extensionKeys.map { String($0) },
        "payload_extension_keys": r.payloadExtensionKeys.map { String($0) },
    ]
}

func keyring(_ input: JSON) throws -> (Data, UInt32) -> Data? {
    let entries: [(Data, UInt32, Data)] = try input.array("keys").map { k in
        guard let d = k as? JSON else { throw TestFailure("bad key entry") }
        return (try d.hex("gid"), UInt32(try d.uint("epoch")), try d.hex("key"))
    }
    return { gid, epoch in entries.first { $0.0 == gid && $0.1 == epoch }?.2 }
}

func compareOpened(_ got: OpenedRecord, _ expected: JSON) throws -> Outcome {
    guard let want = expected["ok"] as? JSON else { return .fail("vector has no ok object") }
    let mine = try openedJSON(got)
    for key in want.keys.sorted() {
        guard jv(mine[key]) == jv(want[key]) else { return .fail("\(key): got \(jv(mine[key])), want \(jv(want[key]))") }
    }
    return .pass
}

/// Seals with the vector's signature injected (the signature is read out of the vector's own sealed record when that is given).
func sealInjected(_ input: JSON, signature: Data, allowOversize: Bool = false) throws -> SealedRecord {
    try RecordCodec.seal(gid: try input.hex("gid"), epoch: UInt32(try input.uint("epoch")), groupKey: try input.hex("key"),
                         fields: try recordFields(input), allowOversizeForTesting: allowOversize, sign: { _ in signature })
}

func sealNative(_ input: JSON, allowOversize: Bool = false) throws -> SealedRecord {
    let person = try Person(secret: try input.hex("signer_ps"))
    return try RecordCodec.seal(gid: try input.hex("gid"), epoch: UInt32(try input.uint("epoch")), groupKey: try input.hex("key"),
                                fields: try recordFields(input), allowOversizeForTesting: allowOversize, sign: person.sign)
}

func singleKeyring(_ input: JSON) throws -> (Data, UInt32) -> Data? {
    let gid = try input.hex("gid"), epoch = UInt32(try input.uint("epoch")), key = try input.hex("key")
    return { g, e in g == gid && e == epoch ? key : nil }
}

let f1 = "CryptoKit's Ed25519 signature is randomized (finding F1)"

func runRecord(_ v: Vector) throws -> Outcome {
    switch v.type {
    case "record.key":
        return compareFields(["rk": RecordCodec.recordKey(groupKey: try v.input.hex("key"), salt: try v.input.hex("salt")).formatHex], v.expected)
    case "record.salt":
        return compareFields(["salt": RecordCodec.derivedSalt(groupKey: try v.input.hex("key"), bodyWithoutSignature: try v.input.hex("body_without_9")).formatHex], v.expected)
    case "padding.length":
        return compareFields(["padded": String(RecordCodec.paddedLength(Int(try v.input.uint("plaintext_len"))))], v.expected)
    case "record.seal":
        let wantSig = try v.expected.hex("sig")
        let injected = try sealInjected(v.input, signature: wantSig)
        let exact = compareFields([
            "salt": injected.salt.formatHex, "header": injected.header.formatHex, "body_without_sig": injected.bodyWithoutSignature.formatHex,
            "signed_message": injected.signedMessage.formatHex, "sig": injected.signature.formatHex,
            "plaintext_len_before_padding": String(injected.plaintextLengthBeforePadding), "padded_len": String(injected.paddedLength),
            "sealed": injected.sealed.formatHex, "sealed_len": String(injected.sealed.count), "record_id": injected.recordID.formatHex,
        ].mapValues { $0 }, v.expected.mapValues { value -> Any in (value as? NSNumber).map { "\($0)" } ?? value })
        guard case .pass = exact else { return exact }
        // The vector's own sealed record opens, and one signed by CryptoKit verifies and opens.
        let opened = try RecordCodec.open(try v.expected.hex("sealed"), groupKey: try singleKeyring(v.input))
        guard opened.recordID == injected.recordID else { return .fail("record id differs after opening") }
        let native = try sealNative(v.input)
        let author = try v.input.hex("author")
        guard Ed25519Strict.verify(publicKey: author, message: native.signedMessage, signature: native.signature) == .ok else {
            return .fail("a signature made by CryptoKit does not verify")
        }
        _ = try RecordCodec.open(native.sealed, groupKey: try singleKeyring(v.input))
        if native.sealed == injected.sealed { return .pass }
        return .partial("\(f1): everything matches byte for byte (salt, header, body, padding, ciphertext, record id) with the vector's signature injected; with CryptoKit's own signature the sealed record and record_id differ")
    case "record.seal_twice":
        let want = try v.expected.hex("sealed")
        let wantOpened = try RecordCodec.open(want, groupKey: try singleKeyring(v.input))
        let injected = try sealInjected(v.input, signature: wantOpened.signature)
        guard case .pass = compareFields(["salt": injected.salt.formatHex, "sealed": injected.sealed.formatHex, "record_id": injected.recordID.formatHex], v.expected) else {
            return .fail("sealing with the vector's signature does not reproduce the vector")
        }
        let a = try sealNative(v.input), b = try sealNative(v.input)
        if a.sealed == b.sealed { return .pass }
        if v.name.hasSuffix("different-body-different-record") {
            return .partial("\(f1); the bytes match with the vector's signature injected")
        }
        // Specification 4.1: a signer may add randomness, so two seals of one body may differ, but only in the signature and what
        // follows from it. Everything fixed by the body must be equal, both must open, and a writer never seals a body twice.
        guard a.salt == b.salt, a.header == b.header, a.bodyWithoutSignature == b.bodyWithoutSignature, a.signedMessage == b.signedMessage,
              a.paddedLength == b.paddedLength, a.sealed.count == b.sealed.count else {
            return .fail("two seals of one body differ in more than the signature")
        }
        let keyring = try singleKeyring(v.input)
        let openedA = try RecordCodec.open(a.sealed, groupKey: keyring), openedB = try RecordCodec.open(b.sealed, groupKey: keyring)
        guard openedA.recordID == a.recordID, openedB.recordID == b.recordID, a.recordID != b.recordID, a.signature != b.signature else {
            return .fail("two seals of one body do not open to their own record ids")
        }
        return .partial("\(f1); the bytes match with the vector's signature injected, and two seals by CryptoKit differ only in the signature, as specification 4.1 allows")
    case "record.seal_large":
        let size = Int(try v.expected.uint("body_len"))
        // The vector gives the item id and the length of one byte-string field but not its name or the ramp. Any name of the
        // right length gives the same lengths; the signature is random, so the hash of the sealed record cannot match.
        var sealed: SealedRecord?
        let item = try v.input.hex("item")
        let ramp = Data((0..<Int(try v.input.uint("bytes_len"))).map { UInt8(truncatingIfNeeded: $0) })
        for nameLength in 1...32 {
            var input = v.input
            input["kind"] = 16
            input["prev"] = NSNull()
            let payload = CBORValue.uintMap([(1, .bytes(item)), (2, .textMap([(String(repeating: "f", count: nameLength), .bytes(ramp))])), (3, .array([]))])
            input["payload"] = try FormatCBOR.encode(payload).formatHex
            let candidate = try sealNative(input, allowOversize: true)
            if candidate.plaintextLengthBeforePadding == size + 4 { sealed = candidate; break }
        }
        guard let sealed else { return .fail("no field name length gives a body of \(size) bytes") }
        guard sealed.sealed.count == Int(try v.expected.uint("sealed_len")) else { return .fail("sealed length \(sealed.sealed.count)") }
        let opens = v.expected["opens"] as? JSON ?? [:]
        let result = Result { try RecordCodec.open(sealed.sealed, groupKey: try singleKeyring(v.input)) }
        let outcome = try judge(result, opens) { _ in .pass }
        guard case .pass = outcome else { return outcome }
        return .partial("body and sealed lengths and the opening result match; sha256 not compared (the vector does not say the field name or the ramp, and \(f1))")
    case "record.craft":
        let gid = try v.input.hex("gid"), epoch = UInt32(try v.input.uint("epoch")), key = try v.input.hex("key"), salt = try v.input.hex("salt")
        let plaintextLength = Int(try v.input.uint("plaintext_len")), declared = UInt32(try v.input.uint("declared_body_len"))
        var plaintext = FormatCrypto.u32(declared)
        plaintext.append(Data(count: plaintextLength - 4))
        let header = RecordCodec.makeHeader(gid: gid, epoch: epoch, salt: salt)
        let sealed = header + (try FormatCrypto.chachaSeal(key: RecordCodec.recordKey(groupKey: key, salt: salt), aad: header, plaintext: plaintext))
        guard case .pass = compareFields(["sealed_len": String(sealed.count), "sealed_sha256": FormatCrypto.sha256(sealed).formatHex],
                                         v.expected.mapValues { value -> Any in (value as? NSNumber).map { "\($0)" } ?? value }) else {
            return .fail("crafted record differs from the vector (zero padding after the declared length assumed): sha256 \(FormatCrypto.sha256(sealed).formatHex)")
        }
        let result = Result { try RecordCodec.open(sealed, groupKey: try singleKeyring(v.input)) }
        return try judge(result, try v.expected.object("opens")) { _ in .pass }
    case "record.open":
        let ring = try keyring(v.input)
        let result = Result { try RecordCodec.open(try v.input.hex("sealed"), groupKey: ring) }
        return try judge(result, v.expected) { try compareOpened($0, v.expected) }
    default:
        return .skip("unknown type \(v.type)")
    }
}

// MARK: - clock.json and fold.json

func order(_ d: JSON) throws -> RecordOrder {
    RecordOrder(wallMs: try d.uint("wall"), counter: try d.uint("counter"), author: try d.hex("author"), device: try d.hex("device"), seq: try d.uint("seq"))
}

func runClock(_ v: Vector) throws -> Outcome {
    switch v.type {
    case "clock.order":
        let clocks = try v.input.array("clocks").map { c -> RecordOrder in
            guard let d = c as? JSON else { throw TestFailure("bad clock entry") }
            return try order(d)
        }
        let sorted = clocks.indices.sorted { clocks[$0] < clocks[$1] }
        guard jv(v.expected["order"]) == .array(sorted.map { .int(Int64($0)) }) else { return .fail("order \(sorted)") }
        return .pass
    case "clock.next":
        let seen = try v.input.array("seen").map { s -> RecordClock in
            guard let p = s as? [Any], p.count == 2, let w = (p[0] as? NSNumber)?.uint64Value, let c = (p[1] as? NSNumber)?.uint64Value else { throw TestFailure("bad seen") }
            return RecordClock(wallMs: w, counter: c)
        }
        let next = FormatClock.next(nowMs: try v.input.uint("now_ms"), seen: seen)
        guard jv(v.expected["clock"]) == .array([.int(Int64(next.wallMs)), .int(Int64(next.counter))]) else { return .fail("clock \(next)") }
        return .pass
    case "clock.held_back":
        let held = FormatClock.isHeldBack(wallMs: try v.input.uint("wall_ms"), nowMs: try v.input.uint("now_ms"))
        return jv(v.expected["held_back"]) == .bool(held) ? .pass : .fail("held_back \(held)")
    case "clock.purge_due":
        let due = FormatClock.isPurgeDue(acceptedMs: try v.input.uint("accepted_ms"), nowMs: try v.input.uint("now_ms"))
        return jv(v.expected["due"]) == .bool(due) ? .pass : .fail("due \(due)")
    default:
        return .skip("unknown type \(v.type)")
    }
}

func orderJV(_ o: RecordOrder) -> JV {
    .array([.int(Int64(o.wallMs)), .int(Int64(o.counter)), .string(o.author.formatHex), .string(o.device.formatHex), .int(Int64(o.seq))])
}

func writeJV(_ w: ItemWrite) throws -> [String: JV] {
    ["value": try w.value.map { JV.string(try FormatCBOR.encode($0).formatHex) } ?? .null, "cleared": .bool(w.value == nil), "clock": orderJV(w.order)]
}

func stateJV(_ state: [Data: ItemState]) throws -> JV {
    var items: [String: JV] = [:]
    for (item, itemState) in state {
        var fields: [String: JV] = [:]
        for (name, field) in itemState.fields {
            var current = try writeJV(field.current)
            current["current"] = current.removeValue(forKey: "value")
            current["history"] = .array(try field.history.map { .object(try writeJV($0)) })
            fields[String(decoding: name, as: UTF8.self)] = .object(current)
        }
        items[item.formatHex] = .object(["deleted": .bool(itemState.isDeleted), "fields": .object(fields)])
    }
    return .object(items)
}

func runFold(_ v: Vector) throws -> Outcome {
    let changes: [(order: RecordOrder, change: ItemChange)] = try v.input.array("changes").map { c in
        guard let d = c as? JSON, let clock = d["clock"] as? [Any], clock.count == 2,
              let wall = (clock[0] as? NSNumber)?.uint64Value, let counter = (clock[1] as? NSNumber)?.uint64Value else { throw TestFailure("bad change") }
        let place = RecordOrder(wallMs: wall, counter: counter, author: try d.hex("author"), device: try d.hex("device"), seq: try d.uint("seq"))
        return (place, try ItemChange.parse(payload: try FormatCBOR.decode(try d.hex("payload"))))
    }
    var orders: [[Int]] = [Array(changes.indices)]
    if let given = v.input["orders"] as? [[Int]] { orders = given }
    let want = jv(try v.expected.object("state"))
    for permutation in orders {
        let got = try stateJV(try ItemFold.fold(permutation.map { changes[$0] }))
        guard got == want else { return .fail("state differs for order \(permutation): got \(got)") }
    }
    if let byOrder = v.expected["states_by_order"] as? [Any] {
        guard byOrder.count == orders.count, byOrder.allSatisfy({ jv($0) == want }) else { return .fail("states_by_order disagrees with state") }
    }
    return .pass
}

// MARK: - wraps.json

func runWraps(_ v: Vector) throws -> Outcome {
    switch v.type {
    case "wrap.seal":
        let gid = try v.input.hex("gid"), epoch = UInt32(try v.input.uint("epoch")), pid = try v.input.hex("recipient_pid")
        let info = GroupKeyWrap.info(gid: gid, epoch: epoch, recipientPID: pid)
        let wrap = try RefHPKE.seal(publicKey: try v.input.hex("recipient_kem_pk"), ekX: try v.input.hex("ek_x"), mlkemCiphertext: try v.input.hex("mlkem_ct"),
                                    mlkemSharedSecret: try v.input.hex("mlkem_ss"), info: info, aad: Data(), plaintext: try v.input.hex("key"))
        guard case .pass = compareFields(["wrap": wrap.formatHex], v.expected) else { return .fail("reference HPKE does not reproduce the wrap") }
        guard let person = knownPersons[pid] else { return .partial("fixed KEM randomness cannot be given to CryptoKit; reproduced with the reference HPKE; recipient's seed unknown here, so CryptoKit's opening of it was not checked") }
        let opened = try GroupKeyWrap.unwrap(try v.expected.hex("wrap"), gid: gid, epoch: epoch, recipientPID: pid, kemSeed: person.kemSeed)
        guard opened == (try v.input.hex("key")) else { return .fail("CryptoKit opens the vector's wrap to another key") }
        // And CryptoKit's own wrap opens in CryptoKit.
        let own = try GroupKeyWrap.wrap(groupKey: opened, gid: gid, epoch: epoch, recipientPID: pid, recipientKemPublicKey: person.kemPublicKey)
        guard own.count == GroupKeyWrap.length, (try GroupKeyWrap.unwrap(own, gid: gid, epoch: epoch, recipientPID: pid, kemSeed: person.kemSeed)) == opened else {
            return .fail("CryptoKit's own wrap does not open")
        }
        return .partial("CryptoKit cannot be given fixed KEM randomness: the vector's bytes were reproduced with the reference HPKE written in the test, opened by CryptoKit, and CryptoKit's own wrap round-trips")
    case "wrap.open":
        let result = Result { try GroupKeyWrap.unwrap(try v.input.hex("wrap"), gid: try v.input.hex("gid"), epoch: UInt32(try v.input.uint("epoch")),
                                                       recipientPID: try v.input.hex("recipient_pid"), kemSeed: try v.input.hex("recipient_kem_seed")) }
        return try judge(result, v.expected) { compareFields(["key": $0.formatHex], v.expected) }
    case "wrap.select":
        let wraps = try v.input.array("wraps").map { w -> Data in
            guard let s = w as? String, let d = Data(formatHex: s) else { throw TestFailure("bad wrap") }
            return d
        }
        let key = GroupKeyWrap.select(wraps: wraps, gid: try v.input.hex("gid"), epoch: UInt32(try v.input.uint("epoch")),
                                      recipientPID: try v.input.hex("recipient_pid"), kemSeed: try v.input.hex("recipient_kem_seed"),
                                      commit: try v.input.hex("commit"))
        guard jv(v.expected["key"]) == (key.map { JV.string($0.formatHex) } ?? .null) else { return .fail("selected \(key?.formatHex ?? "nil")") }
        return .pass
    default:
        return .skip("unknown type \(v.type)")
    }
}

// MARK: - slots.json

func passwordParameters(_ input: JSON) throws -> PasswordKDFParameters {
    let p = try input.object("params")
    return PasswordKDFParameters(memoryKiB: try p.uint("memory"), passes: try p.uint("passes"), lanes: try p.uint("lanes"))
}

func runSlots(_ v: Vector) throws -> Outcome {
    switch v.type {
    case "slot.seal_password":
        let result = Result {
            try Slots.sealPassword(ps: try v.input.hex("ps"), pid: try v.input.hex("pid"), slotID: try v.input.hex("slot_id"), salt: try v.input.hex("salt"),
                                   parameters: try passwordParameters(v.input), password: try v.input.string("password"),
                                   allowTestParameters: v.input.bool("test_only"))
        }
        return try judge(result, v.expected) { compareFields(["slot": $0.formatHex], v.expected) }
    case "slot.craft_password":
        let p = try passwordParameters(v.input)
        let slot = try Slots.encode(type: Slots.typePassword, pid: try v.input.hex("pid"), slotID: try v.input.hex("slot_id"),
                                    params: Slots.passwordParams(salt: try v.input.hex("salt"), p), ciphertext: Data(count: 48))
        return compareFields(["slot": slot.formatHex], v.expected)
    case "slot.craft_other":
        let slot = try Slots.encode(version: try v.input.uint("version"), type: try v.input.uint("slot_type"), pid: try v.input.hex("pid"),
                                    slotID: try v.input.hex("slot_id"), params: .map([]), ciphertext: Data(count: 48))
        return compareFields(["slot": slot.formatHex], v.expected)
    case "slot.seal_kit":
        let result = Result { try Slots.sealKit(ps: try v.input.hex("ps"), pid: try v.input.hex("pid"), slotID: try v.input.hex("slot_id"), kit: try v.input.hex("kit")) }
        return try judge(result, v.expected) { compareFields(["slot": $0.formatHex], v.expected) }
    case "slot.seal_device":
        let ps = try v.input.hex("ps"), pid = try v.input.hex("pid"), slotID = try v.input.hex("slot_id"), pk = try v.input.hex("device_kem_pk")
        let params = CBORValue.uintMap([(1, .bytes(pk))])
        let aad = try Slots.encode(type: Slots.typeDevice, pid: pid, slotID: slotID, params: params, ciphertext: nil)
        let blob = try RefHPKE.seal(publicKey: pk, ekX: try v.input.hex("ek_x"), mlkemCiphertext: try v.input.hex("mlkem_ct"),
                                    mlkemSharedSecret: try v.input.hex("mlkem_ss"), info: Slots.deviceInfo(pid: pid, slotID: slotID), aad: aad, plaintext: ps)
        let slot = try Slots.encode(type: Slots.typeDevice, pid: pid, slotID: slotID, params: params, ciphertext: blob)
        guard case .pass = compareFields(["slot": slot.formatHex], v.expected) else { return .fail("reference HPKE does not reproduce the slot") }
        guard let seed = knownDeviceSeeds[pk] else { return .partial("fixed KEM randomness cannot be given to CryptoKit; reproduced with the reference HPKE; the device seed is unknown here, so CryptoKit's opening was not checked") }
        let expectedSlot = try v.expected.hex("slot")
        let blobWant = Data(expectedSlot.suffix(blob.count))
        guard (try XWingHPKE.open(seed: seed, info: Slots.deviceInfo(pid: pid, slotID: slotID), aad: aad, blob: blobWant)) == ps else {
            return .fail("CryptoKit opens the vector's device slot to another secret")
        }
        return .partial("CryptoKit cannot be given fixed KEM randomness: the vector's bytes were reproduced with the reference HPKE written in the test and opened by CryptoKit")
    case "slot.open":
        if v.name.contains("at-maximum-memory") && !heavy { return .skip("needs a gigabyte of memory: set PSSS_HEAVY=1") }
        let unlockJSON = try v.input.object("unlock")
        let unlock: SlotUnlock
        if let password = unlockJSON["password"] as? String { unlock = .password(password) }
        else if unlockJSON["kit"] != nil { unlock = .kit(try unlockJSON.hex("kit")) }
        else { unlock = .deviceKemSeed(try unlockJSON.hex("device_kem_seed")) }
        if let seed = unlockJSON["device_kem_seed"] as? String, let seedData = Data(formatHex: seed),
           let key = try? XWingMLKEM768X25519.PrivateKey(seedRepresentation: seedData, publicKey: nil) {
            knownDeviceSeeds[key.publicKey.rawRepresentation] = seedData
        }
        let result = Result { try Slots.open(try v.input.hex("slot"), unlock: unlock, allowTestParameters: v.input.bool("test_only")) }
        return try judge(result, v.expected) { compareFields(["ps": $0.formatHex], v.expected) }
    case "kit.text":
        let result = Result { try RecoveryKit.text(for: try v.input.hex("kit")) }
        return try judge(result, v.expected) { compareFields(["text": $0], v.expected) }
    case "kit.parse":
        let result = Result { try RecoveryKit.parse(try v.input.string("text")) }
        return try judge(result, v.expected) { compareFields(["kit": $0.formatHex], v.expected) }
    default:
        return .skip("unknown type \(v.type)")
    }
}

// MARK: - Running the files

func runFile(_ dir: URL, _ file: String, prepare: ([Vector]) -> Void = { _ in }, _ run: (Vector) throws -> Outcome) {
    guard let vectors = loadVectors(dir, file) else {
        report("\(file).json", .fail("cannot read the vector file"))
        finishFile(file)
        return
    }
    prepare(vectors)
    for v in vectors {
        let outcome: Outcome
        do { outcome = try run(v) } catch let error as TestFailure { outcome = .fail(error.description) } catch { outcome = .fail("threw \(error)") }
        report(v.name, outcome)
    }
    finishFile(file)
}

// MARK: - Entry

let arguments = CommandLine.arguments
let vectorsDirectory = URL(fileURLWithPath: arguments.count > 1 ? arguments[1] : "Packages/format/vectors")
let outputDirectory = URL(fileURLWithPath: arguments.count > 2 ? arguments[2] : "build/format-test")

print("Ed25519Strict field constants: \(Ed25519Strict.Curve.constantsAreRight() ? "ok" : "WRONG")")
if !Ed25519Strict.Curve.constantsAreRight() { exit(1) }

// person.json first (it teaches the later files which keys belong to which people), then the others.
runFile(vectorsDirectory, "cbor", runCBOR)
runFile(vectorsDirectory, "person", runPerson)
runFile(vectorsDirectory, "record", runRecord)
runFile(vectorsDirectory, "clock", runClock)
runFile(vectorsDirectory, "fold", runFold)
runFile(vectorsDirectory, "wraps", runWraps)
runFile(vectorsDirectory, "slots", prepare: { vectors in
    // The device seeds that the slot.open vectors use, so that the seal vectors (earlier in the file) can be opened with CryptoKit.
    for v in vectors where v.type == "slot.open" {
        if let unlock = v.input["unlock"] as? JSON, let seed = try? unlock.hex("device_kem_seed"),
           let key = try? XWingMLKEM768X25519.PrivateKey(seedRepresentation: seed, publicKey: nil) {
            knownDeviceSeeds[key.publicKey.rawRepresentation] = seed
        }
    }
}, runSlots)

// MARK: - What CryptoKit sealed in this run

func vec(_ name: String, _ description: String, _ type: String, _ input: JSON, _ expected: JSON) -> JSON {
    ["name": name, "description": description, "type": type, "input": input, "expected": expected]
}

func writeSealedBySwift() throws -> [JSON] {
    var vectors: [JSON] = []
    let alice = try Person.generate(), bob = try Person.generate()
    let nonce = FormatCrypto.randomBytes(32), k0 = FormatCrypto.randomBytes(32), k1 = FormatCrypto.randomBytes(32)
    let gid = GroupIdentity.gid(creatorPID: alice.pid, genesisNonce: nonce, k0: k0, minReader: 1)
    let device = FormatCrypto.randomBytes(16), mhead = FormatCrypto.randomBytes(32)
    let keys: [Any] = [["gid": gid.formatHex, "epoch": 0, "key": k0.formatHex] as JSON]

    func item(_ title: String) throws -> CBORValue {
        .uintMap([(1, .bytes(FormatCrypto.randomBytes(16))), (2, .textMap([("title", .text(title)), ("url", .text("https://example.com")),
                  ("passkey", .uintMap([(1, .bytes(Data([1, 2, 3]))), (2, .text("é"))]))])), (3, .array([.text("note")]))])
    }
    var previous: Data?
    for seq in 1...2 {
        let sealed = try RecordCodec.seal(gid: gid, epoch: 0, groupKey: k0, fields: RecordFields(
            author: alice.pid, device: device, seq: UInt64(seq), prev: previous, clock: RecordClock(wallMs: 1_700_000_000_000 + UInt64(seq), counter: 0),
            kind: 16, mhead: mhead, payload: try item("Written by CryptoKit \(seq)")), sign: alice.sign)
        previous = sealed.recordID
        let opened = try RecordCodec.open(sealed.sealed, groupKey: { g, e in g == gid && e == 0 ? k0 : nil })
        vectors.append(vec("swift/record/open-\(seq)", "A record sealed by CryptoKit (Ed25519 signature, ChaCha20-Poly1305): the Node package must open it.",
                           "record.open", ["keys": keys, "sealed": sealed.sealed.formatHex], ["ok": try openedJSON(opened)]))
    }
    // The same body sealed twice: CryptoKit's signature is randomized, so these are two records (finding F1). Both must open.
    let fields = RecordFields(author: alice.pid, device: device, seq: 1, prev: nil, clock: RecordClock(wallMs: 1_700_000_100_000, counter: 0),
                              kind: 16, mhead: mhead, payload: try item("Same body twice"))
    for copy in ["a", "b"] {
        let sealed = try RecordCodec.seal(gid: gid, epoch: 0, groupKey: k0, fields: fields, sign: alice.sign)
        let opened = try RecordCodec.open(sealed.sealed, groupKey: { g, e in g == gid && e == 0 ? k0 : nil })
        vectors.append(vec("swift/record/same-body-twice-\(copy)", "The same body sealed by CryptoKit twice; the two sealed records differ only in the signature (and so in everything after it). Each must open.",
                           "record.open", ["keys": keys, "sealed": sealed.sealed.formatHex], ["ok": try openedJSON(opened)]))
    }

    // Card and person.
    let card = try alice.card()
    vectors.append(vec("swift/card/verify", "A person card signed by CryptoKit.", "card.verify", ["card": card.formatHex], ["ok": true, "pid": alice.pid.formatHex]))
    vectors.append(vec("swift/person/derive-fields", "Alice's derived keys (the card is left out: its signature is randomized).", "person.derive.partial",
                       ["ps": alice.secret.formatHex], ["sign_seed": alice.signSeed.formatHex, "kem_seed": alice.kemSeed.formatHex,
                                                        "pid": alice.pid.formatHex, "kem_pk": alice.kemPublicKey.formatHex]))
    let message = FormatCrypto.randomBytes(40)
    vectors.append(vec("swift/signature/verify", "An Ed25519 signature made by CryptoKit over 40 random bytes.", "signature.verify",
                       ["pk": alice.pid.formatHex, "msg": message.formatHex, "sig": try alice.sign(message).formatHex], ["result": "ok"]))

    // X-Wing and HPKE.
    let device1 = try XWingMLKEM768X25519.PrivateKey.generate()
    let encapsulation = try device1.publicKey.encapsulate()
    vectors.append(vec("swift/xwing/decapsulate", "A ciphertext made by CryptoKit's X-Wing encapsulation to a random key.", "xwing.decapsulate",
                       ["seed": device1.seedRepresentation.formatHex, "ct": encapsulation.encapsulated.formatHex],
                       ["ss": encapsulation.sharedSecret.withUnsafeBytes { Data($0) }.formatHex]))
    vectors.append(vec("swift/xwing/keygen", "The public key CryptoKit derives from a random seed.", "xwing.keygen", ["seed": device1.seedRepresentation.formatHex],
                       ["pk": device1.publicKey.rawRepresentation.formatHex]))
    let info = FormatCrypto.randomBytes(9), aad = FormatCrypto.randomBytes(5), pt = FormatCrypto.randomBytes(32)
    vectors.append(vec("swift/hpke/open", "HPKE (X-Wing, HKDF-SHA256, AES-256-GCM) sealed by CryptoKit with info and aad.", "hpke.open",
                       ["seed": device1.seedRepresentation.formatHex, "info": info.formatHex, "aad": aad.formatHex,
                        "blob": try XWingHPKE.seal(to: device1.publicKey.rawRepresentation, info: info, aad: aad, plaintext: pt).formatHex], ["pt": pt.formatHex]))

    // Wrapped group key.
    let wrap = try GroupKeyWrap.wrap(groupKey: k1, gid: gid, epoch: 1, recipientPID: bob.pid, recipientKemPublicKey: bob.kemPublicKey)
    let wrapInput: JSON = ["gid": gid.formatHex, "epoch": 1, "recipient_pid": bob.pid.formatHex, "recipient_kem_seed": bob.kemSeed.formatHex]
    var wrapOpenInput = wrapInput
    wrapOpenInput["wrap"] = wrap.formatHex
    var wrapSelectInput = wrapInput
    wrapSelectInput["wraps"] = [Data(count: 1168).formatHex, wrap.formatHex]
    wrapSelectInput["commit"] = GroupIdentity.commit(gid: gid, epoch: 1, key: k1).formatHex
    vectors.append(vec("swift/wrap/open", "K_1 wrapped to bob by CryptoKit.", "wrap.open", wrapOpenInput, ["key": k1.formatHex]))
    vectors.append(vec("swift/wrap/select", "A wrap by CryptoKit among garbage; the commitment picks it.", "wrap.select", wrapSelectInput, ["key": k1.formatHex]))
    // A record sealed in epoch 1 under the key that wrap carries.
    let epoch1 = try RecordCodec.seal(gid: gid, epoch: 1, groupKey: k1, fields: RecordFields(
        author: alice.pid, device: device, seq: 3, prev: previous, clock: RecordClock(wallMs: 1_700_000_200_000, counter: 0),
        kind: 16, mhead: mhead, payload: try item("Epoch 1")), sign: alice.sign)
    let epoch1Opened = try RecordCodec.open(epoch1.sealed, groupKey: { g, e in g == gid && e == 1 ? k1 : nil })
    vectors.append(vec("swift/record/open-epoch-1", "A record sealed in epoch 1 by CryptoKit; open it with the key from swift/wrap/open.", "record.open",
                       ["keys": [["gid": gid.formatHex, "epoch": 1, "key": k1.formatHex] as JSON], "sealed": epoch1.sealed.formatHex],
                       ["ok": try openedJSON(epoch1Opened)]))

    // Slots, one of each type.
    let slotPS = alice.secret
    let passwordSlotID = FormatCrypto.randomBytes(16), salt = FormatCrypto.randomBytes(16)
    let testParameters = PasswordKDFParameters(memoryKiB: 64, passes: 2, lanes: 2)
    let weakSlot = try Slots.sealPassword(ps: slotPS, pid: alice.pid, slotID: passwordSlotID, salt: salt, parameters: testParameters,
                                          password: "caf\u{65}\u{301} swift", allowTestParameters: true)
    vectors.append(vec("swift/slot/password-test-params", "A password slot sealed by CryptoKit with test-only Argon2id parameters (64 KiB, 2 passes, 2 lanes); the password is typed in NFD and the device normalizes it to NFC. Open it with the NFC password and the test-only switch.",
                       "slot.open", ["slot": weakSlot.formatHex, "unlock": ["password": "caf\u{e9} swift"], "test_only": true], ["ps": slotPS.formatHex]))
    let floorSlot = try Slots.sealPassword(ps: slotPS, pid: alice.pid, slotID: FormatCrypto.randomBytes(16), salt: FormatCrypto.randomBytes(16),
                                           parameters: PasswordKDFParameters(memoryKiB: 65_536, passes: 2, lanes: 1), password: "correct horse swift")
    vectors.append(vec("swift/slot/password-at-minimum", "A password slot at the floor (65,536 KiB, 2 passes, 1 lane), opened without the test-only switch.", "slot.open",
                       ["slot": floorSlot.formatHex, "unlock": ["password": "correct horse swift"], "test_only": false], ["ps": slotPS.formatHex]))
    let kit = RecoveryKit.generate()
    let kitSlot = try Slots.sealKit(ps: slotPS, pid: alice.pid, slotID: FormatCrypto.randomBytes(16), kit: kit)
    vectors.append(vec("swift/slot/kit", "A recovery kit slot sealed by CryptoKit.", "slot.open", ["slot": kitSlot.formatHex, "unlock": ["kit": kit.formatHex]], ["ps": slotPS.formatHex]))
    vectors.append(vec("swift/kit/text", "The printed form of a random kit.", "kit.text", ["kit": kit.formatHex], ["text": try RecoveryKit.text(for: kit)]))
    vectors.append(vec("swift/kit/parse", "Reading it back, in lower case with spaces.", "kit.parse", ["text": try RecoveryKit.text(for: kit).lowercased().replacingOccurrences(of: "-", with: " ")], ["kit": kit.formatHex]))
    let deviceSlot = try Slots.sealDevice(ps: slotPS, pid: alice.pid, slotID: FormatCrypto.randomBytes(16), deviceKemPublicKey: device1.publicKey.rawRepresentation)
    vectors.append(vec("swift/slot/device", "A device slot sealed by CryptoKit (HPKE, the slot map as aad) to the key of swift/xwing/decapsulate.", "slot.open",
                       ["slot": deviceSlot.formatHex, "unlock": ["device_kem_seed": device1.seedRepresentation.formatHex]], ["ps": slotPS.formatHex]))
    return vectors
}

do {
    let vectors = try writeSealedBySwift()
    let document: JSON = ["description": "Things sealed by Swift and CryptoKit in one run of scripts/test-format-swift.sh, with every key and input another implementation needs to open them. Same layout and conventions as the vector files; `type`s are those of the vector files (person.derive.partial lists only the derived keys). Every secret here is random and is made for this file only.", "vectors": vectors]
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    let data = try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    try data.write(to: outputDirectory.appendingPathComponent("sealed-by-swift.json"))
    // Read it back and run it through the same code: what is written must be what this implementation accepts.
    let written = try JSONSerialization.jsonObject(with: data) as! JSON
    for case let raw as JSON in written["vectors"] as! [Any] {
        let v = Vector(name: raw["name"] as! String, description: raw["description"] as! String, type: raw["type"] as! String,
                       input: raw["input"] as! JSON, expected: raw["expected"] as! JSON)
        let outcome: Outcome
        do {
            switch v.type {
            case "person.derive.partial":
                let p = try Person(secret: try v.input.hex("ps"))
                outcome = compareFields(["sign_seed": p.signSeed.formatHex, "kem_seed": p.kemSeed.formatHex, "pid": p.pid.formatHex, "kem_pk": p.kemPublicKey.formatHex], v.expected)
            case "record.open": outcome = try runRecord(v)
            case "card.verify", "signature.verify", "xwing.decapsulate", "xwing.keygen", "hpke.open": outcome = try runPerson(v)
            case "wrap.open", "wrap.select": outcome = try runWraps(v)
            default: outcome = try runSlots(v)
            }
        } catch { outcome = .fail("threw \(error)") }
        report(v.name, outcome)
    }
} catch {
    report("sealed-by-swift.json", .fail("could not be written: \(error)"))
}
finishFile("sealed-by-swift")

// MARK: - Summary

print("")
if !notes.isEmpty {
    print("Notes (CryptoKit on its own, informational):")
    for note in notes { print("  \(note)") }
    print("")
}
print("file                passed  partial  skipped  failed")
var total = Tally()
for (file, t) in tallies {
    print(file.padding(toLength: 20, withPad: " ", startingAt: 0) + String(t.passed).padding(toLength: 8, withPad: " ", startingAt: 0)
          + String(t.partial).padding(toLength: 9, withPad: " ", startingAt: 0) + String(t.skipped).padding(toLength: 9, withPad: " ", startingAt: 0) + String(t.failed))
    total.passed += t.passed; total.partial += t.partial; total.skipped += t.skipped; total.failed += t.failed
}
print("total".padding(toLength: 20, withPad: " ", startingAt: 0) + String(total.passed).padding(toLength: 8, withPad: " ", startingAt: 0)
      + String(total.partial).padding(toLength: 9, withPad: " ", startingAt: 0) + String(total.skipped).padding(toLength: 9, withPad: " ", startingAt: 0) + String(total.failed))
print(total.failed == 0 ? "OK" : "FAILED: \(total.failed)")
exit(total.failed == 0 ? 0 : 1)
