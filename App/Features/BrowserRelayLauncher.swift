#if os(macOS)
import Foundation

/// Starts the browser relay once, when the app's `VaultSession` exists, and says what became of it. The relay is macOS only: iOS has
/// no long-running app to relay to (docs/plans/browser-relay.md, section 7).
///
/// It serves `ping` and `vaults` from the real session (slice R1). Every other request type is answered `unsupported` by the
/// server before it reaches the protocol, until the slices that add the offer ledger (R2), unlock (R3) and save (R4) land.
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
    static let servedTypes: Set<String> = ["ping", "vaults"]

    func startIfNeeded(session: VaultSession) {
        guard status == .notStarted else { return }
        guard let group = SharedVault.teamPrefixedGroup(in: [SharedVault.groupID]),
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let policy = PeerPolicy.signedNativeHost() else { status = .notSigned; return }

        let service = SessionVaultService(session: session)
        BrowserProtocol.vaultService = service
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
