#if os(macOS)
import Foundation

/// What the Safari app extension answers for one message from Safari (`Extensions/Safari/SafariWebExtensionHandler.swift`, which only
/// adds Safari's own types around this). The message goes to the running app over the relay as the `safari` caller, and the app's reply
/// comes back as it is. This process holds no key and no vault code.
///
/// When the app is not running there is nothing to relay to: `vaults` is answered from the App Group (every vault locked,
/// `StoredVaultService`), `unlock-vault` asks `launchApp` to start the app and otherwise answers `needs-app`, and everything else
/// answers `not-running`. Every other failure is its protocol error word. The answer is always a protocol reply, never a thrown error.
enum SafariRelay {
    /// The longest anything waits for the app. The app's 90 second unlock is not served over the relay yet.
    static let longestWait: TimeInterval = 10

    static func answer(_ message: [String: Any]?, socketPath path: String?, verifyApp: Bool = true, launchApp: @escaping @Sendable () -> Bool = { false }) -> [String: Any] {
        func fail(_ word: String, id: String = "") -> [String: Any] { ["v": BrowserProtocol.version, "id": id, "ok": false, "error": word] }
        guard let message, JSONSerialization.isValidJSONObject(message),
              let request = try? JSONSerialization.data(withJSONObject: message), RelayFrame.looksLikeObject(request) else { return fail("unsupported") }
        let id = message["id"] as? String ?? ""
        let type = message["type"] as? String
        let wait = min(RelayLimits.replyDeadline(for: type), longestWait) + RelayLimits.hostMargin
        func withoutApp() -> [String: Any] {
            switch type {
            case "vaults", "unlock-vault":
                BrowserProtocol.vaultService = StoredVaultService(launchApp: launchApp)
                return BrowserProtocol.handle(message)
            default:
                return fail(RelayFailure.notRunning.rawValue, id: id)
            }
        }
        // No App Group container (a build signed only to run locally) means no app to reach and nothing stored: the same as no app.
        guard let path else { return withoutApp() }
        switch RelayClient.send(request, caller: RelayLimits.safariCaller, socketPath: path, verifyApp: verifyApp, replyWithin: wait) {
        case .success(let reply):
            return RelayFrame.object(RelayClient.passThrough(reply, id: id)) ?? fail("failed", id: id)
        case .failure(.notRunning):
            return withoutApp()
        case .failure(let failure):
            return fail(failure.rawValue, id: id)
        }
    }
}
#endif
