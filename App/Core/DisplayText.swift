import Foundation

/// Text from the person's vault (a title, an account, a stored website) made safe to show as one line of a label or sentence.
///
/// A vault may have been imported from elsewhere, so its text can hold characters that reorder or hide what is around it. This
/// changes only what is displayed, never what is stored or filled. It
/// - removes bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C), zero-width and other invisible
///   format characters, other default-ignorable characters, C0 and C1 controls, tag characters, private-use, unassigned and
///   surrogate code points;
/// - turns every kind of space and line break (including no-break, line and paragraph separators and tabs) into one space,
///   collapses runs of them and trims the ends;
/// - keeps a zero-width joiner only between two emoji, and a variation selector only right after an emoji, so emoji sequences
///   survive;
/// - cuts the result to `maxLength` characters (what a person sees as one character, so a flag or a family counts once) and
///   ends it with an ellipsis.
enum DisplayText {
    static let maxLength = 80

    /// `text` as one safe line. When nothing is left, `empty`, which is the "Untitled" placeholder unless you pass another.
    static func safe(_ text: String, empty: String = String(localized: "Untitled")) -> String {
        let scalars = Array(text.unicodeScalars)
        var kept = String.UnicodeScalarView()
        var pendingSpace = false
        var previousWasEmoji = false  // the last kept scalar is an emoji (possibly followed by its variation selector)
        for (index, scalar) in scalars.enumerated() {
            if isSpace(scalar) {
                pendingSpace = !kept.isEmpty
                previousWasEmoji = false
                continue
            }
            if scalar == "\u{200D}" {
                // Only inside an emoji sequence: an emoji before it and an emoji after it.
                guard previousWasEmoji, index + 1 < scalars.count, isEmoji(scalars[index + 1]) else { continue }
                kept.append(scalar)
                previousWasEmoji = false  // the next emoji restarts the sequence
                continue
            }
            if (0xFE00...0xFE0F).contains(scalar.value) {
                guard previousWasEmoji else { continue }
                kept.append(scalar)
                continue
            }
            if isRemoved(scalar) { continue }
            if pendingSpace { kept.append(" "); pendingSpace = false }
            kept.append(scalar)
            previousWasEmoji = isEmoji(scalar)
        }
        var result = String(kept)
        if result.count > maxLength { result = String(result.prefix(maxLength - 1)) + "…" }
        return result.isEmpty ? empty : result
    }

    /// The name of a login as shown: its safe title, else the safe form of its site, else the "Untitled" placeholder.
    static func title(of item: VaultItem) -> String {
        let name = safe(item.title, empty: "")
        if !name.isEmpty { return name }
        let site = HostDisplay.shown(SharedVault.host(item.website))
        return site.isEmpty ? String(localized: "Untitled") : site
    }

    private static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.properties.isWhitespace { return true }
        switch scalar.properties.generalCategory {
        case .spaceSeparator, .lineSeparator, .paragraphSeparator: return true
        default: return scalar.value == 0x09 || scalar.value == 0x0A || scalar.value == 0x0D || scalar.value == 0x85
        }
    }

    /// An emoji that can join in a sequence: not a digit, `#` or `*`, which are only emoji with a keycap.
    private static func isEmoji(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.isEmojiPresentation || (scalar.properties.isEmoji && scalar.value > 0xFF)
    }

    private static func isRemoved(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        if scalar.properties.isDefaultIgnorableCodePoint { return true }
        if (0x202A...0x202E).contains(value) || (0x2066...0x2069).contains(value) || value == 0x200E || value == 0x200F || value == 0x061C { return true }
        if (0xE0000...0xE007F).contains(value) { return true }
        switch scalar.properties.generalCategory {
        case .format, .control, .surrogate, .privateUse, .unassigned: return true
        default: return false
        }
    }
}
