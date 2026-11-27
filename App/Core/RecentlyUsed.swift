import Foundation

/// The "Recently used" group at the top of All, Codes and Cards (owner, 2026-11-24): up to five items used in the last 30 days, most
/// recently used first. Pure: no vault, no interface. `lastUsed` is set by every use, including copying a verification code.
enum RecentlyUsed {
    /// The most items the group holds.
    static let limit = 5
    /// An item used longer ago than this is not recent.
    static let days = 30

    /// The oldest use that still counts as recent.
    static func cutoff(now: Date = .now) -> Date { now.addingTimeInterval(-Double(days) * 86_400) }

    /// The group of `items` (the list it will sit above): those used since the cutoff, newest use first, at most `limit`. Equal times
    /// go by name, then id, so the same items always give the same group.
    static func group(from items: [VaultItem], now: Date = .now) -> [VaultItem] {
        let from = cutoff(now: now)
        let recent = items.compactMap { item -> (VaultItem, Date)? in
            guard let used = item.lastUsed, used >= from else { return nil }
            return (item, used)
        }
        let ordered = recent.sorted { a, b in
            if a.1 != b.1 { return a.1 > b.1 }
            let byName = a.0.fullName.localizedStandardCompare(b.0.fullName)
            if byName != .orderedSame { return byName == .orderedAscending }
            return a.0.id.uuidString < b.0.id.uuidString
        }
        return Array(ordered.prefix(limit).map(\.0))
    }

    /// A group that only repeats a short list is noise: it shows only above a list of more than `limit` items.
    static func isWorthShowing(listCount: Int) -> Bool { listCount > limit }

    /// What the group shows now. `snapshot` is the group as it was when the list appeared (ids, in order): items that are still in
    /// `listed` keep their place and nothing joins, so nothing moves while the list is on screen. Without a snapshot the group is
    /// taken now. Empty when the list is too short for a group.
    static func visible(snapshot: [VaultItem.ID]?, in listed: [VaultItem], now: Date = .now) -> [VaultItem] {
        guard isWorthShowing(listCount: listed.count) else { return [] }
        let ids = snapshot ?? group(from: listed, now: now).map(\.id)
        let byID = Dictionary(listed.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return ids.compactMap { byID[$0] }
    }
}
