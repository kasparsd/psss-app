import Foundation

// Deterministic CBOR (spec section 2). Allowed: unsigned integers below 2^64, byte strings, text strings, arrays, maps with
// all-integer or all-text keys, false, true, null. Nothing else, shortest integer and length forms, keys unique and in
// ascending order of their encodings, at most 16 levels of nesting (the outermost container is level 1).

enum CBORValue: Sendable {
    case uint(UInt64)
    case bytes(Data)
    case text(String)
    case array([CBORValue])
    case map([CBORMapEntry])
    case bool(Bool)
    case null
}

struct CBORMapEntry: Sendable {
    let key: CBORValue
    let value: CBORValue
    init(_ key: CBORValue, _ value: CBORValue) {
        self.key = key
        self.value = value
    }
}

extension CBORValue: Equatable {
    /// Text compares by its UTF-8 bytes, never by Swift's canonical equivalence: section 2 says text is never normalized,
    /// so "e" + U+0301 and U+00E9 are different values.
    static func == (a: CBORValue, b: CBORValue) -> Bool {
        switch (a, b) {
        case let (.uint(x), .uint(y)): return x == y
        case let (.bytes(x), .bytes(y)): return x == y
        case let (.text(x), .text(y)): return x.utf8.elementsEqual(y.utf8)
        case let (.array(x), .array(y)): return x == y
        case let (.map(x), .map(y)): return x.count == y.count && zip(x, y).allSatisfy { $0.key == $1.key && $0.value == $1.value }
        case let (.bool(x), .bool(y)): return x == y
        case (.null, .null): return true
        default: return false
        }
    }
}

extension CBORValue {
    var uintValue: UInt64? { if case .uint(let v) = self { return v } else { return nil } }
    var bytesValue: Data? { if case .bytes(let v) = self { return v } else { return nil } }
    var textValue: String? { if case .text(let v) = self { return v } else { return nil } }
    var arrayValue: [CBORValue]? { if case .array(let v) = self { return v } else { return nil } }
    var mapEntries: [CBORMapEntry]? { if case .map(let v) = self { return v } else { return nil } }
    var isNull: Bool { if case .null = self { return true } else { return false } }

    /// The value under an integer key of a map, nil when this is not a map or has no such key.
    func value(forKey key: UInt64) -> CBORValue? {
        guard case .map(let entries) = self else { return nil }
        return entries.first { $0.key == .uint(key) }?.value
    }

    /// A map with integer keys; the encoder puts them in order.
    static func uintMap(_ pairs: [(UInt64, CBORValue)]) -> CBORValue {
        .map(pairs.map { CBORMapEntry(.uint($0.0), $0.1) })
    }

    /// A map with text keys; the encoder puts them in order.
    static func textMap(_ pairs: [(String, CBORValue)]) -> CBORValue {
        .map(pairs.map { CBORMapEntry(.text($0.0), $0.1) })
    }
}

enum FormatCBOR {
    static let maxDepth = 16

    // MARK: Encoding

    /// Encodes in deterministic form. Map entries are sorted by the bytes of their encoded keys; duplicate or mixed-kind keys
    /// and nesting beyond 16 levels are errors.
    static func encode(_ value: CBORValue) throws -> Data {
        var out = [UInt8]()
        try write(value, level: 0, into: &out)
        return Data(out)
    }

    private static func head(_ major: UInt8, _ n: UInt64, _ out: inout [UInt8]) {
        let m = major << 5
        if n < 24 {
            out.append(m | UInt8(n))
        } else if n <= 0xff {
            out.append(m | 24); out.append(UInt8(n))
        } else if n <= 0xffff {
            out.append(m | 25)
            for shift in [8, 0] { out.append(UInt8(truncatingIfNeeded: n >> UInt64(shift))) }
        } else if n <= 0xffff_ffff {
            out.append(m | 26)
            for shift in [24, 16, 8, 0] { out.append(UInt8(truncatingIfNeeded: n >> UInt64(shift))) }
        } else {
            out.append(m | 27)
            for shift in [56, 48, 40, 32, 24, 16, 8, 0] { out.append(UInt8(truncatingIfNeeded: n >> UInt64(shift))) }
        }
    }

    private static func write(_ value: CBORValue, level: Int, into out: inout [UInt8]) throws {
        switch value {
        case .uint(let n):
            head(0, n, &out)
        case .bytes(let data):
            head(2, UInt64(data.count), &out)
            out.append(contentsOf: data)
        case .text(let text):
            let utf8 = Array(text.utf8)
            head(3, UInt64(utf8.count), &out)
            out.append(contentsOf: utf8)
        case .bool(let flag):
            out.append(flag ? 0xf5 : 0xf4)
        case .null:
            out.append(0xf6)
        case .array(let items):
            guard level + 1 <= maxDepth else { throw FormatError("too_deep") }
            head(4, UInt64(items.count), &out)
            for item in items { try write(item, level: level + 1, into: &out) }
        case .map(let entries):
            guard level + 1 <= maxDepth else { throw FormatError("too_deep") }
            var encoded: [(key: [UInt8], value: CBORValue)] = []
            var kind: UInt8?
            for entry in entries {
                let entryKind: UInt8
                switch entry.key {
                case .uint: entryKind = 0
                case .text: entryKind = 3
                default: throw FormatError("bad_key_type")
                }
                if let kind, kind != entryKind { throw FormatError("mixed_key_kinds") }
                kind = entryKind
                var keyBytes = [UInt8]()
                try write(entry.key, level: level + 1, into: &keyBytes)
                encoded.append((keyBytes, entry.value))
            }
            encoded.sort { $0.key.lexicographicallyPrecedes($1.key) }
            if encoded.count > 1 {
                for i in 1..<encoded.count where encoded[i - 1].key == encoded[i].key { throw FormatError("duplicate_key") }
            }
            head(5, UInt64(encoded.count), &out)
            for entry in encoded {
                out.append(contentsOf: entry.key)
                try write(entry.value, level: level + 1, into: &out)
            }
        }
    }

    // MARK: Decoding

    /// Decodes exactly one item and refuses anything section 2 does not allow. Throws a `FormatError` whose code names the
    /// first rule broken.
    static func decode(_ data: Data) throws -> CBORValue {
        var reader = Reader(data)
        let value = try reader.item(depth: 0)
        guard reader.pos == reader.bytes.count else { throw FormatError("trailing_bytes") }
        return value
    }

    private struct Reader {
        let bytes: [UInt8]
        var pos = 0

        init(_ data: Data) { bytes = [UInt8](data) }

        var remaining: Int { bytes.count - pos }

        mutating func read(_ count: Int) throws -> UInt64 {
            guard remaining >= count else { throw FormatError("truncated") }
            var value: UInt64 = 0
            for _ in 0..<count {
                value = value << 8 | UInt64(bytes[pos])
                pos += 1
            }
            return value
        }

        mutating func argument(_ additional: UInt8) throws -> UInt64 {
            switch additional {
            case 0..<24: return UInt64(additional)
            case 24:
                let v = try read(1)
                guard v >= 24 else { throw FormatError("non_shortest") }
                return v
            case 25:
                let v = try read(2)
                guard v > 0xff else { throw FormatError("non_shortest") }
                return v
            case 26:
                let v = try read(4)
                guard v > 0xffff else { throw FormatError("non_shortest") }
                return v
            default:
                let v = try read(8)
                guard v > 0xffff_ffff else { throw FormatError("non_shortest") }
                return v
            }
        }

        /// `depth` is the number of containers around this item.
        mutating func item(depth: Int) throws -> CBORValue {
            guard pos < bytes.count else { throw FormatError("truncated") }
            let initial = bytes[pos]
            pos += 1
            let major = initial >> 5
            let additional = initial & 31
            if major == 7 {
                switch additional {
                case 20: return .bool(false)
                case 21: return .bool(true)
                case 22: return .null
                case 23: throw FormatError("undefined")
                case 24: throw FormatError("simple_value")
                case 25, 26, 27: throw FormatError("float")
                case 28, 29, 30: throw FormatError("reserved_additional_info")
                case 31: throw FormatError("break")
                default: throw FormatError("simple_value")
                }
            }
            if additional >= 28 && additional <= 30 { throw FormatError("reserved_additional_info") }
            if additional == 31 {
                switch major {
                case 2, 3, 4, 5: throw FormatError("indefinite_length")
                default: throw FormatError("malformed")
                }
            }
            let arg = try argument(additional)
            switch major {
            case 0:
                return .uint(arg)
            case 1:
                throw FormatError("negative_integer")
            case 6:
                throw FormatError("tag")
            case 2:
                guard arg <= UInt64(remaining) else { throw FormatError("truncated") }
                let end = pos + Int(arg)
                let data = Data(bytes[pos..<end])
                pos = end
                return .bytes(data)
            case 3:
                guard arg <= UInt64(remaining) else { throw FormatError("truncated") }
                let end = pos + Int(arg)
                guard let text = String(validating: bytes[pos..<end], as: UTF8.self) else { throw FormatError("invalid_utf8") }
                pos = end
                return .text(text)
            case 4:
                guard depth + 1 <= FormatCBOR.maxDepth else { throw FormatError("too_deep") }
                guard arg <= UInt64(remaining) else { throw FormatError("truncated") }
                var items = [CBORValue]()
                items.reserveCapacity(Int(arg))
                for _ in 0..<Int(arg) { items.append(try item(depth: depth + 1)) }
                return .array(items)
            default:
                guard depth + 1 <= FormatCBOR.maxDepth else { throw FormatError("too_deep") }
                guard arg <= UInt64(remaining) / 2 else { throw FormatError("truncated") }
                var entries = [CBORMapEntry]()
                entries.reserveCapacity(Int(arg))
                var previousKey: ArraySlice<UInt8>?
                var kind: UInt8?
                for _ in 0..<Int(arg) {
                    guard pos < bytes.count else { throw FormatError("truncated") }
                    let keyMajor = bytes[pos] >> 5
                    if keyMajor != 0 && keyMajor != 3 {
                        switch keyMajor {
                        case 2, 4, 5: throw FormatError("bad_key_type")
                        default:
                            _ = try item(depth: depth + 1)   // negative, tag, float and so on name themselves first
                            throw FormatError("bad_key_type")
                        }
                    }
                    let start = pos
                    let key = try item(depth: depth + 1)
                    let keyBytes = bytes[start..<pos]
                    if let kind, kind != keyMajor { throw FormatError("mixed_key_kinds") }
                    kind = keyMajor
                    if let previousKey {
                        if previousKey.elementsEqual(keyBytes) { throw FormatError("duplicate_key") }
                        if !previousKey.lexicographicallyPrecedes(keyBytes) { throw FormatError("unsorted_keys") }
                    }
                    previousKey = keyBytes
                    let value = try item(depth: depth + 1)
                    entries.append(CBORMapEntry(key, value))
                }
                return .map(entries)
            }
        }
    }

    /// True when the arrays's elements are in strictly ascending order of their encodings ("sorted", section 2): no
    /// duplicates, no inversions.
    static func isSorted(_ items: [CBORValue]) throws -> Bool {
        var previous: Data?
        for item in items {
            let encoded = try encode(item)
            if let previous, !previous.formatLess(than: encoded) { return false }
            previous = encoded
        }
        return true
    }
}
