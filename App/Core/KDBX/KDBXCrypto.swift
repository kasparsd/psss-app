import CommonCrypto
import CryptoKit
import Compression
import Foundation

/// Thin wrappers over the system's AES, HMAC, SHA and zlib, plus the little that KDBX adds (gzip framing).
enum KDBXCrypto {
    enum Failure: Error { case cipher, compression, tooLarge }

    static func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }
    static func sha512(_ data: Data) -> Data { Data(SHA512.hash(data: data)) }

    static func hmacSHA256(key: Data, _ data: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
    }

    /// Constant-time comparison for MACs.
    static func equal(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }

    static func randomBytes(_ count: Int) -> Data {
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        precondition(status == errSecSuccess, "No secure random bytes")
        return data
    }

    // MARK: AES

    /// AES-256-CBC with PKCS#7 padding.
    static func aesCBC(_ data: Data, key: Data, iv: Data, encrypt: Bool) throws -> Data {
        guard key.count == 32, iv.count == 16 else { throw Failure.cipher }
        var out = Data(count: data.count + kCCBlockSizeAES128)
        var written = 0
        let status = out.withUnsafeMutableBytes { outPtr in
            data.withUnsafeBytes { inPtr in
                key.withUnsafeBytes { keyPtr in
                    iv.withUnsafeBytes { ivPtr in
                        CCCrypt(CCOperation(encrypt ? kCCEncrypt : kCCDecrypt), CCAlgorithm(kCCAlgorithmAES),
                                CCOptions(kCCOptionPKCS7Padding), keyPtr.baseAddress, 32, ivPtr.baseAddress,
                                inPtr.baseAddress, data.count, outPtr.baseAddress, outPtr.count, &written)
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw Failure.cipher }
        return out.prefix(written)
    }

    /// The AES-KDF: encrypts the 32-byte key `rounds` times with AES-256-ECB under `seed`, then hashes it.
    static func aesKDF(key: Data, seed: Data, rounds: UInt64) throws -> Data {
        guard key.count == 32, seed.count == 32 else { throw Failure.cipher }
        var cryptor: CCCryptorRef?
        let created = seed.withUnsafeBytes {
            CCCryptorCreate(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionECBMode),
                            $0.baseAddress, 32, nil, &cryptor)
        }
        guard created == kCCSuccess, let cryptor else { throw Failure.cipher }
        defer { CCCryptorRelease(cryptor) }
        var block = [UInt8](key)
        var out = [UInt8](repeating: 0, count: 32)
        for _ in 0..<rounds {
            var moved = 0
            guard CCCryptorUpdate(cryptor, block, 32, &out, 32, &moved) == kCCSuccess, moved == 32 else { throw Failure.cipher }
            swap(&block, &out)
        }
        return sha256(Data(block))
    }

    // MARK: gzip

    static func gzip(_ data: Data) throws -> Data {
        let deflated = try (data as NSData).compressed(using: .zlib) as Data
        var out = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])
        out.append(deflated)
        out.append(le32(crc32(data)))
        out.append(le32(UInt32(truncatingIfNeeded: data.count)))
        return out
    }

    /// Inflates a gzip member. `limit` guards against a small file that expands without bound.
    static func gunzip(_ data: Data, limit: Int = KDBXLimits.inflatedPayload) throws -> Data {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else { throw Failure.compression }
        let flags = bytes[3]
        var offset = 10
        if flags & 4 != 0 { guard offset + 2 <= bytes.count else { throw Failure.compression }; offset += 2 + Int(bytes[offset]) + Int(bytes[offset + 1]) << 8 }
        for bit: UInt8 in [8, 16] where flags & bit != 0 {
            while offset < bytes.count, bytes[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 2 != 0 { offset += 2 }
        guard offset < bytes.count - 8 else { throw Failure.compression }
        let body = Data(bytes[offset..<(bytes.count - 8)])
        let inflated = try inflate(body, limit: limit)
        let expected = bytes[(bytes.count - 8)..<(bytes.count - 4)].enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << UInt32(8 * $1.offset) }
        guard expected == crc32(inflated) else { throw Failure.compression }
        return inflated
    }

    /// Raw deflate, inflated in 64 KiB steps and stopped as soon as the output passes `limit`: a small file that expands without
    /// bound is refused after `limit` bytes, never after it has filled memory.
    private static func inflate(_ body: Data, limit: Int) throws -> Data {
        let chunk = 1 << 16
        let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
        defer { dst.deallocate() }
        let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { stream.deallocate() }
        stream.initialize(to: compression_stream(dst_ptr: dst, dst_size: 0, src_ptr: UnsafePointer(dst), src_size: 0, state: nil))
        guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw Failure.compression
        }
        defer { compression_stream_destroy(stream) }
        var out = Data()
        return try body.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Data in
            if let base = raw.bindMemory(to: UInt8.self).baseAddress { stream.pointee.src_ptr = base }
            stream.pointee.src_size = raw.count
            while true {
                stream.pointee.dst_ptr = dst
                stream.pointee.dst_size = chunk
                let status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                let produced = chunk - stream.pointee.dst_size
                if produced > 0 { out.append(dst, count: produced) }
                if out.count > limit { throw Failure.tooLarge }
                switch status {
                case COMPRESSION_STATUS_END: return out
                case COMPRESSION_STATUS_OK: if produced == 0 && stream.pointee.src_size == 0 { throw Failure.compression }
                default: throw Failure.compression
                }
            }
        }
    }

    private static let crcTable: [UInt32] = (0..<256).map { index -> UInt32 in
        var c = UInt32(index)
        for _ in 0..<8 { c = c & 1 == 1 ? 0xedb88320 ^ (c >> 1) : c >> 1 }
        return c
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xffff_ffff
        for byte in data { c = crcTable[Int((c ^ UInt32(byte)) & 0xff)] ^ (c >> 8) }
        return c ^ 0xffff_ffff
    }

    static func le32(_ value: UInt32) -> Data { withUnsafeBytes(of: value.littleEndian) { Data($0) } }
    static func le64(_ value: UInt64) -> Data { withUnsafeBytes(of: value.littleEndian) { Data($0) } }
}
