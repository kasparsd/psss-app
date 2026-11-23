import Foundation

/// How the Cards place lists cards and describes them. Pure: no vault, no interface.
enum CardsOrder {
    /// Live cards, last used first (then A to Z), and expired cards after them, in the same order. A card whose expiry cannot be
    /// read is not expired. `rank` fixes an order seen earlier: a card it knows keeps its place, one it does not know (just added)
    /// leads. The list uses it so nothing moves while it is on screen.
    static func ordered(_ cards: [VaultItem], rank: [VaultItem.ID: Int]? = nil, now: Date = .now,
                        calendar: Calendar = .current) -> (live: [VaultItem], expired: [VaultItem]) {
        func before(_ a: VaultItem, _ b: VaultItem) -> Bool {
            if let rank {
                let (x, y) = (rank[a.id] ?? -1, rank[b.id] ?? -1)
                if x != y { return x < y }
            }
            let (used, other) = (a.lastUsed ?? .distantPast, b.lastUsed ?? .distantPast)
            if used != other { return used > other }
            return a.displayTitle.localizedStandardCompare(b.displayTitle) == .orderedAscending
        }
        let sorted = cards.filter { $0.kind == .creditCard }.sorted(by: before)
        let expired = sorted.filter { $0.isExpiredCard(now: now, calendar: calendar) }
        return (sorted.filter { !$0.isExpiredCard(now: now, calendar: calendar) }, expired)
    }
}

extension VaultItem {
    /// A card past its expiry month. No expiry, or one that cannot be read, is not expired.
    func isExpiredCard(now: Date = .now, calendar: Calendar = .current) -> Bool {
        guard kind == .creditCard, let expiry = CardExpiry.parse(expiry) else { return false }
        return expiry.isPast(now: now, calendar: calendar)
    }

    /// "Visa ending 4417". Without a known network, "Card ending 4417"; without a number, "Card".
    var cardSummary: String {
        let digits = CardNumber.normalized(secret)
        guard digits.count >= 4 else { return String(localized: "Card") }
        let last = String(digits.suffix(4))
        let network = CardBrand(number: digits)?.name ?? String(localized: "Card")
        return String(localized: "\(network) ending \(last)")
    }

    /// "March 2025" for the card's expiry month, in the Gregorian calendar a card's year belongs to. Nil when unreadable.
    var cardExpiryMonthYear: String? {
        guard let expiry = CardExpiry.parse(expiry) else { return nil }
        let calendar = Calendar(identifier: .gregorian)
        guard let date = calendar.date(from: DateComponents(year: expiry.year, month: expiry.month, day: 1)) else { return nil }
        var style = Date.FormatStyle(date: .omitted, time: .omitted).month(.wide).year()
        style.calendar = calendar
        return date.formatted(style)
    }
}
