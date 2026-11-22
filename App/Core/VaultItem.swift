import Foundation

enum ItemKind: String, CaseIterable, Identifiable, Sendable, Codable {
    case login, creditCard, secureNote, keePassEntry

    var id: Self { self }
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
