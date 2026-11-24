import SwiftUI

/// The one way a verification code is written (owner, 2026-11-24): the system monospaced design (so 0 and O differ), medium weight, the two halves a narrow gap
/// apart (about a quarter of a digit) made by kerning the last digit of the first half, never by a space character. It takes the
/// colour and the type style the caller gives it: the Codes list and search results write it at body size inside a tinted button, the
/// login's page at the size of the item's name. What is copied is the plain code, and VoiceOver spells the digits out, so neither has
/// the gap.
struct CodeDigits: View {
    /// The plain code, as it is copied. Six or eight digits are written in two halves, anything else whole.
    let code: String
    var style: Font.TextStyle = .body

    /// The font size, which scales with the type size the person chose. The gap is a fraction of this very size, so it is the same
    /// fraction of a digit's width at every size (the system monospaced digit is 0.6 em wide, so 0.15 em is a quarter of a digit).
    @ScaledMetric private var size: CGFloat

    init(code: String, style: Font.TextStyle = .body) {
        self.code = code
        self.style = style
        _size = ScaledMetric(wrappedValue: Self.basePointSize(of: style), relativeTo: style)
    }

    /// Point size of the style at the default text size.
    private static func basePointSize(of style: Font.TextStyle) -> CGFloat {
        #if os(iOS)
        switch style {
        case .title: 28
        case .title2: 22
        case .title3: 20
        default: 17
        }
        #else
        switch style {
        case .title: 22
        case .title2: 17
        case .title3: 15
        default: 13
        }
        #endif
    }

    private var written: AttributedString {
        guard let halves = TOTP.halves(code) else { return AttributedString(code) }
        var first = AttributedString(String(halves.first.dropLast()))
        var last = AttributedString(String(halves.first.suffix(1)))
        last.kern = 0.15 * size
        first.append(last)
        first.append(AttributedString(halves.second))
        return first
    }

    var body: some View {
        Text(written)
            .font(.system(size: size, weight: .medium, design: .monospaced))
            .contentTransition(.numericText())
            .accessibilityLabel(Text(verbatim: code).speechSpellsOutCharacters())
    }
}
