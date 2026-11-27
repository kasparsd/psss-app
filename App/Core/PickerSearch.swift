import Foundation

/// One value an item can give to a field, as the AutoFill picker lists it: a label, a safe preview and the role that releases it.
/// The preview never holds a secret: a password, a card number's digits (but the last four), a security code and a verification
/// code are hidden or described.
struct PickerValue: Identifiable, Equatable, Sendable {
    let role: FieldRole
    let label: String
    let preview: String
    var id: String { role.rawValue }
}

/// What the AutoFill picker can find and offer, kept pure so it is tested without a device (`scripts/test-matching.sh`).
/// Logins with a password, and cards with a number, can be found and give single values. Notes, Wi-Fi networks and custom items
/// are not offered here yet.
enum PickerSearch {
    /// The most results listed at once. The screen says when the list is cut.
    static let limit = 40

    /// Items the picker can offer: a login with a password, or a card with a number.
    static func offerable(_ items: [VaultItem]) -> [VaultItem] {
        items.filter { item in
            switch item.kind {
            case .login: !item.secret.isEmpty
            case .creditCard: !item.secret.isEmpty
            default: false
            }
        }
    }

    /// The fields of `item` that contain `query`: the app's rule (`ItemSearch`), and the website too when the query is part of
    /// the saved site's host, so the address a person remembers finds the login.
    static func fields(of item: VaultItem, query: String) -> Set<SearchField> {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var found = ItemSearch.fields(of: item, query: query)
        if !query.isEmpty, SharedVault.host(item.website).localizedStandardContains(query) { found.insert(.website) }
        return found
    }

    /// Items whose name, username or saved site contains `query`, A to Z by name. An empty query matches every item. With pills
    /// chosen (`chosen`), only items that have the text in one of those fields; none chosen means any field.
    static func matches(_ items: [VaultItem], query: String, in chosen: Set<SearchField> = []) -> [VaultItem] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return offerable(items)
            .filter { item in
                if query.isEmpty { return true }
                let found = fields(of: item, query: query)
                return chosen.isEmpty ? !found.isEmpty : !found.isDisjoint(with: chosen)
            }
            .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
    }

    /// How many offerable items have the text in each field, for the pills. One item can count in two fields.
    static func counts(_ items: [VaultItem], query: String) -> [SearchField: Int] {
        var counts = Dictionary(uniqueKeysWithValues: SearchField.allCases.map { ($0, 0) })
        for item in offerable(items) { for field in fields(of: item, query: query) { counts[field, default: 0] += 1 } }
        return counts
    }

    /// The values `item` can give, in the order the screen lists them. A value the item does not have is not listed.
    static func values(of item: VaultItem) -> [PickerValue] {
        let roles: [FieldRole]
        switch item.kind {
        case .login: roles = [.username, .password, .oneTimeCode]
        case .creditCard: roles = [.cardNumber, .cardholder, .expiry, .securityCode]
        default: return []
        }
        return roles.compactMap { role in
            guard let value = item.fillValue(for: role) else { return nil }
            return PickerValue(role: role, label: String(localized: role.label), preview: preview(role, value))
        }
    }

    private static func preview(_ role: FieldRole, _ value: String) -> String {
        switch role {
        case .password: return "••••••••"
        case .securityCode: return "•••"
        case .oneTimeCode: return String(localized: "Changes every 30 seconds")
        case .cardNumber:
            let digits = CardNumber.normalized(value)
            return digits.count >= 4 ? "•••• \(digits.suffix(4))" : "••••"
        default: return DisplayText.safe(value, empty: "")
        }
    }
}

extension ReleaseCheck {
    /// One value goes out only for an item the picker offers and only for a role it lists for that kind. Nothing else leaves the
    /// vault: a username request never carries the password, and a website is never a value.
    static func value(item: VaultItem, role: FieldRole, at date: Date = .now) -> String? {
        guard PickerSearch.values(of: item).contains(where: { $0.role == role }) else { return nil }
        return item.fillValue(for: role, at: date)
    }
}

/// The second line of a picker row (mock `#/autofill`): the account, and the website when the name is the account or the login has
/// no account, so a row never repeats its own title and never has an empty line when the login has a site. A list that shows other
/// sites' logins (`showsSite`) always adds the website after the account. Everything is made safe for one line.
enum RowLine {
    static func text(for item: VaultItem, showsSite: Bool) -> String? {
        let title = item.displayTitle
        let account = DisplayText.safe(item.account, empty: "")
        let site = DisplayText.value(HostDisplay.shown(SharedVault.host(item.website)))
        var parts: [String] = []
        if !account.isEmpty, account != title { parts.append(account) }
        if !site.isEmpty, site != title, showsSite || parts.isEmpty { parts.append(site) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

extension RowLine {
    /// What differs, for rows that would read the same (owner, 2026-11-26, mock `#/autofill-lessons`, frame B). Two rows read the same
    /// when their title and second line are the same text, such as two E-Klase logins for one username. Each of them gets one more
    /// part for its second line: the website (“No website” for one without), when the websites differ; else the vault, when the
    /// vaults differ; else “Changed <date>”. Rows that read differently get nothing, and a row that has nothing to add is left out of
    /// the result, so a person is never shown a line that tells nothing.
    /// - Parameters:
    ///   - showsSite: the same flag `text(for:showsSite:)` takes, so the comparison is of what the rows really show.
    ///   - vaultName: the vault an item sits in, or nil when the list holds one vault.
    ///   - changed: how a change date reads. The default is the person's own date format.
    static func differences(in items: [VaultItem], showsSite: Bool = false, vaultName: (VaultItem) -> String? = { _ in nil },
                            changed: (Date) -> String = RowLine.changedText) -> [UUID: String] {
        var groups: [String: [VaultItem]] = [:]
        for item in items {
            let key = item.displayTitle + "\u{0}" + (text(for: item, showsSite: showsSite) ?? "")
            groups[key, default: []].append(item)
        }
        var result: [UUID: String] = [:]
        for group in groups.values where group.count > 1 {
            let sites = group.map { DisplayText.value(HostDisplay.shown(SharedVault.host($0.website))) }
            let vaults = group.map { vaultName($0).map { DisplayText.safe($0, empty: "") } ?? "" }
            for (index, item) in group.enumerated() {
                if Set(sites).count > 1 {
                    result[item.id] = sites[index].isEmpty ? String(localized: "No website") : sites[index]
                } else if Set(vaults).count > 1, !vaults[index].isEmpty {
                    result[item.id] = vaults[index]
                } else if let modified = item.modified {
                    result[item.id] = changed(modified)
                }
            }
        }
        return result
    }

    /// The second line with `extra` after it, as the picker draws a row that would read like another one.
    static func line(_ base: String?, extra: String?) -> String? {
        switch (base, extra) {
        case let (base?, extra?): return base + " · " + extra
        case let (base?, nil): return base
        case let (nil, extra?): return extra
        default: return nil
        }
    }

    /// “Changed 14 Dec 2023”: the day, month and year in the person's own format.
    static func changedText(_ date: Date) -> String {
        String(localized: "Changed \(date.formatted(.dateTime.day().month(.abbreviated).year()))")
    }
}
