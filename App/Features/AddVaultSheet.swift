import SwiftUI
import UniformTypeIdentifiers

/// Runs one add-vault flow when `choice` is set, then clears it: the create form, the file picker and then the password sheet
/// for a vault file, or the picker, the "Ready to import" alert and the create form for an Apple Passwords export. Nothing is
/// added until the last step succeeds; then the new vault is the open one, the others stay in the list and `onAdded` runs.
private struct AddVaultFlow: ViewModifier {
    @Binding var choice: AddVaultChoice?
    let session: VaultSession
    let onAdded: () -> Void

    private enum FilePurpose { case vaultFile, passwordsCSV }
    @State private var picking = false
    @State private var purpose = FilePurpose.vaultFile
    @State private var creating = false
    @State private var pendingImport: [VaultItem] = []
    @State private var fileToOpen: URL?
    @State private var notice: String?
    @State private var problem: String?

    func body(content: Content) -> some View {
        content
            .onChange(of: choice) { _, new in
                guard let new else { return }
                choice = nil
                switch new {
                case .create: pendingImport = []; creating = true
                case .open: purpose = .vaultFile; picking = true
                case .importPasswords: purpose = .passwordsCSV; picking = true
                }
            }
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
                NewVaultSheet(session: session, importing: pendingImport) { creating = false; pendingImport = []; onAdded() }
            }
            .sheet(item: $fileToOpen) { url in
                OpenVaultSheet(session: session, file: url) { fileToOpen = nil; onAdded() }
            }
    }
}

extension View {
    /// Starts an add-vault flow when `choice` is set (it is cleared at once). Attach it once per screen, to a view that stays on
    /// screen while the flow runs. `onAdded` runs after a vault was created, opened or imported, with the new vault already open.
    func addVaultFlow(_ choice: Binding<AddVaultChoice?>, session: VaultSession, onAdded: @escaping () -> Void) -> some View {
        modifier(AddVaultFlow(choice: choice, session: session, onAdded: onAdded))
    }
}

/// iPhone and iPad Settings: the "Add Vault" group with its three rows and footer. Each row starts its flow inside Settings.
/// Put it after the vaults list inside a `Form`, and attach `.addVaultFlow` to the form with the same binding.
struct AddVaultSection: View {
    @Binding var choice: AddVaultChoice?

    var body: some View {
        Section {
            ForEach([AddVaultChoice.create, .open, .importPasswords]) { item in
                Button { choice = item } label: {
                    HStack {
                        Text(item.title)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Add Vault")
        } footer: {
            Text(AddVaultChoice.footer)
        }
    }
}

/// Mac Settings, Vaults pane, "Add Vault" selected: a grouped form with a label and a push button per row.
struct AddVaultPane: View {
    @Binding var choice: AddVaultChoice?

    var body: some View {
        Form {
            Section {
                ForEach([AddVaultChoice.create, .open, .importPasswords]) { item in
                    LabeledContent {
                        Button(item.buttonTitle) { choice = item }
                    } label: {
                        Text(item.title)
                    }
                }
            } footer: {
                Text(AddVaultChoice.footer)
            }
        }
        .formStyle(.grouped)
    }
}
