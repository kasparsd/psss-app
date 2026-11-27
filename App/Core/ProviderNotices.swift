import Foundation

/// The words under the Vault row of an AutoFill screen when the current vault cannot be used yet (mock `#/autofill`, frames J, K, P
/// to R, Z). Pure, so the sentences are tested. `name` is the vault's own name: it is made safe here (`VaultName.sentence`), so
/// callers pass it as the vault has it. `method` is "Face ID", "Touch ID" or similar.
enum ProviderNotices {
    /// What the notice is: information (a grey circled i) or a problem (orange).
    enum Tone: Equatable { case info, warning }

    struct Notice: Equatable {
        var tone: Tone
        var text: String
    }

    /// Face ID, Touch ID or the passcode prompt was cancelled. Unlock asks again.
    static func cancelled(method: String) -> Notice {
        Notice(tone: .info, text: String(localized: "\(method) was cancelled."))
    }

    /// The vault asks for its password, in a few words why, then what to do.
    static func needsPassword(_ state: VaultState, name: String, method: String) -> Notice? {
        guard let why = state.passwordNotice(name: VaultName.sentence(name), method: method) else { return nil }
        return Notice(tone: .info, text: String(localized: "\(why) Unlock with the vault password."))
    }

    /// The device has no passcode, so the system keeps no saved key for the vault.
    static func noPasscode(name: String) -> Notice {
        Notice(tone: .info, text: String(localized: "This device has no passcode, so Psss cannot keep a saved key for \(VaultName.sentence(name)). Unlock with the vault password."))
    }

    /// Not available: nothing in the sheet can fix it, so the notice says what Psss will do and where. Nil for a vault that is available.
    static func unavailable(_ state: VaultState, name: String) -> Notice? {
        let name = VaultName.sentence(name)
        switch state {
        case .notDownloaded: return Notice(tone: .warning, text: String(localized: "\(name) isn’t downloaded yet. Open Psss to download it."))
        case .notFound: return Notice(tone: .warning, text: String(localized: "\(name) can’t be found. Open Psss to locate it."))
        case .unreadable: return Notice(tone: .warning, text: String(localized: "\(name) can’t be read. Open Psss for details."))
        default: return nil
        }
    }

    /// The vault's key derivation asks for more memory than the extension can give (`ExtensionUnlockBudget`).
    static func openPsss(name: String) -> Notice {
        Notice(tone: .info, text: String(localized: "Open Psss to unlock \(VaultName.sentence(name))."))
    }

    /// A wrong password, as the lock screen says it, with the same hint about a key file.
    static func wrongPassword(name: String) -> String {
        String(localized: "That didn’t open \(VaultName.sentence(name)). Check Caps Lock and your keyboard language. If this vault uses a key file, choose it.")
    }
}

/// The button of a save screen, named for what it will change (mock `#/autofill`, frames W to Y). Pure, so the words are tested.
enum SaveWords {
    /// "Save" for a new login; "Update Gitforge (sam.r)" when the same website and username exist (the password changes, the
    /// username and the name stay). Name and username are the vault's own text, made safe and cut.
    static func passwordButton(existing: VaultItem?) -> String {
        guard let existing else { return String(localized: "Save") }
        return String(localized: "Update \(label(of: existing))")
    }

    /// "Create Passkey" for a new login; "Add Passkey to Gitforge (sam.r)" when a login with the same website and username exists.
    static func passkeyButton(existing: VaultItem?) -> String {
        guard let existing else { return String(localized: "Create Passkey") }
        return String(localized: "Add Passkey to \(label(of: existing))")
    }

    /// The name of a login Psss saves from a page: the page's own title when it has one, else the site, so the row's name is a real
    /// name that search finds and sets in bold (a nameless login showed "localhost" but counted 0 under Name).
    static func newTitle(requestTitle: String, host: String) -> String {
        let title = DisplayText.safe(requestTitle, empty: "")
        return title.isEmpty ? HostDisplay.shown(host) : title
    }

    /// "Gitforge (sam.r)", or the name alone when the login has no username.
    static func label(of item: VaultItem) -> String {
        let name = shortened(DisplayText.title(of: item))
        let account = shortened(DisplayText.safe(item.account, empty: ""))
        return account.isEmpty || account == name ? name : "\(name) (\(account))"
    }

    private static func shortened(_ text: String, limit: Int = 28) -> String {
        guard text.count > limit else { return text }
        return String(text.prefix(limit - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }
}

/// Which login a save request from a page changes (pure, so the rules are tested). The simulator showed a duplicate: the system
/// filled a generated password with the username known, Psss saved a new login, and the submit then updated the old one (2026-11-25).
enum SaveMatch {
    enum Generated: Equatable { case nothing, saveNew }

    /// The system filled a generated password into a form not submitted yet. Saved as a new login so it is never lost, except when
    /// it is already saved, or when a login with this username exists: then the submit asks to Update it, and the old password stays
    /// until the site has taken the new one.
    static func generated(in items: [VaultItem], host: String, user: String, password: String) -> Generated {
        let logins = siteLogins(items, host: host)
        if logins.contains(where: { $0.secret == password }) { return .nothing }
        if !user.isEmpty, logins.contains(where: { $0.account == user }) { return .nothing }
        return .saveNew
    }

    enum Submitted { case alreadySaved, update(VaultItem), completePending(VaultItem), new }

    /// The form was submitted. Nothing to do when a login with this username already holds this password (Psss saved it when the
    /// generated password was filled: no screen asks again). Otherwise the login with this username is updated; a login Psss saved
    /// from a generated password before the username was known gets the username; otherwise a new login.
    static func submitted(in items: [VaultItem], host: String, user: String, password: String) -> Submitted {
        let logins = siteLogins(items, host: host)
        if logins.contains(where: { $0.account == user && $0.secret == password }) { return .alreadySaved }
        if let same = logins.first(where: { $0.account == user }) { return .update(same) }
        if !user.isEmpty, let pending = logins.first(where: { $0.account.isEmpty && $0.secret == password }) {
            return .completePending(pending)
        }
        return .new
    }

    private static func siteLogins(_ items: [VaultItem], host: String) -> [VaultItem] {
        items.filter { $0.kind == .login && SharedVault.matches($0, host: host) }
    }
}
