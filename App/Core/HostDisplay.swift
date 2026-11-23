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

    /// What to put in a sentence: the Unicode form when it is safe to show, followed by the ASCII form in parentheses when the
    /// Unicode form mixes scripts or a Latin label holds a letter outside `isCommonLatinLetter`.
    static func shown(_ host: String) -> String {
        let readable = unicode(host)
        // A host that was not ASCII to begin with is never repeated in the hint: it may hold what was just written out.
        guard readable != host, host.allSatisfy(\.isASCII) else { return readable }
        guard scripts(in: readable).count > 1 || hasUncommonLatinLetter(readable) else { return readable }
        return "\(readable) (\(host))"
    }

    /// True when a label in `text` has Latin letters and one of its letters is outside the common set.
    static func hasUncommonLatinLetter(_ text: String) -> Bool {
        text.split(separator: ".").contains { label in
            let letters = label.unicodeScalars.filter { $0.properties.isAlphabetic }
            guard letters.contains(where: { script(of: $0.value) == "Latin" }) else { return false }
            return letters.contains { script(of: $0.value) == "Latin" && !isCommonLatinLetter($0) }
        }
    }

    /// The Latin letters shown without a hint: the letters of European languages with Latin alphabets and Vietnamese, and no
    /// lookalike of another letter. Exactly: a-z; the Latin-1 Supplement letters U+00DF to U+00F6 and U+00F8 to U+00FF
    /// (not the ordinals U+00AA and U+00BA); Latin Extended-A U+0100 to U+017F without dotless i U+0131 and kra U+0138;
    /// Latin Extended-B s and t with comma below U+0218 to U+021B and Vietnamese o and u with horn U+01A1 and U+01B0; Latin
    /// Extended Additional Vietnamese letters U+1EA0 to U+1EF9. Everything else Latin (dental click, turned l, sinological dot,
    /// Extended-D, ...) is uncommon.
    static func isCommonLatinLetter(_ scalar: Unicode.Scalar) -> Bool {
        let v = scalar.value
        switch v {
        case 0x41...0x5A, 0x61...0x7A, 0xDF...0xF6, 0xF8...0xFF: return true
        case 0x100...0x17F: return v != 0x131 && v != 0x138
        case 0x218...0x21B, 0x1A1, 0x1B0, 0x1EA0...0x1EF9: return true
        default: return false
        }
    }

    /// True when a decoded label may be shown. It must be:
    /// - not empty, not plain ASCII letters, digits and hyphens (a punycode label that decodes to that is malformed), in NFC,
    ///   and unchanged by NFKC and by lower casing (so no fullwidth or mathematical letters, ligatures, superscripts,
    ///   ordinals, upper case or title case; full case folding is not used because it would refuse ß and final sigma);
    /// - made only of letters, marks, decimal digits and the ASCII hyphen, as IDNA allows (so no space, control, format,
    ///   separator, private-use, unassigned, punctuation or symbol character), not starting with a mark, and free of
    ///   default-ignorable and bidirectional-control characters, whatever their category;
    /// - free of a combining mark that follows an ASCII letter (in an NFC label that means no single code point exists for the
    ///   pair, as for `a` and a low line; `é` is one code point and passes);
    /// - ASCII in its decimal digits, unless every letter of the label is in one non-Latin script and all its digits come from
    ///   one digit set of that same script.
    static func isSafeLabel(_ label: String) -> Bool {
        guard !label.isEmpty else { return false }
        let scalars = Array(label.unicodeScalars)
        func same(_ other: String) -> Bool { Array(other.unicodeScalars) == scalars }
        guard same(label.precomposedStringWithCanonicalMapping), same(label.precomposedStringWithCompatibilityMapping),
              same(label.lowercased()) else { return false }
        let isPlain = scalars.allSatisfy { $0.isASCII && ($0.properties.isAlphabetic || ($0.value >= 48 && $0.value <= 57) || $0 == "-") }
        guard !isPlain else { return false }
        var base: Unicode.Scalar?  // the last scalar that is not a mark
        var marksOnBase = 0
        var foreignDigitSets = Set<Int>(), hasForeignDigit = false, hasASCIIDigit = false
        for (index, scalar) in scalars.enumerated() {
            if isInvisibleOrConfusable(scalar) { return false }
            switch scalar.properties.generalCategory {
            case .lowercaseLetter, .otherLetter, .modifierLetter: base = scalar; marksOnBase = 0
            case .decimalNumber:
                base = scalar; marksOnBase = 0
                if scalar.isASCII { hasASCIIDigit = true } else {
                    hasForeignDigit = true
                    foreignDigitSets.insert(Int(scalar.value) - Int(scalar.properties.numericValue ?? 0))
                }
            case .nonspacingMark, .spacingMark:
                guard index > 0, let base, markIsAllowed(scalar, on: base) else { return false }
                marksOnBase += 1
                if marksOnBase > 2 { return false }
                continue
            default:
                guard scalar == "-" else { return false }
                base = scalar; marksOnBase = 0
            }
        }
        if hasForeignDigit {
            let letterScripts = scripts(in: label)
            guard !hasASCIIDigit, foreignDigitSets.count == 1, letterScripts.count == 1, letterScripts.first != "Latin" else { return false }
            let digit = scalars.first { $0.properties.generalCategory == .decimalNumber && !$0.isASCII }!
            guard script(of: digit.value) == letterScripts.first else { return false }
        }
        return true
    }

    /// Known cost: orthographies whose accented letters have no single-character form (Yoruba, Igbo, Navajo, Lithuanian accented
    /// vowels and Russian stress-marked names, for example) show only their encoded form, because a general combining mark
    /// (U+0300 to U+036F and the other combining blocks) is refused on a Latin or Cyrillic base. A later allowlist of base and
    /// mark pairs per orthography could bring them back.
    ///
    /// A combining mark may stay only on a base of its own script: no mark from the general combining blocks (U+0300 to U+036F,
    /// U+1AB0 to U+1AFF, U+1DC0 to U+1DFF, U+FE20 to U+FE2F), which Latin, Cyrillic and Greek bases would need and which can
    /// decorate any letter; never an enclosing mark (category Me) or an overlay (U+0334 to U+0338, U+20D2 to U+20F0).
    /// Arabic harakat, Hebrew points, Indic vowel signs and Thai marks sit in their own script's block, so they pass on a
    /// base of that script. Hiragana and Katakana count as one script for marks.
    private static func markIsAllowed(_ mark: Unicode.Scalar, on base: Unicode.Scalar) -> Bool {
        let v = mark.value
        if mark.properties.generalCategory == .enclosingMark { return false }
        if (0x334...0x338).contains(v) || (0x20D2...0x20F0).contains(v) { return false }
        if (0x300...0x36F).contains(v) || (0x1AB0...0x1AFF).contains(v) || (0x1DC0...0x1DFF).contains(v) || (0xFE20...0xFE2F).contains(v) { return false }
        let markScript = script(of: v), baseScript = script(of: base.value)
        let kana: Set<String> = ["Hiragana", "Katakana"]
        return markScript == baseScript || (kana.contains(markScript) && kana.contains(baseScript))
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
    /// as one script each by Unicode block, so two unlisted scripts still read as mixed. The writing systems that Unicode's
    /// security recommendations treat as one are one script here: Han with Hiragana and Katakana ("Japanese"), Han with
    /// Bopomofo ("Chinese") and Han with Hangul ("Korean"). Han alone stays "Han".
    static func scripts(in text: String) -> Set<String> {
        var found = Set<String>()
        for scalar in text.unicodeScalars where scalar.properties.isAlphabetic {
            found.insert(script(of: scalar.value))
        }
        guard found.count > 1, found.contains("Han") || found.isSubset(of: ["Hiragana", "Katakana"]) else { return found }
        if found.isSubset(of: ["Han", "Hiragana", "Katakana"]) { return ["Japanese"] }
        if found.isSubset(of: ["Han", "Bopomofo"]) { return ["Chinese"] }
        if found.isSubset(of: ["Han", "Hangul"]) { return ["Korean"] }
        return found
    }

    /// Script by block. Where a script has several blocks they share one name. Anything not listed is its own "Block n".
    private static let ranges: [(ClosedRange<UInt32>, String)] = [
        (0x41...0x5A, "Latin"), (0x61...0x7A, "Latin"), (0xAA...0xAA, "Latin"), (0xBA...0xBA, "Latin"), (0xC0...0x24F, "Latin"),
        (0x1E00...0x1EFF, "Latin"), (0x2C60...0x2C7F, "Latin"), (0xA720...0xA7FF, "Latin"), (0xFF21...0xFF5A, "Latin"),
        (0x370...0x3FF, "Greek"), (0x1F00...0x1FFF, "Greek"),
        (0x400...0x52F, "Cyrillic"), (0x1C80...0x1C8F, "Cyrillic"), (0x2DE0...0x2DFF, "Cyrillic"), (0xA640...0xA69F, "Cyrillic"),
        (0x530...0x58F, "Armenian"), (0x590...0x5FF, "Hebrew"),
        (0x600...0x6FF, "Arabic"), (0x750...0x77F, "Arabic"), (0x8A0...0x8FF, "Arabic"), (0xFB50...0xFDFF, "Arabic"), (0xFE70...0xFEFE, "Arabic"),
        (0x700...0x74F, "Syriac"), (0x860...0x86F, "Syriac"), (0x780...0x7BF, "Thaana"), (0x7C0...0x7FF, "NKo"),
        (0x900...0x97F, "Devanagari"), (0xA8E0...0xA8FF, "Devanagari"), (0x980...0x9FF, "Bengali"), (0xA00...0xA7F, "Gurmukhi"),
        (0xA80...0xAFF, "Gujarati"), (0xB00...0xB7F, "Oriya"), (0xB80...0xBFF, "Tamil"), (0xC00...0xC7F, "Telugu"),
        (0xC80...0xCFF, "Kannada"), (0xD00...0xD7F, "Malayalam"), (0xD80...0xDFF, "Sinhala"),
        (0xE00...0xE7F, "Thai"), (0xE80...0xEFF, "Lao"), (0xF00...0xFFF, "Tibetan"),
        (0x1000...0x109F, "Myanmar"), (0xA9E0...0xA9FF, "Myanmar"), (0xAA60...0xAA7F, "Myanmar"),
        (0x1780...0x17FF, "Khmer"), (0x19E0...0x19FF, "Khmer"), (0x1800...0x18AF, "Mongolian"),
        (0x10A0...0x10FF, "Georgian"), (0x1C90...0x1CBF, "Georgian"), (0x2D00...0x2D2F, "Georgian"), (0x1200...0x139F, "Ethiopic"),
        (0x3040...0x309F, "Hiragana"), (0x30A0...0x30FF, "Katakana"), (0x31F0...0x31FF, "Katakana"),
        (0x3100...0x312F, "Bopomofo"), (0x31A0...0x31BF, "Bopomofo"),
        (0x3005...0x3007, "Han"), (0x3400...0x4DBF, "Han"), (0x4E00...0x9FFF, "Han"), (0x20000...0x2FFFF, "Han"),
        (0x1100...0x11FF, "Hangul"), (0x3130...0x318F, "Hangul"), (0xA960...0xA97F, "Hangul"), (0xAC00...0xD7AF, "Hangul"), (0xD7B0...0xD7FF, "Hangul")
    ]

    static func script(of value: UInt32) -> String {
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
