import SwiftUI

/// Every address in the vault, one row per address, A to Z (owner, 2026-11-26, mock `#/address-item`): the tile and the label over
/// the full name and the city. Past five addresses a "Recently used" group leads, as in Cards. A row opens the address's page. Where
/// a selection is given (Mac and iPad at regular width) the page shows beside the list.
struct AddressesView: View {
    let items: [VaultItem]
    /// The selected address, in the split layouts. nil on iPhone, whose rows push the address's page.
    var selection: Binding<VaultItem.ID?>?
    let add: () -> Void

    /// The order and group seen when the list appeared; an address used or edited meanwhile keeps its place until it appears again.
    @State private var rank: [VaultItem.ID: Int]
    @State private var recent: [VaultItem.ID]?
    @State private var picked: SectionedRowID?
    #if os(iOS)
    @State private var showsSafariSteps = false
    #endif

    init(items: [VaultItem], selection: Binding<VaultItem.ID?>? = nil, add: @escaping () -> Void) {
        self.items = items
        self.selection = selection
        self.add = add
        _rank = State(initialValue: Self.snapshot(items).rank)
    }

    private static func snapshot(_ items: [VaultItem]) -> (rank: [VaultItem.ID: Int], recent: [VaultItem.ID]) {
        let ordered = AddressesOrder.ordered(items)
        return (Dictionary(uniqueKeysWithValues: ordered.all.enumerated().map { ($1.id, $0) }), ordered.recent.map(\.id))
    }

    private var addresses: [VaultItem] { items.filter { $0.kind == .address } }

    private var countText: String {
        addresses.count == 1 ? String(localized: "1 address") : String(localized: "\(addresses.count) addresses")
    }

    var body: some View {
        let ordered = AddressesOrder.ordered(addresses, rank: rank, recent: recent)
        Group {
            if let selection {
                List(selection: SectionedRowID.binding(outer: selection, picked: $picked, recent: Set(ordered.recent.map(\.id)))) { rows(ordered) }
            } else {
                List { rows(ordered) }
            }
        }
        .itemListStyle()
        #if os(iOS)
        .modifier(PlaceReminders(showsSteps: $showsSafariSteps))
        #endif
        .overlay {
            if addresses.isEmpty {
                ContentUnavailableView {
                    Label("No addresses yet", systemImage: "mappin.and.ellipse")
                } description: {
                    Text("Save where you live, work or ship to, to copy it into a delivery form. It stays encrypted in your vault.")
                } actions: {
                    Button("Add address", action: add).buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Addresses")
        #if os(iOS)
        .navigationSubtitle(selection == nil && !addresses.isEmpty ? countText : "")
        #endif
        .columnTitleInList(selection != nil)
        .onAppear {
            let seen = Self.snapshot(items)
            rank = seen.rank
            recent = seen.recent
        }
    }

    @ViewBuilder
    private func rows(_ ordered: (recent: [VaultItem], all: [VaultItem])) -> some View {
        #if os(iOS)
        // The reminder cards lead the place, above its title on iPad. An empty place shows its own empty state alone.
        if !addresses.isEmpty { PlaceReminderRow { showsSafariSteps = true } }
        #endif
        if selection != nil { ListTitleLine(title: "Addresses", count: countText) }
        if ordered.recent.isEmpty {
            ForEach(ordered.all) { row($0, in: .all, group: ordered.all) }
        } else {
            Section("Recently used") { ForEach(ordered.recent) { row($0, in: .recent, group: ordered.recent) } }
            Section("All addresses") { ForEach(ordered.all) { row($0, in: .all, group: ordered.all) } }
        }
    }

    @ViewBuilder
    private func row(_ address: VaultItem, in section: SectionedRowID.Section, group: [VaultItem]) -> some View {
        let content = AddressListRow(address: address)
        let (first, last) = (group.first?.id == address.id, group.last?.id == address.id)
        if selection != nil {
            content.tag(SectionedRowID(section: section, id: address.id)).itemRowInsets(first: first, last: last)
        } else {
            NavigationLink(value: address.id) { content }.itemRowInsets(first: first, last: last)
        }
    }
}

/// An address in a list, the same in Addresses and in All (owner, 2026-11-26): the label (else the full name) over the full name and
/// the city. No street: the most private line is not in a list. A part that is missing drops out.
struct AddressListRow: View {
    let address: VaultItem

    var body: some View {
        ItemListRow(item: address, subtitle: address.addressSecondLine.map { Text(verbatim: $0) })
    }
}
