import Foundation

/// The order of the All list, its filters and search results (owner, 2026-11-24). A view setting kept on the device: it changes
/// nothing in the vault. Codes, Cards and Recently Deleted keep their own orders. Pure: no vault, no interface.
enum ItemSort: String, CaseIterable, Identifiable, Sendable {
    /// What the list opens with: a "Recently used" group of up to five (`RecentlyUsed`), then every item A to Z. As an order of the
    /// whole list it is the name order; the group is added by the list itself, and only in this order.
    case recentlyUsed
    /// `useCount` descending; ties and zero by name.
    case mostUsed
    /// `modified` descending; items without a date after them, by name.
    case recentlyChanged
    /// The display title, in the person's language (`localizedStandardCompare`).
    case name

    var id: Self { self }

    static let standard: Self = .recentlyUsed

    /// How the second line under a list's title names this order, lower case: nil for the default, which is not named there.
    var orderPhrase: String? {
        switch self {
        case .recentlyUsed: nil
        case .mostUsed: String(localized: "most used first")
        case .recentlyChanged: String(localized: "recently changed first")
        case .name: String(localized: "by name")
        }
    }

    /// Where the choice is remembered (`@AppStorage`, `UserDefaults`).
    static let storageKey = "itemSort"

    /// Whether `a` comes before `b`. A total order: what the key cannot tell apart is put by name, then by id, so the same items
    /// always list the same way.
    func precedes(_ a: VaultItem, _ b: VaultItem) -> Bool {
        switch self {
        case .recentlyUsed, .name:
            break
        case .mostUsed:
            if a.useCount != b.useCount { return a.useCount > b.useCount }
        case .recentlyChanged:
            if let order = Self.newerFirst(a.modified, b.modified) { return order }
        }
        let byName = a.fullName.localizedStandardCompare(b.fullName)
        if byName != .orderedSame { return byName == .orderedAscending }
        return a.id.uuidString < b.id.uuidString
    }

    /// Later dates first and a missing date last. Nil when the two cannot be told apart by date.
    private static func newerFirst(_ a: Date?, _ b: Date?) -> Bool? {
        switch (a, b) {
        case let (x?, y?): x == y ? nil : x > y
        case (_?, nil): true
        case (nil, _?): false
        case (nil, nil): nil
        }
    }

    /// `items` in this order. With `rank`, an order seen earlier (see `ranks(of:)`): an item it knows keeps its place and one it does
    /// not know (just added) leads, ties going by this order. The list uses it so nothing moves while it is on screen.
    func ordered(_ items: [VaultItem], rank: [VaultItem.ID: Int]? = nil) -> [VaultItem] {
        items.sorted { a, b in
            if let rank {
                let (x, y) = (rank[a.id] ?? -1, rank[b.id] ?? -1)
                if x != y { return x < y }
            }
            return precedes(a, b)
        }
    }

    /// The place of every item in this order, to hold it still while the list is on screen.
    func ranks(of items: [VaultItem]) -> [VaultItem.ID: Int] {
        Dictionary(uniqueKeysWithValues: ordered(items).enumerated().map { ($1.id, $0) })
    }
}
