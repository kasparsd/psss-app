import Foundation

/// What the item form needs to know about a draft: whether its setup key is usable, what Save stores, and whether anything differs
/// from the stored item. Pure, so the in-place edit and the new-item sheet agree and the tests can check it.
extension VaultItem {
    /// The setup key (or `otpauth://` link) typed or pasted into the draft makes codes.
    var totpUsable: Bool {
        if case .setup = TOTP.parse(otpSecret) { return true }
        return false
    }

    /// Something is in the setup key field and it is not a key.
    var totpInvalid: Bool { !otpSecret.isEmpty && !totpUsable }

    /// The item with its code reduced to the clean Base32 secret and its parameters, whatever was typed or pasted.
    /// A bare key keeps the parameters the login already has; a link brings its own.
    var savedForm: VaultItem {
        var clean = self
        if clean.kind == .creditCard { clean.expiry = CardExpiry.displayed(clean.expiry) }
        if case .setup(let setup) = TOTP.parse(otpSecret) {
            clean.otpSecret = setup.secret
            if otpSecret.lowercased().contains("otpauth://") { clean.otpSettings = setup.settings }
        } else {
            clean.otpSecret = ""
            clean.otpSettings = .standard
        }
        return clean
    }

    /// The person changed something the form edits: compared as Save would store both, so a card's expiry written another way or
    /// a setup key pasted with spaces is not a change by itself.
    func hasChanges(from stored: VaultItem) -> Bool {
        let a = savedForm, b = stored.savedForm
        return a.title != b.title || a.account != b.account || a.website != b.website || a.secret != b.secret
            || a.expiry != b.expiry || a.securityCode != b.securityCode || a.notes != b.notes
            || a.otpSecret != b.otpSecret || a.otpSettings != b.otpSettings
            || (a.otherFieldEdits ?? [:]) != (b.otherFieldEdits ?? [:])
    }

    mutating func editOtherField(_ field: StoredItemField, value: String) {
        var edits = otherFieldEdits ?? [:]
        edits[field.id] = value == field.value ? nil : value
        otherFieldEdits = edits.isEmpty ? nil : edits
    }

    /// The item holds something: a name, a value, a note, a code or a passkey. An entirely empty item cannot be saved.
    var hasContent: Bool {
        passkey != nil || otherFields?.isEmpty == false || [title, account, website, secret, expiry, securityCode, notes, otpSecret]
            .contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// Save is on (owner, 2026-11-24): as soon as the item has any content, and the setup key, if one is typed, makes codes. No kind
    /// needs a name.
    var canSave: Bool { hasContent && !totpInvalid }

    /// The fields of the first card, in the one order the item page, edit in place and the new-item sheet share (owner, 2026-11-24).
    /// A login's verification code, the notes and a passkey are cards of their own after it; a note's text is its only card.
    static func firstCardFields(for kind: ItemKind) -> [ItemField] {
        switch kind {
        case .login, .keePassEntry: [.website, .account, .secret]
        case .creditCard: [.secret, .expiry, .securityCode, .account]
        case .secureNote: []
        }
    }

    /// The fields of the first card that hold something, in that order: what the item page shows. A kind's other plain fields that an
    /// imported item may carry (a card's website, a note's username) follow, so nothing stored is out of sight.
    var filledFirstCardFields: [ItemField] {
        let own = Self.firstCardFields(for: kind)
        return (own + ItemField.allCases.filter { !own.contains($0) && $0 != .notes }).filter { !self[$0].isEmpty }
    }

    subscript(field: ItemField) -> String {
        get { self[keyPath: field.value] }
        set { self[keyPath: field.value] = newValue }
    }

    /// Whether the form may leave `field` empty and says so with "(optional)": everything but the content the kind is for (a
    /// login's password, a card's number, a note's text, a custom item's value).
    static func isOptional(_ field: ItemField, for kind: ItemKind) -> Bool {
        switch field {
        case .secret: false
        case .notes: kind != .secureNote
        default: true
        }
    }
}

/// A value of an item that the page shows as a row and the form as a field.
enum ItemField: String, CaseIterable, Hashable, Sendable {
    case website, account, secret, expiry, securityCode, notes

    fileprivate var value: WritableKeyPath<VaultItem, String> {
        switch self {
        case .website: \.website
        case .account: \.account
        case .secret: \.secret
        case .expiry: \.expiry
        case .securityCode: \.securityCode
        case .notes: \.notes
        }
    }
}
