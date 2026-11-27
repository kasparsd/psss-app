import Foundation

/// How the AutoFill sheet groups a list of logins (mock `#/autofill`, frames A, B and E; the browser popup groups the same way, in
/// `Extensions/Browser/src/groups.js`). Pure, so the rules and the words are tested.
///
/// - "For This Site": the login's website matches the page's site.
/// - "Other Matches": found by name, username or a search, but saved for another site or with no website. Each such login keeps a
///   second line, "Saved for <site>" or "No website": with the group's heading it is the check against a lookalike site, because
///   a tap on a row fills everywhere and no question before a login from another site is filled.
enum ResultGroups {
    struct Split {
        var thisSite: [VaultItem]
        var other: [VaultItem]
    }

    /// The most characters of a saved site shown. The line wraps, so the site is read in full up to this, then cut with an ellipsis.
    static let siteLimit = 80

    /// Splits `items` into the two groups, keeping their order. A group with no items is empty: the screen leaves its heading out.
    /// A page whose site is unknown (`host` nil) has no login for this site, so everything is an other match. Only a login can be
    /// for this site: a card has no website.
    static func split(_ items: [VaultItem], host: String?) -> Split {
        guard let host else { return Split(thisSite: [], other: items) }
        var split = Split(thisSite: [], other: [])
        for item in items {
            if item.kind == .login, SharedVault.matches(item, host: host) { split.thisSite.append(item) } else { split.other.append(item) }
        }
        return split
    }

    /// Where an other-match login is saved.
    enum SavedFor: Equatable {
        case site(String)
        case noWebsite
        /// A website that holds no readable host (a bare path, user info and so on).
        case unreadable
    }

    static func savedFor(_ item: VaultItem) -> SavedFor {
        guard !DisplayText.safe(item.website, empty: "").isEmpty else { return .noWebsite }
        let host = HostDisplay.shown(SharedVault.host(item.website))
        guard !host.isEmpty else { return .unreadable }
        return .site(cut(host))
    }

    /// The site as it follows "Saved for ": the readable, lookalike-safe host, cut to `siteLimit`. Empty for no readable site.
    static func savedSite(_ item: VaultItem) -> String? {
        if case .site(let host) = savedFor(item) { host } else { nil }
    }

    /// "Saved for githosting.example", "Saved for a site Psss could not read" or "No website", as one plain line.
    static func savedForLine(_ item: VaultItem) -> String {
        switch savedFor(item) {
        case .site(let host): String(localized: "Saved for \(host)")
        case .unreadable: String(localized: "Saved for a site Psss could not read")
        case .noWebsite: String(localized: "No website")
        }
    }

    private static func cut(_ text: String) -> String {
        text.count > siteLimit ? String(text.prefix(siteLimit - 1)).trimmingCharacters(in: .whitespaces) + "…" : text
    }

    /// The words of the notice for a vault with no login for the page: the vault named, then the ways on. `others` is true with two or
    /// more vaults, when another vault is a way on. `searchWhere` names where the search is ("below" on iPhone, "above" under the
    /// Vault row on iPad and Mac).
    static func noLoginsBody(vault: String, otherVaults: Bool, searchWhere: String) -> String {
        let name = VaultName.sentence(vault)
        return otherVaults
            ? String(localized: "\(name) has none for this site. Search all items \(searchWhere), or choose another vault above.")
            : String(localized: "\(name) has none for this site. Search all items \(searchWhere).")
    }

    /// The words of the notice for a passkey request that names the passkeys the site accepts when the vault has none of them.
    static func noMatchingPasskeyBody(vault: String, otherVaults: Bool) -> String {
        let name = VaultName.sentence(vault)
        let body = String(localized: "\(name) has none of the passkeys this site accepts. If yours is in Apple Passwords, another app or a security key, choose Cancel and use it there.")
        return otherVaults ? body + " " + String(localized: "Or choose another vault above.") : body
    }
}
