import SwiftUI

/// The places of the vault, the same on every device: All (everything, narrowed by Show and With), Codes and Cards. Only the
/// control differs: the tab bar at the bottom of an iPhone (and of a compact iPad), the sidebar on Mac and a regular iPad.
enum VaultPlace: Int, CaseIterable, Identifiable, Hashable {
    case all, codes, cards, wifi

    var id: Self { self }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .codes: "Codes"
        case .cards: "Cards"
        case .wifi: "Wi-Fi"
        }
    }

    var symbol: String {
        switch self {
        case .all: "square.stack"
        case .codes: "lock.badge.clock"
        case .cards: "creditcard"
        case .wifi: "wifi"
        }
    }

    /// ⌘1 to ⌘4.
    var shortcut: KeyEquivalent {
        switch self {
        case .all: "1"
        case .codes: "2"
        case .cards: "3"
        case .wifi: "4"
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
