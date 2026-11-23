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

extension BiometryKind {
    private static let rememberedKey = "biometryKind"

    /// The kind this device had when the saved key was made. Messages use it when `current` is nil (a lockout hides it). Stored
    /// beside the vault reference, in the shared defaults where those are available; nothing secret.
    // A local Mac build has no shared defaults (no App Group), so the provider cannot see this name and says "Biometric unlock".
    static var remembered: BiometryKind? {
        switch UserDefaults(suiteName: SharedVault.groupID)?.string(forKey: rememberedKey) {
        case "faceID": .faceID
        case "touchID": .touchID
        case "opticID": .opticID
        default: nil
        }
    }

    static func remember(_ kind: BiometryKind?) {
        guard let kind else { return }
        let name: String
        switch kind {
        case .faceID: name = "faceID"
        case .touchID: name = "touchID"
        case .opticID: name = "opticID"
        }
        UserDefaults(suiteName: SharedVault.groupID)?.set(name, forKey: rememberedKey)
    }

    /// The name for a sentence: what the device has now, else what it had when the key was saved, else "Biometric unlock".
    static var nameForMessages: String {
        (current ?? remembered)?.label ?? String(localized: "Biometric unlock")
    }
}

/// A context that already passed a biometric check. `LAContext` is thread-safe; the wrapper only lets it cross to the task that
/// reads the Keychain.
struct EvaluatedContext: @unchecked Sendable {
    let context: LAContext
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

/// The vault's key (after the KDF), kept in the Keychain so the person does not retype the vault password. The vault password
/// always still works.
///
/// There are two kinds of build, decided once per process and never per error:
/// - Provisioned (every iOS and iPadOS build, and a Mac build signed with the team's profile, which carries the shared
///   `keychain-access-groups` entry): the key is a data protection keychain item with a biometric access control
///   (`.biometryCurrentSet`, this device only) in the shared access group, readable by the AutoFill extension and only with
///   the enrolled face or fingers. This is the only item such a build ever reads or writes, and any error is an error: there
///   is no fallback to a weaker item. A login-keychain item left by an earlier local build is deleted, never read.
/// - Local (an unsigned or ad-hoc signed Mac build, which cannot use the protected item): the key sits in the login keychain,
///   readable on this device, and the app asks for Touch ID itself before it reads it. The AutoFill extension never runs in
///   such a build, and an extension never touches the login keychain.
/// Saving always removes both variants first and adds one.
enum BiometricKey {
    private static let service = "app.psss.vault-key"

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

    /// True when a process whose `keychain-access-groups` entitlement is `keychainGroups` may use the protected item in `group`:
    /// the group has a team prefix (see `SharedVault.teamPrefixedGroup`) and is one of the entitled groups.
    static func isProvisioned(keychainGroups: [String]?, group: String) -> Bool {
        SharedVault.teamPrefixedGroup(in: [group]) != nil && keychainGroups?.contains(group) == true
    }

    #if os(macOS)
    /// Decided once, from this process's own entitlements: does it carry the shared Keychain group?
    private static let provisioned: Bool = {
        let groups = SecTaskCreateFromSelf(nil).flatMap {
            SecTaskCopyValueForEntitlement($0, "keychain-access-groups" as CFString, nil) as? [String]
        }
        return isProvisioned(keychainGroups: groups, group: SharedVault.groupID)
    }()

    /// True in an app extension, such as the AutoFill provider. It must never touch the login keychain.
    private static var isExtension: Bool { Bundle.main.infoDictionary?["NSExtension"] != nil }
    #else
    private static let provisioned = true
    #endif

    #if HOSTLESS_TESTS
    /// Hostless tests replace the Keychain with this table, so no test touches the real one and no prompt is needed. A test sets
    /// `failure` to make loads throw and `saveFailure` to make saves throw, and edits `memory` to make a saved key stale.
    nonisolated(unsafe) static var memory: [UUID: Data] = [:]
    nonisolated(unsafe) static var failure: BiometricKeyError?
    nonisolated(unsafe) static var saveFailure: BiometricKeyError?
    #endif

    /// A provisioned Mac app, once: removes every login-keychain item under Psss's key service, whatever vault it was for. A
    /// local build leaves such items, and a provisioned build uses another group and therefore another stored vault reference,
    /// so the per-vault delete never reaches them. The login keychain is the only one the query can match (no data protection
    /// flag), so the protected item is untouched. Never runs in an extension, in a local build or on iOS. Call it at app start;
    /// reading, saving and deleting call it too, so it has run before any key is used. What happened is recorded only when the
    /// delete succeeded or found nothing.
    static func removeLeftoverLoginItems() {
        #if os(macOS) && !HOSTLESS_TESTS
        guard provisioned, !isExtension else { return }
        let done = "loginKeychainItemsRemoved"
        guard !UserDefaults.standard.bool(forKey: done) else { return }
        // By service only, on purpose: a local build run side by side on this Mac loses its saved key once and asks for the password.
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { UserDefaults.standard.set(true, forKey: done) }
        #endif
    }

    static func save(_ key: Data, for id: UUID) throws {
        #if HOSTLESS_TESTS
        if let saveFailure { throw saveFailure }
        memory[id] = key
        return
        #else
        try saveToKeychain(key, for: id)
        #endif
    }

    private static func saveToKeychain(_ key: Data, for id: UUID) throws {
        removeLeftoverLoginItems()
        delete(for: id)
        #if os(macOS)
        if !provisioned {
            // Local build: the login keychain item. (An extension is never a local build, and never writes this item.)
            guard !isExtension else { throw BiometricKeyError.unavailable }
            var login = baseQuery(for: id, protected: false)
            login[kSecValueData as String] = key
            login[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let status = SecItemAdd(login as CFDictionary, nil)
            guard status == errSecSuccess else { throw BiometricKeyError.failed(status) }
            BiometryKind.remember(BiometryKind.current)
            return
        }
        #endif
        var query = baseQuery(for: id, protected: true)
        query[kSecValueData as String] = key
        query[kSecAttrAccessControl as String] = try protectedAccessControl()
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw BiometricKeyError.failed(status) }
        BiometryKind.remember(BiometryKind.current)
    }

    /// Shows the system Face ID or Touch ID prompt and returns the key. Runs off the main actor: reading blocks.
    ///
    /// `evaluated` is a context that already passed a biometric check, for example one bound to the lock screen's embedded
    /// Touch ID view (macOS). No second prompt is shown: the provisioned item is read with that context, and a local build skips
    /// its own check because that context is the check.
    static func load(for id: UUID, reason: String, evaluated: EvaluatedContext? = nil) async throws -> Data {
        #if HOSTLESS_TESTS
        if let failure { throw failure }
        guard let key = memory[id] else { throw BiometricKeyError.invalidated }
        return key
        #else
        return try await Task.detached {
            #if os(macOS)
            removeLeftoverLoginItems()
            guard provisioned else {
                guard !isExtension else { throw BiometricKeyError.unavailable }
                return try await loadFromLoginKeychain(for: id, reason: reason, evaluated: evaluated)
            }
            // A login-keychain item from an earlier local build must never open this build: it is not tied to the enrolled
            // fingers. The app removes it; an extension leaves the login keychain alone.
            if !isExtension { SecItemDelete(baseQuery(for: id, protected: false) as CFDictionary) }
            #endif
            let context = evaluated?.context ?? LAContext()
            if evaluated == nil { context.localizedReason = reason }
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
            case errSecItemNotFound:
                // The item is gone: the enrolled face or fingers changed, or it was never saved. The extension only reports
                // "unavailable", so it never switches the app's setting off.
                #if os(macOS)
                if isExtension { throw BiometricKeyError.unavailable }
                #endif
                throw BiometricKeyError.invalidated
            default:
                #if os(macOS)
                // Anything else (interaction not allowed, a busy keychain, ...) may be transient: keep the key and the setting.
                throw BiometricKeyError.unavailable
                #else
                throw BiometricKeyError.failed(status)
                #endif
            }
        }.value
        #endif
    }

    #if os(macOS) && !HOSTLESS_TESTS
    /// The login keychain item of an unprovisioned build. The item has no access control, so the app asks for Touch ID itself.
    private static func loadFromLoginKeychain(for id: UUID, reason: String, evaluated: EvaluatedContext?) async throws -> Data {
        // Look for the item first without a prompt, so an invalidated key does not ask for Touch ID for nothing.
        var probe = baseQuery(for: id, protected: false)
        probe[kSecReturnAttributes as String] = true
        guard SecItemCopyMatching(probe as CFDictionary, nil) == errSecSuccess else { throw BiometricKeyError.invalidated }
        let context = LAContext()
        do { if evaluated == nil { _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) } }
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
        // Anything else may be transient: keep the key and the setting, and ask for the password this once.
        default: throw BiometricKeyError.unavailable
        }
    }
    #endif

    static func delete(for id: UUID) {
        #if HOSTLESS_TESTS
        memory[id] = nil
        #else
        removeLeftoverLoginItems()
        SecItemDelete(baseQuery(for: id, protected: true) as CFDictionary)
        #if os(macOS)
        // An extension never touches the login keychain.
        if !isExtension { SecItemDelete(baseQuery(for: id, protected: false) as CFDictionary) }
        #endif
        #endif
    }
}
