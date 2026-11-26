import AuthenticationServices
import os
import Foundation
import Security

/// What the app and its AutoFill extension share: the App Group identifiers, the credential identity store and the site rule.
/// No credential is stored here. Logins live only in the encrypted vault file; the sample vault is in memory.
private let identityLog = Logger(subsystem: "app.psss.Psss", category: "identities")

enum SharedVault {
    /// The App Group of the app and its AutoFill provider: the vault files, the vault list and shared settings. On the Mac it is
    /// also the Keychain access group the biometric key sits in; iPhone and iPad keep that key in a group of its own
    /// (`BiometricKey.accessGroup`). The iPhone and iPad Safari extension lists neither.
    ///
    /// iOS and iPadOS use a `group.` identifier. On macOS 15 and later an extension is refused the group container unless the
    /// identifier starts with the team identifier (or a provisioning profile or the Mac App Store authorises it), so the Mac
    /// entitlements say `$(TeamIdentifierPrefix)app.psss` and the running process reads which identifier it was
    /// really signed with. An unsigned build carries no entitlements, so it falls back to the `group.` identifier, whose
    /// container is then unavailable and the vault lives in the app's own Application Support, as before.
    static let groupID: String = {
        #if os(macOS)
        return signedGroupID ?? defaultGroupID
        #else
        return defaultGroupID
        #endif
    }()

    private static let defaultGroupID = "group.app.psss"

    /// iPhone and iPad: the App Group of the app and the Safari extension. It holds only the extension's copy of the vault list
    /// (`VaultReference.mirrorForSafari`) and its "seen" note. The extension compiles `App/SafariFill` and not this file, so
    /// `SafariFillAppGroup.id` repeats it; `scripts/test-safari-fill.sh` checks that the two agree.
    static let safariGroupID = "group.app.psss.safari"

    /// The first identifier in `groups` that starts with a team identifier: ten letters or digits (upper case), a dot and
    /// then a name. What `$(TeamIdentifierPrefix)` leaves in a build with no team (`app.psss`, or one that starts
    /// with a dot) is refused, because macOS would not give an extension that group's container anyway.
    static func teamPrefixedGroup(in groups: [String]) -> String? {
        groups.first { group in
            let bytes = Array(group.utf8)
            guard bytes.count > 11, bytes[10] == 46 else { return false }
            return bytes[..<10].allSatisfy { ($0 >= 65 && $0 <= 90) || ($0 >= 48 && $0 <= 57) } && bytes[11] != 46
        }
    }

    #if os(macOS)
    /// The team-prefixed App Group in this process's entitlements, or nil when it has none.
    private static var signedGroupID: String? {
        guard let task = SecTaskCreateFromSelf(nil),
              let groups = SecTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil) as? [String]
        else { return nil }
        return teamPrefixedGroup(in: groups)
    }
    #endif

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
        guard item.fillValue(for: .loginWebsite) != nil else { return false }
        return SiteMatch.matches(stored: item.website, requested: requested)
    }

    /// Tells the system which sites have saved logins and passkeys, without secrets. Fire and forget; the AutoFill extension
    /// uses `registerSavedAndWait` so the system finishes before the extension is torn down.
    ///
    /// Nothing is sent while AutoFill is off. `knownEnabled` is for the moment the app has just found AutoFill on (or been told
    /// so by the system's prompt): it sends at once, so the logins that were saved while AutoFill was off are offered without
    /// waiting for the next unlock, and a state that has not caught up yet cannot make it skip.
    static func registerIdentities(_ identities: [any ASCredentialIdentity], knownEnabled: Bool = false) {
        // The identities are plain values the system only reads; the task is the only one that touches this copy.
        nonisolated(unsafe) let identities = identities
        Task {
            let store = ASCredentialIdentityStore.shared
            if !knownEnabled, await !store.state().isEnabled { return }
            // A failed replacement used to vanish silently, so a new login was simply never offered. Log the code and retry
            // once while the store is busy, as the AutoFill extension does.
            for attempt in 0..<3 {
                do {
                    try await store.replaceCredentialIdentities(identities)
                    return
                } catch {
                    let error = error as NSError
                    identityLog.error("Identity registration failed, domain \(error.domain, privacy: .public), code \(error.code)")
                    let busy = error.domain == ASCredentialIdentityStoreErrorDomain
                        && error.code == ASCredentialIdentityStoreError.Code.storeBusy.rawValue
                    guard busy, attempt < 2 else { return }
                    try? await Task.sleep(for: .milliseconds(500))
                }
            }
        }
    }

    /// For the AutoFill extension: tells the system about the item it just saved and returns once the system has accepted it,
    /// so the request is not completed (and the extension torn down) before the suggestion exists. Adds only `changed` when the
    /// store supports incremental updates, and replaces everything with `all` when it does not. Retries once when the store is
    /// busy. Does nothing when AutoFill is not enabled for Psss. A failure is logged with its error code only.
    static func registerSavedAndWait(_ changed: [VaultItem], in vault: UUID, all: [any ASCredentialIdentity]) async {
        let store = ASCredentialIdentityStore.shared
        let state = await store.state()
        guard state.isEnabled else { return }
        for attempt in 0..<2 {
            do {
                if state.supportsIncrementalUpdates {
                    try await store.saveCredentialIdentities(identities(for: changed, vault: vault))
                } else {
                    try await store.replaceCredentialIdentities(all)
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

    /// True for a login with a one-time code setup that makes a code now. The provider offers a code only for such a login.
    static func hasReadableCode(_ item: VaultItem) -> Bool {
        item.fillValue(for: .oneTimeCode) != nil
    }

    /// The system's suggestions for one vault's items, each tied to its vault by `IdentityRecord` (the provider finds the vault from it).
    static func identities(for items: [VaultItem], vault: UUID) -> [any ASCredentialIdentity] {
        var identities: [any ASCredentialIdentity] = items.compactMap { item in
            guard item.fillValue(for: .password) != nil, !item.visibleWebsite.isEmpty, !item.visibleAccount.isEmpty else { return nil }
            let site = host(item.visibleWebsite)
            guard !site.isEmpty else { return nil }  // malformed website: nothing to register
            return ASPasswordCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: site, type: .domain),
                user: item.visibleAccount,
                recordIdentifier: IdentityRecord.make(vault: vault, item: item.id))
        }
        identities += items.compactMap { item in
            guard let passkey = item.passkey else { return nil }
            return ASPasskeyCredentialIdentity(
                relyingPartyIdentifier: passkey.rpID,
                userName: item.visibleAccount.isEmpty ? item.displayTitle : item.visibleAccount,
                credentialID: passkey.credentialID,
                userHandle: passkey.userHandle,
                recordIdentifier: IdentityRecord.make(vault: vault, item: item.id))
        }
        // One-time codes (iOS 18, macOS 15): a login with a readable code and a website. The label is the account, or the name
        // when the account is empty.
        if #available(iOS 18.0, macOS 15.0, *) {
            identities += items.compactMap { item in
                guard hasReadableCode(item) else { return nil }
                let site = host(item.visibleWebsite)
                guard !site.isEmpty else { return nil }
                return ASOneTimeCodeCredentialIdentity(
                    serviceIdentifier: ASCredentialServiceIdentifier(identifier: site, type: .domain),
                    label: item.visibleAccount.isEmpty ? item.displayTitle : item.visibleAccount,
                    recordIdentifier: IdentityRecord.make(vault: vault, item: item.id))
            }
        }
        return identities
    }
}

/// The record identifier of an AutoFill suggestion: the vault and the item it belongs to, so the provider opens that vault and finds
/// the item there, and two vaults that hold the same item (a copied file) never mix. Both are random identifiers; nothing about the
/// site or the account is in it.
enum IdentityRecord {
    static func make(vault: UUID, item: UUID) -> String { "\(vault.uuidString)/\(item.uuidString)" }

    /// Nil for anything that is not exactly two identifiers (a hostile or an old record): the provider then offers its list instead.
    static func parse(_ record: String?) -> (vault: UUID, item: UUID)? {
        guard let record else { return nil }
        let parts = record.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, let vault = UUID(uuidString: String(parts[0])), let item = UUID(uuidString: String(parts[1])) else { return nil }
        return (vault, item)
    }
}
