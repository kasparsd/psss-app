import SwiftUI

/// The three places of the vault, the same on every device: All (everything, with the filters), Codes and Cards. Only the control
/// differs: the tab bar at the bottom of an iPhone (and of a compact iPad), the system tab bar at the top of a regular iPad, a
/// segmented control in the toolbar on Mac.
enum VaultPlace: Int, CaseIterable, Identifiable, Hashable {
    case all, codes, cards

    var id: Self { self }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .codes: "Codes"
        case .cards: "Cards"
        }
    }

    var symbol: String {
        switch self {
        case .all: "key"
        case .codes: "lock.badge.clock"
        case .cards: "creditcard"
        }
    }

    /// ⌘1 to ⌘3.
    var shortcut: KeyEquivalent {
        switch self {
        case .all: "1"
        case .codes: "2"
        case .cards: "3"
        }
    }
}

/// Lets the View menu choose the place of the focused window.
private struct VaultPlaceKey: FocusedValueKey {
    typealias Value = Binding<VaultPlace>
}

extension FocusedValues {
    var vaultPlace: Binding<VaultPlace>? {
        get { self[VaultPlaceKey.self] }
        set { self[VaultPlaceKey.self] = newValue }
    }
}

/// View, All / Codes / Cards, with ⌘1 to ⌘3.
struct VaultPlaceCommands: Commands {
    @FocusedValue(\.vaultPlace) private var place

    var body: some Commands {
        CommandGroup(before: .toolbar) {
            ForEach(VaultPlace.allCases) { choice in
                Toggle(isOn: Binding(get: { place?.wrappedValue == choice }, set: { if $0 { place?.wrappedValue = choice } })) {
                    Text(choice.title)
                }
                .keyboardShortcut(choice.shortcut, modifiers: .command)
                .disabled(place == nil)
            }
            Divider()
        }
    }
}
