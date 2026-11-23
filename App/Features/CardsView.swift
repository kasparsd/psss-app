import SwiftUI

/// The fields of a card that Cards lets a person copy, in the order a checkout asks for them.
private enum CardField: Hashable, CaseIterable {
    case number, expiry, securityCode, nameOnCard

    var name: String {
        switch self {
        case .number: String(localized: "Number")
        case .expiry: String(localized: "Expiry")
        case .securityCode: String(localized: "Security code")
        case .nameOnCard: String(localized: "Name on card")
        }
    }

    /// What the card's row shows. The number and the security code stay masked: this list is for copying, and revealing stays on the
    /// card's page.
    func shown(for card: VaultItem) -> String {
        switch self {
        case .number: card.maskedSecret
        case .expiry: card.expiry
        case .securityCode: VaultItem.hiddenMask
        case .nameOnCard: card.account
        }
    }

    /// What Copy puts on the clipboard. Empty when the field was never filled in, and then it has no row.
    func value(of card: VaultItem) -> String {
        switch self {
        case .number: card.secret
        case .expiry: card.expiry
        case .securityCode: card.securityCode
        case .nameOnCard: card.account
        }
    }
}

/// Which field of which card says "Copied", and the haptic. Keyed by the card's id, so a change of selection or a redraw of the list
/// never resets it.
@MainActor
@Observable
private final class CardCopyState {
    struct Key: Hashable { let id: VaultItem.ID; let field: CardField }

    private(set) var copied: Key?
    private(set) var count = 0
    private var reset: Task<Void, Never>?

    /// Copies the same way as a password (local only, concealed on Mac, gone after 60 seconds), counts it as using the card and says
    /// "Copied" for about two seconds.
    func copy(_ value: String, key: Key, used: () -> Void) {
        Clipboard.copy(value)
        used()
        copied = key
        count += 1
        AccessibilityNotification.Announcement(String(localized: "Copied")).post()
        reset?.cancel()
        reset = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled { self?.copied = nil }
        }
    }
}

/// Every card in the vault. On iPhone, a group per card with a labeled Copy beside each field, so a checkout's four fields are four
/// taps. Where a selection is given (Mac and iPad at regular width) it is the list of cards, with the card's page beside it.
struct CardsView: View {
    let items: [VaultItem]
    /// The selected card, in the split layouts. nil on iPhone, whose rows copy and whose card name opens the page.
    var selection: Binding<VaultItem.ID?>?
    let open: (VaultItem.ID) -> Void
    /// A field was copied: the card counts as used.
    let used: (VaultItem.ID) -> Void
    let add: () -> Void

    @State private var copy = CardCopyState()
    /// The order seen when the list appeared. Cards used or edited meanwhile keep their place until it appears again.
    @State private var rank: [VaultItem.ID: Int]

    init(items: [VaultItem], selection: Binding<VaultItem.ID?>? = nil, open: @escaping (VaultItem.ID) -> Void,
         used: @escaping (VaultItem.ID) -> Void, add: @escaping () -> Void) {
        self.items = items
        self.selection = selection
        self.open = open
        self.used = used
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
        #if os(macOS)
        .navigationSubtitle(cards.count == 1 ? "1 card" : "\(cards.count) cards")
        #else
        .sensoryFeedback(.success, trigger: copy.count)
        #endif
        .onAppear { rank = Self.snapshot(items) }
    }

    // MARK: Mac and iPad, regular width

    private func regularList(_ ordered: (live: [VaultItem], expired: [VaultItem]), selection: Binding<VaultItem.ID?>) -> some View {
        List(selection: selection) {
            ForEach(ordered.live) { regularRow($0, expired: false) }
            ForEach(ordered.expired) { regularRow($0, expired: true) }
        }
        #if os(iOS)
        .environment(\.defaultMinListRowHeight, 44)
        .listStyle(.plain)
        #else
        .environment(\.defaultMinListRowHeight, 32)
        .listStyle(.inset)
        #endif
    }

    private func regularRow(_ card: VaultItem, expired: Bool) -> some View {
        HStack(spacing: 12) {
            ItemIcon(item: card)
                .alignmentGuide(.listRowSeparatorLeading) { $0[.trailing] + 12 }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: card.displayTitle).lineLimit(1)
                if expired {
                    Text("Expired").foregroundStyle(.secondary).lineLimit(1)
                } else {
                    Text(verbatim: card.cardSummary).foregroundStyle(.secondary).lineLimit(1)
                }
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
            ForEach(ordered.live) { card in
                Section {
                    header(card, detail: Text(verbatim: card.cardSummary))
                    ForEach(CardField.allCases, id: \.self) { field in
                        if !field.value(of: card).isEmpty { fieldRow(field, of: card) }
                    }
                }
            }
            if !ordered.expired.isEmpty {
                Section("Expired") {
                    ForEach(ordered.expired) { card in
                        header(card, detail: Text("Expired in \(card.cardExpiryMonthYear ?? ""). Open it to update or delete it."),
                               lines: 3)
                    }
                }
            }
            if !cards.isEmpty {
                Text("Tap Copy beside a field. Tap the card's name to open it.")
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
        }
        #if os(iOS)
        .environment(\.defaultMinListRowHeight, 44)
        .listStyle(.insetGrouped)
        #endif
    }

    /// The card's name and type. It opens the card; the fields below it copy.
    private func header(_ card: VaultItem, detail: Text, lines: Int = 1) -> some View {
        Button { open(card.id) } label: {
            HStack(spacing: 12) {
                ItemIcon(item: card)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: card.displayTitle).lineLimit(1)
                    detail.foregroundStyle(.secondary).lineLimit(lines)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(.secondary).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the card")
    }

    private func fieldRow(_ field: CardField, of card: VaultItem) -> some View {
        let key = CardCopyState.Key(id: card.id, field: field)
        let copied = copy.copied == key
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(verbatim: field.name).foregroundStyle(.secondary)
                    if field == .securityCode { InfoButton(topic: HelpTopics.securityCode) }
                }
                Text(verbatim: field.shown(for: card)).lineLimit(1)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: field.name))
            .accessibilityValue(field == .number || field == .securityCode ? Text("Hidden") : Text(verbatim: field.shown(for: card)))
            Spacer(minLength: 8)
            Button {
                copy.copy(field.value(of: card), key: key, used: { used(card.id) })
            } label: {
                // Both words are laid out, so the button keeps its width while it says "Copied".
                ZStack {
                    Text("Copy").opacity(copied ? 0 : 1)
                    Text("Copied").opacity(copied ? 1 : 0)
                }
                .fixedSize()
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .accessibilityLabel("Copy \(field.name) of \(card.displayTitle)")
            .accessibilityValue(copied ? Text("Copied") : Text(verbatim: ""))
        }
    }
}
