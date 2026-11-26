import Foundation
import SafariServices
import os

extension UserDefaults: SafariFillVaultSource {}

/// Receives the popup's native messages in Safari on iPhone and iPad and answers them from the short-lived card and address
/// grant (`SafariFillHandler`; docs/plans/ios-safari-fill.md, section 4). There is no running app to relay to, unlike on the Mac
/// (`Extensions/Safari`). This process holds no key and no vault code: it reads one Keychain item that the app writes, and the
/// app's copy of the vault list (identifiers and names) from an App Group that holds nothing else of the vaults
/// (`SafariFillAppGroup`).
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let log = Logger(subsystem: "app.psss", category: "safari-fill")

    func beginRequest(with context: NSExtensionContext) {
        let started = ContinuousClock.now
        // The app's only sign that the person has turned the extension on.
        SafariExtensionSeen().record()
        // The message goes on as Safari handed it over: the handler judges its shape.
        let message = (context.inputItems.first as? NSExtensionItem)?.userInfo?[SFExtensionMessageKey]
        let handler = SafariFillHandler(store: KeychainSafariFillStore(), vaults: SafariFillVaultList(source: Self.appGroup()))
        let reply = handler.reply(to: message)
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply.message]
        context.completeRequest(returningItems: [response])
        // The type, the error word and the time. Never the message or the reply: they hold the person's data.
        let elapsed = (ContinuousClock.now - started).components
        let milliseconds = elapsed.seconds * 1000 + elapsed.attoseconds / 1_000_000_000_000_000
        Self.log.info("request \(reply.type ?? "unknown", privacy: .public) \(reply.refusal?.rawValue ?? "ok", privacy: .public) \(milliseconds, privacy: .public) ms")
    }

    /// The App Group's preferences, or nil when this process cannot open the group. `UserDefaults(suiteName:)` alone would hand
    /// back an empty stand-in, which would read as "no vault is listed".
    private static func appGroup() -> UserDefaults? {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SafariFillAppGroup.id) != nil else { return nil }
        return UserDefaults(suiteName: SafariFillAppGroup.id)
    }
}
