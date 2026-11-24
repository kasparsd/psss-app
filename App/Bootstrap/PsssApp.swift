import SwiftUI

@main
struct PsssApp: App {
    @FocusedValue(\.newItem) private var newItem
    @FocusedValue(\.lockVault) private var lockVault
    @FocusedValue(\.openSetup) private var openSetup
    @FocusedValue(\.deleteSelection) private var deleteSelection

    init() {
        // Earlier builds may have left real logins in a plain-text file in the App Group. Delete it.
        SharedVault.removeLegacyPlainTextFile()
        // Only the app purges Recently Deleted (items older than 30 days) when it unlocks a vault. The AutoFill extension does not.
        VaultSession.purgesRecentlyDeletedOnUnlock = true
        #if os(iOS)
        // Undo is the capsule after Move to Recently Deleted (and Command-Z on iPad). Shaking the phone must not undo anything.
        UIApplication.shared.applicationSupportsShakeToEdit = false
        #elseif os(macOS)
        // The window has its own sidebar of places, so the system's "Show Tab Bar" and "Show All Tabs" would only confuse.
        NSWindow.allowsAutomaticWindowTabbing = false
        #endif
        // Removes the login-keychain items an earlier local build left behind. Does nothing except in a provisioned Mac app.
        BiometricKey.removeLeftoverLoginItems()
        #if DEBUG
        SyncSpikeHarness.startIfRequested()   // sync spike: does nothing without -psss-sync-spike
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 680)
        #endif
        .commands {
            VaultPlaceCommands()
            ItemFilterCommands()
            ItemSortCommands()
            // Psss, Settings… (⌘,): where the Mac window has no Setup gear.
            CommandGroup(replacing: .appSettings) {
                // Always enabled: with no window to show it in, the press does nothing rather than greying the item out.
                Button("Settings…") { openSetup?() }
                    .keyboardShortcut(",", modifiers: .command)
            }
            // Edit, Delete stays the system's own item (a focused text field answers it, and the item list answers it with
            // `onDeleteCommand`, VaultView). Under it the same move in words, with ⌘⌫: "Move to Recently Deleted" (owner,
            // 2026-11-24), or "Delete Now…" for an item that is already there. Off while a text field is being typed in, so ⌘⌫
            // still edits text.
            CommandGroup(after: .pasteboard) {
                Button(deleteSelection?.permanent == true ? "Delete Now…" : LocalizedStringKey(RecentlyDeletedText.moveButton)) { deleteSelection?.run() }
                    .keyboardShortcut(.delete, modifiers: .command)
                    .disabled(deleteSelection == nil)
            }
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
                Button("New Card") { newItem?(.creditCard) }
                    .keyboardShortcut("n", modifiers: [.command, .option])
                    .disabled(newItem == nil)
                Button("New Note") { newItem?(.secureNote) }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                    .disabled(newItem == nil)
                Button("New Custom Item") { newItem?(.keePassEntry) }
                    .disabled(newItem == nil)
                Button("New Wi-Fi Network") { newItem?(.wifi) }
                    .disabled(newItem == nil)
            }
        }
    }
}
