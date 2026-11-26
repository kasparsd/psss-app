import SwiftUI

/// The Safari extension reminder: the AutoFill card's look, one labeled button and Later. On Mac the button opens Safari
/// Settings; on iPhone and iPad it opens the steps, because iOS has no link to the switch. Shows nothing when there is nothing to
/// say. What it says and when it shows is decided in App/Core/SafariExtensionReminder.swift.
struct SafariExtensionCard: View {
    @Environment(SafariExtensionStatus.self) private var extensionStatus
    @Environment(AutoFillStatus.self) private var autoFill
    #if os(iOS)
    let showSteps: () -> Void
    #endif

    static func isShown(_ extensionStatus: SafariExtensionStatus, _ autoFill: AutoFillStatus) -> Bool {
        extensionStatus.reminder(after: autoFill.reminder(for: .real)).showsCard
    }

    var body: some View {
        if Self.isShown(extensionStatus, autoFill) {
            ReminderCard(title: SafariExtensionCopy.title, message: SafariExtensionCopy.body(.current)) {
                Button(SafariExtensionCopy.buttonLabel(.current)) {
                    #if os(macOS)
                    Task { await extensionStatus.openSettings() }
                    #else
                    showSteps()
                    #endif
                }
                .buttonStyle(.borderedProminent)
                Button(SafariExtensionCopy.laterLabel) { extensionStatus.snooze() }
                    .buttonStyle(.borderless)
            }
        }
    }
}

/// The reminder cards a list hosts. Only one has something to say at a time: AutoFill first, then the Safari extension, which
/// shows in the vault list on Mac and in the Cards and Addresses places on iPhone and iPad.
struct ReminderCards: View {
    let vault: AutoFillVault
    #if os(iOS)
    /// Set by the Cards and Addresses places. Without it (All, an empty vault) the extension card is not shown.
    var showSafariSteps: (() -> Void)? = nil
    #endif

    var body: some View {
        VStack(spacing: 12) {
            AutoFillCard(vault: vault)
            #if os(macOS)
            SafariExtensionCard()
            #else
            if let showSafariSteps { SafariExtensionCard(showSteps: showSafariSteps) }
            #endif
        }
    }
}

#if os(iOS)
/// The first row of the Cards and Addresses places: whichever reminder card is due, scrolling away with the list. No row when
/// none is.
struct PlaceReminderRow: View {
    @Environment(SafariExtensionStatus.self) private var extensionStatus
    @Environment(AutoFillStatus.self) private var autoFill
    let showSteps: () -> Void

    var body: some View {
        if autoFill.reminder(for: .real).display != .nothing || SafariExtensionCard.isShown(extensionStatus, autoFill) {
            ReminderCards(vault: .real, showSafariSteps: showSteps)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
    }
}

/// What the Cards and Addresses places hang on their list: the cards' Later notices, and the steps sheet (on the list, not on the
/// card's row, so it stays up if the card goes away behind it).
struct PlaceReminders: ViewModifier {
    @Binding var showsSteps: Bool

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                VStack(spacing: 0) {
                    AutoFillLaterNotice()
                    SafariExtensionLaterNotice()
                }
            }
            .sheet(isPresented: $showsSteps) { SafariExtensionStepsSheet() }
    }
}
#endif
