import AuthenticationServices
import Foundation

/// The prototype's shared storage between the app and its AutoFill extension.
/// Sample items are compiled into both. Logins saved from a web form travel through a small
/// file in the App Group container. A real vault replaces this with the encrypted document.
enum SharedVault {
    static let groupID = "group.local.kdbox.prototype"

    private static var savedURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)?
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

    /// Tells the system which sites have saved logins and passkeys, without secrets.
    static func registerIdentities(for items: [VaultItem]) {
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
        ASCredentialIdentityStore.shared.getState { state in
            guard state.isEnabled else { return }
            ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities) { _, _ in }
        }
    }
}
