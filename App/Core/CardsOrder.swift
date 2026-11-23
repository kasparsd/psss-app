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

    /// The card row's second line. A live card: "Visa •• 4417 · 08/28" (network, two bullets and the last four, expiry as MM/YY);
    /// a part that is missing is dropped with its separator ("Visa •• 4417", "•• 4417 · 08/28"). An expired card: "Expired 03/25".
    func cardSummary(now: Date = .now, calendar: Calendar = .current) -> String {
        let expiry = CardExpiry.parse(expiry)
        if isExpiredCard(now: now, calendar: calendar), let expiry {
            return String(localized: "Expired \(expiry.formatted)")
        }
        let digits = CardNumber.normalized(secret)
        var number: [String] = []
        if let network = CardBrand(number: digits)?.shortName { number.append(network) }
        if digits.count >= 4 { number.append("\u{2022}\u{2022} \(digits.suffix(4))") }
        let segments = [number.joined(separator: " "), expiry?.formatted ?? ""].filter { !$0.isEmpty }
        return segments.isEmpty ? String(localized: "Card") : segments.joined(separator: " \u{00B7} ")
    }

    /// What VoiceOver reads for the row's second line: "Visa ending 4417, expires 08/28" or "Expired March 2025".
    func cardSummarySpoken(now: Date = .now, calendar: Calendar = .current) -> String {
        if isExpiredCard(now: now, calendar: calendar), let month = cardExpiryMonthYear {
            return String(localized: "Expired \(month)")
        }
        let digits = CardNumber.normalized(secret)
        var parts: [String] = []
        let network = CardBrand(number: digits)?.name
        if digits.count >= 4 {
            let last = String(digits.suffix(4))
            parts.append(network.map { String(localized: "\($0) ending \(last)") } ?? String(localized: "Card ending \(last)"))
        } else if let network {
            parts.append(network)
        }
        if let expiry = CardExpiry.parse(expiry) { parts.append(String(localized: "expires \(expiry.formatted)")) }
        return parts.isEmpty ? String(localized: "Card") : parts.joined(separator: ", ")
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
