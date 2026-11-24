import SwiftUI

/// Every card in the vault, one row per card: icon, name, the brand as its second line and the number and expiry at the trailing end (`CardListRow`). A row opens the card's page,
/// which copies every field. Where a selection is given (Mac and iPad at regular width) the page shows beside the list.
struct CardsView: View {
    let items: [VaultItem]
    /// The selected card, in the split layouts. nil on iPhone, whose rows push the card's page.
    var selection: Binding<VaultItem.ID?>?
    let add: () -> Void

    /// The order and the "Recently used" group seen when the list appeared. Cards used or edited meanwhile keep their place until it
    /// appears again.
    @State private var rank: [VaultItem.ID: Int]
    @State private var recent: [VaultItem.ID]?
    /// The selected row, with its section, so a card in the group and in the list below is selected once.
    @State private var picked: SectionedRowID?

    init(items: [VaultItem], selection: Binding<VaultItem.ID?>? = nil, add: @escaping () -> Void) {
        self.items = items
        self.selection = selection
        self.add = add
        _rank = State(initialValue: Self.snapshot(items).rank)
    }

    private static func snapshot(_ items: [VaultItem]) -> (rank: [VaultItem.ID: Int], recent: [VaultItem.ID]) {
        let ordered = CardsOrder.ordered(items)
        let rank = Dictionary(uniqueKeysWithValues: (ordered.live + ordered.expired).enumerated().map { ($1.id, $0) })
        return (rank, RecentlyUsed.group(from: ordered.live).map(\.id))
    }

    private var cards: [VaultItem] { items.filter { $0.kind == .creditCard } }

    private var countText: String { cards.count == 1 ? String(localized: "1 card") : String(localized: "\(cards.count) cards") }

    var body: some View {
        let ordered = CardsOrder.ordered(cards, rank: rank, recent: recent)
        Group {
            if let selection {
                List(selection: SectionedRowID.binding(outer: selection, picked: $picked, recent: Set(ordered.recent.map(\.id)))) { rows(ordered) }
            } else {
                List { rows(ordered) }
            }
        }
        // The same list style, background and row as All and Codes.
        .itemListStyle()
        .overlay {
            if cards.isEmpty {
                ContentUnavailableView {
                    Label("No cards yet", systemImage: "creditcard")
                } description: {
                    Text("Save a card here to copy its number, expiry and security code at a checkout. It stays encrypted in your vault.")
                } actions: {
                    Button("Add card", action: add).buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Cards")
        #if os(iOS)
        // iPhone: the title is the name alone and the line under it carries the count, so neither is ever cut.
        .navigationSubtitle(selection == nil ? countText : "")
        #endif
        .columnTitleInList(selection != nil)
        .onAppear {
            let seen = Self.snapshot(items)
            rank = seen.rank
            recent = seen.recent
        }
    }

    @ViewBuilder
    private func rows(_ ordered: (recent: [VaultItem], live: [VaultItem], expired: [VaultItem])) -> some View {
        if selection != nil {
            ListTitleLine(title: "Cards", count: countText)
        }
        // The headings only tell the sections apart: without a group the title already says Cards.
        if ordered.recent.isEmpty {
            ForEach(ordered.live) { row($0, in: .all, group: ordered.live) }
        } else {
            Section("Recently used") { ForEach(ordered.recent) { row($0, in: .recent, group: ordered.recent) } }
            Section("All cards") { ForEach(ordered.live) { row($0, in: .all, group: ordered.live) } }
        }
        if !ordered.expired.isEmpty {
            Section("Expired") { ForEach(ordered.expired) { row($0, in: .all, group: ordered.expired) } }
        }
    }

    /// The shared card row. A row selects (Mac and iPad) or pushes the card's page (iPhone, with the system chevron like All). The
    /// line between rows stops at the end of each group, so none meets a heading.
    @ViewBuilder
    private func row(_ card: VaultItem, in section: SectionedRowID.Section, group: [VaultItem]) -> some View {
        let content = CardListRow(card: card)
        let (first, last) = (group.first?.id == card.id, group.last?.id == card.id)
        if selection != nil {
            content.tag(SectionedRowID(section: section, id: card.id)).itemRowInsets(first: first, last: last)
        } else {
            NavigationLink(value: card.id) { content }.itemRowInsets(first: first, last: last)
        }
    }
}

/// A card in a list, the same in Cards, in All and in search results (owner, 2026-11-24). On the left the card's name over its short
/// brand ("Visa", "Visa · Expired"), or over the name on the card when the card has no name of its own (`cardSecondLine`); at the trailing end, right-aligned in digits of one width, the last four digits over the expiry.
/// A part that is missing drops out. VoiceOver reads one summary ("Visa ending 4417, expires 08/28") and skips the trailing block.
struct CardListRow: View {
    let card: VaultItem

    var body: some View {
        ItemListRow(item: card, subtitle: card.cardSecondLine().map { Text(verbatim: $0) }, subtitleSpoken: card.cardSummarySpoken()) {
            if card.cardNumberLine != nil || card.cardExpiryLine != nil {
                VStack(alignment: .trailing, spacing: 2) {
                    if let number = card.cardNumberLine { Text(verbatim: number) }
                    if let expiry = card.cardExpiryLine { Text(verbatim: expiry).foregroundStyle(.secondary) }
                }
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .fixedSize()
                .accessibilityHidden(true)
            }
        }
    }
}
