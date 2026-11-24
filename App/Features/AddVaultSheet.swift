import SwiftUI
import UniformTypeIdentifiers

/// "Add a Vault": the welcome screen's choices without the sample vault (owner, 2026-11-24, mock `#/vault-switcher`). One sheet
/// for Settings, the vault switcher and the lock screens. Each row opens the sheet that already exists for it; nothing is added
/// until that sheet succeeds, and then the new vault is the open one and the others stay in the list.
struct AddVaultSheet: View {
    let session: VaultSession
    /// Called after a vault was created, opened or imported, with the new vault already open.
    let onAdded: () -> Void
    @Environment(\.dismiss) private var dismiss

    private enum FilePurpose { case vaultFile, passwordsCSV }
    @State private var picking = false
    @State private var purpose = FilePurpose.vaultFile
    @State private var creating = false
    @State private var pendingImport: [VaultItem] = []
    @State private var fileToOpen: URL?
    @State private var notice: String?
    @State private var problem: String?

    @ViewBuilder
    private func row(_ title: LocalizedStringKey, _ detail: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    Text(detail).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("Create a New Vault", "A new, empty vault. You choose its name and password.") {
                        pendingImport = []; creating = true
                    }
                    row("Open a Vault File", "A KeePass file from Files, iCloud Drive or another app.") {
                        purpose = .vaultFile; picking = true
                    }
                    row("Import from Apple Passwords", "Make a new vault from an Apple Passwords export.") {
                        purpose = .passwordsCSV; picking = true
                    }
                } header: {
                    Text("Nothing changes until you choose. The vault you add opens now, and your other vaults stay in the list.")
                        .textCase(nil)
                } footer: {
                    Text("Exports from other apps are not encrypted. Delete the file after importing.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Add a Vault")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .modifier(VaultSheetSize())
        .fileImporter(isPresented: $picking,
                      allowedContentTypes: purpose == .vaultFile ? [.keePassVault, .data] : [.commaSeparatedText, .plainText]) { result in
            switch purpose {
            case .vaultFile:
                if let url = try? result.get() { fileToOpen = url }
            case .passwordsCSV:
                readPasswordsCSV(result, notice: $notice, problem: $problem) { pendingImport = $0 }
            }
        }
        .alert("Ready to import", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("Create Vault…") { notice = nil; creating = true }
            Button("Cancel", role: .cancel) { notice = nil; pendingImport = [] }
        } message: { Text((notice ?? "") + " " + String(localized: "Choose a vault password to create the vault that will hold them.")) }
        .alert("Nothing was added", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK") { problem = nil }
        } message: { Text(problem ?? "") }
        .sheet(isPresented: $creating) {
            NewVaultSheet(session: session, importing: pendingImport) { added() }
        }
        .sheet(item: $fileToOpen) { url in
            OpenVaultSheet(session: session, file: url) { added() }
        }
    }

    private func added() {
        dismiss()
        onAdded()
    }
}
