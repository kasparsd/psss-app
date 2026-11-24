import SwiftUI

/// The one row layout of the All, Codes and Cards lists, on iPhone, iPad and Mac: the item's icon, the name over one secondary line,
/// what a login has as quiet glyphs in fixed columns, and an optional accessory at the trailing edge (the system chevron on iPhone,
/// the code button on Codes, a card's number and expiry on Cards). Each list supplies only its own words and accessory, so the
/// three read as one family: same icon size and place, same type sizes (body for both lines), same insets and row height
/// (`itemRowInsets()`).
struct ItemListRow<Trailing: View>: View {
    let item: VaultItem
    /// The second line. Nil for none.
    var subtitle: Text?
    /// What VoiceOver reads in place of the second line, when the written form is not how it is spoken.
    var subtitleSpoken: String?
    /// What the login has, as filled glyphs at the trailing end, each in its own fixed-width column so they line up down the list
    /// (passkey, then code last). Only the All list shows them. Empty for none: the row then reserves nothing.
    var glyphs: [ItemTrait] = []
    /// The glyph columns laid out when there are glyphs. A search result that shows the live code leaves the code column out.
    var glyphColumns: [ItemTrait] = ItemTrait.glyphColumns
    /// When set, the icon and the words open it as a button and the accessory stays its own target (a code button must not also
    /// open the login). Without it the row is plain content, for a list link or a selection to wrap.
    var open: (() -> Void)?
    @ViewBuilder var trailing: Trailing
    @Environment(\.dynamicTypeSize) private var typeSize

    init(item: VaultItem, subtitle: Text? = nil, subtitleSpoken: String? = nil, glyphs: [ItemTrait] = [],
         glyphColumns: [ItemTrait] = ItemTrait.glyphColumns, open: (() -> Void)? = nil,
         @ViewBuilder trailing: () -> Trailing) {
        self.item = item
        self.subtitle = subtitle
        self.subtitleSpoken = subtitleSpoken
        self.glyphs = glyphs
        self.glyphColumns = glyphColumns
        self.open = open
        self.trailing = trailing()
    }

    /// The name may wrap to a second line rather than be cut ("Harbor Vault (8 dig…").
    private var titleLine: some View {
        Text(verbatim: item.displayTitle.breakableAfterDots).lineLimit(2).fixedSize(horizontal: false, vertical: true)
    }

    /// Filled glyphs, secondary (they tell, they are not buttons), a little larger than the text, one fixed column each.
    @ViewBuilder
    private var glyphBlock: some View {
        if !glyphs.isEmpty {
            HStack(spacing: 0) {
                ForEach(glyphColumns, id: \.self) { trait in
                    TraitGlyph(trait: trait, present: glyphs.contains(trait))
                }
            }
            .layoutPriority(1)
        }
    }

    private var leading: some View {
        HStack(spacing: 12) {
            ItemIcon(item: item)
                // The separator starts where the text starts, the same on every row and every platform.
                .alignmentGuide(.listRowSeparatorLeading) { $0[.trailing] + 12 }
            VStack(alignment: .leading, spacing: 2) {
                titleLine
                if let subtitle {
                    subtitle.foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        .accessibilityLabel(subtitleSpoken.map { Text(verbatim: $0) } ?? subtitle)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var opener: some View {
        if let open { Button(action: open) { leading }.buttonStyle(.plain) } else { leading }
    }

    /// Where the words start: the icon's width and the gap after it. What moves under the words starts here, not under the icon.
    private static var textInset: CGFloat { 30 + 12 }

    var body: some View {
        if typeSize.isAccessibilitySize && (Trailing.self != EmptyView.self || !glyphs.isEmpty) {
            // The largest text sizes: the glyphs and the accessory move under the words, at the text column, rather than squeezing
            // them, so the name wraps to two lines instead of being cut.
            VStack(alignment: .leading, spacing: 8) {
                opener
                VStack(alignment: .leading, spacing: 8) {
                    glyphBlock
                    trailing
                }
                .padding(.leading, Self.textInset)
            }
        } else {
            HStack(spacing: 12) {
                opener
                glyphBlock
                trailing
            }
        }
    }
}

extension ItemListRow where Trailing == EmptyView {
    init(item: VaultItem, subtitle: Text? = nil, subtitleSpoken: String? = nil, glyphs: [ItemTrait] = [],
         glyphColumns: [ItemTrait] = ItemTrait.glyphColumns, open: (() -> Void)? = nil) {
        self.init(item: item, subtitle: subtitle, subtitleSpoken: subtitleSpoken, glyphs: glyphs, glyphColumns: glyphColumns,
                  open: open) { EmptyView() }
    }
}

extension ItemTrait {
    /// The glyph columns of a row, left to right: passkey, then the verification code last. Notes has no glyph in rows (it is a
    /// filter, "With notes", and shows on the item's page).
    static let glyphColumns: [ItemTrait] = [.passkey, .code]
}

/// One column of the glyph block: a characteristic of a login as a quiet filled glyph, with its spoken label and, on Mac, a tooltip;
/// or an empty column of the same width, so the glyphs after it keep their place.
private struct TraitGlyph: View {
    let trait: ItemTrait
    let present: Bool
    @ScaledMetric(relativeTo: .body) private var width: CGFloat = 26

    var body: some View {
        if present {
            Image(systemName: trait.rowSymbol)
                .imageScale(.large)
                .foregroundStyle(.secondary)
                .frame(width: width)
                .accessibilityLabel(trait.badgeLabel)
                .help(trait.badgeLabel)
        } else {
            Color.clear.frame(width: width, height: 1).accessibilityHidden(true)
        }
    }
}

extension View {
    /// Insets of one row, the same in every item list, and its separators (owner, 2026-11-24): the system line below a row, starting
    /// where the text starts, between two rows of one group. None above the first row of a group and none below its last, so no line
    /// meets a heading ("Expired", "All codes") or the end of the list. `first` and `last` say where the row stands in its group.
    func itemRowInsets(first: Bool = false, last: Bool = false) -> some View {
        #if os(iOS)
        let insets = EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
        #else
        let insets = EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 8)
        #endif
        return listRowInsets(insets)
            .listRowSeparator(first ? .hidden : .visible, edges: .top)
            .listRowSeparator(last ? .hidden : .visible, edges: .bottom)
    }

    /// The list style of every item list (All, Codes, Cards, Recently Deleted): plain on iPhone and iPad, so rows sit directly on the
    /// screen with no card behind them and no inset at the sides, and inset on Mac, with the minimum row height the platform asks for
    /// (44 pt touch targets on iOS). One background, one separator style, whichever place is showing.
    func itemListStyle() -> some View {
        #if os(iOS)
        environment(\.defaultMinListRowHeight, 44).listStyle(.plain)
        #else
        environment(\.defaultMinListRowHeight, 32).listStyle(.inset)
        #endif
    }
}
