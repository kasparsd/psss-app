import SwiftUI

extension ItemSort {
    var title: LocalizedStringKey {
        switch self {
        case .recentlyUsed: "Recently used"
        case .mostUsed: "Most used"
        case .recentlyChanged: "Recently changed"
        case .name: "Name"
        }
    }
}

/// The sort control beside Add (owner, 2026-11-24): the standard sort symbol, icon only as in Apple's Passwords, opening a menu whose
/// checkmark shows the order in use. Shown only where the order applies (All, its filters, search results).
struct SortMenu: View {
    @Binding var sort: ItemSort

    var body: some View {
        Menu {
            // An inline picker, so the system draws the checkmark.
            Picker("Sort by", selection: $sort) {
                ForEach(ItemSort.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.inline)
        } label: {
            Label("Sort", systemImage: "arrow.up.arrow.down")
                .labelStyle(.iconOnly)
        }
        .menuIndicator(.hidden)
        .accessibilityLabel("Sort")
        .help("Sort")
    }
}

/// Lets the View menu choose the order of the focused window's list. Nil while the list on screen has no sort of its own.
private struct ItemSortKey: FocusedValueKey {
    typealias Value = Binding<ItemSort>
}

extension FocusedValues {
    var itemSort: Binding<ItemSort>? {
        get { self[ItemSortKey.self] }
        set { self[ItemSortKey.self] = newValue }
    }
}

/// View, Sort By: the same four orders as the Sort menu, with a checkmark on the current one. Off where the sort does not apply.
struct ItemSortCommands: Commands {
    @FocusedValue(\.itemSort) private var sort

    var body: some Commands {
        CommandGroup(before: .toolbar) {
            Menu("Sort By") {
                ForEach(ItemSort.allCases) { choice in
                    Toggle(isOn: Binding(get: { sort?.wrappedValue == choice }, set: { if $0 { sort?.wrappedValue = choice } })) {
                        Text(choice.title)
                    }
                }
            }
            .disabled(sort == nil)
            Divider()
        }
    }
}
