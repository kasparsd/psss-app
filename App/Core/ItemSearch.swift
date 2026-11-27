import Foundation

/// A field a search can be narrowed to (owner, 2026-11-24, mock `#/search-fields`). They are the fields search reads, and no more:
/// notes, tags and secrets stay out of search.
enum SearchField: CaseIterable, Hashable {
    case name, website, username

    var label: String {
        switch self {
        case .name: String(localized: "Name")
        case .website: String(localized: "Website")
        case .username: String(localized: "Username")
        }
    }

    /// The word the line under the title uses: “Found in website or name”.
    var lowercased: String { label.lowercased() }

    /// What the item holds in this field. The name is the one shown for the item, so a nameless card is found by its brand.
    func text(of item: VaultItem) -> [String] {
        switch self {
        // A nameless login's made-up name is its website or username, which have their own pills. (Logins Psss saves from a page
        // get the site as their name, see `SaveWords.newTitle`, so they count under Name.)
        case .name:
            // An address is found by its label, its full name and its city, and never by street, email or phone (owner, 2026-11-26).
            // The name made from a street is not searched either.
            item.kind == .address ? [item.visibleTitle, item.visibleAccount, item.address.city]
                : item.kind == .login ? [item.visibleTitle] : [item.visibleTitle, item.fullName]
        case .website: [item.visibleWebsite]
        // The full name of an address is a Name match, so an address never answers to "Username".
        case .username: item.kind == .address ? [] : [item.visibleAccount]
        }
    }

    /// The order the row's second line looks in when no pill is chosen: the username first, as the row shows it today.
    static let rowOrder: [SearchField] = [.username, .website, .name]
}

/// Which items a search finds: the title, website, username or the name shown for the item (also a name made from what the
/// item holds, such as “Visa •• 4417” or the first line of a note). The vault list and Recently Deleted
/// use the same rule, so typing in Recently Deleted finds exactly what it would find among live items.
enum ItemSearch {
    /// The fields of the item that contain the text. Empty text matches nothing here (use `matches` for the list).
    static func fields(of item: VaultItem, query: String) -> Set<SearchField> {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return Set(SearchField.allCases.filter { field in field.text(of: item).contains { $0.localizedStandardContains(query) } })
    }

    /// Found when any chosen field has the text; with none chosen, any field (more pills show more, never fewer).
    static func matches(_ item: VaultItem, query: String, in chosen: Set<SearchField> = []) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { return true }
        let found = fields(of: item, query: query)
        return chosen.isEmpty ? !found.isEmpty : !found.isDisjoint(with: chosen)
    }

    /// How many items have the text in each field. One item can count in two fields, so the numbers can add to more than the results.
    static func counts(_ items: [VaultItem], query: String) -> [SearchField: Int] {
        var counts = Dictionary(uniqueKeysWithValues: SearchField.allCases.map { ($0, 0) })
        for item in items { for field in fields(of: item, query: query) { counts[field, default: 0] += 1 } }
        return counts
    }

    /// The text to set in bold in a row's name: `query` when Name counts the match, otherwise empty. A nameless login's made-up
    /// name (its website or username) is not a Name match, so nothing in it is bold and it agrees with the Name pill.
    static func nameHighlight(of item: VaultItem, query: String) -> String {
        fields(of: item, query: query).contains(.name) ? query : ""
    }

    /// The field a row shows under its name: a chosen pill's field that matched, otherwise the first that did.
    static func shownField(of item: VaultItem, query: String, chosen: Set<SearchField>) -> SearchField? {
        let found = fields(of: item, query: query)
        let order = SearchField.rowOrder
        return order.first { chosen.contains($0) && found.contains($0) } ?? order.first { found.contains($0) }
    }

    /// The row's second line while searching, as the apps draw it: the field shown, the text of it that holds `query` and the
    /// part to set in bold, as UTF-16 offsets (a web page counts the same way). Nil when no field has the text. The range is nil
    /// when the match is by a looser rule than a plain case and diacritic fold, and the line then has nothing in bold.
    static func hit(of item: VaultItem, query: String, chosen: Set<SearchField>) -> (field: SearchField, text: String, range: Range<Int>?)? {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let field = shownField(of: item, query: query, chosen: chosen),
              let text = field.text(of: item).first(where: { $0.localizedStandardContains(query) }) else { return nil }
        guard let found = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else { return (field, text, nil) }
        let start = text.utf16.distance(from: text.utf16.startIndex, to: found.lowerBound)
        let length = text.utf16.distance(from: found.lowerBound, to: found.upperBound)
        return (field, text, start..<(start + length))
    }

    /// “Found in website or name”, or nil when no pill is chosen.
    static func foundLine(_ chosen: Set<SearchField>) -> String? {
        guard !chosen.isEmpty else { return nil }
        let words = SearchField.allCases.filter(chosen.contains).map(\.lowercased)
        // The list's "or" follows the language the interface is shown in (the one `String(localized:)` picks), not the region of the
        // device: with a Latvian region and an English interface the line read "name vai website".
        let language = Locale(identifier: Bundle.main.preferredLocalizations.first ?? "en")
        return String(localized: "Found in \(words.formatted(.list(type: .or, width: .standard).locale(language)))")
    }
}
