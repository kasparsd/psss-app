import Foundation

/// Makes a Safari fill grant from an unlocked vault's items: the cards and addresses, and of those only the values a form is
/// filled with. App only; the extension reads the grant and never sees a `VaultItem`.
///
/// A wrong or expired value in a form is worse than a missing card, so a card goes in only when its text is plainly one thing:
///
/// - Expiry: stored text with no digit of any script (or none at all) means a card without an expiry. Text that `CardExpiry.parse`
///   reads, and that is not past, is sent. Any other text with a digit in it leaves the card out, full dates included.
/// - Number: one Luhn-valid number of 12 to 19 ASCII digits, unbroken or in a listed grouping (see `number`). Gift and store
///   cards that fail the Luhn check are left out.
///
/// Also left out: every other kind of item, entries the file says have expired, items that share an identifier, an address with
/// nothing to fill, a security code that is not 3 or 4 digits, and of each item the PIN, valid from, issuer, website, notes,
/// other fields and any value the file conceals (the card's number and security code excepted, as they are what a card fill is
/// for). Recently Deleted items are never in a store's `items()`, which is what the caller passes.
enum SafariFillSnapshot {
    struct Result: Sendable {
        let grant: SafariFillGrant
        /// How many cards and addresses did not fit the caps, plus unexpired cards whose number or expiry could not be taken as
        /// written. Only this number may be logged.
        let leftOut: Int
    }

    /// An item with a value over the length cap, or that no longer fits the count or size caps, is left out whole: a cut value
    /// would fill wrong data. The most recently used go in first, cards and addresses in turn, so neither crowds out the other.
    /// Only the vault's name, which is shown and never filled, is cut to the length cap.
    static func make(vaultID: UUID, vaultName: String, items: [VaultItem], clock: some SafariFillClock = SystemSafariFillClock(),
                     calendar: Calendar = .current) throws -> Result {
        let name = String(String.UnicodeScalarView(vaultName.unicodeScalars.prefix(SafariFillGrant.maxCharacters)))
        var grant = SafariFillGrant(vault: .init(id: vaultID, name: name), clock: clock)
        let now = Date(timeIntervalSince1970: Double(grant.issuedWall) / 1000)
        // An identifier on two items would name two entries, and nothing says which is meant: neither goes in.
        let uses = Dictionary(items.map { ($0.id, 1) }, uniquingKeysWith: +)
        let ordered = items.filter { uses[$0.id] == 1 && $0.expires.map { $0 > now } != false }.sorted(by: before)
        var cards: [SafariFillGrant.Card] = []
        var leftOut = 0
        for item in ordered where item.kind == .creditCard {
            switch candidate(from: item, now: now, calendar: calendar) {
            case .card(let card): cards.append(card)
            case .unreadable: leftOut += 1
            case .expired: break
            }
        }
        let addresses = ordered.compactMap(address)

        var size = try grant.encoded().count
        /// Adds the entry when it is within every cap. Its cost is its own bytes and the comma before it.
        func add<Entry: Encodable>(_ entry: Entry, to list: inout [Entry], limit: Int, valid: Bool) throws {
            guard valid, list.count < limit else { leftOut += 1; return }
            let cost = try SafariFillGrant.bytes(of: entry).count + (list.isEmpty ? 0 : 1)
            guard size + cost <= SafariFillGrant.maxBytes else { leftOut += 1; return }
            size += cost
            list.append(entry)
        }
        for index in 0..<max(cards.count, addresses.count) {
            if index < cards.count {
                try add(cards[index], to: &grant.cards, limit: SafariFillGrant.maxCards, valid: cards[index].isWithinCaps)
            }
            if index < addresses.count {
                try add(addresses[index], to: &grant.addresses, limit: SafariFillGrant.maxAddresses, valid: addresses[index].isWithinCaps)
            }
        }
        return Result(grant: grant, leftOut: leftOut)
    }

    private static func before(_ a: VaultItem, _ b: VaultItem) -> Bool {
        let (first, second) = (a.lastUsed ?? .distantPast, b.lastUsed ?? .distantPast)
        if first != second { return first > second }
        let names = a.visibleTitle.localizedStandardCompare(b.visibleTitle)
        if names != .orderedSame { return names == .orderedAscending }
        return a.id.uuidString < b.id.uuidString
    }

    /// The value, or nothing when the file conceals the field it came from.
    private static func shown(_ value: String, _ slot: String, of item: VaultItem) -> String {
        item.concealedFields?.contains(slot) == true ? "" : value
    }

    private enum Candidate {
        case card(SafariFillGrant.Card), expired, unreadable
    }

    private static func candidate(from item: VaultItem, now: Date, calendar: Calendar) -> Candidate {
        let expiry = CardExpiry.parse(item.expiry)
        if let expiry {
            if expiry.isPast(now: now, calendar: calendar) { return .expired }
        } else if item.expiry.unicodeScalars.contains(where: { $0.properties.numericType != nil }) {
            return .unreadable
        }
        guard let number = number(item.secret) else { return .unreadable }
        let month = item.concealedFields?.contains("expiry") == true ? nil : expiry.map { String(format: "%04d-%02d", $0.year, $0.month) }
        let code = item.securityCode.trimmingCharacters(in: .whitespacesAndNewlines)
        return .card(SafariFillGrant.Card(
            id: item.id, title: item.visibleTitle, brand: CardBrand(number: number)?.name ?? "", cardholder: item.visibleAccount,
            number: number, expiry: month,
            securityCode: SafariFillGrant.isDigits(code, count: SafariFillGrant.securityCodeDigits) ? code : nil))
    }

    /// The printed layouts a grouped number may have. 4-4-4 and 4-4-4-x are not listed: they cannot be told from a number with a
    /// group missing, or from a short number with a code after it.
    private static let groupings: Set<[Int]> = [
        [4, 4, 4, 4], [4, 6, 5], [4, 6, 4], [4, 4, 4, 4, 1], [4, 4, 4, 4, 2], [4, 4, 4, 4, 3], [6, 13],
    ]

    /// The card number's digits, when the whole field is one number: 12 to 19 ASCII digits, unbroken or in one of `groupings`
    /// with one space or one dash (the same throughout) between groups, passing the Luhn check. Nothing is trimmed or dropped.
    ///
    /// Two groupings can also be a shorter card with a code typed after it, and are refused when the leading digits are a valid
    /// number on their own, at the price of some genuine cards:
    /// - 4-4-4-4-x whose first 16 digits pass the Luhn check;
    /// - 4-4-4-4 whose first 12 pass it, unless the network is a known one without 12-digit numbers (every known one but Maestro).
    private static func number(_ text: String) -> String? {
        let separator: Character = text.contains("-") ? "-" : " "
        let groups = text.split(separator: separator, omittingEmptySubsequences: false)
        let number = groups.joined()
        // `isDigits` also rejects any other character, a second kind of separator included.
        guard SafariFillGrant.isDigits(number, count: SafariFillGrant.numberDigits), !groups.contains(where: \.isEmpty),
              CardNumber.isValidLuhn(number) else { return nil }
        guard groups.count > 1 else { return number }
        let sizes = groups.map(\.count)
        guard groupings.contains(sizes) else { return nil }
        if sizes.count == 5, CardNumber.isValidLuhn(String(number.prefix(16))) { return nil }
        if sizes == [4, 4, 4, 4], CardNumber.isValidLuhn(String(number.prefix(12))) {
            let brand = CardBrand(number: number)
            if brand == nil || brand == .maestro { return nil }
        }
        return number
    }

    private static func address(from item: VaultItem) -> SafariFillGrant.Address? {
        guard item.kind == .address else { return nil }
        let place = item.address
        let address = SafariFillGrant.Address(
            id: item.id, label: item.visibleTitle, fullName: item.visibleAccount,
            organization: shown(place.organization, "addressOrganization", of: item),
            street: shown(place.street, "addressStreet", of: item),
            city: shown(place.city, "addressCity", of: item),
            region: shown(place.region, "addressRegion", of: item),
            postalCode: shown(place.postalCode, "addressPostalCode", of: item),
            country: shown(place.country, "addressCountry", of: item),
            email: shown(place.email, "addressEmail", of: item),
            phone: shown(place.phone, "addressPhone", of: item))
        // The label names the row and is never filled.
        return address.strings.dropFirst().allSatisfy(\.isEmpty) ? nil : address
    }
}
