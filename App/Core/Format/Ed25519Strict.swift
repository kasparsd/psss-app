import Foundation
import CryptoKit

// Ed25519 verification with the checks of spec section 1.2, on top of CryptoKit: S must be below the group order, a
// signature and a public key must be canonical encodings of curve points, and a public key must not be of small order.
// CryptoKit's own verification is used for the equation itself.

enum Ed25519Strict {
    /// The names follow the vector files' "result" field.
    enum Result: String, Sendable {
        case ok
        case badSignature = "bad_signature"
        case scalarNotReduced = "scalar_not_reduced"
        case badSignatureEncoding = "bad_signature_encoding"
        case badPublicKey = "bad_public_key"
        case smallOrderPublicKey = "small_order_public_key"
    }

    static func verify(publicKey: Data, message: Data, signature: Data) -> Result {
        let key = checkPublicKey(publicKey)
        guard key == .ok else { return key }
        guard signature.count == 64 else { return .badSignatureEncoding }
        let sig = [UInt8](signature)
        guard scalarIsReduced(Array(sig[32..<64])) else { return .scalarNotReduced }
        guard Curve.pointIsValid(Array(sig[0..<32])) else { return .badSignatureEncoding }
        guard let pk = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else { return .badPublicKey }
        return pk.isValidSignature(signature, for: message) ? .ok : .badSignature
    }

    /// `.ok`, `.badPublicKey` (wrong length, not canonical, not on the curve) or `.smallOrderPublicKey`.
    static func checkPublicKey(_ publicKey: Data) -> Result {
        guard publicKey.count == 32, Curve.pointIsValid([UInt8](publicKey)) else { return .badPublicKey }
        return smallOrderPoints.contains(publicKey) ? .smallOrderPublicKey : .ok
    }

    /// The group order L = 2^252 + 27742317777372353535851937790883648493, as little-endian 64-bit limbs.
    private static let order: [UInt64] = [0x5812_631a_5cf5_d3ed, 0x14de_f9de_a2f7_9cd6, 0, 0x1000_0000_0000_0000]

    private static func scalarIsReduced(_ s: [UInt8]) -> Bool {
        let limbs = Curve.limbs(s)
        return !Curve.greaterOrEqual(limbs, order)
    }

    /// The eight points of order dividing 8, in their canonical encodings. Every other encoding of one of them is not
    /// canonical and is refused earlier.
    private static let smallOrderPoints: Set<Data> = Set([
        "0100000000000000000000000000000000000000000000000000000000000000",
        "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0000000000000000000000000000000000000000000000000000000000000080",
        "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
        "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
        "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
        "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    ].compactMap { Data(formatHex: $0) })

    /// Arithmetic modulo p = 2^255 - 19 on four little-endian 64-bit limbs, just enough to decide whether a
    /// 32-byte string is the canonical encoding of a point of edwards25519. Not constant time: it only ever sees public data.
    enum Curve {
        static let p: [UInt64] = [0xffff_ffff_ffff_ffed, ~0, ~0, 0x7fff_ffff_ffff_ffff]
        /// d = -121665 / 121666 mod p.
        static let d: [UInt64] = [0x75eb_4dca_1359_78a3, 0x0070_0a4d_4141_d8ab, 0x8cc7_4079_7779_e898, 0x5203_6cee_2b6f_fe73]

        static func limbs(_ bytes: [UInt8]) -> [UInt64] {
            var out = [UInt64](repeating: 0, count: 4)
            for i in 0..<32 { out[i / 8] |= UInt64(bytes[i]) << UInt64(8 * (i % 8)) }
            return out
        }

        static func greaterOrEqual(_ a: [UInt64], _ b: [UInt64]) -> Bool {
            for i in stride(from: 3, through: 0, by: -1) where a[i] != b[i] { return a[i] > b[i] }
            return true
        }

        static func isZero(_ a: [UInt64]) -> Bool { a.allSatisfy { $0 == 0 } }

        /// a - b, for a >= b.
        static func subtract(_ a: [UInt64], _ b: [UInt64]) -> [UInt64] {
            var out = [UInt64](repeating: 0, count: 4)
            var borrow: UInt64 = 0
            for i in 0..<4 {
                let (s1, o1) = a[i].subtractingReportingOverflow(b[i])
                let (s2, o2) = s1.subtractingReportingOverflow(borrow)
                out[i] = s2
                borrow = (o1 || o2) ? 1 : 0
            }
            return out
        }

        static func addRaw(_ a: [UInt64], _ b: [UInt64]) -> [UInt64] {
            var out = [UInt64](repeating: 0, count: 4)
            var carry: UInt64 = 0
            for i in 0..<4 {
                let (s1, o1) = a[i].addingReportingOverflow(b[i])
                let (s2, o2) = s1.addingReportingOverflow(carry)
                out[i] = s2
                carry = (o1 || o2) ? 1 : 0
            }
            return out
        }

        static func add(_ a: [UInt64], _ b: [UInt64]) -> [UInt64] {
            let sum = addRaw(a, b)
            return greaterOrEqual(sum, p) ? subtract(sum, p) : sum
        }

        static func sub(_ a: [UInt64], _ b: [UInt64]) -> [UInt64] {
            greaterOrEqual(a, b) ? subtract(a, b) : subtract(addRaw(a, p), b)
        }

        static func mul(_ a: [UInt64], _ b: [UInt64]) -> [UInt64] {
            var t = [UInt64](repeating: 0, count: 8)
            for i in 0..<4 {
                var carry: UInt64 = 0
                for j in 0..<4 {
                    let (hi, lo) = a[i].multipliedFullWidth(by: b[j])
                    let (s1, o1) = t[i + j].addingReportingOverflow(lo)
                    let (s2, o2) = s1.addingReportingOverflow(carry)
                    t[i + j] = s2
                    carry = hi &+ (o1 ? 1 : 0) &+ (o2 ? 1 : 0)
                }
                t[i + 4] = carry
            }
            // 2^256 = 38 (mod p): fold the high half into the low half.
            var r = [UInt64](repeating: 0, count: 4)
            var carry: UInt64 = 0
            for i in 0..<4 {
                let (hi, lo) = t[4 + i].multipliedFullWidth(by: 38)
                let (s1, o1) = t[i].addingReportingOverflow(lo)
                let (s2, o2) = s1.addingReportingOverflow(carry)
                r[i] = s2
                carry = hi &+ (o1 ? 1 : 0) &+ (o2 ? 1 : 0)
            }
            if addSmall(&r, carry &* 38) { _ = addSmall(&r, 38) }
            while greaterOrEqual(r, p) { r = subtract(r, p) }
            return r
        }

        /// Adds a small number; returns true when the sum went past 2^256.
        private static func addSmall(_ r: inout [UInt64], _ x: UInt64) -> Bool {
            var carry = x
            for i in 0..<4 where carry != 0 {
                let (s, o) = r[i].addingReportingOverflow(carry)
                r[i] = s
                carry = o ? 1 : 0
            }
            return carry != 0
        }

        static func pow(_ base: [UInt64], _ exponent: [UInt64]) -> [UInt64] {
            var result: [UInt64] = [1, 0, 0, 0]
            for limb in stride(from: 3, through: 0, by: -1) {
                for bit in stride(from: 63, through: 0, by: -1) {
                    result = mul(result, result)
                    if (exponent[limb] >> UInt64(bit)) & 1 == 1 { result = mul(result, base) }
                }
            }
            return result
        }

        /// 121666 * d + 121665 = 0 (mod p): a check on the constant above, run by the tests.
        static func constantsAreRight() -> Bool {
            isZero(add(mul([121666, 0, 0, 0], d), [121665, 0, 0, 0]))
        }

        /// True when the 32 bytes are the canonical encoding of a point: the 255-bit y is below p, there is an x with
        /// x^2 = (y^2 - 1) / (d y^2 + 1), and x = 0 is not written with its sign bit set.
        static func pointIsValid(_ bytes: [UInt8]) -> Bool {
            guard bytes.count == 32 else { return false }
            var y = limbs(bytes)
            let signBit = y[3] >> 63 == 1
            y[3] &= 0x7fff_ffff_ffff_ffff
            guard !greaterOrEqual(y, p) else { return false }
            let one: [UInt64] = [1, 0, 0, 0]
            let y2 = mul(y, y)
            let u = sub(y2, one)
            let v = add(mul(d, y2), one)
            if isZero(u) { return !signBit }
            // u / v is a square exactly when u * v is (Euler's criterion, exponent (p - 1) / 2).
            let exponent: [UInt64] = [0xffff_ffff_ffff_fff6, ~0, ~0, 0x3fff_ffff_ffff_ffff]
            return pow(mul(u, v), exponent) == one
        }
    }
}
