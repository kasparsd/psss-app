import SwiftUI

#if os(macOS)
/// The Safari extension reminder on Mac: the AutoFill card's look, one labeled button and Later. Shows nothing when there is
/// nothing to say. What it says and when it shows is decided in App/Core/SafariExtensionReminder.swift.
struct SafariExtensionCard: View {
    @Environment(SafariExtensionStatus.self) private var extensionStatus
    @Environment(AutoFillStatus.self) private var autoFill

    static func isShown(_ extensionStatus: SafariExtensionStatus, _ autoFill: AutoFillStatus) -> Bool {
        extensionStatus.reminder(autoFill: autoFill.reading).showsCard
    }

    var body: some View {
        if Self.isShown(extensionStatus, autoFill) {
            ReminderCard(title: SafariExtensionCopy.title, message: SafariExtensionCopy.body) {
                Button(SafariExtensionCopy.openLabel) { Task { await extensionStatus.openSettings() } }
                    .buttonStyle(.borderedProminent)
                Button(SafariExtensionCopy.laterLabel) { extensionStatus.snooze() }
                    .buttonStyle(.borderless)
            }
        }
    }
}
#endif

/// The reminder cards the vault list hosts, one under the other: AutoFill first, then on Mac the Safari extension.
struct ReminderCards: View {
    let vault: AutoFillVault

    var body: some View {
        VStack(spacing: 12) {
            AutoFillCard(vault: vault)
            #if os(macOS)
            SafariExtensionCard()
            #endif
        }
    }
}
