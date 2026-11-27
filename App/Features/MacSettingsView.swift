#if os(macOS)
import AppKit
import SwiftUI

/// The Mac Settings window (Psss, Settings… ⌘,), with the system's toolbar of panes (owner, 2026-11-24, mock `#/settings`,
/// option C). General holds the app's own rows. Vaults lists the vaults on the left and the selected one's page on the right.
/// It reads the same session and lock state as the vault window and shows nothing from inside a locked vault.
struct MacSettingsView: View {
    @Environment(VaultSession.self) private var session
    @Environment(UnlockGate.self) private var gate
    @Environment(SettingsRequests.self) private var requests
    @AppStorage("vaultSource") private var vaultSource = ""
    @State private var selection: Entry.ID?
    @State private var tab = Tab.general
    @State private var addChoice: AddVaultChoice?
    @Environment(AppleImportRequests.self) private var appleImports
    @State private var showsAppleImport = false

    private enum Tab: Hashable { case general, vaults }

    private enum Entry: Identifiable, Hashable {
        case vault(UUID)
        case sample
        case add
        var id: String {
            switch self {
            case .vault(let id): id.uuidString
            case .sample: "sample"
            case .add: "add"
            }
        }
    }

    private var sampleOpen: Bool { !vaultSource.isEmpty && vaultSource != RootView.keePassSource }

    var body: some View {
        TabView(selection: $tab) {
            Form { AppSettingsSections(isSample: sampleOpen) { session.holdBiometricPrompts(); gate.lock() } }
                .formStyle(.grouped)
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(Tab.general)
            vaultsPane
                .tabItem { Label("Vaults", systemImage: "lock.rectangle.stack") }
                .tag(Tab.vaults)
        }
        .frame(width: 640, height: 560)
        .scenePadding()
        .onAppear(perform: consumeRequest)
        .onChange(of: requests.page) { _, _ in consumeRequest() }
    }

    /// Another part of the app asked for Settings at a page (`SettingsRequests.show`).
    private func consumeRequest() {
        guard let page = requests.page else { return }
        requests.page = nil
        tab = .vaults
        switch page {
        case .vault(let id): selection = id.uuidString
        case .addVault: selection = Entry.add.id
        }
    }

    /// The vaults in the order of the vault list. The open one never moves.
    private var entries: [Entry] {
        if sampleOpen { return [.sample] }
        return session.knownVaults.map { .vault($0.id) } + [.add]
    }

    private var current: Entry.ID? { selection ?? entries.first?.id }

    private var vaultsPane: some View {
        HStack(spacing: 0) {
            List(selection: Binding(get: { current }, set: { selection = $0 })) {
                ForEach(entries) { entry in
                    switch entry {
                    case .sample:
                        Text("Sample vault").tag(entry.id)
                    case .vault(let id):
                        if let reference = session.knownVaults.first(where: { $0.id == id }) {
                            VaultListName(session: session, reference: reference).tag(entry.id)
                        }
                    case .add:
                        Label("Add Vault", systemImage: "plus").tag(entry.id)
                    }
                }
            }
            .listStyle(.sidebar)
            .frame(width: 200)
            Divider()
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .addVaultFlow($addChoice, session: session, onAdded: showAdded, importsApplePasswords: { showsAppleImport = true })
        .appleImportSheet(isPresented: $showsAppleImport, session: session, requests: appleImports, onImported: showAdded)
    }

    /// A vault was created or imported into: the app is unlocked on it and Settings shows it.
    private func showAdded() {
        gate.markUnlocked()
        vaultSource = RootView.keePassSource
        selection = session.reference?.id.uuidString
    }

    @ViewBuilder
    private var detail: some View {
        if sampleOpen {
            SampleSettingsPage(session: session, gate: gate) { selection = nil }
        } else if current == Entry.add.id {
            AddVaultPane(choice: $addChoice)
        } else if let id = current, let reference = session.knownVaults.first(where: { "\($0.id)" == id }) {
            let open = session.store(for: reference.id)
            VaultSettingsPage(session: session, gate: gate, reference: reference, store: open, itemCount: nil,
                              // The password sheet belongs to the window, which is built on the shown vault.
                              onChangePassword: open == nil || reference.id != session.reference?.id ? nil : {
                                  requests.changePassword = true
                                  Self.showVaultWindow()
                              },
                              afterLeaving: { selection = nil })
                .id(reference.id)
        } else {
            ContentUnavailableView("No vault yet", systemImage: "lock.rectangle.stack",
                                   description: Text("Create or open a vault in the Psss window. It then shows here."))
        }
    }

    /// Change Vault Password opens in the vault window, so that comes to the front.
    private static func showVaultWindow() {
        NSApp.activate()
        let window = NSApp.windows.first { $0.isVisible && $0.canBecomeMain && ($0.identifier?.rawValue.localizedCaseInsensitiveContains("settings") != true) }
        window?.makeKeyAndOrderFront(nil)
    }
}
#endif
