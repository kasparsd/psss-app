import Foundation
import CryptoKit

// Psss vault format, version 1 (docs/format-spec.md, draft 5). Shared pieces: errors, hex, and the small crypto helpers
// every section uses. Foundation and CryptoKit only.

/// What a reader does with a thing that failed a check (spec section 9, and the vector files' "disposition").
enum FormatDisposition: String, Sendable {
    case discard, wait, reject, ignore
}

/// A refusal with a stable code. The codes are not defined by the specification; they follow the vector files.
struct FormatError: Error, Equatable, CustomStringConvertible, Sendable {
    let code: String
    let disposition: FormatDisposition?
    init(_ code: String, _ disposition: FormatDisposition? = nil) {
        self.code = code
        self.disposition = disposition
    }
    var description: String { disposition.map { "\(code) (\($0.rawValue))" } ?? code }
}

extension Data {
    /// Lowercase hexadecimal.
    var formatHex: String {
        let digits = Array("0123456789abcdef".utf8)
        var out = [UInt8]()
        out.reserveCapacity(count * 2)
        for byte in self {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 15)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Parses hexadecimal text (either case); nil when it is not an even run of hex digits.
    init?(formatHex text: String) {
        let chars = Array(text.utf8)
        guard chars.count % 2 == 0 else { return nil }
        func nibble(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: return c - 48
            case 97...102: return c - 87
            case 65...70: return c - 55
            default: return nil
            }
        }
        var out = [UInt8]()
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let high = nibble(chars[i]), let low = nibble(chars[i + 1]) else { return nil }
            out.append(high << 4 | low)
            i += 2
        }
        self.init(out)
    }
}

enum FormatCrypto {
    /// A label such as "psss/v1/record" is its ASCII bytes with no terminator (section 1).
    static func label(_ text: String) -> Data { Data(text.utf8) }

    static func u32(_ value: UInt32) -> Data {
        Data([UInt8(truncatingIfNeeded: value >> 24), UInt8(truncatingIfNeeded: value >> 16),
              UInt8(truncatingIfNeeded: value >> 8), UInt8(truncatingIfNeeded: value)])
    }

    static func u64(_ value: UInt64) -> Data {
        Data((0..<8).map { UInt8(truncatingIfNeeded: value >> UInt64(56 - 8 * $0)) })
    }

    static func sha256(_ parts: Data...) -> Data {
        var hasher = SHA256()
        for part in parts { hasher.update(data: part) }
        return Data(hasher.finalize())
    }

    static func sha3_256(_ parts: Data...) -> Data {
        var hasher = SHA3_256()
        for part in parts { hasher.update(data: part) }
        return Data(hasher.finalize())
    }

    /// HKDF-SHA256 (RFC 5869) with 32 bytes of output (section 1). An empty salt is allowed.
    static func hkdf(ikm: Data, salt: Data, info: Data) -> Data {
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: salt, info: info, outputByteCount: 32)
        return key.withUnsafeBytes { Data($0) }
    }

    static func randomBytes(_ count: Int) -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) })
    }

    private static let zeroNonce = Data(count: 12)

    /// ChaCha20-Poly1305 with the fixed all-zero nonce of sections 4.1 and 7.2. Returns ciphertext followed by the 16-byte tag.
    static func chachaSeal(key: Data, aad: Data, plaintext: Data) throws -> Data {
        let nonce = try ChaChaPoly.Nonce(data: zeroNonce)
        let box = try ChaChaPoly.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce, authenticating: aad)
        return box.ciphertext + box.tag
    }

    /// The opposite; nil when the tag does not verify or the input is shorter than a tag.
    static func chachaOpen(key: Data, aad: Data, sealed: Data) -> Data? {
        guard sealed.count >= 16, let nonce = try? ChaChaPoly.Nonce(data: zeroNonce) else { return nil }
        let split = sealed.count - 16
        let base = sealed.startIndex
        guard let box = try? ChaChaPoly.SealedBox(nonce: nonce, ciphertext: sealed[base..<(base + split)], tag: sealed[(base + split)...]) else { return nil }
        return try? ChaChaPoly.open(box, using: SymmetricKey(data: key), authenticating: aad)
    }
}

extension Data {
    /// Bytewise order, shorter first when one is a prefix of the other (the order of section 4.5 for byte strings).
    func formatLess(than other: Data) -> Bool { lexicographicallyPrecedes(other) }
}
