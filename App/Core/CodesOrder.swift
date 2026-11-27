import Foundation

/// How the Codes place lists logins: those with a verification code, A to Z by their name. Pure: no vault, no interface.
enum CodesOrder {
    /// The logins with a code, in the order they came in.
    static func listed(_ items: [VaultItem]) -> [VaultItem] {
        items.filter { $0.traits.contains(.code) }
    }

    /// The login with a code that `id` names: the first in the order the items came in, never the first by name. Two entries of a
    /// file can have the same id.
    static func item(_ id: VaultItem.ID, in items: [VaultItem]) -> VaultItem? {
        items.first { $0.id == id && $0.traits.contains(.code) }
    }

    /// Logins with the same name keep the order they came in. Each name is worked out once, not at every comparison: a login without
    /// a name of its own is called by its website's host, which has to be read from the address.
    static func ordered(_ items: [VaultItem]) -> [VaultItem] {
        listed(items)
            .map { (item: $0, name: $0.fullName) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            .map(\.item)
    }
}
