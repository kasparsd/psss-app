import Foundation
import LocalAuthentication
import Security

/// What the device can use to unlock without typing the vault password.
enum BiometryKind: Sendable {
    case faceID, touchID, opticID

    /// The name shown on the button: "Face ID", "Touch ID" or "Optic ID".
    var label: String {
        switch self {
        case .faceID: String(localized: "Face ID")
        case .touchID: String(localized: "Touch ID")
        case .opticID: String(localized: "Optic ID")
        }
    }

    var symbol: String {
        switch self {
        case .faceID: "faceid"
        case .touchID: "touchid"
        case .opticID: "opticid"
        }
    }

    /// Nil when the device has no enrolled biometry.
    static var current: BiometryKind? {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return nil }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return nil
        }
    }
}

enum BiometricKeyError: Error {
    /// The person cancelled the system prompt: stay on the lock screen, say nothing.
    case cancelled
    /// The saved key is gone, for example because Face ID was re-enrolled. The password is needed once.
    case invalidated
    /// Biometrics cannot be used right now (locked out, a closed lid, not available). The saved key and the setting stay as they are;
    /// the vault password is needed this time.
    case unavailable
    case failed(OSStatus)
}

/// The vault's key (after the KDF), kept in the Keychain behind biometrics so the person does not retype the vault password.
/// The item is readable only on this device, only with the same enrolled fingers or face, and is removed when they change.
/// The vault password always still works.
///
/// On iOS and iPadOS the item is in the data protection keychain with a biometric access control and the shared access group,
/// so the AutoFill extension reads the same item. macOS works the same way in a provisioned build. A build without the
/// entitlements (unsigned, or ad-hoc signed) cannot add that item; the app then keeps the key in the login keychain and asks for
/// Touch ID itself before it reads it. Which of the two holds the key is recorded by the Keychain: saving removes both and adds
/// one, and reading tries the protected item first, so reading always uses the mode the key was saved in. The AutoFill
/// extension on the Mac only ever reads the protected item and never the login keychain.
enum BiometricKey {
    private static let service = "local.kdbox.vault-key"

    private static func baseQuery(for id: UUID, protected: Bool) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: id.uuidString]
        if protected {
            // The App Group (team-prefixed on macOS) doubles as the keychain access group, so the AutoFill extension can read the same item.
            query[kSecUseDataProtectionKeychain as String] = true
            query[kSecAttrAccessGroup as String] = SharedVault.groupID
        }
        return query
    }

    private static func protectedAccessControl() throws -> SecAccessControl {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                           .biometryCurrentSet, &error) else {
            throw BiometricKeyError.failed(errSecParam)
        }
        return access
    }

    #if os(macOS)
    /// What adding or reading a protected item returns in a build that is not provisioned for it: the entitlement is missing
    /// (-34018, what unsigned and ad-hoc builds get), or the parameters do not fit this Mac (-50, -4, -25291).
    private static let unprovisioned: Set<OSStatus> = [-34018, errSecParam, errSecUnimplemented, errSecNotAvailable]

    /// True in an app extension, such as the AutoFill provider. It must never read a key from the login keychain.
    private static var isExtension: Bool { Bundle.main.infoDictionary?["NSExtension"] != nil }
    #endif

    #if HOSTLESS_TESTS
    /// Hostless tests replace the Keychain with this table, so no test touches the real one and no prompt is needed. A test sets
    /// `failure` to make the next loads throw, and edits `memory` to make a saved key stale.
    nonisolated(unsafe) static var memory: [UUID: Data] = [:]
    nonisolated(unsafe) static var failure: BiometricKeyError?
    #endif

    static func save(_ key: Data, for id: UUID) throws {
        #if HOSTLESS_TESTS
        memory[id] = key
        return
        #else
        try saveToKeychain(key, for: id)
        #endif
    }

    private static func saveToKeychain(_ key: Data, for id: UUID) throws {
        delete(for: id)
        var query = baseQuery(for: id, protected: true)
        query[kSecValueData as String] = key
        query[kSecAttrAccessControl as String] = try protectedAccessControl()
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecSuccess { return }
        #if os(macOS)
        // Not provisioned for the protected item: the app keeps the key in the login keychain. An extension never does.
        if unprovisioned.contains(status), !isExtension {
            var login = baseQuery(for: id, protected: false)
            login[kSecValueData as String] = key
            login[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let loginStatus = SecItemAdd(login as CFDictionary, nil)
            guard loginStatus == errSecSuccess else { throw BiometricKeyError.failed(loginStatus) }
            return
        }
        #endif
        throw BiometricKeyError.failed(status)
    }

    /// Shows the system Face ID or Touch ID prompt and returns the key. Runs off the main actor: reading blocks.
    static func load(for id: UUID, reason: String) async throws -> Data {
        #if HOSTLESS_TESTS
        if let failure { throw failure }
        guard let key = memory[id] else { throw BiometricKeyError.invalidated }
        return key
        #else
        return try await Task.detached {
            let context = LAContext()
            context.localizedReason = reason
            var query = baseQuery(for: id, protected: true)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            query[kSecUseAuthenticationContext as String] = context
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            switch status {
            case errSecSuccess:
                guard let data = result as? Data else { throw BiometricKeyError.failed(errSecDecode) }
                return data
            case errSecUserCanceled, errSecAuthFailed:
                throw BiometricKeyError.cancelled
            default:
                #if os(macOS)
                if status == errSecItemNotFound || unprovisioned.contains(status) {
                    // The AutoFill extension reads only the protected item. Say "unavailable", never "invalidated", so the
                    // app's Touch ID setting is not switched off just because the extension cannot see the key.
                    if isExtension { throw BiometricKeyError.unavailable }
                    return try await loadFromLoginKeychain(for: id, reason: reason)
                }
                #else
                if status == errSecItemNotFound { throw BiometricKeyError.invalidated }
                #endif
                throw BiometricKeyError.failed(status)
            }
        }.value
        #endif
    }

    #if os(macOS) && !HOSTLESS_TESTS
    /// The login keychain item of an unprovisioned build. The item has no access control, so the app asks for Touch ID itself.
    private static func loadFromLoginKeychain(for id: UUID, reason: String) async throws -> Data {
        // Look for the item first without a prompt, so an invalidated key does not ask for Touch ID for nothing.
        var probe = baseQuery(for: id, protected: false)
        probe[kSecReturnAttributes as String] = true
        guard SecItemCopyMatching(probe as CFDictionary, nil) == errSecSuccess else { throw BiometricKeyError.invalidated }
        let context = LAContext()
        do { _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) }
        catch let error as LAError where error.code == .userCancel || error.code == .appCancel || error.code == .systemCancel {
            throw BiometricKeyError.cancelled
        } catch let error as LAError where error.code == .biometryNotEnrolled {
            throw BiometricKeyError.invalidated
        } catch {
            // Lockout, biometry not available, a failed match: not a reason to delete the saved key.
            throw BiometricKeyError.unavailable
        }
        var query = baseQuery(for: id, protected: false)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else { throw BiometricKeyError.failed(errSecDecode) }
            return data
        case errSecItemNotFound: throw BiometricKeyError.invalidated
        default: throw BiometricKeyError.failed(status)
        }
    }
    #endif

    static func delete(for id: UUID) {
        #if HOSTLESS_TESTS
        memory[id] = nil
        #else
        SecItemDelete(baseQuery(for: id, protected: true) as CFDictionary)
        #if os(macOS)
        SecItemDelete(baseQuery(for: id, protected: false) as CFDictionary)
        #endif
        #endif
    }
}
