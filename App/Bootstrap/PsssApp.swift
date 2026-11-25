import SwiftUI

@main
struct PsssApp: App {
    @FocusedValue(\.newItem) private var newItem
    @FocusedValue(\.vaultMenu) private var vaultMenu
    @FocusedValue(\.openSetup) private var openSetup
    @FocusedValue(\.startAddVault) private var startAddVault
    @FocusedValue(\.deleteSelection) private var deleteSelection
    // One of each for the whole app: the vault window and the Mac Settings window read the same lock state and vault.
    @State private var gate = UnlockGate()
    @State private var session = VaultSession()
    @State private var autoFill = AutoFillStatus.live()
    @State private var safariExtension = SafariExtensionStatus.live()
    @State private var settingsRequests = SettingsRequests()
    @State private var incomingCodes = IncomingCodeRequests()

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
            RootView(gate: gate, session: session, autoFill: autoFill, safariExtension: safariExtension)
                .equatable()
                .environment(settingsRequests)
                .environment(incomingCodes)
                // A site's “set up authenticator” link. It only queues; the unlocked vault asks which login it belongs to.
                .onOpenURL { incomingCodes.receive($0) }
                #if os(macOS)
                // The browser relay starts once, as soon as the session exists. Later windows find it running.
                .task { BrowserRelayLauncher.shared.startIfNeeded(session: session) }
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 680)
        // A link opens in the window that is there, not in a new one.
        .handlesExternalEvents(matching: ["*"])
        #endif
        .commands {
            VaultPlaceCommands()
            ItemFilterCommands()
            ItemSortCommands()
            #if os(iOS)
            // Psss, Settings… (⌘,) on iPad with a keyboard. The Mac has a Settings window, and the system adds its own menu item.
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { openSetup?() }
                    .keyboardShortcut(",", modifiers: .command)
            }
            #endif
            // Edit, Delete stays the system's own item (a focused text field answers it, and the item list answers it with
            // `onDeleteCommand`, VaultView). Under it the same move in words, with ⌘⌫: "Move to Recently Deleted" (owner,
            // 2026-11-24), or "Delete Now…" for an item that is already there. Off while a text field is being typed in, so ⌘⌫
            // still edits text.
            CommandGroup(after: .pasteboard) {
                Button(deleteSelection?.permanent == true ? "Delete Now…" : LocalizedStringKey(RecentlyDeletedText.moveButton)) { deleteSelection?.run() }
                    .keyboardShortcut(.delete, modifiers: .command)
                    .disabled(deleteSelection == nil)
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
                Divider()
                // The three ways to add a vault, then the current vault's two actions (owner, 2026-11-25, mock `#/vault-switcher`).
                ForEach(AddVaultChoice.all) { choice in
                    Button(choice.menuTitle) { startAddVault?(choice) }
                        .disabled(startAddVault == nil)
                }
                Divider()
                Button("Vault Settings…") { vaultMenu?.settings() }
                    .disabled(vaultMenu == nil)
                Button(vaultMenu?.lockTitle ?? String(localized: "Lock Vault")) { vaultMenu?.lock?() }
                    .keyboardShortcut("l", modifiers: .command)
                    .disabled(vaultMenu?.lock == nil)
            }
        }
        #if os(macOS)
        Settings {
            MacSettingsView()
                .environment(gate)
                .environment(session)
                .environment(autoFill)
                .environment(safariExtension)
                .environment(settingsRequests)
        }
        #endif
    }
}
