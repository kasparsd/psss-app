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
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(keyFile == nil ? "Choose Key File…" : "Change Key File…") { choosingKeyFile = true }
                        if let keyFileName {
                            Text(keyFileName).foregroundStyle(.secondary).lineLimit(1)
                            Button("Remove", role: .destructive) { keyFile = nil; self.keyFileName = nil }
                        }
                    }
                    if let keyFileProblem { ProblemText(text: keyFileProblem) }
                }
                .padding(.vertical, 4)
            }
            // One importer on one view. On a Group, the modifier would be applied to every row of it.
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
                keyFileProblem = ((error as? KDBXError).map { confirms ? $0.messageForNewKey : $0.message }) ?? error.localizedDescription
            }
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
                    ProblemText(text: String(localized: "The passwords do not match."))
                }
                if !importing.isEmpty {
                    Text("\(importing.count) imported logins will be added.").foregroundStyle(.secondary)
                }
                if working { WorkingNotice(text: "Creating your vault…") }
                if let problem { ProblemText(text: problem) }
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
                password = ""; confirmation = ""; keyFile = nil
                dismiss()
                onCreated()
            } catch {
                problem = (error as? KDBXError)?.messageForNewKey ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
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
                if let problem { ProblemText(text: problem) }
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
                password = ""; keyFile = nil
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
    /// What the one file picker of this screen is for. It is kept after the picker closes, because the completion runs after
    /// the presentation flag was reset.
    private enum FilePurpose { case relinkVault, keyFile, otherVault }
    @State private var picking = false
    @State private var purpose = FilePurpose.keyFile
    @State private var working = false
    @State private var problem: String?
    @State private var missing = false
    @State private var confirmingSwitch = false
    @State private var otherFile: URL?
    @State private var explaining = false
    @State private var lost = false
    @State private var triedBiometric = false
    @State private var unlockingWithBiometrics = false
    @FocusState private var focused: Bool
    @AppStorage("vaultSource") private var vaultSource = ""

    /// Input fields are darker than the grey rows around them, with a visible edge, so they read as places to type.
    private static var fieldFill: Color {
        #if os(macOS)
        Color(nsColor: .textBackgroundColor)
        #else
        Color(uiColor: .secondarySystemBackground)
        #endif
    }

    private var biometry: BiometryKind? {
        guard session.reference?.biometricUnlock == true else { return nil }
        return session.biometry
    }

    private var vaultName: String { session.reference?.name ?? "Psss" }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 16) {
                vaultSelector

                VStack(spacing: 16) {
                    HStack(spacing: 8) {
                        SecureField("Vault Password", text: $password)
                            .textFieldStyle(.plain)
                            .focused($focused)
                            .onSubmit(unlock)
                            .disabled(missing || working)
                            .padding(12)
                            .background(Self.fieldFill, in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(focused ? Color.accentColor : Color.secondary.opacity(0.4), lineWidth: focused ? 2 : 1))
                        if let biometry, !missing {
                            Button { Task { await unlockWithBiometrics() } } label: {
                                Label(biometry.label, systemImage: biometry.symbol)
                            }
                            .controlSize(.large)
                            .disabled(working)
                            .help("Unlock \(vaultName) with \(biometry.label)")
                        }
                    }
                    if let problem {
                        ProblemText(text: problem)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if let notice = gate.lockNotice {
                        // Information, not a mistake in what the person typed, so not red. A newer problem replaces it.
                        Text(notice).foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    keyFileRow
                    if missing {
                        Button { choose(.relinkVault) } label: {
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
                        WorkingNotice(text: unlockingWithBiometrics ? "Opening your vault…" : "Checking your vault password…")
                    } else {
                        VStack(spacing: 10) {
                            Text("Psss cannot reset or recover a vault password. A key file is only needed if you added one when you created this vault.")
                            HStack(spacing: 8) {
                                Button("What Is This?") { explaining = true }
                                Button("Forgot Password?") { lost = true }
                            }
                            .buttonStyle(.bordered)
                            .foregroundStyle(.primary)
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
        .task {
            // Like Apple Passwords, ask for Face ID or Touch ID straight away; the button retries.
            // Not when the vault was just locked because it changed elsewhere: the saved key is probably stale, so the
            // prompt would only fail. The notice says to enter the vault password, and the button still tries.
            guard !triedBiometric, biometry != nil, !missing, gate.lockNotice == nil else { return }
            triedBiometric = true
            await unlockWithBiometrics()
        }
        .sheet(isPresented: $explaining) { PasswordExplainerSheet() }
        .sheet(isPresented: $lost) {
            LostPasswordSheet(session: session, vaultName: vaultName,
                              onOpenAnother: { lost = false; openAnother(afterSheet: true) },
                              onForgotten: { vaultSource = ""; gate.markUnlocked() })
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: purpose == .keyFile ? [.data] : [.keePassVault, .data]) { result in
            guard let url = try? result.get() else { return }
            switch purpose {
            case .relinkVault:
                do { try session.relink(to: url); missing = false; problem = nil }
                catch { problem = error.localizedDescription }
            case .keyFile:
                // Read inside the security scope, then keep only the bytes, and only until unlocking succeeds.
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
            case .otherVault:
                otherFile = url
            }
        }
        .sheet(item: $otherFile) { url in
            OpenVaultSheet(session: session, file: url) { gate.markUnlocked() }
        }
        .alert("Leave \(vaultName)?", isPresented: $confirmingSwitch) {
            Button("Choose a File…") { choose(.otherVault, afterDismissal: true) }
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
                    Button("Open Another Vault…") { openAnother(afterSheet: false) }
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
            Button(keyFile == nil ? "Choose…" : "Change…") { choose(.keyFile) }
                #if os(iOS)
                .buttonStyle(.bordered)
                #endif
        }
        .disabled(working)
    }

    /// Opens the screen's one file picker for `purpose`. After a sheet or alert closes, the picker waits until it has gone,
    /// because a picker requested while another presentation is leaving is dropped. The same goes for the keyboard: a picker
    /// requested while the password field holds focus is often dropped on iPhone and iPad, so the field lets go first (which
    /// closes the keyboard) and the picker follows once the keyboard has gone.
    private func choose(_ purpose: FilePurpose, afterDismissal: Bool = false) {
        guard afterDismissal else {
            self.purpose = purpose
            #if os(iOS)
            if focused {
                focused = false
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(350))
                    picking = true
                }
                return
            }
            #endif
            picking = true
            return
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            self.purpose = purpose
            picking = true
        }
    }

    private func openAnother(afterSheet: Bool) {
        if session.reference?.managed == true {
            // A vault Psss made cannot be reopened from here, so ask first.
            if afterSheet { Task { @MainActor in try? await Task.sleep(for: .milliseconds(500)); confirmingSwitch = true } }
            else { confirmingSwitch = true }
        } else {
            choose(.otherVault, afterDismissal: afterSheet)
        }
    }

    private func unlockWithBiometrics() async {
        guard !working else { return }
        working = true
        unlockingWithBiometrics = true
        problem = nil
        // The lock notice stays until the unlock succeeds or a new problem replaces it: cancelling the prompt explains nothing else.
        defer { working = false; unlockingWithBiometrics = false }
        do {
            try await session.unlockWithBiometrics()
            password = ""
            gate.lockNotice = nil
            gate.markUnlocked()
        } catch BiometricKeyError.cancelled {
            refocus()
        } catch BiometricKeyError.unavailable {
            gate.lockNotice = nil
            problem = String(localized: "\(biometry?.label ?? "Face ID") cannot be used right now. Enter the vault password this time.")
            refocus()
        } catch BiometricKeyError.invalidated {
            gate.lockNotice = nil
            if session.reference?.biometricStale == true {
                problem = String(localized: "\(biometry?.label ?? "Face ID") no longer opens \(vaultName), because the vault was changed elsewhere. Enter the vault password once and \(biometry?.label ?? "Face ID") is turned on again.")
            } else {
                problem = String(localized: "\(biometry?.label ?? "Face ID") no longer opens \(vaultName), for example because it changed. Enter the vault password once. You can turn it on again afterwards.")
            }
            refocus()
        } catch {
            gate.lockNotice = nil
            if case VaultStoreError.fileMissing = error { missing = true }
            problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
        }
    }

    private func unlock() {
        guard !working, !(password.isEmpty && keyFile == nil) else { return }
        working = true
        problem = nil
        gate.lockNotice = nil
        Task {
            do {
                try await session.unlock(credentials: .init(password: password.isEmpty ? nil : password, keyFile: keyFile))
                password = ""; keyFile = nil; keyFileName = nil
                gate.markUnlocked()
            } catch {
                if case VaultStoreError.fileMissing = error { missing = true }
                if case KDBXError.wrongCredentials = error {
                    problem = String(localized: "That didn't open \(vaultName). Check Caps Lock and your keyboard language. If you added a key file when you created this vault, choose it below.")
                } else {
                    problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
                }
                password = ""
                working = false
                refocus()
            }
            working = false
        }
    }

    /// Puts the cursor back in the password field after a failed attempt, so the person can type again at once. The field was
    /// disabled while the vault was checked, and a disabled field gives up focus; asking again for focus that is still marked
    /// as held does nothing, so it is released first and taken once the field is enabled again.
    private func refocus() {
        focused = false
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            if !missing { focused = true }
        }
    }
}

/// New vault password or key file for the open vault.
struct ChangePasswordSheet: View {
    @Environment(VaultSession.self) private var session
    let store: KeePassVaultStore
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmation = ""
    @State private var keyFile: Data?
    @State private var working = false
    @State private var problem: String?
    /// The password was changed, but older backup copies could not be removed, so the sheet stays to say so.
    @State private var changed = false
    /// The change was refused because the file changed elsewhere. The vault is reloaded when the sheet closes.
    @State private var reloadOnClose = false
    /// Called after the vault was reloaded on close, so the list can follow.
    var onReloaded: () -> Void = {}
    /// Called when the reload on close shows that the vault password changed elsewhere, so the vault can lock.
    var onChangedElsewhere: () -> Void = {}

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CredentialFields(password: $password, confirmation: $confirmation, keyFile: $keyFile, confirms: true)
                } footer: {
                    if changed {
                        Text("The vault is encrypted again with the new password. Copies elsewhere, such as on other devices, in iCloud versions or in exports, keep the old password.")
                    } else {
                        Text("The vault is encrypted again with the new password. Earlier backup copies kept on this device are removed. Copies elsewhere, such as on other devices, in iCloud versions or in exports, keep the old password.")
                    }
                }
                if working { WorkingNotice(text: "Encrypting the vault with the new password…") }
                if let problem { ProblemText(text: problem, secondary: changed) }
            }
            .formStyle(.grouped)
            .disabled(working)
            .interactiveDismissDisabled(working)
            .navigationTitle("Change vault password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(changed ? "Done" : "Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Saving…" : "Change") { change() }.disabled(working || changed || password.isEmpty || password != confirmation)
                }
            }
            .onDisappear {
                guard reloadOnClose else { return }
                let store = store
                let onReloaded = onReloaded
                Task {
                    do { try await store.reload(); onReloaded() } catch KDBXError.wrongCredentials {
                        onChangedElsewhere()
                    } catch {
                        // Unreadable for now. The vault stays as it is; the next save reports the problem.
                    }
                }
            }
        }
        .modifier(VaultSheetSize())
    }

    private func change() {
        working = true
        Task {
            do {
                let result = try await store.changeCredentials(to: .init(password: password, keyFile: keyFile))
                session.refreshBiometricKey()
                if result == .changedBackupsRemain {
                    problem = String(localized: "The password was changed, but older backup copies on this device could not be removed.")
                    changed = true
                    working = false
                } else {
                    dismiss()
                }
            } catch VaultStoreError.changedOnDisk {
                problem = String(localized: "The vault was changed elsewhere, so the password was not changed. Psss will reload the vault when you close this sheet. Then try again.")
                reloadOnClose = true
                working = false
            } catch {
                problem = (error as? KDBXError)?.messageForNewKey ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
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

/// What the lock screen's password is, for someone who forgot choosing it or opened a file made elsewhere.
struct PasswordExplainerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("It is the password chosen when this vault was created. It is not your Apple Account password or your device passcode.")
                    Text("If the file came from KeePassXC or Strongbox, use the password you set there.")
                    Text("A key file is a separate file that some vaults need as well. Choose one only if you added it when you created the vault.")
                } footer: {
                    Text("Psss cannot see or reset this password.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Your vault password")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .modifier(VaultSheetSize())
    }
}

/// Honest help for a lost vault password: what to try, how to use another vault, how to let go of this one.
struct LostPasswordSheet: View {
    let session: VaultSession
    let vaultName: String
    let onOpenAnother: () -> Void
    let onForgotten: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsForget = false

    private var managed: Bool { session.reference?.managed == true }

    /// Forgetting a vault Psss made removes its file, its rollback copies and the saved biometric key.
    private var forgetManagedFooter: String {
        if session.reference?.biometricUnlock == true, let biometry = session.biometry {
            return String(localized: "Forgetting removes this vault and its backup copies from this device, and turns off \(biometry.label) for it. This cannot be undone.")
        }
        return String(localized: "Forgetting removes this vault and its backup copies from this device. This cannot be undone.")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Psss cannot recover or reset a vault password. Nobody else can either, because the vault is encrypted with it.")
                } header: {
                    Text("Nothing to reset")
                }
                Section("Try first") {
                    Label("Caps Lock off, and the same keyboard language you used to create it", systemImage: "keyboard")
                    Label("The key file, if you added one when you created this vault", systemImage: "key")
                    Label("An older copy of the vault, on another device or in a backup, may have an older password", systemImage: "doc.on.doc")
                }
                Section {
                    Button("Open Another Vault…") { onOpenAnother() }
                    Button("Forget This Vault…", role: .destructive) { confirmsForget = true }
                } header: {
                    Text("Or move on")
                } footer: {
                    Text(managed
                         ? forgetManagedFooter
                         : String(localized: "Forgetting removes \(vaultName) from Psss. Your file is not deleted."))
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Forgot your password?")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Forget \(vaultName)?", isPresented: $confirmsForget) {
                Button(managed ? "Delete Vault from This Device" : "Forget Vault", role: .destructive) {
                    session.forget()
                    dismiss()
                    onForgotten()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(managed ? "The vault and its passwords are deleted from this device and cannot be recovered."
                             : "Psss stops using this file. The file stays where it is.")
            }
        }
        .modifier(VaultSheetSize())
    }
}


/// A problem or an explanation on a lock, creation or change screen: a warning symbol and the words in the primary style, or the
/// secondary style when nothing went wrong. Red is kept for deletion.
struct ProblemText: View {
    let text: String
    var secondary = false

    /// What VoiceOver reads: one element, with "Warning" in front when something went wrong.
    private var spoken: String { secondary ? text : String(localized: "Warning: \(text)") }

    var body: some View {
        Label { Text(verbatim: text) } icon: { Image(systemName: "exclamationmark.triangle").accessibilityHidden(true) }
            .foregroundStyle(secondary ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: spoken))
            // A problem that appears, or changes, is spoken at once: the person is looking at the field, not at this line.
            .onAppear { announce() }
            .onChange(of: text) { announce() }
    }

    private func announce() {
        guard !text.isEmpty else { return }
        AccessibilityNotification.Announcement(spoken).post()
    }
}
