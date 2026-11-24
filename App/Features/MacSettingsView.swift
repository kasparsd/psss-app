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

    private enum Entry: Identifiable, Hashable {
        case vault(UUID)
        case sample
        var id: String {
            switch self {
            case .vault(let id): id.uuidString
            case .sample: "sample"
            }
        }
    }

    private var sampleOpen: Bool { !vaultSource.isEmpty && vaultSource != RootView.keePassSource }

    var body: some View {
        TabView {
            Form { AppSettingsSections(isSample: sampleOpen) { gate.lock() } }
                .formStyle(.grouped)
                .tabItem { Label("General", systemImage: "gearshape") }
            vaultsPane
                .tabItem { Label("Vaults", systemImage: "lock.rectangle.stack") }
        }
        .frame(width: 640, height: 560)
        .scenePadding()
    }

    private var entries: [Entry] {
        if sampleOpen { return [.sample] }
        return session.knownVaults.map { .vault($0.id) }
    }

    private var current: Entry.ID? { selection ?? entries.first?.id }

    private var vaultsPane: some View {
        HStack(spacing: 0) {
            List(selection: Binding(get: { current }, set: { selection = $0 })) {
                ForEach(entries) { entry in
                    switch entry {
                    case .sample:
                        VStack(alignment: .leading) {
                            Text("Sample vault")
                            Text("Not saved").foregroundStyle(.secondary)
                        }
                        .tag(entry.id)
                    case .vault(let id):
                        if let reference = session.knownVaults.first(where: { $0.id == id }) {
                            VStack(alignment: .leading) {
                                Text(reference.name)
                                Text(vaultSummary(reference)).foregroundStyle(.secondary)
                            }
                            .tag(entry.id)
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .frame(width: 200)
            Divider()
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var detail: some View {
        if sampleOpen {
            SampleSettingsPage(session: session, gate: gate) { selection = nil }
        } else if let id = current, let reference = session.knownVaults.first(where: { "\($0.id)" == id }) {
            if reference.id == session.reference?.id {
                let open = gate.isUnlocked ? session.store : nil
                VaultSettingsPage(session: session, gate: gate, reference: reference, store: open, itemCount: nil,
                                  onChangePassword: open == nil ? nil : {
                                      requests.changePassword = true
                                      Self.showVaultWindow()
                                  },
                                  afterLeaving: { selection = nil })
                    .id(reference.id)
            } else {
                OtherVaultSettingsPage(reference: reference)
            }
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
