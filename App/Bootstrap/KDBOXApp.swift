import SwiftUI

@main
struct KDBOXApp: App {
    @FocusedValue(\.newItem) private var newItem

    var body: some Scene {
        WindowGroup {
            VaultView(items: SharedVault.allItems)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 680)
        #endif
        .commands {
            // File, New: the standard place and shortcuts for creating things.
            CommandGroup(replacing: .newItem) {
                Button("New Login") { newItem?(.login) }
                    .keyboardShortcut("n", modifiers: .command)
                Button("New Credit Card") { newItem?(.creditCard) }
                    .keyboardShortcut("n", modifiers: [.command, .option])
                Button("New Secure Note") { newItem?(.secureNote) }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                Button("New Custom Item") { newItem?(.keePassEntry) }
            }
        }
    }
}
