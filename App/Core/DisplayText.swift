import Foundation

/// Text from the person's vault (a title, an account, a stored website) made safe to show as one line of a label or sentence.
///
/// A vault may have been imported from elsewhere, so its text can hold characters that reorder, hide or inflate what is around
/// it. This changes only what is displayed, never what is stored or filled. It
/// - removes bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C), zero-width and other invisible
///   format characters, other default-ignorable characters, C0 and C1 controls, tag characters, private-use, unassigned and
///   surrogate code points, and the code points that draw nothing although they are not invisible: U+2800 (blank braille),
///   U+FFFC and U+FFFD, U+1D159, the fillers (Hangul U+115F, U+1160, U+3164, U+FFA0 and Khitan small script U+16FE4), the blank Egyptian hieroglyphs U+13441 and U+13442 and the Kawi space filler U+11F48;
/// - turns every kind of space and line break (including no-break, line and paragraph separators and tabs) into one space,
///   collapses runs of them and trims the ends;
/// - keeps a zero-width non-joiner or joiner (U+200C, U+200D) only where a script spells words with it: between two letters of
///   the same script, skipping combining marks, when that script is one of `joinerScripts`, never twice in a row, never at an
///   end and never next to a space, in one uninterrupted word (a space resets it). The exception is the final form: one joiner
///   straight after a virama of the letter's script (a Malayalam chillu), before a space, punctuation or the end of the text.
///   Between two emoji a joiner stays as part of the emoji sequence;
/// - keeps a variation selector (U+FE0E, U+FE0F) only right after an emoji (so `©` and a heart keep theirs), and after the digit,
///   `#` or `*` of a keycap when U+20E3 follows;
/// - limits what one position can cost: at most 8 combining marks on a base, an emoji sequence of at most 10 scalars (a longer
///   one keeps only its first emoji), and 320 scalars in all, so a hostile value cannot fill a screen with one "character";
/// - cuts the result to `maxLength` characters (what a person sees as one character, so a flag or a family counts once) and
///   ends it with an ellipsis, never leaving a joiner or a space before it;
/// - gives the placeholder when nothing with a base is left: a title of only combining marks, an enclosing keycap mark or
///   variation selectors has nothing to sit on.
///
/// The result is stable: passing it through again changes nothing.
enum DisplayText {
    static let maxLength = 80
    static let maxScalars = 320
    static let maxMarksPerBase = 8
    static let maxEmojiSequence = 10

    /// The scripts in which U+200C and U+200D are part of correct spelling: Arabic, Syriac, N'Ko, Mongolian, Devanagari, Bengali,
    /// Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Tibetan, Myanmar and Khmer. Persian,
    /// Urdu and Pashto (Arabic) and the Indic half-forms and conjuncts are the common cases. Latin, Cyrillic and Greek never
    /// need a joiner, and a joiner between two scripts is never right.
    static let joinerScripts: Set<String> = [
        "Arabic", "Syriac", "NKo", "Mongolian", "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu",
        "Kannada", "Malayalam", "Sinhala", "Thai", "Lao", "Tibetan", "Myanmar", "Khmer"
    ]

    /// `text` as one safe line. When nothing is left, `empty`: nothing, unless you pass a placeholder.
    static func safe(_ text: String, empty: String = "") -> String {
        var builder = Builder()
        builder.run(Array(text.unicodeScalars))
        var kept = builder.kept
        trimTail(&kept)
        guard kept.contains(where: hasInk) else { return empty }
        var result = String(String.UnicodeScalarView(kept))
        if builder.capHit || result.count > maxLength {
            var head = Array(result.prefix(result.count >= maxLength ? maxLength - 1 : result.count).unicodeScalars)
            trimTail(&head)
            result = String(String.UnicodeScalarView(head)) + "…"
        }
        return result
    }

    /// `text` made safe and put in typographic quotes, for a value from the vault inside a sentence with fixed text. Straight and
    /// typographic double quotes inside the value are removed first, so it cannot close its own quote and carry on as if it were
    /// our text. Label-like words in a value are not filtered: the quotes are what mark them as the vault's. A value with nothing
    /// to show gives the placeholder inside the quotes.
    static func quoted(_ text: String) -> String {
        let stripped = String(String.UnicodeScalarView(text.unicodeScalars.filter { !quoteMarks.contains($0.value) }))
        return "\u{201C}" + safe(stripped) + "\u{201D}"
    }

    /// The double quotation marks in Unicode: ASCII, the typographic and low/high-reversed ones, guillemets, double prime,
    /// CJK quotation marks and fullwidth.
    private static let quoteMarks: Set<UInt32> = [0x22, 0xAB, 0xBB, 0x201C, 0x201D, 0x201E, 0x201F, 0x2033, 0x2036, 0x301D, 0x301E, 0x301F, 0xFF02]

    /// The name of an item as shown: its safe title, else the name made from what it holds (`VaultItem.derivedTitle`), with a
    /// website in its readable, lookalike-safe form. Never empty: the kind ("Login") stands in last.
    static func title(of item: VaultItem) -> String {
        let name = safe(item.title)
        if !name.isEmpty { return name }
        if item.kind == .login || item.kind == .keePassEntry {
            let site = HostDisplay.shown(SharedVault.host(item.website))
            if !site.isEmpty { return site }
        }
        return safe(item.derivedTitle, empty: item.kind.unnamedTitle)
    }

    // MARK: Scanning

    private struct Builder {
        var kept: [Unicode.Scalar] = []
        var capHit = false
        private var pendingSpace = false
        private var lastBase: Unicode.Scalar?  // the last kept scalar that is not a mark or a joiner
        private var marksOnBase = 0
        private var sequenceStart: Int?  // where the emoji sequence being built began
        private var dropping = false  // the rest of an over-long emoji sequence is being skipped

        mutating func run(_ scalars: [Unicode.Scalar]) {
            var previous: Unicode.Scalar?
            for index in scalars.indices {
                let scalar = scalars[index]
                defer { previous = scalar }
                if DisplayText.isSpace(scalar) {
                    pendingSpace = !kept.isEmpty
                    lastBase = nil  // a joiner never reaches across a space: it needs a letter on each side in one word
                    sequenceStart = nil
                    dropping = false
                    continue
                }
                if dropping {
                    if scalar == "\u{200D}" || DisplayText.isVariationSelector(scalar) || DisplayText.isModifier(scalar) || (previous == "\u{200D}" && DisplayText.isEmoji(scalar)) { continue }
                    dropping = false
                }
                if scalar == "\u{200C}" || scalar == "\u{200D}" {
                    if DisplayText.isJoiner(previous) || pendingSpace || DisplayText.isJoiner(kept.last) { continue }
                    guard let base = lastBase, DisplayText.joinerBelongs(scalar, between: base, scalars: scalars, after: index, previous: kept.last) else { continue }
                    if !append(scalar) { return }
                    continue
                }
                if DisplayText.isVariationSelector(scalar) {
                    guard !pendingSpace, scalar.value == 0xFE0F || scalar.value == 0xFE0E, let base = lastBase, kept.last == base else { continue }
                    let keycap = DisplayText.isKeycapBase(base)
                    if keycap {
                        guard scalar.value == 0xFE0F, index + 1 < scalars.count, scalars[index + 1] == "\u{20E3}" else { continue }
                    } else if !base.properties.isEmoji {
                        continue
                    }
                    if !append(scalar) { return }
                    continue
                }
                if DisplayText.isBlank(scalar) || DisplayText.isRemoved(scalar) { continue }
                switch scalar.properties.generalCategory {
                case .nonspacingMark, .spacingMark, .enclosingMark:
                    marksOnBase += 1
                    if marksOnBase > DisplayText.maxMarksPerBase { continue }
                    if !append(scalar) { return }
                default:
                    marksOnBase = 0
                    if !append(scalar) { return }
                    lastBase = scalar
                }
            }
        }

        /// Adds `scalar` (after a pending space), keeping the emoji sequence and total limits. False when the total is full.
        private mutating func append(_ scalar: Unicode.Scalar) -> Bool {
            if kept.count + (pendingSpace ? 2 : 1) > DisplayText.maxScalars {
                capHit = true
                return false
            }
            if pendingSpace {
                kept.append(" ")
                pendingSpace = false
            }
            let isBase = !(scalar == "\u{200C}" || scalar == "\u{200D}" || DisplayText.isVariationSelector(scalar))
            if isBase, DisplayText.isEmoji(scalar) {
                // An emoji continues a sequence after a joiner (or as a skin tone); otherwise it starts one.
                if sequenceStart == nil || !(DisplayText.isJoiner(kept.last) || DisplayText.isModifier(scalar)) { sequenceStart = kept.count }
            } else if isBase, !DisplayText.isModifier(scalar), !DisplayText.isMark(scalar) {
                sequenceStart = nil
            }
            kept.append(scalar)
            if let start = sequenceStart, kept.count - start > DisplayText.maxEmojiSequence {
                // Too long to be a real emoji: keep the first emoji (and its variation selector) alone.
                var end = start + 1
                if end < kept.count, DisplayText.isVariationSelector(kept[end]) { end += 1 }
                kept.removeSubrange(end...)
                lastBase = kept[start]
                marksOnBase = 0
                sequenceStart = nil
                dropping = true
            }
            return true
        }
    }

    /// Whether a joiner here is part of correct spelling: the letter before and the letter after (marks skipped) are of one
    /// script in `joinerScripts`, or both ends are emoji (a ZWJ only). One more case: a joiner directly after a virama of the
    /// script of the letter before it, when a space, punctuation or the end of the text follows. That is how a chillu (Malayalam)
    /// and other final forms are written at the end of a word.
    private static func joinerBelongs(_ joiner: Unicode.Scalar, between base: Unicode.Scalar, scalars: [Unicode.Scalar], after index: Int, previous: Unicode.Scalar?) -> Bool {
        var next = index + 1
        if joiner == "\u{200D}", isEmoji(base) {
            return next < scalars.count && isEmoji(scalars[next])
        }
        guard isLetter(base) else { return false }
        let script = HostDisplay.script(of: base.value)
        guard joinerScripts.contains(script) else { return false }
        if let previous, isVirama(previous), HostDisplay.script(of: previous.value) == script {
            if next >= scalars.count { return true }
            let after = scalars[next]
            if isSpace(after) || isPunctuation(after) { return true }
        }
        while next < scalars.count, isMark(scalars[next]) { next += 1 }
        guard next < scalars.count, isLetter(scalars[next]), !isBlank(scalars[next]), !isRemoved(scalars[next]) else { return false }
        return HostDisplay.script(of: scalars[next].value) == script
    }

    /// A joiner that ends the text is fine only as the final form after a virama (see `joinerBelongs`).
    private static func endsWithFinalForm(_ scalars: [Unicode.Scalar]) -> Bool {
        guard scalars.count >= 3, isJoiner(scalars[scalars.count - 1]), isVirama(scalars[scalars.count - 2]) else { return false }
        var index = scalars.count - 3
        while index > 0, isMark(scalars[index]) { index -= 1 }
        guard isLetter(scalars[index]) else { return false }
        let script = HostDisplay.script(of: scalars[index].value)
        return joinerScripts.contains(script) && HostDisplay.script(of: scalars[scalars.count - 2].value) == script
    }

    /// Takes off what must not end a line: joiners (with any marks after them) unless they are the final form after a virama,
    /// spaces, and the variation selector of a keycap that lost its U+20E3.
    private static func trimTail(_ scalars: inout [Unicode.Scalar]) {
        while let last = scalars.last {
            var end = scalars.count
            while end > 0, isMark(scalars[end - 1]), !isVariationSelector(scalars[end - 1]) { end -= 1 }
            if end > 0, isJoiner(scalars[end - 1]) {
                scalars.removeSubrange(end...)
                if endsWithFinalForm(scalars) { break }
                scalars.removeLast()
            } else if last == " " {
                scalars.removeLast()
            } else if last == "\u{FE0F}", scalars.count >= 2, isKeycapBase(scalars[scalars.count - 2]) {
                scalars.removeLast()
            } else {
                break
            }
        }
    }

    // MARK: Classes

    private static func isJoiner(_ scalar: Unicode.Scalar?) -> Bool { scalar == "\u{200C}" || scalar == "\u{200D}" }
    private static func isVariationSelector(_ scalar: Unicode.Scalar) -> Bool { (0xFE00...0xFE0F).contains(scalar.value) }
    private static func isModifier(_ scalar: Unicode.Scalar) -> Bool { (0x1F3FB...0x1F3FF).contains(scalar.value) }
    private static func isKeycapBase(_ scalar: Unicode.Scalar) -> Bool {
        (0x30...0x39).contains(scalar.value) || scalar == "#" || scalar == "*"
    }

    private static func isVirama(_ scalar: Unicode.Scalar) -> Bool { scalar.properties.canonicalCombiningClass == .virama }

    private static func isPunctuation(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation: return true
        default: return false
        }
    }

    private static func isMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }

    /// A base a person can see: a letter, number, punctuation or symbol (an emoji is a symbol). Marks and variation selectors
    /// alone are not one: they need something to sit on.
    private static func hasInk(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber,
             .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation,
             .otherPunctuation, .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol:
            return !isBlank(scalar)
        default:
            return false
        }
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

    /// Code points that draw nothing (or a replacement box) although they are not format characters.
    private static func isBlank(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x2800, 0xFFFC, 0xFFFD, 0x1D159, 0x1D173...0x1D17A, 0x115F, 0x1160, 0x3164, 0xFFA0, 0x16FE4, 0x13441, 0x13442, 0x11F48: return true
        default: return false
        }
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
