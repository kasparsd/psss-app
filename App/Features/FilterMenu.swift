import SwiftUI

extension ItemWith {
    var title: LocalizedStringKey { self == .passkey ? "Passkey" : "Notes" }
}

extension VaultDestination {
    /// The sidebar row, and the list's title.
    var title: String {
        switch self {
        case .all, .logins, .notes, .custom: show?.title ?? ""
        case .codes: String(localized: "Codes")
        case .cards: String(localized: "Cards")
        case .addresses: String(localized: "Addresses")
        case .wifi: String(localized: "Wi-Fi")
        case .recentlyDeleted: String(localized: "Recently Deleted")
        }
    }

    var symbol: String {
        switch self {
        case .all: VaultPlace.all.symbol
        case .codes: VaultPlace.codes.symbol
        case .cards: VaultPlace.cards.symbol
        case .addresses: VaultPlace.addresses.symbol
        case .wifi: VaultPlace.wifi.symbol
        case .logins: ItemKind.login.symbol
        case .notes: ItemKind.secureNote.symbol
        case .custom: ItemKind.keePassEntry.symbol
        case .recentlyDeleted: "trash"
        }
    }
}

/// The Filter control beside Sort (owner, 2026-11-24): the standard filter symbol, icon only, opening a menu with what to show and what
/// an item must also have, each group under its heading ("Show", "With"). Filled in the accent colour while this menu narrows the
/// list; sorting alone never fills it.
struct FilterMenu: View {
    enum Scope {
        /// iPhone: Show the kinds and With. Recently Deleted is in the More tab (owner, 2026-11-24).
        case kinds
        /// Mac and iPad with the sidebar hidden: Show lists every place too, so nothing is out of reach.
        case everyPlace
        /// Mac and iPad with the sidebar visible: the sidebar chooses what to show, so only With.
        case withOnly
    }

    let scope: Scope
    let destination: Binding<VaultDestination?>
    @Binding var filter: ItemFilter

    private var current: VaultDestination? { destination.wrappedValue }
    /// Show and With describe the All list; they do not apply while Codes, Cards or Recently Deleted is showing.
    private var describesList: Bool { current?.show != nil }
    /// The button looks filled while something chosen in this menu narrows the list. With the sidebar visible the kind is the
    /// sidebar's choice, not this menu's, so only a ticked entry that applies fills it.
    private var narrowing: Bool {
        guard describesList else { return false }
        return scope == .withOnly ? !filter.applied.isEmpty : filter.isNarrowing
    }

    private var shown: [VaultDestination] {
        scope == .everyPlace ? VaultDestination.allCases : [.all, .logins, .notes, .custom]
    }

    var body: some View {
        Menu {
            if scope != .withOnly {
                // Checkable entries under a Section, like With below: an inline Picker in a Section drops the heading on iPhone.
                Section("Show") {
                    ForEach(shown, id: \.self) { row in
                        Toggle(isOn: Binding(get: { current == row }, set: { if $0 { destination.wrappedValue = row } })) {
                            Text(verbatim: row.title)
                        }
                    }
                }
            }
            Section("With") {
                ForEach(ItemWith.entries, id: \.rawValue) { entry in
                    Toggle(isOn: Binding(get: { filter.with.contains(entry) },
                                         set: { if $0 { filter.with.insert(entry) } else { filter.with.remove(entry) } })) {
                        Text(entry.title)
                    }
                    .disabled(!describesList || !filter.applies(entry))
                    #if os(iOS)
                    // The menu stays open while ticking. A Mac menu has no such setting and closes, as Mac menus do.
                    .menuActionDismissBehavior(.disabled)
                    #endif
                }
            }
        } label: {
            // One view structure whether the list is narrowed or not: both symbols are always there and only their opacity changes.
            // A label that swapped its image for another (or changed its symbol variant) made iPhone rebuild the toolbar item, which
            // closed the open menu at the first tick from the plain list.
            #if os(iOS)
            ZStack {
                Image(systemName: "line.3.horizontal.decrease")
                    .opacity(narrowing ? 0 : 1)
                Image(systemName: "line.3.horizontal.decrease.circle.fill")
                    .foregroundStyle(Color.accentColor)
                    .opacity(narrowing ? 1 : 0)
            }
            .accessibilityHidden(true)
            #else
            Label("Filter", systemImage: "line.3.horizontal.decrease")
                .labelStyle(.iconOnly)
                .symbolVariant(narrowing ? .circle.fill : .none)
                .foregroundStyle(narrowing ? Color.accentColor : Color.primary)
            #endif
        }
        .menuIndicator(.hidden)
        .accessibilityLabel("Filter")
        .accessibilityValue(narrowing ? Text("On") : Text("Off"))
        .help("Filter")
    }
}

/// Lets the View menu choose what the focused window's All list shows. Nil while the list on screen has no Show and With.
private struct ItemFilterKey: FocusedValueKey {
    typealias Value = Binding<ItemFilter>
}

extension FocusedValues {
    var itemFilter: Binding<ItemFilter>? {
        get { self[ItemFilterKey.self] }
        set { self[ItemFilterKey.self] = newValue }
    }
}

/// View, Show (the kinds, with a checkmark on the current one) and With (Passkey, Notes as checkable items).
struct ItemFilterCommands: Commands {
    @FocusedValue(\.itemFilter) private var filter

    var body: some Commands {
        CommandGroup(before: .toolbar) {
            Menu("Show") {
                ForEach(ItemShow.allCases) { choice in
                    Toggle(isOn: Binding(get: { filter?.wrappedValue.show == choice },
                                         set: { if $0 { filter?.wrappedValue.show = choice } })) {
                        Text(verbatim: choice.title)
                    }
                }
            }
            .disabled(filter == nil)
            Menu("With") {
                ForEach(ItemWith.entries, id: \.rawValue) { entry in
                    Toggle(isOn: Binding(get: { filter?.wrappedValue.with.contains(entry) == true },
                                         set: { on in
                        if on { filter?.wrappedValue.with.insert(entry) } else { filter?.wrappedValue.with.remove(entry) }
                    })) {
                        Text(entry.title)
                    }
                    .disabled(filter?.wrappedValue.applies(entry) != true)
                }
            }
            .disabled(filter == nil)
            Divider()
        }
    }
}

/// A row of a list in which an item can stand in two sections: "Recently used" and the complete list below it. A row is named by its
/// section too, so the list's selection never sees two rows with one tag and highlights only one.
struct SectionedRowID: Hashable {
    enum Section { case recent, all }
    let section: Section
    let id: VaultItem.ID

    /// The list selects rows; the screen keeps the selected item's id. This maps one to the other. An item chosen without a click on
    /// a row (the first row opens by itself) is shown in the group when it is in it.
    static func binding(outer: Binding<VaultItem.ID?>, picked: Binding<SectionedRowID?>, recent: Set<VaultItem.ID>) -> Binding<SectionedRowID?> {
        Binding(get: {
            guard let id = outer.wrappedValue else { return nil }
            if let row = picked.wrappedValue, row.id == id, row.section == .all || recent.contains(id) { return row }
            return SectionedRowID(section: recent.contains(id) ? .recent : .all, id: id)
        }, set: {
            picked.wrappedValue = $0
            outer.wrappedValue = $0?.id
        })
    }
}
