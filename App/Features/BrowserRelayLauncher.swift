#if os(macOS)
import AppKit
import Foundation

/// Starts the browser relay once, when the app's `VaultSession` exists, and says what became of it. The relay is macOS only: iOS has
/// no long-running app to relay to (docs/plans/browser-relay.md, section 7).
///
/// It serves `ping`, `vaults`, `candidates`, `search`, `credential`, `generate` and `save` from the real session (slices R1, R2, R4).
/// Logins are read only from the open vault a request names, and a password is released only for a login the app has just shown
/// (`OfferLedger`); `save` writes only into the open vault it names, and an update only for a login just offered. Every other request
/// type is answered `unsupported` by the server before it reaches the protocol, until the slice that adds unlock (R3) lands. Cards
/// are the prototype's samples only, so `card-candidates` and `card` are not served either.
@MainActor
final class BrowserRelayLauncher {
    enum Status: Equatable {
        case notStarted
        case running
        /// This build has no App Group container or no team signature (an ad hoc build): nothing to relay with, and the host answers
        /// "not running".
        case notSigned
        /// Another copy of Psss is serving (a development build beside a release build).
        case anotherCopyServes
        case pathTooLong
        case failed(String)
    }

    static let shared = BrowserRelayLauncher()
    private(set) var status = Status.notStarted
    private var server: BrowserRelayServer?

    /// What the relay answers in this slice.
    static let servedTypes: Set<String> = ["ping", "vaults", "candidates", "search", "credential", "generate", "save"]

    private var observers: [NSObjectProtocol] = []

    /// The offer ledger is emptied when the Mac sleeps, the display sleeps, the screen locks and the app quits (a vault locking
    /// empties it too: `SessionVaultService`). It holds no secret, but an old offer must not outlive the person's presence.
    private func clearLedgerOnAbsence() {
        let clear: @Sendable (Notification) -> Void = { _ in BrowserProtocol.ledger.clear() }
        let workspace = NSWorkspace.shared.notificationCenter
        observers = [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification].map {
            workspace.addObserver(forName: $0, object: nil, queue: nil, using: clear)
        }
        observers.append(DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: nil, using: clear))
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil, using: clear))
    }

    func startIfNeeded(session: VaultSession) {
        guard status == .notStarted else { return }
        guard let group = SharedVault.teamPrefixedGroup(in: [SharedVault.groupID]),
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let policy = PeerPolicy.signedNativeHost() else { status = .notSigned; return }

        let service = SessionVaultService(session: session)
        BrowserProtocol.vaultService = service
        clearLedgerOnAbsence()
        let server = BrowserRelayServer(.init(
            directory: container.appendingPathComponent(RelayLimits.folderName, isDirectory: true),
            policy: policy,
            callerAllowed: { ExtensionIDs.callers.contains($0) },
            allowedTypes: Self.servedTypes,
            handler: { request in
                guard let object = RelayFrame.object(request) else { return RelayFrame.error("unsupported") }
                return (try? JSONSerialization.data(withJSONObject: BrowserProtocol.handle(object))) ?? RelayFrame.error("failed")
            }))
        switch server.start() {
        case .listening: status = .running; self.server = server
        case .alreadyServed: status = .anotherCopyServes
        case .pathTooLong: status = .pathTooLong
        case .unavailable(let words): status = .failed(words)
        }
    }
}
#endif
