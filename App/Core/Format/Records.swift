import Foundation

// Sealed records (spec sections 4.1 to 4.3 and 9): padding, the derived salt, the body, the signature and the order of
// checks on opening.

/// The fields of a record body that a writer chooses. `mhead` is present exactly for content records (kind 16 and above);
/// membership records carry their `mprev` inside the payload.
struct RecordFields {
    var author: Data
    var device: Data
    var seq: UInt64
    var prev: Data?
    var clock: RecordClock
    var kind: UInt64
    var mhead: Data?
    var payload: CBORValue
    /// Integer keys of 128 and above, kept and covered by the signature.
    var extensions: [(key: UInt64, value: CBORValue)] = []
}

struct SealedRecord {
    var sealed: Data
    var header: Data
    var salt: Data
    var bodyWithoutSignature: Data
    var signedMessage: Data
    var signature: Data
    /// 4 + len(body)
    var plaintextLengthBeforePadding: Int
    /// size(n)
    var paddedLength: Int
    var recordID: Data
}

struct OpenedRecord {
    var gid: Data
    var epoch: UInt32
    var salt: Data
    var author: Data
    var device: Data
    var seq: UInt64
    var prev: Data?
    var clock: RecordClock
    var kind: UInt64
    var mhead: Data?
    var payload: CBORValue
    var signature: Data
    var recordID: Data
    /// Body keys of 128 and above, ascending.
    var extensionKeys: [UInt64]
    /// Payload keys of 128 and above for a kind this implementation checks the payload of, ascending.
    var payloadExtensionKeys: [UInt64]
}

enum RecordCodec {
    static let magic = Data("PSR1".utf8)
    static let headerLength = 72
    static let tagLength = 16
    static let maxBodyLength = 1_048_576
    /// The header, the largest plaintext and the tag.
    static let maxSealedLength = 1_052_760
    /// Content records are kinds 16 and above.
    static let firstContentKind: UInt64 = 16

    /// size(n): 256 × ceil(n / 256) when that is at most 4096, 4096 × ceil(n / 4096) otherwise.
    static func paddedLength(_ n: Int) -> Int {
        let small = 256 * ((n + 255) / 256)
        return small <= 4096 ? small : 4096 * ((n + 4095) / 4096)
    }

    static func makeHeader(gid: Data, epoch: UInt32, salt: Data) -> Data {
        magic + gid + FormatCrypto.u32(epoch) + salt
    }

    /// salt = HKDF(K_epoch, SHA-256(body_without_9), "psss/v1/salt")
    static func derivedSalt(groupKey: Data, bodyWithoutSignature: Data) -> Data {
        FormatCrypto.hkdf(ikm: groupKey, salt: FormatCrypto.sha256(bodyWithoutSignature), info: FormatCrypto.label("psss/v1/salt"))
    }

    /// rk = HKDF(K_epoch, salt, "psss/v1/record")
    static func recordKey(groupKey: Data, salt: Data) -> Data {
        FormatCrypto.hkdf(ikm: groupKey, salt: salt, info: FormatCrypto.label("psss/v1/record"))
    }

    static func signedMessage(header: Data, bodyWithoutSignature: Data) -> Data {
        FormatCrypto.label("psss/v1/record-sig") + header + bodyWithoutSignature
    }

    // MARK: Sealing

    private static func bodyEntries(_ fields: RecordFields) -> [(UInt64, CBORValue)] {
        var entries: [(UInt64, CBORValue)] = [
            (1, .uint(1)), (2, .bytes(fields.author)), (3, .bytes(fields.device)), (4, .uint(fields.seq)),
            (5, fields.prev.map { .bytes($0) } ?? .null),
            (6, .array([.uint(fields.clock.wallMs), .uint(fields.clock.counter)])),
            (7, .uint(fields.kind)), (8, fields.payload),
        ]
        if let mhead = fields.mhead { entries.append((10, .bytes(mhead))) }
        for (key, value) in fields.extensions { entries.append((key, value)) }
        return entries
    }

    /// Seals a record: derives the salt, signs header and body, pads, and encrypts. `sign` is given the message
    /// "psss/v1/record-sig" || header || body_without_9 and returns 64 bytes; it defaults to nothing because the caller owns
    /// the signing key (`Person.sign`). `allowOversizeForTesting` lifts the body limit so the limit vectors can be built.
    static func seal(gid: Data, epoch: UInt32, groupKey: Data, fields: RecordFields, allowOversizeForTesting: Bool = false,
                     sign: (Data) throws -> Data) throws -> SealedRecord {
        let bodyWithoutSignature = try FormatCBOR.encode(.uintMap(bodyEntries(fields)))
        let salt = derivedSalt(groupKey: groupKey, bodyWithoutSignature: bodyWithoutSignature)
        let header = makeHeader(gid: gid, epoch: epoch, salt: salt)
        let message = signedMessage(header: header, bodyWithoutSignature: bodyWithoutSignature)
        let signature = try sign(message)
        guard signature.count == 64 else { throw FormatError("bad_signature_encoding") }
        let body = try FormatCBOR.encode(.uintMap(bodyEntries(fields) + [(9, .bytes(signature))]))
        guard body.count <= maxBodyLength || allowOversizeForTesting else { throw FormatError("body_too_large", .discard) }
        let n = 4 + body.count
        let padded = paddedLength(n)
        var plaintext = FormatCrypto.u32(UInt32(body.count)) + body
        plaintext.append(Data(count: padded - n))
        let ciphertext = try FormatCrypto.chachaSeal(key: recordKey(groupKey: groupKey, salt: salt), aad: header, plaintext: plaintext)
        let sealed = header + ciphertext
        return SealedRecord(sealed: sealed, header: header, salt: salt, bodyWithoutSignature: bodyWithoutSignature,
                            signedMessage: message, signature: signature, plaintextLengthBeforePadding: n, paddedLength: padded,
                            recordID: FormatCrypto.sha256(sealed))
    }

    // MARK: Opening

    /// Opens a sealed record in the order of section 9: magic, key (wait when missing), AEAD tag, padding, body form, body
    /// shape, payload shape, derived salt, author, signature. `groupKey(gid, epoch)` returns the key the reader holds, if any.
    /// A returned record has passed steps 1 and 2 of section 9; chains, order and membership are not looked at.
    static func open(_ sealed: Data, groupKey: (Data, UInt32) -> Data?) throws -> OpenedRecord {
        let base = sealed.startIndex
        guard sealed.count <= maxSealedLength else { throw FormatError("too_large", .discard) }
        guard sealed.count >= 4, sealed[base..<(base + 4)] == magic else { throw FormatError("bad_magic", .discard) }
        guard sealed.count >= headerLength + tagLength else { throw FormatError("too_short", .discard) }
        let header = Data(sealed[base..<(base + headerLength)])
        let gid = Data(header[4..<36])
        let epoch = header[36..<40].reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        let salt = Data(header[40..<72])
        guard let key = groupKey(gid, epoch) else { throw FormatError("no_key", .wait) }

        guard let plaintext = FormatCrypto.chachaOpen(key: recordKey(groupKey: key, salt: salt), aad: header,
                                                       sealed: Data(sealed[(base + headerLength)...])) else {
            throw FormatError("bad_tag", .discard)
        }
        // 4.2: length, size and padding.
        guard plaintext.count >= 4 else { throw FormatError("bad_size", .discard) }
        let declared = plaintext.prefix(4).reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
        guard declared <= UInt64(maxBodyLength) else { throw FormatError("body_too_large", .discard) }
        let bodyLength = Int(declared)
        guard 4 + bodyLength <= plaintext.count, paddedLength(4 + bodyLength) == plaintext.count else {
            throw FormatError("bad_size", .discard)
        }
        let pStart = plaintext.startIndex
        guard plaintext[(pStart + 4 + bodyLength)...].allSatisfy({ $0 == 0 }) else { throw FormatError("bad_padding", .discard) }
        let bodyBytes = Data(plaintext[(pStart + 4)..<(pStart + 4 + bodyLength)])

        // 4.3: body.
        let body: CBORValue
        do { body = try FormatCBOR.decode(bodyBytes) } catch { throw FormatError("bad_body", .discard) }
        guard let entries = body.mapEntries else { throw FormatError("bad_body", .discard) }
        let badSchema = FormatError("bad_body_schema", .discard)
        var fields: [UInt64: CBORValue] = [:]
        var extensionKeys: [UInt64] = []
        for entry in entries {
            guard let k = entry.key.uintValue else { throw badSchema }
            if k >= 128 { extensionKeys.append(k) } else if !(1...10).contains(k) { throw badSchema }
            fields[k] = entry.value
        }
        guard fields[1] == .uint(1),
              let author = fields[2]?.bytesValue, author.count == 32,
              let device = fields[3]?.bytesValue, device.count == 16,
              let seq = fields[4]?.uintValue, seq >= 1,
              let prevValue = fields[5],
              let clockItems = fields[6]?.arrayValue, clockItems.count == 2,
              let wall = clockItems[0].uintValue, let counter = clockItems[1].uintValue,
              let kind = fields[7]?.uintValue,
              let payload = fields[8], payload.mapEntries != nil,
              let signature = fields[9]?.bytesValue, signature.count == 64 else { throw badSchema }
        let prev: Data?
        if seq == 1 {
            guard prevValue.isNull else { throw badSchema }
            prev = nil
        } else {
            guard let p = prevValue.bytesValue, p.count == 32 else { throw badSchema }
            prev = p
        }
        let mhead: Data?
        if kind >= firstContentKind {
            guard let m = fields[10]?.bytesValue, m.count == 32 else { throw badSchema }
            mhead = m
        } else {
            guard fields[10] == nil else { throw badSchema }
            mhead = nil
        }

        // Payload shape, for the kinds this implementation checks (item changes). The other defined kinds (membership,
        // checkpoint, purge request) are out of scope and their payloads are kept as they are; an undefined kind is not malformed.
        var payloadExtensionKeys: [UInt64] = []
        if kind == 16 { payloadExtensionKeys = try ItemChange.parse(payload: payload).extensionKeys }

        // The salt is recomputed before the signature is looked at.
        let withoutSignature = try FormatCBOR.encode(.map(entries.filter { $0.key != .uint(9) }))
        guard derivedSalt(groupKey: key, bodyWithoutSignature: withoutSignature) == salt else { throw FormatError("bad_salt", .discard) }
        guard Ed25519Strict.checkPublicKey(author) == .ok else { throw FormatError("bad_author", .discard) }
        guard Ed25519Strict.verify(publicKey: author, message: signedMessage(header: header, bodyWithoutSignature: withoutSignature),
                                   signature: signature) == .ok else { throw FormatError("bad_signature", .discard) }
        return OpenedRecord(gid: gid, epoch: epoch, salt: salt, author: author, device: device, seq: seq, prev: prev,
                            clock: RecordClock(wallMs: wall, counter: counter), kind: kind, mhead: mhead, payload: payload,
                            signature: signature, recordID: FormatCrypto.sha256(sealed), extensionKeys: extensionKeys.sorted(),
                            payloadExtensionKeys: payloadExtensionKeys)
    }

    /// The place of an opened record in the order of section 4.5.
    static func order(of record: OpenedRecord) -> RecordOrder {
        RecordOrder(wallMs: record.clock.wallMs, counter: record.clock.counter, author: record.author, device: record.device, seq: record.seq)
    }
}
