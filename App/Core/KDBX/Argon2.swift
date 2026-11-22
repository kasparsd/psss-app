import Foundation

/// Argon2d, Argon2i and Argon2id (RFC 9106, version 0x13), single-threaded. Lanes are computed one after another,
/// which gives the same result as parallel lanes. Used only to derive the vault key, never inside the AutoFill extension.
enum Argon2 {
    enum Variant: UInt32 { case d = 0, i = 1, id = 2 }

    struct Parameters: Sendable {
        var variant: Variant
        var salt: Data
        var iterations: UInt32
        var memoryKiB: UInt32
        var lanes: UInt32
        var secret = Data()
        var associatedData = Data()
        var length = 32
    }

    enum Failure: Error { case invalidParameters }

    private static let blockWords = 128

    static func hash(password: Data, _ p: Parameters) throws -> Data {
        guard p.lanes >= 1, p.lanes <= 255, p.iterations >= 1, p.salt.count >= 8,
              p.memoryKiB >= 8 * p.lanes, p.length >= 4,
              // A tampered file must not be able to ask for gigabytes.
              p.memoryKiB <= 4 * 1024 * 1024 else { throw Failure.invalidParameters }

        let lanes = Int(p.lanes)
        let memory = Int(p.memoryKiB) / (4 * lanes) * (4 * lanes)
        let laneLength = memory / lanes
        let segmentLength = laneLength / 4

        var initial = Data()
        for value in [p.lanes, UInt32(p.length), p.memoryKiB, p.iterations, 0x13, p.variant.rawValue] { initial.append(le32(value)) }
        for part in [password, p.salt, p.secret, p.associatedData] { initial.append(le32(UInt32(part.count))); initial.append(part) }
        let h0 = Blake2b.hash(initial)

        var blocks = [UInt64](repeating: 0, count: memory * blockWords)
        blocks.withUnsafeMutableBufferPointer { buffer in
            for lane in 0..<lanes {
                for column in 0..<2 {
                    let block = variableHash(h0 + le32(UInt32(column)) + le32(UInt32(lane)), length: 1024)
                    let base = (lane * laneLength + column) * blockWords
                    block.withUnsafeBytes { raw in
                        for w in 0..<blockWords { buffer[base + w] = UInt64(littleEndian: raw.loadUnaligned(fromByteOffset: w * 8, as: UInt64.self)) }
                    }
                }
            }
            for pass in 0..<Int(p.iterations) {
                for slice in 0..<4 {
                    for lane in 0..<lanes {
                        fillSegment(buffer, pass: pass, slice: slice, lane: lane, lanes: lanes, laneLength: laneLength,
                                    segmentLength: segmentLength, memory: memory, parameters: p)
                    }
                }
            }
        }

        var final = [UInt64](repeating: 0, count: blockWords)
        for lane in 0..<lanes {
            let base = (lane * laneLength + laneLength - 1) * blockWords
            for w in 0..<blockWords { final[w] ^= blocks[base + w] }
        }
        var bytes = Data(capacity: 1024)
        for word in final { bytes.append(contentsOf: withUnsafeBytes(of: word.littleEndian) { Array($0) }) }
        return variableHash(bytes, length: p.length)
    }

    // MARK: Segment filling

    /// Word indexes of the 16 words each permutation round works on: eight rows, then eight columns.
    private static let permutationIndexes: [Int] = {
        var table: [Int] = []
        for i in 0..<8 { for j in 0..<16 { table.append(16 * i + j) } }
        for i in 0..<8 { for j in 0..<8 { table.append(2 * i + 16 * j); table.append(2 * i + 16 * j + 1) } }
        return table
    }()

    @_optimize(speed)
    private static func fillSegment(_ memory: UnsafeMutableBufferPointer<UInt64>, pass: Int, slice: Int, lane: Int, lanes: Int,
                                    laneLength: Int, segmentLength: Int, memory totalBlocks: Int, parameters p: Parameters) {
        let independent = p.variant == .i || (p.variant == .id && pass == 0 && slice < 2)
        var input = [UInt64](repeating: 0, count: blockWords)
        var addresses = [UInt64](repeating: 0, count: blockWords)
        var first = [UInt64](repeating: 0, count: blockWords)
        let zero = [UInt64](repeating: 0, count: blockWords)
        var scratch = [UInt64](repeating: 0, count: 2 * blockWords)
        if independent {
            input[0] = UInt64(pass); input[1] = UInt64(lane); input[2] = UInt64(slice)
            input[3] = UInt64(totalBlocks); input[4] = UInt64(p.iterations); input[5] = UInt64(p.variant.rawValue)
        }
        func nextAddresses() {
            input[6] += 1
            first.withUnsafeMutableBufferPointer { first in
                zero.withUnsafeBufferPointer { zero in
                    input.withUnsafeBufferPointer { input in
                        compress(zero.baseAddress!, input.baseAddress!, first.baseAddress!, xorInto: false, scratch: &scratch)
                    }
                }
                addresses.withUnsafeMutableBufferPointer { addresses in
                    zero.withUnsafeBufferPointer { zero in
                        compress(zero.baseAddress!, first.baseAddress!, addresses.baseAddress!, xorInto: false, scratch: &scratch)
                    }
                }
            }
        }

        var start = 0
        if pass == 0 && slice == 0 {
            start = 2
            if independent { nextAddresses() }
        }
        guard let base = memory.baseAddress else { return }
        var current = lane * laneLength + slice * segmentLength + start
        for index in start..<segmentLength {
            let previous = current % laneLength == 0 ? current + laneLength - 1 : current - 1
            let random: UInt64
            if independent {
                if index % blockWords == 0 { nextAddresses() }
                random = addresses[index % blockWords]
            } else {
                random = memory[previous * blockWords]
            }
            let j1 = random & 0xffff_ffff
            let j2 = random >> 32

            let referenceLane = pass == 0 && slice == 0 ? lane : Int(j2 % UInt64(lanes))
            let sameLane = referenceLane == lane
            let area: Int
            if pass == 0 {
                if slice == 0 { area = index - 1 }
                else if sameLane { area = slice * segmentLength + index - 1 }
                else { area = slice * segmentLength + (index == 0 ? -1 : 0) }
            } else if sameLane {
                area = laneLength - segmentLength + index - 1
            } else {
                area = laneLength - segmentLength + (index == 0 ? -1 : 0)
            }
            let x = (j1 * j1) >> 32
            let y = (UInt64(area) * x) >> 32
            let relative = area - 1 - Int(y)
            let startPosition = pass != 0 && slice != 3 ? (slice + 1) * segmentLength : 0
            let referenceIndex = referenceLane * laneLength + (startPosition + relative) % laneLength

            // Pass 0 overwrites the block, later passes XOR into the old value (version 0x13).
            compress(base + previous * blockWords, base + referenceIndex * blockWords, base + current * blockWords,
                     xorInto: pass != 0, scratch: &scratch)
            current += 1
        }
    }

    /// G(X, Y): P(X xor Y) xor (X xor Y), optionally xored into the existing output.
    @_optimize(speed)
    private static func compress(_ x: UnsafePointer<UInt64>, _ y: UnsafePointer<UInt64>, _ out: UnsafeMutablePointer<UInt64>,
                                 xorInto: Bool, scratch r: inout [UInt64]) {
        r.withUnsafeMutableBufferPointer { r in
            let v = r.baseAddress!
            let saved = v + blockWords
            for i in 0..<blockWords { v[i] = x[i] ^ y[i]; saved[i] = v[i] }
            permutationIndexes.withUnsafeBufferPointer { table in
                for round in 0..<16 { mixRound(v, table.baseAddress! + round * 16) }
            }
            for i in 0..<blockWords {
                let value = saved[i] ^ v[i]
                out[i] = xorInto ? out[i] ^ value : value
            }
        }
    }

    @inline(__always)
    private static func mixRound(_ v: UnsafeMutablePointer<UInt64>, _ o: UnsafePointer<Int>) {
        @inline(__always) func mix(_ a: Int, _ b: Int, _ c: Int, _ d: Int) {
            let ia = o[a], ib = o[b], ic = o[c], id = o[d]
            v[ia] = v[ia] &+ v[ib] &+ 2 &* (v[ia] & 0xffff_ffff) &* (v[ib] & 0xffff_ffff)
            v[id] = (v[id] ^ v[ia]).rotatedRight(32)
            v[ic] = v[ic] &+ v[id] &+ 2 &* (v[ic] & 0xffff_ffff) &* (v[id] & 0xffff_ffff)
            v[ib] = (v[ib] ^ v[ic]).rotatedRight(24)
            v[ia] = v[ia] &+ v[ib] &+ 2 &* (v[ia] & 0xffff_ffff) &* (v[ib] & 0xffff_ffff)
            v[id] = (v[id] ^ v[ia]).rotatedRight(16)
            v[ic] = v[ic] &+ v[id] &+ 2 &* (v[ic] & 0xffff_ffff) &* (v[id] & 0xffff_ffff)
            v[ib] = (v[ib] ^ v[ic]).rotatedRight(63)
        }
        mix(0, 4, 8, 12); mix(1, 5, 9, 13); mix(2, 6, 10, 14); mix(3, 7, 11, 15)
        mix(0, 5, 10, 15); mix(1, 6, 11, 12); mix(2, 7, 8, 13); mix(3, 4, 9, 14)
    }

    // MARK: Helpers

    /// H' from the RFC: BLAKE2b with an output of any length.
    private static func variableHash(_ input: Data, length: Int) -> Data {
        let prefix = le32(UInt32(length))
        if length <= 64 { return Blake2b.hash(prefix + input, length: length) }
        let r = (length + 31) / 32 - 2
        var v = Blake2b.hash(prefix + input)
        var out = Data(v.prefix(32))
        for _ in 1..<r {
            v = Blake2b.hash(v)
            out.append(v.prefix(32))
        }
        out.append(Blake2b.hash(v, length: length - 32 * r))
        return out
    }

    private static func le32(_ value: UInt32) -> Data {
        withUnsafeBytes(of: value.littleEndian) { Data($0) }
    }
}
