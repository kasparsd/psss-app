import AuthenticationServices
import os
import Foundation

/// What the app and its AutoFill extension share: the App Group identifier, the credential identity store and the site rule.
/// No credential is stored here. Logins live only in the encrypted vault file; the sample vault is in memory.
private let identityLog = Logger(subsystem: "local.kdbox.prototype", category: "identities")

enum SharedVault {
    static let groupID = "group.local.kdbox.prototype"

    /// Earlier builds saved logins from AutoFill and the sample vault to a plain-text file in the App Group. Deletes it, if
    /// it is still there. Called once from app start, because that file may hold real credentials.
    static func removeLegacyPlainTextFile() {
        guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) else { return }
        try? FileManager.default.removeItem(at: group.appendingPathComponent("saved-logins.json"))
    }

    /// Clears every suggestion from the system's credential identity store.
    static func removeIdentities() {
        ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, _ in }
    }

    /// The host of a service identifier or a stored website, lowercased and without a leading `www.`.
    static func host(_ text: String) -> String { SiteMatch.normalizedHost(text) }

    /// A login is offered on its own host and on subdomains of it, never on its parent and never under a public suffix
    /// (see `SiteMatch`).
    static func matches(_ item: VaultItem, host requested: String) -> Bool {
        guard item.kind == .login, !item.website.isEmpty else { return false }
        return SiteMatch.matches(stored: item.website, requested: requested)
    }

    /// Tells the system which sites have saved logins and passkeys, without secrets. Fire and forget; the AutoFill extension
    /// uses `registerSavedAndWait` so the system finishes before the extension is torn down.
    static func registerIdentities(for items: [VaultItem]) {
        ASCredentialIdentityStore.shared.getState { state in
            guard state.isEnabled else { return }
            ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities(for: items)) { _, _ in }
        }
    }

    /// For the AutoFill extension: tells the system about the item it just saved and returns once the system has accepted it,
    /// so the request is not completed (and the extension torn down) before the suggestion exists. Adds only `changed` when the
    /// store supports incremental updates, and replaces everything with `all` when it does not. Retries once when the store is
    /// busy. Does nothing when AutoFill is not enabled for Psss. A failure is logged with its error code only.
    static func registerSavedAndWait(_ changed: [VaultItem], all: [VaultItem]) async {
        let store = ASCredentialIdentityStore.shared
        let state = await store.state()
        guard state.isEnabled else { return }
        for attempt in 0..<2 {
            do {
                if state.supportsIncrementalUpdates {
                    try await store.saveCredentialIdentities(identities(for: changed))
                } else {
                    try await store.replaceCredentialIdentities(identities(for: all))
                }
                return
            } catch {
                let error = error as NSError
                identityLog.error("Identity registration failed, domain \(error.domain, privacy: .public), code \(error.code)")
                let busy = error.domain == ASCredentialIdentityStoreErrorDomain
                    && error.code == ASCredentialIdentityStoreError.Code.storeBusy.rawValue
                guard busy, attempt == 0 else { return }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    private static func identities(for items: [VaultItem]) -> [any ASCredentialIdentity] {
        var identities: [any ASCredentialIdentity] = items.compactMap { item in
            guard item.kind == .login, !item.website.isEmpty, !item.account.isEmpty, !item.secret.isEmpty else { return nil }
            let site = host(item.website)
            guard !site.isEmpty else { return nil }  // malformed website: nothing to register
            return ASPasswordCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: site, type: .domain),
                user: item.account,
                recordIdentifier: item.id.uuidString)
        }
        identities += items.compactMap { item in
            guard let passkey = item.passkey else { return nil }
            return ASPasskeyCredentialIdentity(
                relyingPartyIdentifier: passkey.rpID,
                userName: item.account.isEmpty ? item.displayTitle : item.account,
                credentialID: passkey.credentialID,
                userHandle: passkey.userHandle,
                recordIdentifier: item.id.uuidString)
        }
        return identities
    }
}
