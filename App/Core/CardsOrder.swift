import Foundation

/// How the Cards place lists cards and describes them (the row's words are the `card…Line` properties below). Pure: no vault, no interface.
enum CardsOrder {
    /// The cards in the order the list shows them (owner, 2026-11-24): a "Recently used" group (up to five live cards used in the
    /// last 30 days, only when more than five live cards are listed), the live cards A to Z, and the expired ones A to Z last. A card
    /// whose expiry cannot be read is not expired. `rank` fixes an order seen earlier and `recent` the group seen earlier, so
    /// nothing moves while the list is on screen: a card they do not know (just added) leads.
    static func ordered(_ cards: [VaultItem], rank: [VaultItem.ID: Int]? = nil, recent snapshot: [VaultItem.ID]? = nil,
                        now: Date = .now, calendar: Calendar = .current) -> (recent: [VaultItem], live: [VaultItem], expired: [VaultItem]) {
        func before(_ a: VaultItem, _ b: VaultItem) -> Bool {
            if let rank {
                let (x, y) = (rank[a.id] ?? -1, rank[b.id] ?? -1)
                if x != y { return x < y }
            }
            let byName = a.fullName.localizedStandardCompare(b.fullName)
            if byName != .orderedSame { return byName == .orderedAscending }
            return a.id.uuidString < b.id.uuidString
        }
        let sorted = cards.filter { $0.kind == .creditCard }.sorted(by: before)
        let expired = sorted.filter { $0.isExpiredCard(now: now, calendar: calendar) }
        let live = sorted.filter { !$0.isExpiredCard(now: now, calendar: calendar) }
        return (RecentlyUsed.visible(snapshot: snapshot, in: live, now: now), live, expired)
    }
}

extension VaultItem {
    /// A card past its expiry month. No expiry, or one that cannot be read, is not expired.
    func isExpiredCard(now: Date = .now, calendar: Calendar = .current) -> Bool {
        guard kind == .creditCard, let expiry = CardExpiry.parse(expiry) else { return false }
        return expiry.isPast(now: now, calendar: calendar)
    }

    /// The card row's second line, under its name. A card with a name of its own: the short brand name ("Visa", "Mastercard",
    /// "Amex"), "Card" when the network is not known. A card without one is already called by its brand and last four digits
    /// ("Visa \u{2022}\u{2022} 4417"), so its second line is the name on the card instead, and nothing when there is none (owner,
    /// 2026-11-24). A card past its expiry adds "Expired": "Visa · Expired", "Sam Rivera · Expired", or "Expired" alone. Nil when
    /// there is nothing to say. The number and the expiry are the row's trailing block, see `cardNumberLine` and `cardExpiryLine`.
    func cardSecondLine(now: Date = .now, calendar: Calendar = .current) -> String? {
        let holder = DisplayText.safe(visibleAccount)
        let lead: String? = visibleTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (holder.isEmpty ? nil : holder)
            : CardBrand(number: CardNumber.normalized(secret))?.shortName ?? String(localized: "Card")
        let parts = [lead, isExpiredCard(now: now, calendar: calendar) ? String(localized: "Expired") : nil].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// The trailing block's first line: two bullets and the last four digits ("\u{2022}\u{2022} 4417"). Nil without a number of four digits.
    var cardNumberLine: String? {
        let digits = CardNumber.normalized(secret)
        return digits.count >= 4 ? "\u{2022}\u{2022} \(digits.suffix(4))" : nil
    }

    /// The trailing block's second line: the expiry as MM/YY, also for an expired card. Nil when there is none or it cannot be read.
    var cardExpiryLine: String? { CardExpiry.parse(expiry)?.formatted }

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
