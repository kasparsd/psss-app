import Foundation

/// Salsa20/20, the protected-value cipher of KDBX 3.x files. Only read paths need it: saving always writes KDBX 4 with ChaCha20.
struct Salsa20 {
    private var state = [UInt32](repeating: 0, count: 16)
    private var block = [UInt8](repeating: 0, count: 64)
    private var used = 64

    init(key: Data, iv: Data) {
        precondition(key.count == 32 && iv.count == 8)
        func word(_ data: Data, _ i: Int) -> UInt32 {
            let b = data.startIndex + i * 4
            return UInt32(data[b]) | UInt32(data[b + 1]) << 8 | UInt32(data[b + 2]) << 16 | UInt32(data[b + 3]) << 24
        }
        state[0] = 0x61707865; state[5] = 0x3320646e; state[10] = 0x79622d32; state[15] = 0x6b206574
        for i in 0..<4 { state[1 + i] = word(key, i); state[11 + i] = word(key, 4 + i) }
        state[6] = word(iv, 0); state[7] = word(iv, 1)
    }

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
        @inline(__always) func r(_ v: UInt32, _ n: UInt32) -> UInt32 { (v << n) | (v >> (32 - n)) }
        for _ in 0..<10 {
            x[4] ^= r(x[0] &+ x[12], 7); x[8] ^= r(x[4] &+ x[0], 9); x[12] ^= r(x[8] &+ x[4], 13); x[0] ^= r(x[12] &+ x[8], 18)
            x[9] ^= r(x[5] &+ x[1], 7); x[13] ^= r(x[9] &+ x[5], 9); x[1] ^= r(x[13] &+ x[9], 13); x[5] ^= r(x[1] &+ x[13], 18)
            x[14] ^= r(x[10] &+ x[6], 7); x[2] ^= r(x[14] &+ x[10], 9); x[6] ^= r(x[2] &+ x[14], 13); x[10] ^= r(x[6] &+ x[2], 18)
            x[3] ^= r(x[15] &+ x[11], 7); x[7] ^= r(x[3] &+ x[15], 9); x[11] ^= r(x[7] &+ x[3], 13); x[15] ^= r(x[11] &+ x[7], 18)
            x[1] ^= r(x[0] &+ x[3], 7); x[2] ^= r(x[1] &+ x[0], 9); x[3] ^= r(x[2] &+ x[1], 13); x[0] ^= r(x[3] &+ x[2], 18)
            x[6] ^= r(x[5] &+ x[4], 7); x[7] ^= r(x[6] &+ x[5], 9); x[4] ^= r(x[7] &+ x[6], 13); x[5] ^= r(x[4] &+ x[7], 18)
            x[11] ^= r(x[10] &+ x[9], 7); x[8] ^= r(x[11] &+ x[10], 9); x[9] ^= r(x[8] &+ x[11], 13); x[10] ^= r(x[9] &+ x[8], 18)
            x[12] ^= r(x[15] &+ x[14], 7); x[13] ^= r(x[12] &+ x[15], 9); x[14] ^= r(x[13] &+ x[12], 13); x[15] ^= r(x[14] &+ x[13], 18)
        }
        for i in 0..<16 {
            let value = x[i] &+ state[i]
            for j in 0..<4 { block[i * 4 + j] = UInt8(truncatingIfNeeded: value >> UInt32(8 * j)) }
        }
        state[8] = state[8] &+ 1
        if state[8] == 0 { state[9] = state[9] &+ 1 }
        used = 0
    }
}
