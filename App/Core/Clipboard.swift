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
        pasteboard.clearContents()
        pasteboard.declareTypes([.string, concealed], owner: nil)
        pasteboard.setString(value, forType: .string)
        pasteboard.setString("", forType: concealed)
        let changeCount = pasteboard.changeCount
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            if NSPasteboard.general.changeCount == changeCount { NSPasteboard.general.clearContents() }
        }
        #endif
    }
}
