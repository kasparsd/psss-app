import Foundation
#if os(iOS)
import UIKit
import UniformTypeIdentifiers
#else
import AppKit
#endif

/// Copies a secret so it stays on this device, is hidden from clipboard managers where the platform allows,
/// and disappears after `expiresAfter` seconds.
enum Clipboard {
    @MainActor
    static func copy(_ value: String, expiresAfter seconds: TimeInterval = 60) {
        #if os(iOS)
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: value]],
            options: [.localOnly: true, .expirationDate: Date(timeIntervalSinceNow: seconds)]
        )
        #else
        let pasteboard = NSPasteboard.general
        let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
        // This Mac only: not offered to the person's other devices.
        pasteboard.prepareForNewContents(with: .currentHostOnly)
        pasteboard.addTypes([.string, concealed], owner: nil)
        pasteboard.setString(value, forType: .string)
        pasteboard.setString("", forType: concealed)
        let changeCount = pasteboard.changeCount
        pending = changeCount
        // Quitting must not leave the secret behind: the timer below dies with the app.
        if quitObserver == nil {
            quitObserver = NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { clear(ifStill: pending) }
            }
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            clear(ifStill: changeCount)
        }
        #endif
    }

    #if os(macOS)
    /// The change count of the last secret copied.
    @MainActor private static var pending: Int?
    @MainActor private static var quitObserver: (any NSObjectProtocol)?

    /// Clears the clipboard only while it still holds that copy.
    @MainActor private static func clear(ifStill changeCount: Int?) {
        if NSPasteboard.general.changeCount == changeCount { NSPasteboard.general.clearContents() }
    }
    #endif
}
