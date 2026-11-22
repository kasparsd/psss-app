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
    case failed(OSStatus)
}

/// The vault's key (after the KDF), kept in the Keychain behind biometrics so the person does not retype the vault password.
/// The item is readable only on this device, only with the same enrolled fingers or face, and is removed when they change.
/// The vault password always still works.
enum BiometricKey {
    private static let service = "local.kdbox.vault-key"

    private static func baseQuery(for id: UUID) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: id.uuidString]
        for (key, value) in dataProtection { query[key] = value }
        return query
    }

    #if os(macOS)
    // The data protection keychain with a biometric access control needs a provisioned build. The login keychain item is
    // protected by this device and the signed app, and the app asks for Touch ID itself before it reads it.
    private static var dataProtection: [String: Any] { [:] }
    #else
    // The App Group doubles as the keychain access group, so the AutoFill extension can read the same item.
    private static var dataProtection: [String: Any] {
        [kSecUseDataProtectionKeychain as String: true, kSecAttrAccessGroup as String: SharedVault.groupID]
    }
    #endif

    static func save(_ key: Data, for id: UUID) throws {
        delete(for: id)
        var query = baseQuery(for: id)
        query[kSecValueData as String] = key
        #if os(macOS)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        #else
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                           .biometryCurrentSet, &error) else {
            throw BiometricKeyError.failed(errSecParam)
        }
        query[kSecAttrAccessControl as String] = access
        #endif
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw BiometricKeyError.failed(status) }
    }

    /// Shows the system Face ID or Touch ID prompt and returns the key. Runs off the main actor: reading blocks.
    static func load(for id: UUID, reason: String) async throws -> Data {
        try await Task.detached {
            let context = LAContext()
            context.localizedReason = reason
            #if os(macOS)
            do { _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) }
            catch let error as LAError where error.code == .userCancel || error.code == .appCancel || error.code == .systemCancel {
                throw BiometricKeyError.cancelled
            } catch {
                throw BiometricKeyError.invalidated
            }
            #endif
            var query = baseQuery(for: id)
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
            case errSecItemNotFound:
                throw BiometricKeyError.invalidated
            default:
                throw BiometricKeyError.failed(status)
            }
        }.value
    }

    static func delete(for id: UUID) {
        SecItemDelete(baseQuery(for: id) as CFDictionary)
    }
}
