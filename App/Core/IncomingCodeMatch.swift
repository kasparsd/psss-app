import Foundation

/// Which logins a code that arrived as an `otpauth://` link probably belongs to, and the login to start when none does. Pure, so
/// it is tested without a device. The person always chooses; this only decides what is listed first (docs/verification-codes.md,
/// “Opening a site's setup link”).
enum IncomingCodeMatch {
    /// Logins whose name or saved site holds the link's issuer (GitHub finds “GitHub” and github.com), or, when the link names no
    /// issuer, whose username is the link's account. A username alone never suggests a login when an issuer is named: the same
    /// email address is on many logins.
    static func suggested(for setup: TOTPSetup, among items: [VaultItem]) -> [VaultItem] {
        let issuer = setup.issuer.trimmingCharacters(in: .whitespacesAndNewlines)
        let account = setup.account.trimmingCharacters(in: .whitespacesAndNewlines)
        return items
            .filter { $0.kind == .login }
            .filter { item in
                if !issuer.isEmpty {
                    return item.title.localizedStandardContains(issuer)
                        || SharedVault.host(item.website).localizedStandardContains(issuer.replacingOccurrences(of: " ", with: ""))
                }
                return !account.isEmpty && item.account.caseInsensitiveCompare(account) == .orderedSame
            }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
    }

    /// A login that holds the code but is not saved: named for the issuer, with the account as its username. The editor opens on it
    /// and the person saves it or cancels. Nothing is stored from a link.
    static func newLogin(for setup: TOTPSetup) -> VaultItem {
        var item = VaultItem(kind: .login)
        item.title = setup.issuer
        item.account = setup.account
        item.otpSecret = setup.secret
        item.otpSettings = setup.settings
        return item
    }
}
