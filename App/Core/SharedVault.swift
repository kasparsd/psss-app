import AuthenticationServices
import os
import Foundation

/// The prototype's shared storage between the app and its AutoFill extension.
/// Sample items are compiled into both. Logins saved from a web form travel through a small
/// file in the App Group container. A real vault replaces this with the encrypted document.
private let identityLog = Logger(subsystem: "local.kdbox.prototype", category: "identities")

enum SharedVault {
    static let groupID = "group.local.kdbox.prototype"

    /// Where saved logins live for the unsigned browser host, which cannot use the App Group
    /// (macOS still returns a container path for it, but writing there fails). Always nil in the apps.
    nonisolated(unsafe) static var overrideDirectory: URL?

    private static var savedURL: URL? {
        (overrideDirectory ?? FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID))?
            .appendingPathComponent("saved-logins.json")
    }

    static func loadSaved() -> [VaultItem] {
        guard let url = savedURL, let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([VaultItem].self, from: data)) ?? []
    }

    static var allItems: [VaultItem] { SampleVault.items + loadSaved() }

    /// Items for the vault the person chose on first launch: the sample vault, or only their own.
    static func items(source: String) -> [VaultItem] {
        source == "sample" ? allItems : loadSaved()
    }

    static func save(_ item: VaultItem) {
        guard let url = savedURL else { return }
        var saved = loadSaved()
        saved.removeAll { $0.id == item.id }
        saved.append(item)
        try? JSONEncoder().encode(saved).write(to: url, options: .atomic)
    }

    static func delete(_ id: UUID) {
        guard let url = savedURL else { return }
        let remaining = loadSaved().filter { $0.id != id }
        try? JSONEncoder().encode(remaining).write(to: url, options: .atomic)
    }

    /// Removes the logins saved in the App Group, for starting over.
    static func eraseSaved() {
        if let url = savedURL { try? FileManager.default.removeItem(at: url) }
        removeIdentities()
    }

    /// Clears every suggestion from the system's credential identity store.
    static func removeIdentities() {
        ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, _ in }
    }

    /// The host of a service identifier or a stored website, lowercased and without a leading `www.`.
    static func host(_ text: String) -> String {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let url = URL(string: value), let host = url.host { value = host }
        else if let url = URL(string: "https://" + value), let host = url.host { value = host }
        return value.hasPrefix("www.") ? String(value.dropFirst(4)) : value
    }

    /// Conservative matching: the same host, or one is a subdomain of the other.
    static func matches(_ item: VaultItem, host requested: String) -> Bool {
        guard item.kind == .login, !item.website.isEmpty, !requested.isEmpty else { return false }
        let stored = host(item.website)
        return stored == requested || requested.hasSuffix("." + stored) || stored.hasSuffix("." + requested)
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
            return ASPasswordCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: host(item.website), type: .domain),
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
