#if os(macOS) && DEBUG
import AppKit
import SwiftUI

/// The panel: the vault switcher and three tabs on top, the tab's content, one status line, and the app's own actions at the
/// bottom (mock `#/menu-bar`). Built from the system's lists, forms and fields; the window supplies the glass behind them.
struct MenuBarPanelView: View {
    @Bindable var model: MenuBarModel

    var body: some View {
        VStack(spacing: 0) {
            if model.hasVault { header }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            if let status = model.status {
                Text(status).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal).padding(.vertical, 8)
            }
            Divider()
            footer
        }
        .frame(width: MenuBarController.panelSize.width, height: MenuBarController.panelSize.height)
        // Escape leaves an item's page first, then closes.
        .onExitCommand { if model.tab == .search, model.opened != nil { model.back() } else { model.close(false) } }
        .background { shortcuts }
    }

    private var header: some View {
        VStack(alignment: .leading) {
            if model.sample != nil {
                LabeledContent("Vault") { Text("Sample vault") }
            } else {
                Picker("Vault", selection: Binding(get: { model.vaultID }, set: { model.choose($0) })) {
                    ForEach(model.session.knownVaults, id: \.id) { vault in
                        Text(model.session.isOpen(vault.id) ? vault.name : String(localized: "\(vault.name) (locked)")).tag(vault.id)
                    }
                }
                .pickerStyle(.menu)
            }
            Picker("Section", selection: Binding(get: { model.tab }, set: { model.show($0) })) {
                Text("Search").tag(MenuBarTab.search)
                Text("Generate").tag(MenuBarTab.generate)
                Text("New Login").tag(MenuBarTab.newLogin)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if model.shortcutTaken { Text("⌃⌘P is used by another app.").foregroundStyle(.secondary) }
        }
        .padding([.horizontal, .top])
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var content: some View {
        if !model.hasVault {
            MenuBarMessage(title: "No vault yet", message: "Create a vault or open a vault file in Psss. Then find your logins here.") {
                Button("Open Psss") { openApp() }.buttonStyle(.borderedProminent)
            }
        } else if model.tab == .generate {
            MenuBarGenerateView(model: model)
        } else if model.store == nil {
            MenuBarLockedView(model: model, openApp: openApp)
        } else if model.tab == .search {
            MenuBarSearchView(model: model, openApp: openApp)
        } else {
            MenuBarNewLoginView(model: model, openApp: openApp).id(model.vaultID)
        }
    }

    private var footer: some View {
        HStack(spacing: 16) {
            Button("Open Psss") { openApp() }
            Button("Settings…") { openSettings() }
            Spacer()
            if model.openCount > 0 {
                Button(model.openCount > 1 ? "Lock All" : "Lock") { model.lockByChoice() }.help("⌘L")
            }
            Button("Quit") { NSApp.terminate(nil) }
        }
        .buttonStyle(.borderless)
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    /// ⌘L and ⌘1 to ⌘3: the app is not in front, so its menus do not answer.
    private var shortcuts: some View {
        Group {
            Button("") { if model.openCount > 0 { model.lockByChoice() } }.keyboardShortcut("l", modifiers: .command)
            Button("") { model.show(.search) }.keyboardShortcut("1", modifiers: .command)
            Button("") { model.show(.generate) }.keyboardShortcut("2", modifiers: .command)
            Button("") { model.show(.newLogin) }.keyboardShortcut("3", modifiers: .command)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    /// Brings Psss forward, with a new window when none is open.
    private func openApp() {
        model.close(true)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration)
    }

    private func openSettings() {
        model.close(true)
        NSApp.activate()
        // The app menu's own Settings item: the scene action is not reachable from a panel outside the scenes.
        guard let menu = NSApp.mainMenu?.items.first?.submenu,
              let index = menu.items.firstIndex(where: { $0.keyEquivalent == "," }) else { return }
        menu.performActionForItem(at: index)
    }
}

/// An empty or blocked state with its actions, as the system draws one.
struct MenuBarMessage<Actions: View>: View {
    let title: LocalizedStringKey
    var message: LocalizedStringKey?
    @ViewBuilder var actions: Actions

    var body: some View {
        ContentUnavailableView {
            Text(title)
        } description: {
            if let message { Text(message) }
        } actions: {
            actions
        }
    }
}

struct MenuBarLockedView: View {
    @Bindable var model: MenuBarModel
    let openApp: () -> Void
    @FocusState private var passwordFocused: Bool

    private var reachable: Bool { model.reference?.isReachable ?? false }

    var body: some View {
        if !reachable {
            MenuBarMessage(title: "\(model.vaultName) isn’t available", message: "Open Psss to see why and to locate or download the vault.") {
                Button("Open Psss", action: openApp).buttonStyle(.borderedProminent)
            }
        } else {
            VStack(spacing: 12) {
                Text("\(model.vaultName) is locked").font(.title2.weight(.semibold))
                if model.away { Text("The lock time passed while you were away.").foregroundStyle(.secondary) }
                if model.canUseBiometrics {
                    Button("Unlock with Touch ID") { Task { await model.unlockWithBiometrics() } }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(model.unlocking)
                    Text("or enter the vault password").foregroundStyle(.secondary)
                }
                HStack {
                    SecureField("Vault password", text: $model.password)
                        .textFieldStyle(.roundedBorder)
                        .focused($passwordFocused)
                        .onSubmit { Task { await model.unlockWithPassword() } }
                    Button("Unlock") { Task { await model.unlockWithPassword() } }.disabled(model.password.isEmpty || model.unlocking)
                }
                .frame(maxWidth: 300)
                if model.unlocking { ProgressView().controlSize(.small) }
                if let failure = model.failure { Text(failure).fixedSize(horizontal: false, vertical: true) }
            }
            .multilineTextAlignment(.center)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onAppear { if !model.canUseBiometrics { passwordFocused = true } }
        }
    }
}
#endif
