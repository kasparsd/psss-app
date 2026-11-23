import Foundation

/// The AutoFill provider's decision to release a secret, kept pure so it can be tested without a device. The provider finds an
/// item by record identifier, then asks here whether what the request names really is that item.
enum ReleaseCheck {
    /// A password goes out only for a login that has one and whose website matches the identity's site (`SharedVault.matches`).
    static func password(item: VaultItem, serviceIdentifier: String) -> Bool {
        let site = SharedVault.host(serviceIdentifier)
        return item.kind == .login && !item.secret.isEmpty && !site.isEmpty && SharedVault.matches(item, host: site)
    }

    /// A passkey signs only for the relying party and credential the identity names. The relying party is compared exactly:
    /// a different case or a trailing dot is a different party.
    static func passkey(record: PasskeyRecord, relyingParty: String, credentialID: Data) -> Bool {
        record.rpID == relyingParty && record.credentialID == credentialID
    }
}
