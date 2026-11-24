import Foundation

enum ItemKind: String, CaseIterable, Identifiable, Sendable, Codable {
    case login, creditCard, secureNote, keePassEntry

    var id: Self { self }

    /// What an item of this kind is called when it has no name and nothing to make one from.
    var unnamedTitle: String {
        switch self {
        case .login: String(localized: "Login")
        case .creditCard: String(localized: "Card")
        case .secureNote: String(localized: "Note")
        case .keePassEntry: String(localized: "Custom item")
        }
    }
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
    /// The ordered strings backing the detail and mapping form. KeePass remains the source of truth.
    var sourceFields: [StoredItemField]?
    var otherFields: [StoredItemField]?
    /// Pending edits keyed by the source row ID. The original rows stay available for conflict checks.
    var otherFieldEdits: [StoredItemField.ID: String]?
    var concealedFields: Set<String>?
    var fieldMapping: ItemFieldMapping?
    var fieldMappingNeedsReview: Bool?
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

    /// The name shown everywhere (owner, 2026-11-24): the name the person gave, or one made from what the item holds, so no kind
    /// needs a name. Lists, search, sort by name, the item page, the Undo capsule, Recently Deleted and AutoFill all use this.
    var displayTitle: String {
        let name = visibleTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? derivedTitle : name
    }

    /// What an item without a name is called. A login or a custom item: the website's host, else the username, else the kind. A card:
    /// the short network name and the last four digits ("Visa \u{2022}\u{2022} 4417"), either alone when only one is known, else
    /// "Card". A note: the start of its first line, else "Note". Never empty. The name field shows it as its placeholder.
    var derivedTitle: String {
        switch kind {
        case .login, .keePassEntry:
            let host = SharedVault.host(visibleWebsite)
            if !host.isEmpty { return host }
            let user = visibleAccount.trimmingCharacters(in: .whitespacesAndNewlines)
            return user.isEmpty ? kind.unnamedTitle : user
        case .creditCard:
            let digits = CardNumber.normalized(secret)
            let parts = [CardBrand(number: digits)?.shortName, digits.count >= 4 ? "\u{2022}\u{2022} \(digits.suffix(4))" : nil].compactMap { $0 }
            return parts.isEmpty ? kind.unnamedTitle : parts.joined(separator: " ")
        case .secureNote:
            return concealedFields?.contains("notes") == true ? kind.unnamedTitle : Self.noteTitle(notes) ?? kind.unnamedTitle
        }
    }

    /// The longest name a note's text gives.
    static let noteTitleLength = 40

    /// A name from a note's text: its first line with something in it, cut at a word when it is longer than `noteTitleLength`
    /// characters (in the middle of a word only when the first word alone is longer), with no punctuation left at the end. Nil when
    /// the text has nothing to show.
    static func noteTitle(_ text: String) -> String? {
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        guard var line = lines.first(where: { !$0.isEmpty }) else { return nil }
        if line.count > noteTitleLength {
            let head = line.prefix(noteTitleLength + 1)
            if let space = head.lastIndex(where: \.isWhitespace) { line = String(head[..<space]) } else { line = String(line.prefix(noteTitleLength)) }
        }
        let trimmed = line.trimmingCharacters(in: .whitespaces.union(.punctuationCharacters))
        return trimmed.isEmpty ? nil : trimmed
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

/// Stable HTML autocomplete names for values offered to forms. A login's site is vault metadata.
enum FieldRole: String, Codable, CaseIterable, Sendable {
    case username
    case password = "current-password"
    case oneTimeCode = "one-time-code"
    case cardholder = "cc-name"
    case cardNumber = "cc-number"
    case expiry = "cc-exp"
    case securityCode = "cc-csc"
    case loginWebsite = "psss:login-website"

    static func mappingRoles(for kind: ItemKind) -> [Self] {
        switch kind {
        case .creditCard: [.cardNumber, .expiry, .securityCode, .cardholder]
        case .login: [.username, .password, .loginWebsite]
        default: []
        }
    }

    var required: Bool { self == .cardNumber || self == .password }

    var sensitive: Bool { self == .password || self == .cardNumber || self == .securityCode || self == .oneTimeCode }

    var label: LocalizedStringResource {
        switch self {
        case .username: "Username"
        case .password: "Password"
        case .oneTimeCode: "Verification code"
        case .cardholder: "Name on card"
        case .cardNumber: "Card number"
        case .expiry: "Expiry"
        case .securityCode: "Security code"
        case .loginWebsite: "Website"
        }
    }

    fileprivate static func normalized(_ name: String) -> String {
        String(name.lowercased().filter { $0.isLetter || $0.isNumber })
    }

    fileprivate var aliases: Set<String> {
        switch self {
        case .username: ["username", "loginname", "accountname", "email"]
        case .password: ["password", "loginpassword", "currentpassword"]
        case .oneTimeCode: []
        case .cardholder: ["nameoncard", "cardholder", "cardholdername", "ccname"]
        case .cardNumber: ["cardnumber", "cardno", "creditcardnumber", "ccnumber", "ccnum", "pan"]
        case .expiry: ["expiry", "expiration", "expirydate", "expirationdate", "validthru", "validthrough", "ccexp"]
        case .securityCode: ["cvv", "cvv2", "cvc", "cvc2", "csc", "securitycode", "cardsecuritycode", "cccsc"]
        case .loginWebsite: ["url", "website", "loginurl", "site"]
        }
    }
}

struct StoredItemField: Codable, Equatable, Identifiable, Sendable {
    let id: Int
    let key: String
    let value: String
    let isProtected: Bool

    var concealed: Bool {
        isProtected || FieldRole.allCases.contains { $0.sensitive && $0.aliases.contains(FieldRole.normalized(key)) }
            || ["pin", "otp", "totpseed", "timeotpsecretbase32"].contains(FieldRole.normalized(key))
    }
}

struct ItemFieldMapping: Codable, Equatable, Sendable {
    let kind: ItemKind
    var keys: [String: String]

    init(kind: ItemKind, keys: [String: String] = [:]) {
        self.kind = kind
        self.keys = keys
    }

    subscript(role: FieldRole) -> String? {
        get { keys[role.rawValue] }
        set { keys[role.rawValue] = newValue }
    }

    /// A source key is eligible only when it identifies one field. Duplicate labels remain visible in the detail.
    static func choices(in fields: [StoredItemField]) -> [StoredItemField] {
        let counts = Dictionary(grouping: fields, by: \.key)
        return fields.filter { !$0.key.isEmpty && counts[$0.key]?.count == 1 }
    }

    static func suggested(for kind: ItemKind, fields: [StoredItemField], defaults: Self?) -> Self {
        let choices = choices(in: fields)
        var result = Self(kind: kind)
        for role in FieldRole.mappingRoles(for: kind) {
            if let key = defaults?[role], choices.contains(where: { $0.key == key && !$0.value.isEmpty }) {
                result[role] = key
                continue
            }
            let matches = choices.filter { !$0.value.isEmpty && role.aliases.contains(FieldRole.normalized($0.key)) }
            if matches.count == 1 { result[role] = matches.first?.key }
        }
        return result
    }

    func issue(in fields: [StoredItemField], requireValues: Bool = true) -> String? {
        validationIssues(in: fields, requireValues: requireValues).first?.message
    }

    func validationIssues(in fields: [StoredItemField], requireValues: Bool = true) -> [(role: FieldRole?, message: String)] {
        guard [.login, .creditCard, .keePassEntry].contains(kind) else { return [(nil, String(localized: "Choose an item type."))] }
        let roles = FieldRole.mappingRoles(for: kind)
        let choices = Self.choices(in: fields)
        var issues: [(role: FieldRole?, message: String)] = []
        for role in roles {
            guard let key = self[role] else {
                if role.required {
                    issues.append((role, String(localized: "Choose the field that holds the \(String(localized: role.label).localizedLowercase).")))
                }
                continue
            }
            let otherRoles = roles.filter { $0 != role && self[$0] == key }
            if !otherRoles.isEmpty {
                let names = otherRoles.map { String(localized: $0.label) }.formatted(.list(type: .and))
                issues.append((role, String(localized: "Also used for \(names). Choose a different field for one of these roles.")))
                continue
            }
            guard let field = choices.first(where: { $0.key == key }) else {
                issues.append((role, String(localized: "“\(key)” is unavailable. Choose a different field.")))
                continue
            }
            if requireValues && role.required && field.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append((role, String(localized: "“\(key)” is empty. Choose a field with a value.")))
            }
        }
        if !Set(keys.keys).isSubset(of: Set(roles.map(\.rawValue))) {
            issues.append((nil, String(localized: "One of the assignments is unavailable. Choose the fields again.")))
        }
        return issues
    }
}

extension VaultItem {
    var visibleTitle: String { concealedFields?.contains("title") == true ? "" : title }
    var visibleAccount: String { concealedFields?.contains("account") == true ? "" : account }
    var visibleWebsite: String { concealedFields?.contains("website") == true ? "" : website }

    func fillValue(for role: FieldRole, at date: Date = .now) -> String? {
        let value: String
        switch (kind, role) {
        case (.login, .username), (.creditCard, .cardholder): value = account
        case (.login, .password), (.creditCard, .cardNumber): value = secret
        case (.creditCard, .expiry): value = expiry
        case (.creditCard, .securityCode): value = securityCode
        case (.login, .loginWebsite): value = website
        case (.login, .oneTimeCode): return TOTP.code(secret: otpSecret, settings: otpSettings, at: date)
        default: return nil
        }
        return value.isEmpty ? nil : value
    }
}
