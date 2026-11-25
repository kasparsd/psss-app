import SwiftUI
import UniformTypeIdentifiers

/// The three ways to add a vault (owner, 2026-11-25, mock `#/vault-switcher` and `#/settings`). The chooser sheet is gone: each
/// place that adds a vault (Settings, the vault switcher, the sidebar, the File menu, the lock screens) names one of these and
/// starts that flow directly with `.addVaultFlow`.
enum AddVaultChoice: Hashable, Identifiable {
    /// A new, empty vault: its form asks for a name and a password.
    case create
    /// A KeePass file from Files, iCloud Drive or another folder.
    case open
    /// A new vault made from an Apple Passwords export (a CSV file).
    case importPasswords

    var id: Self { self }

    /// The words of the row that starts it (iOS) and of its push button (Mac).
    var title: LocalizedStringKey {
        switch self {
        case .create: "Create a New Vault"
        case .open: "Open a Vault File"
        case .importPasswords: "Import from Apple Passwords"
        }
    }

    var buttonTitle: LocalizedStringKey {
        switch self {
        case .create: "Create…"
        case .open: "Open…"
        case .importPasswords: "Import…"
        }
    }

    /// The footer under the "Add Vault" group, the same everywhere.
    static var footer: LocalizedStringKey {
        "Create makes a new, empty vault. Open adds a KeePass file from iCloud Drive or another folder. Import makes a new vault from an Apple Passwords export; exports are not encrypted, so delete the file afterwards."
    }
}

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

/// Deprecated: the chooser sheet. Kept only until the remaining call sites (vault window, lock screens) use `.addVaultFlow`
/// directly; the next slice removes them and deletes this view.
struct AddVaultSheet: View {
    let session: VaultSession
    let onAdded: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var choice: AddVaultChoice?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach([AddVaultChoice.create, .open, .importPasswords]) { item in
                        Button(item.title) { choice = item }
                    }
                } footer: {
                    Text(AddVaultChoice.footer)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Add Vault")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .modifier(VaultSheetSize())
        .addVaultFlow($choice, session: session) { dismiss(); onAdded() }
    }
}
