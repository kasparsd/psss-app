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
    /// A card's security code (CVC, CVV), cards only. Stored as the protected custom string `Security code`.
    var securityCode = ""
    var notes = ""
    /// TOTP (RFC 6238) secret as Base32, logins only. The codes it makes are shown as the item's one-time code.
    var otpSecret = ""
    /// Digits, period and algorithm of the TOTP secret. Most sites use the defaults.
    var otpSettings = TOTPSettings.standard
    var lastUsed: Date?
    var useCount = 0
    /// Set when this login also holds a passkey.
    var passkey: PasskeyRecord?
    /// When the entry was made and last changed, read from the file's `CreationTime` and `LastModificationTime`. The codec owns
    /// them: they are never written from an item, so setting them on an item you save has no effect. Nil for an item that was
    /// not read from a file, or whose entry has no such time.
    private(set) var created: Date?
    private(set) var modified: Date?

    /// The `otpauth://` link that moves this TOTP secret to another authenticator.
    var totpSetupURL: String? {
        guard kind == .login, let secret = TOTP.normalizedSecret(otpSecret) else { return nil }
        return TOTP.setupURL(secret: secret, issuer: displayTitle, account: account, settings: otpSettings)
    }

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

    init(id: UUID = UUID(), kind: ItemKind, title: String = "", account: String = "", website: String = "",
         secret: String = "", expiry: String = "", securityCode: String = "", notes: String = "",
         otpSecret: String = "", otpSettings: TOTPSettings = .standard, lastUsed: Date? = nil, useCount: Int = 0,
         created: Date? = nil, modified: Date? = nil) {
        self.id = id
        self.kind = kind
        self.title = title
        self.account = account
        self.website = website
        self.secret = secret
        self.expiry = expiry
        self.securityCode = securityCode
        self.notes = notes
        self.otpSecret = otpSecret
        self.otpSettings = otpSettings
        self.lastUsed = lastUsed
        self.useCount = useCount
        self.created = created
        self.modified = modified
    }
}
