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
    /// Change Vault Password, for the open vault (the sheet closes first; the caller opens the password sheet).
    let changePassword: () -> Void
    let close: () -> Void
    /// A vault was created, opened or imported: it is open now.
    let added: () -> Void
    @State private var addChoice: AddVaultChoice?

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
                                VaultListName(session: session, reference: reference, unlocked: gate.isUnlocked)
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
        .addVaultFlow($addChoice, session: session, onAdded: added)
    }

    /// The open (or current) vault's page, or the read-only page of another vault. A vault removed meanwhile pops back.
    @ViewBuilder
    private func page(for id: UUID) -> some View {
        if let reference = session.knownVaults.first(where: { $0.id == id }) {
            if reference.id == session.reference?.id {
                VaultSettingsPage(session: session, gate: gate, reference: reference, store: keePass, itemCount: itemCount,
                                  onChangePassword: keePass == nil ? nil : changePassword, afterLeaving: close)
            } else {
                OtherVaultSettingsPage(reference: reference)
            }
        }
    }
}
#endif
