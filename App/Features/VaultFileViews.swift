import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    /// KeePass databases. Declared by extension so no document type needs registering for opening from Files.
    static let keePassVault = UTType(filenameExtension: "kdbx") ?? .data
}

/// Shown while the key is derived. The wait is deliberate (it makes password guessing slow), so say so.
private struct WorkingNotice: View {
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ProgressView().controlSize(.small)
            VStack(alignment: .leading, spacing: 2) {
                Text(text).fontWeight(.medium)
                Text("This takes a moment on purpose: it makes guessing your vault password very slow. Keep this window open.")
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Vault password and optional key file, shared by every screen that asks for them.
private struct CredentialFields: View {
    @Binding var password: String
    @Binding var confirmation: String
    @Binding var keyFile: Data?
    var confirms: Bool
    @State private var choosingKeyFile = false
    @State private var keyFileName: String?
    @State private var keyFileProblem: String?

    var body: some View {
        Group {
            SecureField("Vault Password", text: $password)
            if confirms {
                SecureField("Repeat Vault Password", text: $confirmation)
            }
            DisclosureGroup("Key file (optional)") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("A second secret file needed together with the password. Keep it somewhere separate.")
                        .font(.footnote).foregroundStyle(.secondary)
                    HStack {
                        Button(keyFile == nil ? "Choose Key File…" : "Change Key File…") { choosingKeyFile = true }
                        if let keyFileName {
                            Text(keyFileName).foregroundStyle(.secondary).lineLimit(1)
                            Button("Remove", role: .destructive) { keyFile = nil; self.keyFileName = nil }
                        }
                    }
                    if let keyFileProblem { Text(keyFileProblem).font(.footnote).foregroundStyle(.red) }
                }
                .padding(.vertical, 4)
            }
        }
        .fileImporter(isPresented: $choosingKeyFile, allowedContentTypes: [.data]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                _ = try KDBXCredentials.keyFileHash(data)
                keyFile = data
                keyFileName = url.lastPathComponent
                keyFileProblem = nil
            } catch {
                keyFileProblem = (error as? KDBXError)?.message ?? error.localizedDescription
            }
        }
    }
}

/// First vault: a name and a vault password. Imported items wait here until the vault exists.
struct NewVaultSheet: View {
    let session: VaultSession
    var importing: [VaultItem] = []
    let onCreated: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = String(localized: "Passwords")
    @State private var password = ""
    @State private var confirmation = ""
    @State private var keyFile: Data?
    @State private var working = false
    @State private var problem: String?

    private var canCreate: Bool { !password.isEmpty && password == confirmation && !working }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Your logins, passkeys, codes, cards and notes are kept in one encrypted file on this device. Nothing is uploaded.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
                Section {
                    LabeledContent("Name") {
                        TextField("Name", text: $name).multilineTextAlignment(.trailing)
                    }
                }
                Section {
                    CredentialFields(password: $password, confirmation: $confirmation, keyFile: $keyFile, confirms: true)
                } header: {
                    Text("Vault Password")
                } footer: {
                    Text("You enter it each time the vault unlocks. Psss cannot reset it, so keep a copy somewhere safe.")
                }
                if !password.isEmpty, !confirmation.isEmpty, password != confirmation {
                    Text("The passwords do not match.").foregroundStyle(.red)
                }
                if !importing.isEmpty {
                    Text("\(importing.count) imported logins will be added.").foregroundStyle(.secondary)
                }
                if working { WorkingNotice(text: "Creating your vault…") }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            .disabled(working)
            .interactiveDismissDisabled(working)
            .navigationTitle("Create a vault")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Creating…" : "Create") { create() }.disabled(!canCreate)
                }
            }
        }
        .modifier(VaultSheetSize())
    }

    private func create() {
        working = true
        problem = nil
        Task {
            do {
                try await session.create(name: name, credentials: .init(password: password, keyFile: keyFile), items: importing)
                dismiss()
                onCreated()
            } catch {
                problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
                working = false
            }
        }
    }
}

/// Asks for the vault password of a file the person just chose to open.
struct OpenVaultSheet: View {
    let session: VaultSession
    let file: URL
    let onOpened: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmation = ""
    @State private var keyFile: Data?
    @State private var working = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("File", value: file.lastPathComponent)
                    CredentialFields(password: $password, confirmation: $confirmation, keyFile: $keyFile, confirms: false)
                } footer: {
                    Text("Psss opens the file where it is and saves changes to it. It does not make a copy.")
                }
                if working { WorkingNotice(text: "Opening the vault…") }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            .disabled(working)
            .interactiveDismissDisabled(working)
            .navigationTitle("Open vault")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Opening…" : "Open") { open() }.disabled(working || (password.isEmpty && keyFile == nil))
                }
            }
        }
        .modifier(VaultSheetSize())
    }

    private func open() {
        working = true
        problem = nil
        Task {
            do {
                try await session.open(fileAt: file, credentials: .init(password: password.isEmpty ? nil : password, keyFile: keyFile))
                dismiss()
                onOpened()
            } catch {
                problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
                working = false
            }
        }
    }
}

/// Shown instead of the vault while a KeePass vault is locked. Locking drops the keys, so unlocking needs the vault password.
struct VaultPasswordView: View {
    let session: VaultSession
    let gate: UnlockGate
    @State private var password = ""
    @State private var keyFile: Data?
    @State private var keyFileName: String?
    @State private var choosingKeyFile = false
    @State private var working = false
    @State private var problem: String?
    @State private var missing = false
    @State private var relinking = false
    @State private var confirmingSwitch = false
    @State private var choosingOther = false
    @State private var otherFile: URL?
    @FocusState private var focused: Bool

    /// Input fields are darker than the grey rows around them, with a visible edge, so they read as places to type.
    private static var fieldFill: Color {
        #if os(macOS)
        Color(nsColor: .textBackgroundColor)
        #else
        Color(uiColor: .secondarySystemBackground)
        #endif
    }

    private var vaultName: String { session.reference?.name ?? "Psss" }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 16) {
                vaultSelector

                VStack(spacing: 16) {
                    SecureField("Vault Password", text: $password)
                        .textFieldStyle(.plain)
                        .focused($focused)
                        .onSubmit(unlock)
                        .disabled(missing || working)
                        .padding(12)
                        .background(Self.fieldFill, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(focused ? Color.accentColor : Color.secondary.opacity(0.4), lineWidth: focused ? 2 : 1))
                    if let problem {
                        Text(problem).foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    keyFileRow
                    if missing {
                        Button { relinking = true } label: {
                            Label("Locate Vault File…", systemImage: "folder").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    } else {
                        Button(action: unlock) {
                            Label(working ? "Unlocking…" : "Unlock \(vaultName)", systemImage: "lock.open").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(working || (password.isEmpty && keyFile == nil))
                        .keyboardShortcut(.defaultAction)
                    }
                }

                // One place for all help text. Progress takes its place while working, so nothing moves.
                ZStack(alignment: .top) {
                    if working {
                        WorkingNotice(text: "Checking your vault password…")
                    } else {
                        VStack(spacing: 10) {
                            Text("Psss cannot reset or recover a vault password. A key file is only needed if you added one when you created this vault.")
                        }
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 100, alignment: .top)
            }
            .frame(maxWidth: 340)
            .padding(.horizontal, 24)
            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
        .onAppear { focused = true }
        .fileImporter(isPresented: $relinking, allowedContentTypes: [.keePassVault, .data]) { result in
            guard let url = try? result.get() else { return }
            do { try session.relink(to: url); missing = false; problem = nil }
            catch { problem = error.localizedDescription }
        }
        .fileImporter(isPresented: $choosingKeyFile, allowedContentTypes: [.data]) { result in
            guard let url = try? result.get() else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                _ = try KDBXCredentials.keyFileHash(data)
                keyFile = data
                keyFileName = url.lastPathComponent
                problem = nil
            } catch {
                problem = (error as? KDBXError)?.message ?? String(localized: "That file can't be used as a key file.")
            }
        }
        .fileImporter(isPresented: $choosingOther, allowedContentTypes: [.keePassVault, .data]) { result in
            if let url = try? result.get() { otherFile = url }
        }
        .sheet(item: $otherFile) { url in
            OpenVaultSheet(session: session, file: url) { gate.markUnlocked() }
        }
        .alert("Leave \(vaultName)?", isPresented: $confirmingSwitch) {
            Button("Choose a File…") { choosingOther = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Psss created \(vaultName) and keeps it only on this device. Once you open another vault, this one can't be reopened from here. Export a copy first if you want to keep it.")
        }
    }

    /// Which vault is being unlocked: a label on the left and a standard bordered pop-up on the right, like the key file row.
    /// The current vault is checked; the other choice is one click away.
    private var vaultSelector: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Text("Unlock Vault:")
                Spacer(minLength: 0)
                Menu {
                    Button { } label: { Label(vaultName, systemImage: "checkmark") }
                    Divider()
                    Button("Open Another Vault…") {
                        if session.reference?.managed == true { confirmingSwitch = true } else { choosingOther = true }
                    }
                } label: {
                    #if os(iOS)
                    Label(vaultName, systemImage: "chevron.up.chevron.down").labelStyle(.titleAndIcon).lineLimit(1)
                    #else
                    Text(vaultName).lineLimit(1)
                    #endif
                }
                #if os(iOS)
                .buttonStyle(.bordered)
                #endif
                .fixedSize()
                .disabled(working)
                .accessibilityLabel("Unlock vault: \(vaultName). Choose another vault.")
            }
            if let location = session.reference?.locationDescription {
                Text(location).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The key file is rare, so it starts empty, but it is always visible and says when it is needed.
    private var keyFileRow: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Key file (optional)")
                if let keyFileName { Text(keyFileName).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 0)
            if keyFile != nil {
                Button("Remove") { keyFile = nil; keyFileName = nil }.buttonStyle(.borderless)
            }
            Button(keyFile == nil ? "Choose…" : "Change…") { choosingKeyFile = true }
                #if os(iOS)
                .buttonStyle(.bordered)
                #endif
        }
        .disabled(working)
    }

    private func unlock() {
        guard !working, !(password.isEmpty && keyFile == nil) else { return }
        working = true
        problem = nil
        Task {
            do {
                try await session.unlock(credentials: .init(password: password.isEmpty ? nil : password, keyFile: keyFile))
                password = ""
                gate.markUnlocked()
            } catch {
                if case VaultStoreError.fileMissing = error { missing = true }
                if case KDBXError.wrongCredentials = error {
                    problem = String(localized: "That didn't open \(vaultName). Check the vault password. If you added a key file when you created this vault, choose it below.")
                } else {
                    problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
                }
                password = ""
                focused = true
            }
            working = false
        }
    }
}

/// New vault password or key file for the open vault.
struct ChangePasswordSheet: View {
    let store: KeePassVaultStore
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmation = ""
    @State private var keyFile: Data?
    @State private var working = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CredentialFields(password: $password, confirmation: $confirmation, keyFile: $keyFile, confirms: true)
                } footer: {
                    Text("The vault is encrypted again with the new password. Other copies of the file keep the old one.")
                }
                if working { WorkingNotice(text: "Encrypting the vault with the new password…") }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            .disabled(working)
            .interactiveDismissDisabled(working)
            .navigationTitle("Change vault password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Saving…" : "Change") { change() }.disabled(working || password.isEmpty || password != confirmation)
                }
            }
        }
        .modifier(VaultSheetSize())
    }

    private func change() {
        working = true
        Task {
            do {
                try await store.changeCredentials(to: .init(password: password, keyFile: keyFile))
                dismiss()
            } catch {
                problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
                working = false
            }
        }
    }
}

/// An encrypted copy of the vault file, for Save a Copy.
struct VaultCopy: FileDocument {
    static let readableContentTypes: [UTType] = [.keePassVault]
    var data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct VaultSheetSize: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.frame(minWidth: 480, minHeight: 520)
        #else
        content
        #endif
    }
}
