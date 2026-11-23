import Foundation

// The recovery kit and its printed form (spec section 7.2): 20 random bytes shown as "RK1-" and 36 characters of Crockford
// base32 in nine groups of four. The 36 characters encode the kit followed by the first two bytes of
// SHA-256("psss/v1/kit-check" || kit), then four zero bits.

enum RecoveryKit {
    static let kitLength = 20
    static let prefix = "RK1"
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ".unicodeScalars)

    static func checkBytes(_ kit: Data) -> Data {
        Data(FormatCrypto.sha256(FormatCrypto.label("psss/v1/kit-check"), kit).prefix(2))
    }

    static func generate() -> Data { FormatCrypto.randomBytes(kitLength) }

    static func text(for kit: Data) throws -> String {
        guard kit.count == kitLength else { throw FormatError("bad_kit_length", .reject) }
        let bytes = [UInt8](kit + checkBytes(kit))   // 22 bytes, 176 bits
        var symbols = [Character]()
        var accumulator = 0, bits = 0
        for byte in bytes {
            accumulator = accumulator << 8 | Int(byte)
            bits += 8
            while bits >= 5 {
                symbols.append(Character(alphabet[(accumulator >> (bits - 5)) & 31]))
                bits -= 5
                accumulator &= (1 << bits) - 1
            }
        }
        if bits > 0 { symbols.append(Character(alphabet[(accumulator << (5 - bits)) & 31])) }   // 4 data-free bits are zero
        let groups = stride(from: 0, to: symbols.count, by: 4).map { String(symbols[$0..<min($0 + 4, symbols.count)]) }
        return prefix + "-" + groups.joined(separator: "-")
    }

    /// Reads the printed form. Case, hyphens and spaces are ignored, I and L read as 1 and O as 0, also in the prefix.
    /// Checks in this order: prefix, length, characters, trailing bits, check bytes.
    static func parse(_ text: String) throws -> Data {
        var scalars = [Unicode.Scalar]()
        for original in text.unicodeScalars {
            // Only ASCII letters are folded. Unicode case mapping would turn look-alikes such as U+0131 and U+017F into
            // letters of the alphabet, and another implementation would refuse them.
            let scalar = ("a"..."z").contains(original) ? Unicode.Scalar(UInt8(original.value) - 32) : original
            switch scalar {
            case " ", "-": continue
            case "I", "L": scalars.append("1")
            case "O": scalars.append("0")
            default: scalars.append(scalar)
            }
        }
        // Compared scalar by scalar: String equality is canonical equivalence, which would take U+212A (Kelvin sign) for K.
        guard scalars.count >= 3, Array(scalars[0..<3]) == Array(prefix.unicodeScalars) else { throw FormatError("bad_kit_prefix", .reject) }
        let body = Array(scalars[3...])
        guard body.count == 36 else { throw FormatError("bad_kit_length", .reject) }
        var values = [Int]()
        for scalar in body {
            guard let index = alphabet.firstIndex(of: scalar) else { throw FormatError("bad_kit_character", .reject) }
            values.append(index)
        }
        var bytes = [UInt8]()
        var accumulator = 0, bits = 0
        for value in values {
            accumulator = accumulator << 5 | value
            bits += 5
            if bits >= 8 {
                bytes.append(UInt8((accumulator >> (bits - 8)) & 255))
                bits -= 8
                accumulator &= (1 << bits) - 1
            }
        }
        // 180 bits: 22 bytes and 4 left over, which must be zero.
        guard bytes.count == 22, accumulator == 0 else { throw FormatError("bad_kit_trailing_bits", .reject) }
        let kit = Data(bytes[0..<20])
        guard Data(bytes[20..<22]) == checkBytes(kit) else { throw FormatError("bad_kit_check", .reject) }
        return kit
    }
}
