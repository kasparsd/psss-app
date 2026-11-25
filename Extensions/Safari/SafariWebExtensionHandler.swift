import AppKit
import OSLog
import SafariServices

/// Receives the extension's native messages in Safari and relays them to the running Psss app, like the native messaging host does
/// for Chrome and Firefox (`App/Core/Relay/RelayClient.swift`; docs/browser-extension.md, "Safari on Mac"). Safari ignores the host
/// name the extension passes and always delivers to this app extension, and only background scripts and extension pages can reach
/// it, which is where the popup runs.
///
/// This process holds no key and no vault code. The app checks this extension's signature (the team and the bundle identifier) and
/// decides who is calling from that, never from the message; this process checks the app's signature before it sends anything.
/// The app's reply goes back to Safari as it is.
///
/// When the app is not running, there is nothing to relay to: `vaults` is answered from the App Group (every vault locked,
/// `StoredVaultService`), `unlock-vault` tries to start the app and otherwise answers `needs-app`, and everything else answers
/// `not-running` (`SafariRelay`). The request is kept within a few seconds: the app's 90 second unlock is not served yet.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let log = Logger(subsystem: "app.psss", category: "safari-handler")

    func beginRequest(with context: NSExtensionContext) {
        let started = Date()
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let reply = Self.answer(message)
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response])
        // Measures how long a request takes in Safari (type and error word only, never an origin, a name or a secret).
        Self.log.debug("request \(message?["type"] as? String ?? "?", privacy: .public) \(reply["error"] as? String ?? "ok", privacy: .public) \(Int(Date().timeIntervalSince(started) * 1000)) ms")
    }

    /// The reply for one message from Safari (`SafariRelay`).
    static func answer(_ message: [String: Any]?) -> [String: Any] {
        let path = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedVault.groupID)?
            .appendingPathComponent(RelayLimits.folderName, isDirectory: true).appendingPathComponent(RelayLimits.socketName).path
        return SafariRelay.answer(message, socketPath: path, launchApp: launchContainingApp)
    }

    /// Starts the Psss app that contains this extension (`Psss.app/Contents/PlugIns/….appex`), for an unlock the person asked for.
    /// True when the system reports it started. A failure, or an extension the system does not let start an app, is `false`, and the
    /// popup then says "Open Psss to unlock …". Waits at most three seconds.
    private static func launchContainingApp() -> Bool {
        let app = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard app.pathExtension == "app", Bundle(url: app)?.bundleIdentifier == PeerIdentity.appIdentifier else { return false }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let done = DispatchSemaphore(value: 0)
        let result = LaunchResult()
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
            result.set(error == nil)
            done.signal()
        }
        return done.wait(timeout: .now() + 3) == .success && result.value
    }

    private final class LaunchResult: @unchecked Sendable {
        private let lock = NSLock()
        private var stored = false
        var value: Bool { lock.lock(); defer { lock.unlock() }; return stored }
        func set(_ value: Bool) { lock.lock(); stored = value; lock.unlock() }
    }
}
