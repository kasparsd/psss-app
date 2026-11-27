import SwiftUI

#if os(iOS)
/// The Settings sheet of iPhone and iPad (mock `#/settings`): the Vaults group (every vault in the fixed order, each pushing its own
/// page), the "Add Vault" group with its three flows, and the app's own rows. Shared by the vault window and the locked window,
/// so both open the same sheet. `path` pushes a vault's page: "Vault Settings…" sets it to that vault's id before the sheet opens.
struct SettingsSheet: View {
    let session: VaultSession
    let gate: UnlockGate
    /// The open KeePass vault, or nil (locked, or the sample vault).
    let keePass: KeePassVaultStore?
    let isSample: Bool
    let itemCount: Int?
    @Binding var path: [UUID]
    /// Change Vault Password, for the vault the window is built on (the sheet closes first; the caller opens the password sheet).
    let changePassword: () -> Void
    let close: () -> Void
    /// A vault was created, opened or imported: it is open now.
    let added: () -> Void
    @State private var addChoice: AddVaultChoice?
    @Environment(AppleImportRequests.self) private var appleImports
    /// Import from Apple Passwords was chosen here: it opens once this sheet has gone, since only one can be on screen.
    @State private var importsAfterClosing = false

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                Section {
                    if isSample {
                        NavigationLink("Sample vault") {
                            SampleSettingsPage(session: session, gate: gate) { close() }
                        }
                    } else {
                        ForEach(session.knownVaults, id: \.id) { reference in
                            NavigationLink(value: reference.id) {
                                VaultListName(session: session, reference: reference)
                            }
                        }
                    }
                } header: {
                    Text("Vaults")
                } footer: {
                    Text(AppSettingsSections.vaultsFooter)
                }
                if !isSample { AddVaultSection(choice: $addChoice) }
                AppSettingsSections(isSample: isSample) {
                    close()
                    session.holdBiometricPrompts()
                    gate.lock()
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            .navigationDestination(for: UUID.self) { id in page(for: id) }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { close() }
                }
            }
        }
        .modifier(SheetSize())
        .addVaultFlow($addChoice, session: session, onAdded: added, importsApplePasswords: {
            importsAfterClosing = true
            close()
        })
        .onDisappear { if importsAfterClosing { appleImports.start() } }
    }

    /// A vault's page: its details work from the reference, and what needs the vault open (items, a copy, a new password) is there
    /// while the vault is open, whichever vault is shown. A vault removed meanwhile pops back.
    @ViewBuilder
    private func page(for id: UUID) -> some View {
        if let reference = session.knownVaults.first(where: { $0.id == id }) {
            let open = session.store(for: id)
            VaultSettingsPage(session: session, gate: gate, reference: reference, store: open,
                              itemCount: open === keePass ? itemCount : nil,
                              onChangePassword: open == nil || open !== keePass ? nil : changePassword, afterLeaving: close)
        }
    }
}
#endif
