import Foundation

enum ItemKind: String, CaseIterable, Identifiable, Sendable, Codable {
    case login, creditCard, secureNote, keePassEntry, wifi

    var id: Self { self }

    /// What an item of this kind is called when it has no name and nothing to make one from.
    var unnamedTitle: String {
        switch self {
        case .login: String(localized: "Login")
        case .creditCard: String(localized: "Card")
        case .secureNote: String(localized: "Note")
        case .keePassEntry: String(localized: "Custom item")
        case .wifi: String(localized: "Wi-Fi network")
        }
    }
}

/// How a Wi-Fi network is secured, as the QR code and the system's join call know it. WPA covers WPA2 and WPA3 personal networks.
enum WiFiSecurity: String, CaseIterable, Identifiable, Sendable, Codable {
    case wpa = "WPA", wep = "WEP", none = "None"

    var id: Self { self }

    /// The word in a list row.
    var shortLabel: String {
        switch self {
        case .wpa: "WPA"
        case .wep: "WEP"
        case .none: String(localized: "Open")
        }
    }

    var label: String {
        switch self {
        case .wpa: String(localized: "WPA2 or WPA3")
        case .wep: String(localized: "WEP")
        case .none: String(localized: "None (open network)")
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
    /// A card's other fields, cards only, stored as the custom strings `Valid from`, `PIN` (protected) and `Card issuer`, the names the
    /// 1Password importer already gives them. A card shown from a KeePass field mapping keeps these in its other fields.
    var validFrom = ""
    var pin = ""
    var issuer = ""
    /// A Wi-Fi network's security and whether it hides its name, Wi-Fi only. The network name is `account` and the password `secret`.
    var wifiSecurity = WiFiSecurity.wpa
    var wifiHidden = false
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
        case .wifi:
            let name = visibleAccount.trimmingCharacters(in: .whitespacesAndNewlines)
            return name.isEmpty ? kind.unnamedTitle : name
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
         secret: String = "", expiry: String = "", securityCode: String = "", validFrom: String = "", pin: String = "", issuer: String = "", wifiSecurity: WiFiSecurity = .wpa, wifiHidden: Bool = false,
         notes: String = "", otpSecret: String = "", otpSettings: TOTPSettings = .standard, lastUsed: Date? = nil, useCount: Int = 0,
         created: Date? = nil, modified: Date? = nil) {
        self.id = id
        self.kind = kind
        self.title = title
        self.account = account
        self.website = website
        self.secret = secret
        self.expiry = expiry
        self.securityCode = securityCode
        self.validFrom = validFrom
        self.pin = pin
        self.issuer = issuer
        self.wifiSecurity = wifiSecurity
        self.wifiHidden = wifiHidden
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

    /// Only a card needs a field for its number; a login can be a username and a website, or a passkey alone (owner, 2026-11-24).
    var required: Bool { self == .cardNumber }

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
        case .username: ["username", "loginname", "accountname", "email", "emailaddress", "user", "userid", "login"]
        case .password: ["password", "loginpassword", "currentpassword", "pass", "passwd", "pwd", "passphrase"]
        case .oneTimeCode: []
        case .cardholder: ["nameoncard", "cardholder", "cardholdername", "ccname", "owner", "holder", "cardowner"]
        case .cardNumber: ["cardnumber", "cardno", "creditcardnumber", "ccnumber", "ccnum", "pan", "number", "creditcard", "creditcardno"]
        case .expiry: ["expiry", "expiration", "expirydate", "expirationdate", "validthru", "validthrough", "ccexp", "exp", "expdate", "expires", "validuntil", "goodthru"]
        case .securityCode: ["cvv", "cvv2", "cvc", "cvc2", "csc", "securitycode", "cardsecuritycode", "cccsc", "cvn", "cid", "verificationnumber", "verificationvalue"]
        case .loginWebsite: ["url", "website", "loginurl", "site", "uri", "link", "webaddress", "homepage"]
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
            if let key = defaults?[role], choices.contains(where: { $0.key == key }) {
                result[role] = key
                continue
            }
            // By name. Fields that hold something win, so KeePass's empty standard UserName, Password and URL do not compete with
            // a filled custom one. With nothing filled, a single field named for the role is still it (an empty card number), and
            // the item page says it is empty.
            let named = choices.filter { role.aliases.contains(FieldRole.normalized($0.key)) }
            let filled = named.filter { !$0.value.isEmpty }
            let matches = filled.isEmpty ? named : filled
            if matches.count == 1 { result[role] = matches.first?.key }
        }
        return result
    }

    func issue(in fields: [StoredItemField]) -> String? {
        validationIssues(in: fields).first?.message
    }

    /// What stops a mapping from being saved: the structure only. A value that is empty or in the wrong format never does; the
    /// item page marks it and Edit corrects it (owner, 2026-11-24).
    func validationIssues(in fields: [StoredItemField]) -> [(role: FieldRole?, message: String)] {
        guard [.login, .creditCard, .keePassEntry].contains(kind) else { return [(nil, String(localized: "Choose an item type."))] }
        let roles = FieldRole.mappingRoles(for: kind)
        let choices = Self.choices(in: fields)
        var issues: [(role: FieldRole?, message: String)] = []
        for role in roles {
            guard let key = self[role] else {
                if role.required {
                    issues.append((role, String(localized: "Choose which field is the \(String(localized: role.label).localizedLowercase).")))
                }
                continue
            }
            let otherRoles = roles.filter { $0 != role && self[$0] == key }
            if !otherRoles.isEmpty {
                let names = otherRoles.map { String(localized: $0.label) }.formatted(.list(type: .and))
                issues.append((role, String(localized: "Also used for \(names). Choose a different field for one of these roles.")))
                continue
            }
            guard choices.contains(where: { $0.key == key }) else {
                issues.append((role, String(localized: "“\(key)” is unavailable. Choose a different field.")))
                continue
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
