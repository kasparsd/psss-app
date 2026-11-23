import SwiftUI

/// Every card in the vault, one row per card: icon, name, a second line (see `VaultItem.cardSummary`). A row opens the card's page,
/// which copies every field. Where a selection is given (Mac and iPad at regular width) the page shows beside the list.
struct CardsView: View {
    let items: [VaultItem]
    /// The selected card, in the split layouts. nil on iPhone, whose rows push the card's page.
    var selection: Binding<VaultItem.ID?>?
    let open: (VaultItem.ID) -> Void
    let add: () -> Void

    /// The order seen when the list appeared. Cards used or edited meanwhile keep their place until it appears again.
    @State private var rank: [VaultItem.ID: Int]

    init(items: [VaultItem], selection: Binding<VaultItem.ID?>? = nil, open: @escaping (VaultItem.ID) -> Void,
         add: @escaping () -> Void) {
        self.items = items
        self.selection = selection
        self.open = open
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
                regularList(ordered, selection: selection)
            } else {
                phoneList(ordered)
            }
        }
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

    // MARK: Mac and iPad, regular width

    private func regularList(_ ordered: (live: [VaultItem], expired: [VaultItem]), selection: Binding<VaultItem.ID?>) -> some View {
        List(selection: selection) {
            ListTitleLine(title: "Cards", count: cards.count == 1 ? String(localized: "1 card") : String(localized: "\(cards.count) cards"))
            ForEach(ordered.live) { regularRow($0) }
            ForEach(ordered.expired) { regularRow($0) }
        }
        #if os(iOS)
        .environment(\.defaultMinListRowHeight, 44)
        .listStyle(.plain)
        #else
        .environment(\.defaultMinListRowHeight, 32)
        .listStyle(.inset)
        #endif
    }

    private func regularRow(_ card: VaultItem) -> some View {
        HStack(spacing: 12) {
            ItemIcon(item: card)
                .alignmentGuide(.listRowSeparatorLeading) { $0[.trailing] + 12 }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: card.displayTitle).lineLimit(1)
                summary(card)
            }
            Spacer(minLength: 0)
        }
        .tag(card.id)
        #if os(iOS)
        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        #else
        .listRowInsets(EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 4))
        #endif
    }

    // MARK: iPhone

    private func phoneList(_ ordered: (live: [VaultItem], expired: [VaultItem])) -> some View {
        List {
            ForEach(ordered.live) { phoneRow($0) }
            if !ordered.expired.isEmpty {
                Section("Expired") {
                    ForEach(ordered.expired) { phoneRow($0) }
                }
            }
        }
        #if os(iOS)
        .environment(\.defaultMinListRowHeight, 44)
        .listStyle(.insetGrouped)
        #endif
    }

    /// The whole row opens the card's page.
    private func phoneRow(_ card: VaultItem) -> some View {
        Button { open(card.id) } label: {
            HStack(spacing: 12) {
                ItemIcon(item: card)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: card.displayTitle).lineLimit(1)
                    summary(card)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(.secondary).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The row's second line, the same on every platform.
    private func summary(_ card: VaultItem) -> some View {
        Text(verbatim: card.cardSummary())
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .accessibilityLabel(Text(verbatim: card.cardSummarySpoken()))
    }
}
