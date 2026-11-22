import Foundation

/// ChaCha20 (RFC 8439) as a stream cipher. KDBX 4 uses it for protected values and, optionally, for the document.
struct ChaCha20 {
    private var state: [UInt32]
    private var block = [UInt8](repeating: 0, count: 64)
    private var used = 64

    /// `key` is 32 bytes, `nonce` is 12 bytes. The block counter starts at `counter`.
    init(key: Data, nonce: Data, counter: UInt32 = 0) {
        precondition(key.count == 32 && nonce.count == 12)
        func word(_ data: Data, _ i: Int) -> UInt32 {
            let b = data.startIndex + i * 4
            return UInt32(data[b]) | UInt32(data[b + 1]) << 8 | UInt32(data[b + 2]) << 16 | UInt32(data[b + 3]) << 24
        }
        state = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]
        for i in 0..<8 { state.append(word(key, i)) }
        state.append(counter)
        for i in 0..<3 { state.append(word(nonce, i)) }
    }

    /// XORs the keystream into `data`. Calling it again continues the stream, which protected values rely on.
    mutating func process(_ data: Data) -> Data {
        var out = [UInt8](data)
        for i in 0..<out.count {
            if used == 64 { refill() }
            out[i] ^= block[used]
            used += 1
        }
        return Data(out)
    }

    private mutating func refill() {
        var x = state
        func quarter(_ a: Int, _ b: Int, _ c: Int, _ d: Int) {
            x[a] = x[a] &+ x[b]; x[d] = (x[d] ^ x[a]).rotl(16)
            x[c] = x[c] &+ x[d]; x[b] = (x[b] ^ x[c]).rotl(12)
            x[a] = x[a] &+ x[b]; x[d] = (x[d] ^ x[a]).rotl(8)
            x[c] = x[c] &+ x[d]; x[b] = (x[b] ^ x[c]).rotl(7)
        }
        for _ in 0..<10 {
            quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15)
            quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14)
        }
        for i in 0..<16 {
            let value = x[i] &+ state[i]
            block[i * 4] = UInt8(truncatingIfNeeded: value)
            block[i * 4 + 1] = UInt8(truncatingIfNeeded: value >> 8)
            block[i * 4 + 2] = UInt8(truncatingIfNeeded: value >> 16)
            block[i * 4 + 3] = UInt8(truncatingIfNeeded: value >> 24)
        }
        state[12] = state[12] &+ 1
        used = 0
    }
}

private extension UInt32 {
    @inline(__always) func rotl(_ n: UInt32) -> UInt32 { (self << n) | (self >> (32 - n)) }
}
