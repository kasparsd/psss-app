import Foundation

/// What the All list shows by kind (owner, 2026-11-24): exactly one. Cards are a place of their own, so they are not a choice here.
enum ItemShow: String, CaseIterable, Identifiable, Sendable {
    case all, logins, notes, custom

    var id: Self { self }

    /// Where the choice is remembered (`@AppStorage`, `UserDefaults`).
    static let storageKey = "itemShow"

    /// The kind this choice lists. Nil for All.
    var kind: ItemKind? {
        switch self {
        case .all: nil
        case .logins: .login
        case .notes: .secureNote
        case .custom: .keePassEntry
        }
    }

    /// The choice that lists `kind`. Nil for cards, which have their own place.
    init?(kind: ItemKind) {
        switch kind {
        case .login: self = .logins
        case .secureNote: self = .notes
        case .keePassEntry: self = .custom
        case .creditCard, .wifi: return nil
        }
    }

    func includes(_ item: VaultItem) -> Bool { kind.map { item.kind == $0 } ?? true }

    /// The kind's one plural name (owner, 2026-11-24): the list's title, the sidebar row, the Show menu and the View menu all say it.
    var title: String {
        switch self {
        case .all: String(localized: "All")
        case .logins: String(localized: "Logins")
        case .notes: String(localized: "Notes")
        case .custom: String(localized: "Custom items")
        }
    }

    /// What is listed, lower case, for a sentence: "No custom items".
    var noun: String {
        switch self {
        case .all: String(localized: "items")
        case .logins: String(localized: "logins")
        case .notes: String(localized: "notes")
        case .custom: String(localized: "custom items")
        }
    }

    /// The heading of the complete list under "Recently used".
    var allHeading: String {
        switch self {
        case .all: String(localized: "All items")
        case .logins: String(localized: "All logins")
        case .notes: String(localized: "All notes")
        case .custom: String(localized: "All custom items")
        }
    }
}

/// What an item must also have (owner, 2026-11-24): any number of these, and an item must have all that are ticked and apply.
struct ItemWith: OptionSet, Hashable, Sendable {
    let rawValue: Int

    static let passkey = ItemWith(rawValue: 1)
    static let notes = ItemWith(rawValue: 2)

    /// The entries in menu order.
    static let entries: [ItemWith] = [.passkey, .notes]

    /// Where the ticks are remembered (`@AppStorage`).
    static let storageKey = "itemWith"

    /// What the entry says after "With": "passkey", "notes".
    var phrase: String { self == .passkey ? String(localized: "passkey") : String(localized: "notes") }

    func has(_ item: VaultItem) -> Bool {
        switch self {
        case .passkey: item.passkey != nil
        // A note is all notes.
        case .notes: item.kind == .secureNote || !item.notes.isEmpty
        default: true
        }
    }
}

/// Show and With together: which items the All list lists. Sort is separate (`ItemSort`).
struct ItemFilter: Equatable, Sendable {
    var show: ItemShow = .all
    var with: ItemWith = []

    /// Whether a With entry can apply to the chosen kind: only logins have a passkey, and a note is all notes. An entry that
    /// cannot apply is disabled in the menu and ignored here, but its tick is kept.
    func applies(_ entry: ItemWith) -> Bool {
        switch (show, entry) {
        case (.all, _), (.logins, _): true
        case (.custom, .notes): true
        default: false
        }
    }

    /// The ticked entries that apply.
    var applied: [ItemWith] { ItemWith.entries.filter { with.contains($0) && applies($0) } }

    /// The list is narrowed: a kind other than All, or an entry that applies.
    var isNarrowing: Bool { show != .all || !applied.isEmpty }

    func includes(_ item: VaultItem) -> Bool { show.includes(item) && applied.allSatisfy { $0.has(item) } }

    func listed(_ items: [VaultItem]) -> [VaultItem] { items.filter(includes) }

    /// Nothing narrows: All, and no entry.
    var cleared: Self { Self() }

    /// This filter, widened as little as it takes to list `item`: its kind, then no entries.
    func revealing(_ item: VaultItem) -> Self {
        guard !includes(item) else { return self }
        var wider = self
        wider.show = ItemShow(kind: item.kind) ?? .all
        if !wider.includes(item) { wider.with = [] }
        return wider
    }

    // MARK: Words

    /// "passkey", "passkey and notes"; nil when no entry applies.
    var withPhrase: String? {
        let words = applied.map(\.phrase)
        return words.isEmpty ? nil : words.joined(separator: " " + String(localized: "and") + " ")
    }

    /// The line under the title: what else is in force, only when something is. "With passkey", "With passkey and notes", and the
    /// order when it is not the default ("With passkey, most used first", "Recently changed first", "By name").
    func secondLine(sort: ItemSort) -> String? {
        var parts: [String] = []
        if let phrase = withPhrase { parts.append(String(localized: "With \(phrase)")) }
        if let order = sort.orderPhrase {
            parts.append(parts.isEmpty ? order.prefix(1).uppercased() + order.dropFirst() : order)
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// iPhone's line under the list's title, which is the name alone (owner, 2026-11-24): always the count, then what else is in
    /// force, in one lower-case sentence. "367 items", "1 item, with passkey", "8 items, with passkey, most used first".
    func countLine(count: Int, sort: ItemSort) -> String {
        var parts = [RecentlyDeletedText.itemCount(count)]
        if let phrase = withPhrase { parts.append(String(localized: "with \(phrase)")) }
        if let order = sort.orderPhrase { parts.append(order) }
        return parts.joined(separator: ", ")
    }

    /// What an empty combination says: "No custom items with notes".
    var emptySentence: String {
        guard let phrase = withPhrase else { return String(localized: "No \(show.noun)") }
        return String(localized: "No \(show.noun) with \(phrase)")
    }
}

/// Everything the sidebar lists, and the Show menu when the sidebar is hidden: the three places, the kinds, and Recently Deleted.
enum VaultDestination: Hashable, CaseIterable, Sendable {
    case all, codes, cards, wifi, logins, notes, custom, recentlyDeleted

    /// The sidebar's rows, top to bottom.
    static let sidebar: [Self] = allCases

    /// The Show choice this destination is, if it is one of the All list's kinds.
    var show: ItemShow? {
        switch self {
        case .all: .all
        case .logins: .logins
        case .notes: .notes
        case .custom: .custom
        default: nil
        }
    }

    init(show: ItemShow) {
        switch show {
        case .all: self = .all
        case .logins: self = .logins
        case .notes: self = .notes
        case .custom: self = .custom
        }
    }

    /// Whether `item` is one of this row's items (for the sidebar's counts). Recently Deleted lists a store of its own.
    func includes(_ item: VaultItem) -> Bool {
        switch self {
        case .codes: item.kind == .login && !item.otpSecret.isEmpty
        case .cards: item.kind == .creditCard
        case .wifi: item.kind == .wifi
        case .recentlyDeleted: false
        default: show?.includes(item) ?? true
        }
    }
}
