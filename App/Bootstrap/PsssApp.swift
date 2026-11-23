import SwiftUI

@main
struct PsssApp: App {
    @FocusedValue(\.newItem) private var newItem
    @FocusedValue(\.lockVault) private var lockVault

    init() {
        // Earlier builds may have left real logins in a plain-text file in the App Group. Delete it.
        SharedVault.removeLegacyPlainTextFile()
        // Only the app purges Recently Deleted (items older than 30 days) when it unlocks a vault. The AutoFill extension does not.
        VaultSession.purgesRecentlyDeletedOnUnlock = true
        // Removes the login-keychain items an earlier local build left behind. Does nothing except in a provisioned Mac app.
        BiometricKey.removeLeftoverLoginItems()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 680)
        #endif
        .commands {
            CommandGroup(after: .appVisibility) {
                Button("Lock Psss") { lockVault?() }
                    .keyboardShortcut("l", modifiers: .command)
                    .disabled(lockVault == nil)
            }
            // File, New: the standard place and shortcuts for creating things.
            CommandGroup(replacing: .newItem) {
                Button("New Login") { newItem?(.login) }
                    .keyboardShortcut("n", modifiers: .command)
                    .disabled(newItem == nil)
                Button("New Credit Card") { newItem?(.creditCard) }
                    .keyboardShortcut("n", modifiers: [.command, .option])
                    .disabled(newItem == nil)
                Button("New Secure Note") { newItem?(.secureNote) }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                    .disabled(newItem == nil)
                Button("New Custom Item") { newItem?(.keePassEntry) }
                    .disabled(newItem == nil)
            }
        }
    }
}
