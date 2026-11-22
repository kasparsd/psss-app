import Foundation

/// Why a vault file could not be opened or written. The view layer maps these to localizable messages.
enum KDBXError: Error, Equatable {
    case notAVault
    case unsupported(String)
    case wrongCredentials
    case corrupted(String)
    case invalidKeyFile
    case invalidParameters
}

/// The KDBX container: KDBX 4.x with Argon2d, Argon2id or AES-KDF, AES-256 or ChaCha20, and a password,
/// a key file or both. The decrypted XML stays a tree (`XNode`) so unknown content survives a round trip.
/// KDBX 3.x, Twofish and Salsa20 are not supported and are reported as such before anything is written.
struct KDBXDocument: @unchecked Sendable {
    var header: KDBXHeader
    /// Attachments from the inner header, kept byte for byte (first byte is the protection flag).
    var binaries: [Data]
    var root: XNode
    /// Both keys stay in memory only while the vault is open. The transformed key lets saves skip the KDF.
    fileprivate(set) var compositeKey: Data
    fileprivate(set) var transformedKey: Data
    /// "KDBX 3.1" when the file was read from an older format. Saving writes KDBX 4.
    fileprivate(set) var sourceVersion: String?

    /// Replaces the vault password or key file. Runs the KDF, so call it off the main actor.
    mutating func changeCredentials(to credentials: KDBXCredentials) throws {
        compositeKey = try credentials.compositeKey()
        header.kdf.regenerateSeed()
        transformedKey = try header.kdf.transform(compositeKey)
    }
}

struct KDBXCredentials: Sendable {
    var password: String?
    var keyFile: Data?

    init(password: String? = nil, keyFile: Data? = nil) {
        self.password = password
        self.keyFile = keyFile
    }

    /// SHA-256 over the hash of each component, as every KeePass implementation derives it.
    func compositeKey() throws -> Data {
        var parts = Data()
        if let password { parts.append(KDBXCrypto.sha256(Data(password.utf8))) }
        if let keyFile { parts.append(try Self.keyFileHash(keyFile)) }
        guard !parts.isEmpty else { throw KDBXError.invalidKeyFile }
        return KDBXCrypto.sha256(parts)
    }

    /// XML key files (versions 1 and 2), a raw 32 bytes, 64 hex digits, or the hash of anything else.
    static func keyFileHash(_ data: Data) throws -> Data {
        if data.isEmpty { throw KDBXError.invalidKeyFile }
        if let root = try? XMLTree.parse(data), root.name == "KeyFile", let key = root.child("Key"),
           let value = key.child("Data") {
            let version = root.child("Meta")?.child("Version")?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? "1.0"
            if version.hasPrefix("2") {
                let hex = value.text.filter { !$0.isWhitespace }
                guard let bytes = Data(hexString: hex), bytes.count == 32 else { throw KDBXError.invalidKeyFile }
                if let check = value.attribute("Hash"), let expected = Data(hexString: check),
                   !KDBXCrypto.sha256(bytes).prefix(4).elementsEqual(expected.prefix(4)) { throw KDBXError.invalidKeyFile }
                return bytes
            }
            guard let bytes = Data(base64Encoded: value.text.filter { !$0.isWhitespace }), bytes.count == 32 else {
                throw KDBXError.invalidKeyFile
            }
            return bytes
        }
        if data.count == 32 { return data }
        if data.count == 64, let hex = String(data: data, encoding: .ascii), let bytes = Data(hexString: hex) { return bytes }
        return KDBXCrypto.sha256(data)
    }
}

// MARK: Header

struct KDBXHeader: Sendable {
    enum Cipher: Sendable {
        case aes256, chacha20

        static let aesID = Data(hexString: "31c1f2e6bf714350be5805216afc5aff")!
        static let chachaID = Data(hexString: "d6038a2b8b6f4cb5a524339a31dbb59a")!

        var id: Data { self == .aes256 ? Self.aesID : Self.chachaID }
        var ivLength: Int { self == .aes256 ? 16 : 12 }
    }

    var minorVersion: UInt16
    var cipher: Cipher
    var compressed: Bool
    var masterSeed: Data
    var encryptionIV: Data
    var kdf: KDBXKDF
    /// Public custom data (a variant dictionary), kept as written.
    var publicCustomData: Data?

    var versionLabel: String { "KDBX 4.\(minorVersion)" }
}

/// The key derivation function and its parameters, stored in the header as a variant dictionary.
struct KDBXKDF: Sendable {
    enum Kind: Sendable { case aes, argon2d, argon2id }

    private static let aesID = Data(hexString: "c9d9f39a628a4460bf740d08c18a4fea")!
    static var aesIdentifier: Data { aesID }
    private static let argon2dID = Data(hexString: "ef636ddf8c29444b91f7a9a403e30a0c")!
    private static let argon2idID = Data(hexString: "9e298b1956db4773b23dfc3ec6f0a1e6")!

    private(set) var dictionary: VariantDictionary

    /// Argon2id with 64 MiB, three passes and two lanes: the default for new vaults.
    static func recommended() -> KDBXKDF {
        var d = VariantDictionary()
        d.set("$UUID", bytes: argon2idID)
        d.set("S", bytes: KDBXCrypto.randomBytes(32))
        d.set("P", uint32: 2)
        d.set("M", uint64: 64 * 1024 * 1024)
        d.set("I", uint64: 3)
        d.set("V", uint32: 0x13)
        return KDBXKDF(dictionary: d)
    }

    init(dictionary: VariantDictionary) { self.dictionary = dictionary }

    /// A cheap AES-KDF for tests and fixtures. Never used for a real vault.
    static func aesForTesting(rounds: UInt64) -> KDBXKDF {
        var d = VariantDictionary()
        d.set("$UUID", bytes: aesID)
        d.set("S", bytes: KDBXCrypto.randomBytes(32))
        d.set("R", uint64: rounds)
        return KDBXKDF(dictionary: d)
    }

    var kind: Kind? {
        switch dictionary.bytes("$UUID") {
        case Self.aesID: .aes
        case Self.argon2dID: .argon2d
        case Self.argon2idID: .argon2id
        default: nil
        }
    }

    /// A short description for the vault's details, such as "Argon2id, 64 MiB, 3 passes".
    var summary: String {
        switch kind {
        case .aes: return "AES-KDF, \(dictionary.uint64("R") ?? 0) rounds"
        case .argon2d, .argon2id:
            let name = kind == .argon2d ? "Argon2d" : "Argon2id"
            let mib = (dictionary.uint64("M") ?? 0) / (1024 * 1024)
            return "\(name), \(mib) MiB, \(dictionary.uint64("I") ?? 0) passes"
        case nil: return "Unknown"
        }
    }

    mutating func regenerateSeed() {
        dictionary.set("S", bytes: KDBXCrypto.randomBytes(32))
    }

    /// Runs the KDF. Argon2 costs real time and memory, so never call this from the AutoFill extension or the main actor.
    func transform(_ composite: Data) throws -> Data {
        switch kind {
        case .aes:
            guard let seed = dictionary.bytes("S"), let rounds = dictionary.uint64("R"), rounds > 0,
                  rounds <= 1 << 40 else { throw KDBXError.invalidParameters }
            return try KDBXCrypto.aesKDF(key: composite, seed: seed, rounds: rounds)
        case .argon2d, .argon2id:
            guard let salt = dictionary.bytes("S"), let lanes = dictionary.uint32("P"), let memory = dictionary.uint64("M"),
                  let iterations = dictionary.uint64("I"), iterations <= UInt64(UInt32.max), memory / 1024 <= UInt64(UInt32.max)
            else { throw KDBXError.invalidParameters }
            guard (dictionary.uint32("V") ?? 0x13) == 0x13 else { throw KDBXError.unsupported("Argon2 version") }
            let parameters = Argon2.Parameters(variant: kind == .argon2d ? .d : .id, salt: salt, iterations: UInt32(iterations),
                                               memoryKiB: UInt32(memory / 1024), lanes: lanes,
                                               secret: dictionary.bytes("K") ?? Data(), associatedData: dictionary.bytes("A") ?? Data())
            do { return try Argon2.hash(password: composite, parameters) } catch { throw KDBXError.invalidParameters }
        case nil:
            throw KDBXError.unsupported("key derivation function")
        }
    }
}

/// KeePass's typed key-value block used for KDF parameters and public custom data.
struct VariantDictionary: Sendable {
    private enum Kind: UInt8 { case uint32 = 0x04, uint64 = 0x05, bool = 0x08, int32 = 0x0c, int64 = 0x0d, string = 0x18, bytes = 0x42 }

    private var entries: [(kind: UInt8, name: String, value: Data)] = []

    init() {}

    init(_ data: Data) throws {
        var reader = ByteReader(data)
        guard try reader.u16() >> 8 == 1 else { throw KDBXError.unsupported("variant dictionary version") }
        while true {
            let kind = try reader.u8()
            if kind == 0 { break }
            let name = String(decoding: try reader.bytes(Int(try reader.u32())), as: UTF8.self)
            entries.append((kind, name, try reader.bytes(Int(try reader.u32()))))
        }
    }

    var encoded: Data {
        var out = Data([0x00, 0x01])
        for entry in entries {
            out.append(entry.kind)
            out.append(KDBXCrypto.le32(UInt32(entry.name.utf8.count)))
            out.append(Data(entry.name.utf8))
            out.append(KDBXCrypto.le32(UInt32(entry.value.count)))
            out.append(entry.value)
        }
        out.append(0)
        return out
    }

    func bytes(_ name: String) -> Data? { entries.first { $0.name == name && $0.kind == Kind.bytes.rawValue }?.value }

    func uint32(_ name: String) -> UInt32? {
        guard let v = entries.first(where: { $0.name == name && $0.kind == Kind.uint32.rawValue })?.value, v.count == 4 else { return nil }
        return v.enumerated().reduce(0) { $0 | UInt32($1.element) << UInt32(8 * $1.offset) }
    }

    func uint64(_ name: String) -> UInt64? {
        guard let v = entries.first(where: { $0.name == name && $0.kind == Kind.uint64.rawValue })?.value, v.count == 8 else { return nil }
        return v.enumerated().reduce(0) { $0 | UInt64($1.element) << UInt64(8 * $1.offset) }
    }

    mutating func set(_ name: String, bytes: Data) { put(.bytes, name, bytes) }
    mutating func set(_ name: String, uint32: UInt32) { put(.uint32, name, KDBXCrypto.le32(uint32)) }
    mutating func set(_ name: String, uint64: UInt64) { put(.uint64, name, KDBXCrypto.le64(uint64)) }

    private mutating func put(_ kind: Kind, _ name: String, _ value: Data) {
        entries.removeAll { $0.name == name }
        entries.append((kind.rawValue, name, value))
    }
}

// MARK: Reading and writing

enum KDBX {
    private static let signature1: UInt32 = 0x9AA2D903
    private static let signature2: UInt32 = 0xB54BFB67
    private static let blockSize = 1 << 20
    private static let maxHeader = 1 << 20

    /// Opens a KDBX 4 file. Runs the KDF, so call it off the main actor.
    static func open(_ file: Data, credentials: KDBXCredentials) throws -> KDBXDocument {
        try open(file, compositeKey: try credentials.compositeKey())
    }

    /// Opens with an already combined key, for reloading a vault that is open without asking for the password again.
    static func open(_ file: Data, compositeKey composite: Data) throws -> KDBXDocument {
        var reader = ByteReader(file)
        guard file.count > 12, try reader.u32() == signature1, try reader.u32() == signature2 else { throw KDBXError.notAVault }
        let minor = try reader.u16(), major = try reader.u16()
        if major == 3 { return try openV3(file, minor: minor, reader: reader, composite: composite) }
        guard major == 4 else { throw KDBXError.unsupported("KDBX \(major).\(minor)") }

        var cipher: KDBXHeader.Cipher?, compressed = false
        var masterSeed = Data(), iv = Data(), kdf: KDBXKDF?, publicData: Data?
        headerLoop: while true {
            let id = try reader.u8(), size = Int(try reader.u32())
            guard size <= maxHeader else { throw KDBXError.corrupted("header") }
            let value = try reader.bytes(size)
            switch id {
            case 0: break headerLoop
            case 2:
                if value == KDBXHeader.Cipher.aesID { cipher = .aes256 }
                else if value == KDBXHeader.Cipher.chachaID { cipher = .chacha20 }
                else { throw KDBXError.unsupported("cipher (Twofish is not supported)") }
            case 3:
                guard value.count == 4 else { throw KDBXError.corrupted("header") }
                compressed = value[value.startIndex] == 1
            case 4: masterSeed = value
            case 7: iv = value
            case 11: kdf = KDBXKDF(dictionary: try VariantDictionary(value))
            case 12: publicData = value
            default: break
            }
        }
        let headerEnd = reader.offset
        guard let cipher, let kdf, masterSeed.count == 32, iv.count == cipher.ivLength else { throw KDBXError.corrupted("header") }
        let headerBytes = file.prefix(headerEnd)
        let storedHash = try reader.bytes(32), storedMAC = try reader.bytes(32)
        guard KDBXCrypto.equal(KDBXCrypto.sha256(Data(headerBytes)), storedHash) else { throw KDBXError.corrupted("header") }

        let transformed = try kdf.transform(composite)
        let hmacKey = KDBXCrypto.sha512(masterSeed + transformed + Data([1]))
        guard KDBXCrypto.equal(KDBXCrypto.hmacSHA256(key: blockKey(hmacKey, index: .max), Data(headerBytes)), storedMAC) else {
            throw KDBXError.wrongCredentials
        }

        // HMAC block stream.
        var encrypted = Data()
        var index: UInt64 = 0
        while true {
            let mac = try reader.bytes(32), length = try reader.u32()
            guard length <= 1 << 28 else { throw KDBXError.corrupted("block") }
            let block = try reader.bytes(Int(length))
            let expected = KDBXCrypto.hmacSHA256(key: blockKey(hmacKey, index: index), KDBXCrypto.le64(index) + KDBXCrypto.le32(length) + block)
            guard KDBXCrypto.equal(mac, expected) else { throw KDBXError.corrupted("block") }
            if length == 0 { break }
            encrypted.append(block)
            index += 1
        }

        let masterKey = KDBXCrypto.sha256(masterSeed + transformed)
        var payload: Data
        switch cipher {
        case .aes256: payload = try decrypt { try KDBXCrypto.aesCBC(encrypted, key: masterKey, iv: iv, encrypt: false) }
        case .chacha20: var stream = ChaCha20(key: masterKey, nonce: iv); payload = stream.process(encrypted)
        }
        if compressed { payload = try decrypt { try KDBXCrypto.gunzip(payload) } }

        // Inner header, then the XML.
        var inner = ByteReader(payload)
        var streamID: UInt32 = 0, streamKey = Data(), binaries: [Data] = []
        innerLoop: while true {
            let id = try inner.u8(), size = Int(try inner.u32())
            let value = try inner.bytes(size)
            switch id {
            case 0: break innerLoop
            case 1: guard value.count == 4 else { throw KDBXError.corrupted("inner header") }
                    streamID = value.enumerated().reduce(0) { $0 | UInt32($1.element) << UInt32(8 * $1.offset) }
            case 2: streamKey = value
            case 3: binaries.append(value)
            default: break
            }
        }
        guard streamID == 3 else { throw KDBXError.unsupported("protected-value cipher (only ChaCha20)") }
        let root: XNode
        do { root = try XMLTree.parse(inner.rest) } catch { throw KDBXError.corrupted("XML") }
        guard root.name == "KeePassFile" else { throw KDBXError.corrupted("XML") }

        var stream = innerStream(streamKey)
        decryptProtected(root, &stream)
        return KDBXDocument(header: KDBXHeader(minorVersion: minor, cipher: cipher, compressed: compressed, masterSeed: masterSeed,
                                               encryptionIV: iv, kdf: kdf, publicCustomData: publicData),
                            binaries: binaries, root: root, compositeKey: composite, transformedKey: transformed)
    }


    /// Reads KDBX 3.x (AES-256, AES-KDF, Salsa20 protected values). The document is held as KDBX 4, so the next save
    /// upgrades the file; `sourceVersion` tells the interface what was read.
    private static func openV3(_ file: Data, minor: UInt16, reader start: ByteReader, composite: Data) throws -> KDBXDocument {
        var reader = start
        var cipherID = Data(), compressed = false, masterSeed = Data(), transformSeed = Data(), rounds: UInt64 = 0
        var iv = Data(), streamKey = Data(), startBytes = Data(), streamID: UInt32 = 0
        headerLoop: while true {
            let id = try reader.u8(), size = Int(try reader.u16())
            let value = try reader.bytes(size)
            func integer() throws -> UInt64 {
                guard value.count <= 8 else { throw KDBXError.corrupted("header") }
                return value.enumerated().reduce(0) { $0 | UInt64($1.element) << UInt64(8 * $1.offset) }
            }
            switch id {
            case 0: break headerLoop
            case 2: cipherID = value
            case 3: compressed = try integer() == 1
            case 4: masterSeed = value
            case 5: transformSeed = value
            case 6: rounds = try integer()
            case 7: iv = value
            case 8: streamKey = value
            case 9: startBytes = value
            case 10: streamID = UInt32(try integer())
            default: break
            }
        }
        guard cipherID == KDBXHeader.Cipher.aesID else { throw KDBXError.unsupported("cipher (only AES-256)") }
        guard masterSeed.count == 32, transformSeed.count == 32, iv.count == 16, startBytes.count == 32, rounds > 0, rounds <= 1 << 40
        else { throw KDBXError.corrupted("header") }

        var kdfDictionary = VariantDictionary()
        kdfDictionary.set("$UUID", bytes: KDBXKDF.aesIdentifier)
        kdfDictionary.set("S", bytes: transformSeed)
        kdfDictionary.set("R", uint64: rounds)
        let kdf = KDBXKDF(dictionary: kdfDictionary)
        let transformed = try kdf.transform(composite)
        let masterKey = KDBXCrypto.sha256(masterSeed + transformed)

        let ciphertext = reader.rest
        guard ciphertext.count >= 32, ciphertext.count % 16 == 0 else { throw KDBXError.corrupted("payload") }
        // Wrong credentials make the padding or the start bytes wrong, which is how KDBX 3 tells them apart from damage.
        guard let plain = try? KDBXCrypto.aesCBC(ciphertext, key: masterKey, iv: iv, encrypt: false),
              plain.count >= 32, KDBXCrypto.equal(plain.prefix(32), startBytes) else { throw KDBXError.wrongCredentials }

        // Hashed block stream: index, SHA-256, length, data.
        var blocks = ByteReader(plain.dropFirst(32))
        var payload = Data()
        while true {
            _ = try blocks.u32()
            let hash = try blocks.bytes(32), length = try blocks.u32()
            guard length <= 1 << 28 else { throw KDBXError.corrupted("block") }
            if length == 0 { break }
            let block = try blocks.bytes(Int(length))
            guard KDBXCrypto.equal(KDBXCrypto.sha256(block), hash) else { throw KDBXError.corrupted("block") }
            payload.append(block)
        }
        if compressed { payload = try decrypt { try KDBXCrypto.gunzip(payload) } }

        let root: XNode
        do { root = try XMLTree.parse(payload) } catch { throw KDBXError.corrupted("XML") }
        guard root.name == "KeePassFile" else { throw KDBXError.corrupted("XML") }
        var stream: ProtectedStream
        switch streamID {
        case 2: stream = salsaStream(streamKey)
        case 3: stream = innerStream(streamKey)
        default: throw KDBXError.unsupported("protected-value cipher")
        }
        decryptProtected(root, &stream)
        let binaries = convertBinaryPool(root)
        var document = KDBXDocument(header: KDBXHeader(minorVersion: 1, cipher: .aes256, compressed: true, masterSeed: Data(),
                                                       encryptionIV: Data(), kdf: kdf, publicCustomData: nil),
                                    binaries: binaries, root: root, compositeKey: composite, transformedKey: transformed)
        document.sourceVersion = "KDBX 3.\(minor)"
        return document
    }

    /// KDBX 3 keeps attachments in `Meta/Binaries`, referenced by ID. KDBX 4 keeps them in the inner header, referenced by
    /// position. Moves the pool and rewrites the references, including those in history.
    private static func convertBinaryPool(_ root: XNode) -> [Data] {
        var pool: [Data] = []
        var indexByID: [String: Int] = [:]
        if let container = root.child("Meta")?.child("Binaries") {
            for node in container.children(named: "Binary") {
                var data = Data(base64Encoded: node.text.filter { !$0.isWhitespace }) ?? Data()
                if node.attribute("Compressed")?.lowercased() == "true", let inflated = try? KDBXCrypto.gunzip(data) { data = inflated }
                indexByID[node.attribute("ID") ?? "\(pool.count)"] = pool.count
                pool.append(Data([node.attribute("Protected")?.lowercased() == "true" ? 1 : 0]) + data)
            }
            root.child("Meta")?.children.removeAll { $0 === container }
        }
        root.walk { node in
            guard node.name == "Entry" else { return }
            for binary in node.children(named: "Binary") {
                guard let value = binary.child("Value") else { continue }
                if let ref = value.attribute("Ref"), let index = indexByID[ref] { value.setAttribute("Ref", String(index)) }
            }
        }
        return pool
    }

    /// Serializes with a fresh master seed, IV and inner stream key. Does not run the KDF.
    static func save(_ document: KDBXDocument) throws -> Data {
        var header = document.header
        header.masterSeed = KDBXCrypto.randomBytes(32)
        header.encryptionIV = KDBXCrypto.randomBytes(header.cipher.ivLength)

        var out = Data()
        out.append(KDBXCrypto.le32(signature1)); out.append(KDBXCrypto.le32(signature2))
        out.append(contentsOf: [UInt8(header.minorVersion & 0xff), UInt8(header.minorVersion >> 8), 4, 0])
        func field(_ id: UInt8, _ value: Data) {
            out.append(id); out.append(KDBXCrypto.le32(UInt32(value.count))); out.append(value)
        }
        field(2, header.cipher.id)
        field(3, KDBXCrypto.le32(header.compressed ? 1 : 0))
        field(4, header.masterSeed)
        field(7, header.encryptionIV)
        field(11, header.kdf.dictionary.encoded)
        if let custom = header.publicCustomData { field(12, custom) }
        field(0, Data([0x0d, 0x0a, 0x0d, 0x0a]))
        let headerBytes = out
        out.append(KDBXCrypto.sha256(headerBytes))
        let hmacKey = KDBXCrypto.sha512(header.masterSeed + document.transformedKey + Data([1]))
        out.append(KDBXCrypto.hmacSHA256(key: blockKey(hmacKey, index: .max), headerBytes))

        // Work on a copy: protecting values must not change the open document.
        let xml = document.root.deepCopy()
        let streamKey = KDBXCrypto.randomBytes(64)
        var stream = innerStream(streamKey)
        encryptProtected(xml, &stream)

        var payload = Data()
        func inner(_ id: UInt8, _ value: Data) { payload.append(id); payload.append(KDBXCrypto.le32(UInt32(value.count))); payload.append(value) }
        inner(1, KDBXCrypto.le32(3))
        inner(2, streamKey)
        for binary in document.binaries { inner(3, binary) }
        inner(0, Data())
        payload.append(XMLTree.serialize(xml))

        if header.compressed { payload = try KDBXCrypto.gzip(payload) }
        let masterKey = KDBXCrypto.sha256(header.masterSeed + document.transformedKey)
        switch header.cipher {
        case .aes256: payload = try KDBXCrypto.aesCBC(payload, key: masterKey, iv: header.encryptionIV, encrypt: true)
        case .chacha20: var cipher = ChaCha20(key: masterKey, nonce: header.encryptionIV); payload = cipher.process(payload)
        }

        var index: UInt64 = 0, offset = 0
        repeat {
            let block = payload.subdata(in: (payload.startIndex + offset)..<(payload.startIndex + min(offset + blockSize, payload.count)))
            let mac = KDBXCrypto.hmacSHA256(key: blockKey(hmacKey, index: index),
                                            KDBXCrypto.le64(index) + KDBXCrypto.le32(UInt32(block.count)) + block)
            out.append(mac); out.append(KDBXCrypto.le32(UInt32(block.count))); out.append(block)
            offset += block.count; index += 1
        } while offset < payload.count
        out.append(KDBXCrypto.hmacSHA256(key: blockKey(hmacKey, index: index), KDBXCrypto.le64(index) + KDBXCrypto.le32(0)))
        out.append(KDBXCrypto.le32(0))
        return out
    }

    /// A new empty vault with one root group.
    static func create(name: String, credentials: KDBXCredentials, kdf: KDBXKDF = .recommended()) throws -> KDBXDocument {
        let composite = try credentials.compositeKey()
        let transformed = try kdf.transform(composite)
        let now = KeePassTime.string(.now)
        let zeroUUID = Data(count: 16).base64EncodedString()
        func times() -> XNode {
            XNode("Times", children: [XNode("CreationTime", text: now), XNode("LastModificationTime", text: now),
                                      XNode("LastAccessTime", text: now), XNode("ExpiryTime", text: now),
                                      XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
                                      XNode("LocationChanged", text: now)])
        }
        let meta = XNode("Meta", children: [
            XNode("Generator", text: "Psss"),
            XNode("DatabaseName", text: name), XNode("DatabaseNameChanged", text: now),
            XNode("DatabaseDescription"), XNode("DatabaseDescriptionChanged", text: now),
            XNode("DefaultUserName"), XNode("DefaultUserNameChanged", text: now),
            XNode("MaintenanceHistoryDays", text: "365"),
            XNode("MasterKeyChanged", text: now), XNode("MasterKeyChangeRec", text: "-1"), XNode("MasterKeyChangeForce", text: "-1"),
            XNode("MemoryProtection", children: [
                XNode("ProtectTitle", text: "False"), XNode("ProtectUserName", text: "False"),
                XNode("ProtectPassword", text: "True"), XNode("ProtectURL", text: "False"), XNode("ProtectNotes", text: "False")]),
            XNode("RecycleBinEnabled", text: "True"), XNode("RecycleBinUUID", text: zeroUUID), XNode("RecycleBinChanged", text: now),
            XNode("EntryTemplatesGroup", text: zeroUUID), XNode("EntryTemplatesGroupChanged", text: now),
            XNode("HistoryMaxItems", text: "10"), XNode("HistoryMaxSize", text: "6291456"),
            XNode("LastSelectedGroup", text: zeroUUID), XNode("LastTopVisibleGroup", text: zeroUUID),
            XNode("SettingsChanged", text: now), XNode("CustomData")
        ])
        let group = XNode("Group", children: [
            XNode("UUID", text: KDBXCrypto.randomBytes(16).base64EncodedString()),
            XNode("Name", text: "Root"), XNode("Notes"), XNode("IconID", text: "48"), times(),
            XNode("IsExpanded", text: "True"), XNode("DefaultAutoTypeSequence"),
            XNode("EnableAutoType", text: "null"), XNode("EnableSearching", text: "null"),
            XNode("LastTopVisibleEntry", text: zeroUUID)
        ])
        let root = XNode("KeePassFile", children: [meta, XNode("Root", children: [group, XNode("DeletedObjects")])])
        return KDBXDocument(header: KDBXHeader(minorVersion: 1, cipher: .aes256, compressed: true,
                                               masterSeed: Data(), encryptionIV: Data(), kdf: kdf, publicCustomData: nil),
                            binaries: [], root: root, compositeKey: composite, transformedKey: transformed)
    }

    // MARK: Helpers

    private static func blockKey(_ hmacKey: Data, index: UInt64) -> Data { KDBXCrypto.sha512(KDBXCrypto.le64(index) + hmacKey) }

    private static func decrypt(_ body: () throws -> Data) throws -> Data {
        do { return try body() } catch { throw KDBXError.corrupted("payload") }
    }

    private static func innerStream(_ key: Data) -> ProtectedStream {
        let digest = KDBXCrypto.sha512(key)
        return .chacha(ChaCha20(key: digest.prefix(32), nonce: digest.subdata(in: 32..<44)))
    }

    private static func salsaStream(_ key: Data) -> ProtectedStream {
        .salsa(Salsa20(key: KDBXCrypto.sha256(key), iv: Data([0xE8, 0x30, 0x09, 0x4B, 0x97, 0x20, 0x5D, 0x2A])))
    }

    /// Protected values are base64 of the ciphertext, one continuous stream over the whole document in document order.
    private static func decryptProtected(_ root: XNode, _ stream: inout ProtectedStream) {
        root.walk { node in
            guard node.name == "Value", node.attribute("Protected")?.lowercased() == "true" else { return }
            let plain = stream.process(Data(base64Encoded: node.text) ?? Data())
            node.text = String(decoding: plain, as: UTF8.self)
        }
    }

    private static func encryptProtected(_ root: XNode, _ stream: inout ProtectedStream) {
        root.walk { node in
            guard node.name == "Value", node.attribute("Protected")?.lowercased() == "true" else { return }
            node.text = stream.process(Data(node.text.utf8)).base64EncodedString()
        }
    }
}

/// The keystream for protected values: ChaCha20 in KDBX 4, Salsa20 in KDBX 3.
enum ProtectedStream {
    case chacha(ChaCha20), salsa(Salsa20)

    mutating func process(_ data: Data) -> Data {
        switch self {
        case .chacha(var c): defer { self = .chacha(c) }; return c.process(data)
        case .salsa(var c): defer { self = .salsa(c) }; return c.process(data)
        }
    }
}

/// Cursor over little-endian bytes.
private struct ByteReader {
    private let data: Data
    private(set) var offset = 0

    init(_ data: Data) { self.data = data }

    var rest: Data { data.suffix(from: data.startIndex + offset) }

    mutating func u8() throws -> UInt8 {
        guard offset < data.count else { throw KDBXError.corrupted("truncated") }
        defer { offset += 1 }
        return data[data.startIndex + offset]
    }

    mutating func u16() throws -> UInt16 { UInt16(try u8()) | UInt16(try u8()) << 8 }

    mutating func u32() throws -> UInt32 {
        var value: UInt32 = 0
        for shift in stride(from: 0, to: 32, by: 8) { value |= UInt32(try u8()) << UInt32(shift) }
        return value
    }

    mutating func bytes(_ count: Int) throws -> Data {
        guard count >= 0, offset + count <= data.count else { throw KDBXError.corrupted("truncated") }
        defer { offset += count }
        return data.subdata(in: (data.startIndex + offset)..<(data.startIndex + offset + count))
    }
}

extension Data {
    init?(hexString: String) {
        let chars = Array(hexString.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        func nibble(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: c - 48
            case 97...102: c - 87
            case 65...70: c - 55
            default: nil
            }
        }
        for i in stride(from: 0, to: chars.count, by: 2) {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
        }
        self = out
    }
}

/// KeePass writes times as ISO 8601 in UTC, or in KDBX 4 as base64 of seconds since 0001-01-01. Read both, write ISO.
enum KeePassTime {
    private static let epochOffset: TimeInterval = 62_135_596_800 // 0001-01-01 to 1970-01-01

    static func string(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    static func date(_ text: String) -> Date? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: value) { return date }
        plain.formatOptions.insert(.withFractionalSeconds)
        if let date = plain.date(from: value) { return date }
        if let data = Data(base64Encoded: value), data.count == 8 {
            let seconds = data.enumerated().reduce(UInt64(0)) { $0 | UInt64($1.element) << UInt64(8 * $1.offset) }
            return Date(timeIntervalSince1970: TimeInterval(seconds) - epochOffset)
        }
        return nil
    }
}
