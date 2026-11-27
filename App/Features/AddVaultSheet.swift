import SwiftUI
import UniformTypeIdentifiers

/// Runs one add-vault flow when `choice` is set, then clears it: the create form, or the file picker for a vault file. Import from
/// Apple Passwords is handed to the app's one import sheet (`importsApplePasswords`). Nothing is added until the last step
/// succeeds. A created vault is open and shown, the others stay as they were, and `onAdded` runs. A vault file is only added to
/// the list, locked, and shown with its unlock form (no password is asked here): `onFileAdded` runs.
private struct AddVaultFlow: ViewModifier {
    @Binding var choice: AddVaultChoice?
    let session: VaultSession
    let onAdded: () -> Void
    let onFileAdded: () -> Void

    /// Opens the import sheet from here, for a screen that has to close first or keeps the sheet to itself.
    let importsApplePasswords: (() -> Void)?
    @Environment(AppleImportRequests.self) private var imports
    @State private var picking = false
    @State private var creating = false
    @State private var problem: String?

    func body(content: Content) -> some View {
        content
            .onChange(of: choice) { _, new in
                guard let new else { return }
                choice = nil
                switch new {
                case .create: creating = true
                case .open: picking = true
                case .importPasswords: if let importsApplePasswords { importsApplePasswords() } else { imports.start() }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.keePassVault, .data]) { result in
                guard let url = try? result.get() else { return }
                do { try session.add(fileAt: url); onFileAdded() }
                catch { problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? String(localized: "Psss could not read that file.") }
            }
            .alert("Nothing was added", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("OK") { problem = nil }
            } message: { Text(problem ?? "") }
            .sheet(isPresented: $creating) {
                NewVaultSheet(session: session) { creating = false; onAdded() }
            }
    }
}

extension View {
    /// Starts an add-vault flow when `choice` is set (it is cleared at once). Attach it once per screen, to a view that stays on
    /// screen while the flow runs. `onAdded` runs after a vault was created, with the new vault already open; `onFileAdded`
    /// after a vault file was added: it is in the list and shown, locked, and the unlock form follows.
    func addVaultFlow(_ choice: Binding<AddVaultChoice?>, session: VaultSession, onAdded: @escaping () -> Void,
                      onFileAdded: @escaping () -> Void = {}, importsApplePasswords: (() -> Void)? = nil) -> some View {
        modifier(AddVaultFlow(choice: choice, session: session, onAdded: onAdded, onFileAdded: onFileAdded,
                              importsApplePasswords: importsApplePasswords))
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
