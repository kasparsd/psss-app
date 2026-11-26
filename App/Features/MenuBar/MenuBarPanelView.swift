#if os(macOS) && DEBUG
import AppKit
import SwiftUI

/// The panel: the vault switcher and three tabs on top, the tab's content with the Copied pill over it, and the app's own actions at the
/// bottom (mock `#/menu-bar`). Built from the system's lists, forms and fields; the window supplies the glass behind them.
struct MenuBarPanelView: View {
    @Bindable var model: MenuBarModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            if model.hasVault { header }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
                // Over the tab for two seconds, so nothing moves when it appears.
                .overlay(alignment: .bottom) {
                    if let offer = model.pill.offer { CopiedPill(message: offer.message).allowsHitTesting(false) }
                }
                .animation(reduceMotion ? .easeInOut(duration: 0.2) : .snappy, value: model.pill.offer)
            Divider()
            footer
        }
        .frame(width: MenuBarController.panelSize.width, height: MenuBarController.panelSize.height)
        // Kept on top, the panel moves by any empty part of it, also while another app is in front.
        .contentShape(Rectangle())
        .gesture(WindowDragGesture(), isEnabled: model.keptOnTop)
        .allowsWindowActivationEvents(true)
        .background { shortcuts }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            vaultRow
            Picker("Section", selection: Binding(get: { model.tab }, set: { model.show($0) })) {
                Text("Search").tag(MenuBarTab.search)
                Text("Add").tag(MenuBarTab.add)
                Text("Generate").tag(MenuBarTab.generate)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .buttonSizing(.flexible)
            if model.shortcutTaken { Text("⌃⌘P is used by another app.").foregroundStyle(.secondary) }
        }
        .padding(.horizontal, MenuBarController.inset)
        // No space below: each tab's content starts `inset` under the tabs.
        .padding(.top)
    }

    /// “Vault:” at the left; the app's vault menu and Lock at the right.
    private var vaultRow: some View {
        HStack(spacing: 8) {
            Text("Vault") + Text(verbatim: ":")
            Spacer(minLength: 12)
            SwiftUI.Group {
                if let reference = model.reference {
                    // The name with the vault glyph, as in the AutoFill picker and the browser popup.
                    VaultSwitcher(session: model.session, style: .name, context: .extension, choose: { model.choose($0) })
                    let state = model.session.state(of: reference)
                    if !state.isAvailable {
                        Image(systemName: state.symbol).foregroundStyle(.orange)
                            .accessibilityLabel(Text(verbatim: state.spoken))
                            .help(Text(verbatim: state.spoken))
                    }
                } else {
                    Menu {
                        Button {} label: {
                            Text(verbatim: model.vaultName)
                            Image(systemName: "checkmark")
                        }
                    } label: {
                        HStack(spacing: 6) { Image(systemName: VaultSwitcher.symbol); Text(verbatim: model.vaultName) }
                    }
                    .fixedSize()
                }
            }
            .buttonStyle(.bordered)
            .foregroundStyle(.primary)
            if model.sample != nil {
                Button("Lock") {}.disabled(true).help("The sample vault can’t be locked.").fixedSize()
            } else if model.openCount > 0 {
                Button(model.openCount > 1 ? "Lock All" : "Lock") { model.lockByChoice() }.help("⌘L").fixedSize()
            }
        }
        // A long vault name is cut short rather than pushing the row wider than the panel.
        .lineLimit(1)
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
            MenuBarSearchView(model: model)
        } else {
            MenuBarAddView(model: model).id("\(model.vaultID)-\(model.addKind.rawValue)")
        }
    }

    private var footer: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                Toggle("Keep on Top", isOn: $model.keptOnTop)
                    .toggleStyle(.button)
                    .help("Keeps this panel above other windows")
                Button(model.itemOnScreen ? "Show in Psss" : "Open Psss") { openApp() }
            }
            Spacer(minLength: 8)
            HStack(spacing: 12) {
                Button("Settings…") { openSettings() }
                Button("Quit") { NSApp.terminate(nil) }
            }
            .buttonStyle(.borderless)
        }
        .lineLimit(1)
        .padding(.horizontal, MenuBarController.inset)
        .padding(.vertical, 10)
    }

    /// ⌘L and ⌘1 to ⌘3: the app is not in front, so its menus do not answer.
    private var shortcuts: some View {
        Group {
            Button("") { if model.openCount > 0 { model.lockByChoice() } }.keyboardShortcut("l", modifiers: .command)
            Button("") { model.show(.search) }.keyboardShortcut("1", modifiers: .command)
            Button("") { model.show(.add) }.keyboardShortcut("2", modifiers: .command)
            Button("") { model.show(.generate) }.keyboardShortcut("3", modifiers: .command)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    private func openApp() { MenuBarController.openApp(from: model) }

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
            // The unlock form the main window shows beside its sidebar: the icon, “Unlock <vault>”, the password, then Unlock and
            // Use Touch ID, with every message under the buttons.
            GeometryReader { proxy in
                ScrollView {
                    UnlockStack(minHeight: proxy.size.height) {
                        LockHeader(vaultName: model.vaultName, opening: model.unlocking, showsTitle: false)
                        UnlockForm(vaultName: model.vaultName, password: $model.password, focused: $passwordFocused,
                                   biometry: model.canUseBiometrics ? BiometryKind.current : nil, working: model.unlocking,
                                   canUnlock: !model.password.isEmpty,
                                   unlock: { Task { await model.unlockWithPassword() } },
                                   useBiometrics: { Task { await model.unlockWithBiometrics() } }) {
                            notice
                        } keyFile: {
                            EmptyView()
                        }
                    }
                    .padding(.horizontal, MenuBarController.inset)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .onAppear { passwordFocused = true }
        }
    }

    @ViewBuilder private var notice: some View {
        if model.unlocking {
            LockNotice(kind: .progress, text: model.password.isEmpty ? String(localized: "Opening your vault…") : String(localized: "Checking your vault password…"))
        } else if let failure = model.failure {
            LockNotice(kind: .warning, text: failure)
        } else if model.changedVault == model.vaultID {
            LockNotice(kind: .info, text: String(localized: "The vault was changed by another app or device and needs your vault password again."))
        } else if model.away {
            LockNotice(kind: .info, text: String(localized: "The lock time passed while you were away."))
        }
    }
}
#endif
