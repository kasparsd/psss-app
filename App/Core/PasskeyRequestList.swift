import Foundation

/// What the AutoFill list offers when the page has a passkey request pending. Sites such as Google ask for a passkey first
/// (an autofill-assisted request that is still open when the person picks Psss), so the system calls the provider's passkey
/// list even though the person may want the saved password. Kept pure so it can be tested without a device.
///
/// The list holds the passkeys for the request, then what the plain login list holds: the logins saved for the site. Logins
/// for other sites stay behind "Other Logins…" and its confirmation, exactly as in the plain list, so nothing here puts every
/// login one tap away.
///
/// The system does not say whether the page also accepts a password. `ASPasskeyCredentialRequestParameters` carries the relying
/// party, the client data hash, the user verification preference, the allowed credentials and the WebAuthn extension inputs:
/// nothing that tells an autofill-assisted (conditional) request from a modal one. So the logins stay listed, and the list says
/// in one line that a page which only accepts a passkey will not take a login.
struct PasskeyRequestList: Sendable {
    /// The line under "Logins for <site>" in a passkey request.
    static var passkeyOnlyNote: String {
        String(localized: "If this page only accepts a passkey, a login will not sign you in.")
    }

    /// The page, read the same way as for the plain login list. When the system gave no usable service identifier it is the
    /// request's relying party, which the browser has checked against the page.
    let site: FillSite
    /// Passkeys for the request's relying party. When the request names allowed credentials, only those.
    let passkeys: [VaultItem]
    /// Logins with a password that are saved for the site. The list's own matching rule (`SharedVault.matches`) decides.
    let siteLogins: [VaultItem]

    /// One passkey and no login for the site: sign in at once, as before. With any login to choose from the person sees the list.
    var signsInWithoutList: Bool { passkeys.count == 1 && siteLogins.isEmpty }

    /// The logins the plain list and this one are built from: logins that have a password.
    static func passwordLogins(_ items: [VaultItem]) -> [VaultItem] {
        items.filter { $0.kind == .login && !$0.secret.isEmpty }
    }

    init(items: [VaultItem], serviceIdentifiers: [String], rpID: String, allowedCredentials: [Data]) {
        var site = FillSite(serviceIdentifiers: serviceIdentifiers)
        if case .unknown = site { site = FillSite(serviceIdentifier: rpID) }
        self.site = site
        passkeys = items.filter { item in
            guard let passkey = item.passkey, passkey.rpID == rpID else { return false }
            return allowedCredentials.isEmpty || allowedCredentials.contains(passkey.credentialID)
        }
        if let host = site.host {
            siteLogins = Self.passwordLogins(items).filter { SharedVault.matches($0, host: host) }
        } else {
            siteLogins = []
        }
    }
}
