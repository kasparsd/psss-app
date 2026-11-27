import Foundation

/// How the Addresses place lists addresses (owner, 2026-11-26): A to Z by the name shown, with a "Recently used" group above when
/// more than five are listed, as Cards has. Pure: no vault, no interface.
enum AddressesOrder {
    /// `rank` fixes an order seen earlier and `recent` the group seen earlier, so nothing moves while the list is on screen: an
    /// address they do not know (just added) leads.
    static func ordered(_ items: [VaultItem], rank: [VaultItem.ID: Int]? = nil, recent snapshot: [VaultItem.ID]? = nil,
                        now: Date = .now) -> (recent: [VaultItem], all: [VaultItem]) {
        func before(_ a: VaultItem, _ b: VaultItem) -> Bool {
            if let rank {
                let (x, y) = (rank[a.id] ?? -1, rank[b.id] ?? -1)
                if x != y { return x < y }
            }
            let byName = a.fullName.localizedStandardCompare(b.fullName)
            if byName != .orderedSame { return byName == .orderedAscending }
            return a.id.uuidString < b.id.uuidString
        }
        let all = items.filter { $0.kind == .address }.sorted(by: before)
        return (RecentlyUsed.visible(snapshot: snapshot, in: all, now: now), all)
    }
}
