import Foundation

enum ItemKind: String, CaseIterable, Identifiable, Sendable, Codable {
    case login, creditCard, secureNote, keePassEntry

    var id: Self { self }
}

/// A characteristic worth showing on a row and worth filtering by. Order is the order of the badges.
enum ItemTrait: CaseIterable, Hashable, Sendable {
    case passkey, code, notes
}

struct VaultItem: Identifiable, Sendable, Codable {
    let id: UUID
    let kind: ItemKind
    var title = ""
    var account = ""
    var website = ""
    var secret = ""
    var expiry = ""
    var notes = ""
    /// Base32 seed for the verification code, logins only.
    var otpSecret = ""
    var lastUsed: Date?
    var useCount = 0
    /// Set when this login also holds a passkey.
    var passkey: PasskeyRecord?

    /// What this item holds beyond a name and a secret. Secure notes always have notes, so they do not advertise it.
    var traits: [ItemTrait] {
        var found: [ItemTrait] = []
        if passkey != nil { found.append(.passkey) }
        if !otpSecret.isEmpty, kind == .login { found.append(.code) }
        if !notes.isEmpty, kind != .secureNote { found.append(.notes) }
        return found
    }

    /// The name shown everywhere. Logins need no name: the site's host stands in for it.
    var displayTitle: String {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        let host = SharedVault.host(website)
        return host.isEmpty ? String(localized: "Untitled") : host
    }

    init(kind: ItemKind, title: String = "", account: String = "", website: String = "",
         secret: String = "", expiry: String = "", notes: String = "",
         otpSecret: String = "", lastUsed: Date? = nil, useCount: Int = 0) {
        id = UUID()
        self.kind = kind
        self.title = title
        self.account = account
        self.website = website
        self.secret = secret
        self.expiry = expiry
        self.notes = notes
        self.otpSecret = otpSecret
        self.lastUsed = lastUsed
        self.useCount = useCount
    }
}
