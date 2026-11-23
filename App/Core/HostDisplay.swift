import Foundation

/// How a host is shown to a person. Matching always uses the ASCII (punycode) form; this is only for reading.
///
/// An internationalized name is shown in its Unicode form. When that form mixes more than one script, which is how a lookalike
/// of a well-known name is made, the punycode form follows in parentheses so the difference is visible.
enum HostDisplay {
    /// "bücher.example" for "xn--bcher-kva.example". The result is the ASCII host itself, unchanged, whenever any `xn--` label
    /// cannot be shown safely: decoding fails, the decoded label is plain ASCII (a malformed label), is not in NFC, or holds a
    /// character that could make it read as another host (see `isSafeLabel`). Never a mixture of decoded and ASCII labels.
    static func unicode(_ host: String) -> String {
        var labels: [String] = []
        for label in host.split(separator: ".", omittingEmptySubsequences: false) {
            let lower = label.lowercased()
            if lower.hasPrefix("xn--") {
                guard let decoded = decodePunycode(String(label.dropFirst(4))), isSafeLabel(decoded) else { return host }
                labels.append(decoded)
            } else {
                // A label that already holds non-ASCII text (not what the app passes in) is shown only when it is safe.
                if !label.allSatisfy(\.isASCII), !isSafeLabel(String(label)) { return escaped(host) }
                labels.append(String(label))
            }
        }
        return labels.joined(separator: ".")
    }

    /// What to put in a sentence: the Unicode form when it is safe to show, followed by the ASCII form in parentheses when
    /// the Unicode form mixes scripts.
    static func shown(_ host: String) -> String {
        let readable = unicode(host)
        guard readable != host, scripts(in: readable).count > 1 else { return readable }
        return "\(readable) (\(host))"
    }

    /// True when a decoded label may be shown. It must be:
    /// - not empty, not plain ASCII letters, digits and hyphens (a punycode label that decodes to that is malformed), and in NFC;
    /// - made only of letters, marks, decimal digits and the ASCII hyphen, as IDNA allows (so no space, control, format,
    ///   separator, private-use, unassigned, punctuation, symbol, upper-case or title-case character), not starting with a
    ///   mark, and free of default-ignorable and bidirectional-control characters, whatever their category.
    static func isSafeLabel(_ label: String) -> Bool {
        guard !label.isEmpty, Array(label.unicodeScalars) == Array(label.precomposedStringWithCanonicalMapping.unicodeScalars) else { return false }
        let isPlain = label.unicodeScalars.allSatisfy { $0.isASCII && ($0.properties.isAlphabetic || ($0.value >= 48 && $0.value <= 57) || $0 == "-") }
        guard !isPlain else { return false }
        for (index, scalar) in label.unicodeScalars.enumerated() {
            if isInvisibleOrConfusable(scalar) { return false }
            switch scalar.properties.generalCategory {
            case .lowercaseLetter, .otherLetter, .modifierLetter, .decimalNumber: break
            case .nonspacingMark, .spacingMark: if index == 0 { return false }
            default: if scalar != "-" { return false }
            }
        }
        return true
    }

    /// Characters that read as something else or as nothing, listed explicitly on top of the category checks.
    private static func isInvisibleOrConfusable(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        if scalar.properties.isDefaultIgnorableCodePoint { return true }
        switch scalar.properties.generalCategory {
        case .format, .control, .spaceSeparator, .lineSeparator, .paragraphSeparator, .surrogate, .privateUse, .unassigned: return true
        default: break
        }
        if value < 0x20 || (0x7F...0x9F).contains(value) { return true }
        if (0x202A...0x202E).contains(value) || (0x2066...0x2069).contains(value) || value == 0x200E || value == 0x200F || value == 0x061C { return true }
        if [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD, 0x180E, 0x00A0, 0x202F, 0x205F, 0x3000].contains(value) { return true }
        if (0x2000...0x200A).contains(value) { return true }
        return false
    }

    /// Writes the characters of a non-ASCII host that are not safe as U+XXXX, so nothing invisible or confusable is shown.
    private static func escaped(_ text: String) -> String {
        var result = ""
        for scalar in text.unicodeScalars {
            if scalar.isASCII { result.unicodeScalars.append(scalar) }
            else { result += "U+" + String(scalar.value, radix: 16, uppercase: true) }
        }
        return result
    }

    /// The scripts of the letters in `text`. Digits, dots and hyphens belong to no script. Scripts that are not listed count
    /// as one script each by Unicode block, so two unlisted scripts still read as mixed.
    static func scripts(in text: String) -> Set<String> {
        var found = Set<String>()
        for scalar in text.unicodeScalars where scalar.properties.isAlphabetic {
            found.insert(script(of: scalar.value))
        }
        return found
    }

    private static let ranges: [(ClosedRange<UInt32>, String)] = [
        (0x41...0x5A, "Latin"), (0x61...0x7A, "Latin"), (0xAA...0xAA, "Latin"), (0xBA...0xBA, "Latin"), (0xC0...0x24F, "Latin"),
        (0x1E00...0x1EFF, "Latin"), (0x2C60...0x2C7F, "Latin"), (0xA720...0xA7FF, "Latin"), (0xFF21...0xFF5A, "Latin"),
        (0x370...0x3FF, "Greek"), (0x1F00...0x1FFF, "Greek"),
        (0x400...0x52F, "Cyrillic"), (0x1C80...0x1C8F, "Cyrillic"), (0x2DE0...0x2DFF, "Cyrillic"), (0xA640...0xA69F, "Cyrillic"),
        (0x530...0x58F, "Armenian"), (0x590...0x5FF, "Hebrew"), (0x600...0x6FF, "Arabic"), (0x750...0x77F, "Arabic"),
        (0x900...0x97F, "Devanagari"), (0xE00...0xE7F, "Thai"),
        (0x3040...0x309F, "Hiragana"), (0x30A0...0x30FF, "Katakana"), (0x3400...0x4DBF, "Han"), (0x4E00...0x9FFF, "Han"),
        (0x20000...0x2FFFF, "Han"), (0xAC00...0xD7AF, "Hangul"), (0x1100...0x11FF, "Hangul")
    ]

    private static func script(of value: UInt32) -> String {
        ranges.first { $0.0.contains(value) }?.1 ?? "Block \(value >> 7)"
    }

    /// RFC 3492 decoding of one label without its `xn--` prefix. Nil for malformed input.
    static func decodePunycode(_ input: String) -> String? {
        let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700
        var n = 128, i = 0, bias = 72
        var output: [UInt32] = []
        let bytes = Array(input.utf8)
        guard bytes.allSatisfy({ $0 < 128 }) else { return nil }
        var position = 0
        if let delimiter = bytes.lastIndex(of: 45) {
            output = bytes[..<delimiter].map { UInt32($0) }
            position = delimiter + 1
        }
        func digit(_ byte: UInt8) -> Int? {
            switch byte {
            case 48...57: return Int(byte) - 22      // 0-9 are 26-35
            case 65...90: return Int(byte) - 65      // A-Z
            case 97...122: return Int(byte) - 97     // a-z
            default: return nil
            }
        }
        func adapt(_ delta: Int, _ points: Int, _ first: Bool) -> Int {
            var delta = first ? delta / damp : delta / 2
            delta += delta / points
            var k = 0
            while delta > ((base - tMin) * tMax) / 2 { delta /= base - tMin; k += base }
            return k + (base - tMin + 1) * delta / (delta + skew)
        }
        while position < bytes.count {
            let old = i
            var w = 1, k = base
            while true {
                guard position < bytes.count, let d = digit(bytes[position]) else { return nil }
                position += 1
                let (mul, overflow) = d.multipliedReportingOverflow(by: w)
                guard !overflow else { return nil }
                i += mul
                let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
                if d < t { break }
                let (next, over) = w.multipliedReportingOverflow(by: base - t)
                guard !over else { return nil }
                w = next
                k += base
                if i > 0x10FFFF * 2 { return nil }
            }
            let count = output.count + 1
            bias = adapt(i - old, count, old == 0)
            n += i / count
            i %= count
            guard n <= 0x10FFFF, !(0xD800...0xDFFF).contains(n), n >= 128 else { return nil }
            output.insert(UInt32(n), at: i)
            i += 1
        }
        var result = ""
        for value in output { guard let scalar = Unicode.Scalar(value) else { return nil }; result.unicodeScalars.append(scalar) }
        return result
    }
}
