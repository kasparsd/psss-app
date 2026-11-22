import SwiftUI

@main
struct KDBOXApp: App {
    @FocusedValue(\.newItem) private var newItem
    @FocusedValue(\.lockVault) private var lockVault

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
