import Foundation

/// What the AutoFill list offers when the page has a passkey request pending. Sites such as Google ask for a passkey first
/// (an autofill-assisted request that is still open when the person picks Psss), so the system calls the provider's passkey
/// list even though the person may want the saved password. Kept pure so it can be tested without a device.
///
/// The list holds the passkeys for the request, then what the plain login list holds: the logins saved for the site. Logins
/// for other sites stay behind the search and its confirmation, exactly as in the plain list, so nothing here puts every
/// login one tap away.
///
/// A request that names the passkeys it accepts, none of which is listed, is one a password is unlikely to answer (a security-key
/// second step): the list then says so and offers no login (`namedPasskeysMissing`, mock `#/autofill`, frame U2).
///
/// The system does not say whether the page also accepts a password. `ASPasskeyCredentialRequestParameters` carries the relying
/// party, the client data hash, the user verification preference, the allowed credentials and the WebAuthn extension inputs:
/// nothing that tells an autofill-assisted (conditional) request from a modal one. So, apart from that case, the logins stay listed, below the passkeys
/// under "Logins" (mock `#/autofill`, frame U); the list says nothing more about it.
///
/// A passkey belongs to its relying party exactly: the request's `relyingPartyIdentifier` is the identifier the site chose
/// (`google.com` for Google's sign-in page at `accounts.google.com`), and the stored passkey's `rpID` must be that same string.
/// The page's host never takes part in it: it only picks the logins. Nothing looser may match, because the signature covers the
/// hash of the stored identifier, so a passkey for another identifier would be rejected by the site anyway.
struct PasskeyRequestList: Sendable {
    /// The page, read the same way as for the plain login list. When the system gave no usable service identifier it is the
    /// request's relying party, which the browser has checked against the page.
    let site: FillSite
    /// Passkeys for the request's relying party. When the request names allowed credentials, only those.
    let passkeys: [VaultItem]
    /// Logins with a password that are saved for the site. The list's own matching rule (`SharedVault.matches`) decides.
    let siteLogins: [VaultItem]

    /// One passkey and no login for the site: sign in at once, as before. With any login to choose from the person sees the list.
    var signsInWithoutList: Bool { passkeys.count == 1 && siteLogins.isEmpty }

    /// The site named the passkeys it accepts and none of them is listed.
    var namedPasskeysMissing: Bool { diagnostics.allowedCredentials > 0 && passkeys.isEmpty }

    /// The logins the plain list and this one are built from: logins that have a password.
    static func passwordLogins(_ items: [VaultItem]) -> [VaultItem] {
        items.filter { $0.kind == .login && !$0.secret.isEmpty }
    }

    /// Counts for the log, to see from a device why a request listed nothing. Never a name, an account or a credential ID.
    struct Diagnostics: Equatable, Sendable {
        /// Items in the vault that hold a passkey.
        var passkeysInVault = 0
        /// Of those, the ones for exactly the request's relying party.
        var forRelyingParty = 0
        /// Passkeys for another identifier of the same registrable domain (`accounts.google.com` against `google.com`): shown so a
        /// device log can tell "no passkey" from "a passkey saved under a sibling identifier".
        var forSiblingRelyingParty = 0
        /// The request's allowed credentials, and how many of the matching passkeys they removed.
        var allowedCredentials = 0
        var excludedByAllowedCredentials = 0
        /// Passkeys listed.
        var listed = 0
    }

    let diagnostics: Diagnostics

    /// True when a stored passkey's relying party is the request's. Exact: a different case, a trailing dot or a subdomain is
    /// another party.
    static func sameRelyingParty(stored: String, requested: String) -> Bool { stored == requested }

    init(items: [VaultItem], serviceIdentifiers: [String], rpID: String, allowedCredentials: [Data]) {
        var site = FillSite(serviceIdentifiers: serviceIdentifiers)
        if case .unknown = site { site = FillSite(serviceIdentifier: rpID) }
        self.site = site
        var counts = Diagnostics(allowedCredentials: allowedCredentials.count)
        let requestDomain = SiteMatch.registrableDomain(SiteMatch.normalizedHost(rpID))
        var listed: [VaultItem] = []
        for item in items {
            guard let passkey = item.passkey else { continue }
            counts.passkeysInVault += 1
            guard Self.sameRelyingParty(stored: passkey.rpID, requested: rpID) else {
                if let requestDomain, SiteMatch.registrableDomain(SiteMatch.normalizedHost(passkey.rpID)) == requestDomain {
                    counts.forSiblingRelyingParty += 1
                }
                continue
            }
            counts.forRelyingParty += 1
            if allowedCredentials.isEmpty || allowedCredentials.contains(passkey.credentialID) {
                listed.append(item)
            } else {
                counts.excludedByAllowedCredentials += 1
            }
        }
        counts.listed = listed.count
        passkeys = listed
        diagnostics = counts
        if let host = site.host {
            siteLogins = Self.passwordLogins(items).filter { SharedVault.matches($0, host: host) }
        } else {
            siteLogins = []
        }
    }
}
