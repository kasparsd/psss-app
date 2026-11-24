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

    /// Items whose name, account or saved site contains `query`, A to Z by name. An empty query matches every item. A saved site
    /// matches on its text and on its host, so the address a person remembers finds the login.
    static func matches(_ items: [VaultItem], query: String) -> [VaultItem] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return offerable(items)
            .filter { item in
                query.isEmpty
                    || item.displayTitle.localizedStandardContains(query)
                    || item.account.localizedStandardContains(query)
                    || item.website.localizedStandardContains(query)
                    || SharedVault.host(item.website).localizedStandardContains(query)
            }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
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
