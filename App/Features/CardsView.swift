import SwiftUI

/// Every card in the vault, one row per card: icon, name, a second line (see `VaultItem.cardSummary`). A row opens the card's page,
/// which copies every field. Where a selection is given (Mac and iPad at regular width) the page shows beside the list.
struct CardsView: View {
    let items: [VaultItem]
    /// The selected card, in the split layouts. nil on iPhone, whose rows push the card's page.
    var selection: Binding<VaultItem.ID?>?
    let add: () -> Void

    /// The order seen when the list appeared. Cards used or edited meanwhile keep their place until it appears again.
    @State private var rank: [VaultItem.ID: Int]

    init(items: [VaultItem], selection: Binding<VaultItem.ID?>? = nil, add: @escaping () -> Void) {
        self.items = items
        self.selection = selection
        self.add = add
        _rank = State(initialValue: Self.snapshot(items))
    }

    private static func snapshot(_ items: [VaultItem]) -> [VaultItem.ID: Int] {
        let ordered = CardsOrder.ordered(items)
        return Dictionary(uniqueKeysWithValues: (ordered.live + ordered.expired).enumerated().map { ($1.id, $0) })
    }

    private var cards: [VaultItem] { items.filter { $0.kind == .creditCard } }

    var body: some View {
        let ordered = CardsOrder.ordered(cards, rank: rank)
        Group {
            if let selection {
                List(selection: selection) { rows(ordered) }
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
        .columnTitleInList(selection != nil)
        .onAppear { rank = Self.snapshot(items) }
    }

    @ViewBuilder
    private func rows(_ ordered: (live: [VaultItem], expired: [VaultItem])) -> some View {
        if selection != nil {
            ListTitleLine(title: "Cards", count: cards.count == 1 ? String(localized: "1 card") : String(localized: "\(cards.count) cards"))
        }
        ForEach(ordered.live) { row($0) }
        if !ordered.expired.isEmpty {
            Section("Expired") { ForEach(ordered.expired) { row($0) } }
        }
    }

    /// The shared row, with the card's summary as its second line (the same on every platform). A row selects (Mac and iPad) or
    /// pushes the card's page (iPhone, with the system chevron like All).
    @ViewBuilder
    private func row(_ card: VaultItem) -> some View {
        let content = ItemListRow(item: card, subtitle: Text(verbatim: card.cardSummary()), subtitleSpoken: card.cardSummarySpoken())
        if selection != nil {
            content.tag(card.id).itemRowInsets()
        } else {
            NavigationLink(value: card.id) { content }.itemRowInsets()
        }
    }
}
