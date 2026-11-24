import Foundation

/// The AutoFill provider's decision to release a secret, kept pure so it can be tested without a device. The provider finds an
/// item by record identifier, then asks here whether what the request names really is that item.
enum ReleaseCheck {
    /// A password goes out only for a login that has one and whose website matches the identity's site (`SharedVault.matches`).
    static func password(item: VaultItem, serviceIdentifier: String) -> Bool {
        let site = SharedVault.host(serviceIdentifier)
        return item.fillValue(for: .password) != nil && !site.isEmpty && SharedVault.matches(item, host: site)
    }

    /// A one-time code goes out only for a login with a readable code setup whose website matches the request's site. There is no
    /// release for a site that cannot be read, and no way to choose a login for another site.
    static func oneTimeCode(item: VaultItem, serviceIdentifier: String) -> Bool {
        let site = SharedVault.host(serviceIdentifier)
        return SharedVault.hasReadableCode(item) && !site.isEmpty && SharedVault.matches(item, host: site)
    }

    /// The code for `item` right now, computed with the item's own digits, period and algorithm.
    static func currentCode(for item: VaultItem, at date: Date = .now) -> String? {
        item.fillValue(for: .oneTimeCode, at: date)
    }

    /// A passkey signs only for the relying party and credential the identity names. The relying party is compared exactly:
    /// a different case or a trailing dot is a different party.
    static func passkey(record: PasskeyRecord, relyingParty: String, credentialID: Data) -> Bool {
        record.rpID == relyingParty && record.credentialID == credentialID
    }
}
