import SwiftUI

/// The one row layout of the All, Codes and Cards lists, on iPhone, iPad and Mac: the item's icon, the name over one secondary line,
/// and an optional accessory at the trailing edge (the system chevron on iPhone, the code button on Codes). Each list supplies only
/// its own words and accessory, so the three read as one family: same icon size and place, same type sizes (body for both lines),
/// same insets and row height (`itemList()`).
struct ItemListRow<Trailing: View>: View {
    let item: VaultItem
    /// The second line. Nil for none.
    var subtitle: Text?
    /// What VoiceOver reads in place of the second line, when the written form is not how it is spoken.
    var subtitleSpoken: String?
    /// One quiet glyph per characteristic after the name (passkey, code, notes). Only the All list shows them.
    var showsTraits = false
    /// When set, the icon and the words open it as a button and the accessory stays its own target (a code button must not also
    /// open the login). Without it the row is plain content, for a list link or a selection to wrap.
    var open: (() -> Void)?
    @ViewBuilder var trailing: Trailing
    @Environment(\.dynamicTypeSize) private var typeSize

    init(item: VaultItem, subtitle: Text? = nil, subtitleSpoken: String? = nil, showsTraits: Bool = false, open: (() -> Void)? = nil,
         @ViewBuilder trailing: () -> Trailing) {
        self.item = item
        self.subtitle = subtitle
        self.subtitleSpoken = subtitleSpoken
        self.showsTraits = showsTraits
        self.open = open
        self.trailing = trailing()
    }

    /// The name may wrap to a second line rather than be cut ("Harbor Vault (8 dig…"). Glyphs never wrap or truncate.
    private var titleLine: some View {
        HStack(spacing: 6) {
            Text(verbatim: item.displayTitle.breakableAfterDots).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            if showsTraits {
                ForEach(item.traits, id: \.self) { trait in
                    Image(systemName: trait.symbol)
                        .foregroundStyle(.secondary)
                        .layoutPriority(1)
                        .accessibilityLabel(trait.badgeLabel)
                }
            }
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

    var body: some View {
        if Trailing.self != EmptyView.self && typeSize.isAccessibilitySize {
            // The largest text sizes: the accessory moves under the words rather than squeezing them.
            VStack(alignment: .leading, spacing: 8) {
                opener
                trailing
            }
        } else {
            HStack(spacing: 12) {
                opener
                trailing
            }
        }
    }
}

extension ItemListRow where Trailing == EmptyView {
    init(item: VaultItem, subtitle: Text? = nil, subtitleSpoken: String? = nil, showsTraits: Bool = false, open: (() -> Void)? = nil) {
        self.init(item: item, subtitle: subtitle, subtitleSpoken: subtitleSpoken, showsTraits: showsTraits, open: open) { EmptyView() }
    }
}

extension View {
    /// Insets of one row, the same in every item list. The line above a row is hidden, so the first row has no stray line under the
    /// title and every row is separated by the line below it.
    func itemRowInsets() -> some View {
        #if os(iOS)
        listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)).listRowSeparator(.hidden, edges: .top)
        #else
        listRowInsets(EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 8)).listRowSeparator(.hidden, edges: .top)
        #endif
    }

    /// The list style of every item list (All, Codes, Cards): plain on iPhone and iPad, inset on Mac, with the minimum row height
    /// the platform asks for (44 pt touch targets on iOS). One background, one separator style, whichever place is showing.
    func itemListStyle() -> some View {
        #if os(iOS)
        environment(\.defaultMinListRowHeight, 44).listStyle(.plain)
        #else
        environment(\.defaultMinListRowHeight, 32).listStyle(.inset)
        #endif
    }
}
