import LocalAuthentication
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
            SecureField("Vault Password", text: $password).noPasswordOffers()
            if confirms {
                SecureField("Repeat Vault Password", text: $confirmation).noPasswordOffers()
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
    @State private var name: String
    @State private var password = ""
    @State private var confirmation = ""
    @State private var keyFile: Data?
    @State private var working = false
    @State private var problem: String?
    /// Whether Psss's folder in iCloud Drive can be used right now. Nil until asked, which can take a moment.
    @State private var iCloudAvailable: Bool?
    @State private var location = VaultLocation.iCloudDrive

    init(session: VaultSession, importing: [VaultItem] = [], onCreated: @escaping () -> Void) {
        self.session = session
        self.importing = importing
        self.onCreated = onCreated
        _name = State(initialValue: VaultName.suggested(among: session.knownVaults.map(\.name)))
    }

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !password.isEmpty && password == confirmation && !working
    }
    /// iCloud Drive is the default and what is drawn until the answer arrives; without it the vault stays on the device.
    private var effectiveLocation: VaultLocation { iCloudAvailable == false ? .thisDevice : location }

    private var locationNote: String {
        if iCloudAvailable == false {
            return String(localized: "iCloud Drive is off for Psss, so this vault stays on this device and is deleted with Psss. Turn on iCloud Drive for Psss in Settings to keep it there instead.")
        }
        switch location {
        case .iCloudDrive:
            return String(localized: "Saved as \(VaultFiles.fileNameStem(name)).kdbx in the Psss folder in iCloud Drive. It is still there if you delete Psss or get a new device. Only the encrypted file is stored.")
        case .thisDevice:
            return String(localized: "The file stays on this device and is deleted if you delete Psss. Save a copy somewhere safe.")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Your logins, passkeys, codes, cards and notes are kept in one encrypted file. Psss cannot read it without the vault password.")
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
                Section {
                    LabeledContent("Name") {
                        // The row draws "Name"; hidden here, or the Mac also draws the field's own title in the middle (found 2026-11-25).
                        TextField("Name", text: $name).labelsHidden().multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.words)
                            #endif
                    }
                    Picker("Keep in", selection: Binding(get: { effectiveLocation }, set: { location = $0 })) {
                        Text("iCloud Drive").tag(VaultLocation.iCloudDrive)
                        Text("This device only").tag(VaultLocation.thisDevice)
                    }
                    .disabled(iCloudAvailable == false)
                } footer: {
                    Text(locationNote)
                }
                Section {
                    CredentialFields(password: $password, confirmation: $confirmation, keyFile: $keyFile, confirms: true)
                } header: {
                    Text("Vault Password")
                } footer: {
                    Text("You enter it each time the vault unlocks. Psss cannot reset it, so keep a copy somewhere safe. You also need it if you reinstall Psss: \(BiometryKind.keyName) is set up again afterwards.")
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
        .task { iCloudAvailable = await Task.detached { VaultFiles.iCloudFolder() != nil }.value }
    }

    private func create() {
        working = true
        problem = nil
        Task {
            do {
                try await session.create(name: name, credentials: .init(password: password, keyFile: keyFile), items: importing, location: effectiveLocation)
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

/// Shown instead of the vault while a KeePass vault is locked. Locking drops the keys, so unlocking needs the vault password.
///
/// Built on `UnlockForm` (plan `mail-style-vaults`, slice W1; mock `#/unlock-screen`): the password form is always shown, Unlock
/// first and then Use Touch ID (Face ID), and the system's biometric prompt appears by itself once per activation
/// (`biometricAutoPrompt`), with the button to bring it back. `embedded` is the same form in the content column beside the
/// sidebar: no header text and no vault pop-up row, because the sidebar chooses the vault.
struct VaultPasswordView: View {
    let session: VaultSession
    let gate: UnlockGate
    /// In the content area beside a sidebar: the icon and "Unlock <vault>" only, no full-screen header, no vault pop-up row.
    var embedded = false
    /// A line under the actions, for example "Psss is locked. All your vaults are locked."
    var footnote: String?
    /// iPhone, when other vaults are open: a labeled Cancel at the top that goes back to the vault that was open. Nil leaves it out.
    var cancel: (() -> Void)?
    @State private var password = ""
    @State private var keyFile: Data?
    @State private var keyFileName: String?
    /// What the one file picker of this screen is for. It is kept after the picker closes, because the completion runs after
    /// the presentation flag was reset.
    private enum FilePurpose { case relinkVault, keyFile }
    @State private var picking = false
    /// The person asked for a key file from the wrong-password notice, so the Key file row shows although the vault is not
    /// known to use one (mock `#/unlock-screen`, frames T and W).
    @State private var keyFileRequested = false
    /// The last problem is a wrong password, so its notice offers "Choose Key File…".
    @State private var wrongPassword = false
    @State private var purpose = FilePurpose.keyFile
    @State private var working = false
    @State private var problem: String?
    @State private var missing = false
    @State private var addChoice: AddVaultChoice?
    @State private var explaining = false
    @State private var lost = false
    @State private var unlockingWithBiometrics = false
    /// An unlock attempt is under way: the password was submitted, or Face ID or Touch ID was accepted. Off again with any
    /// failure; nothing waits for it. The lock icon shows the name meanwhile.
    @State private var opening = false
    /// Face ID or Touch ID looked and did not recognise the person. The notice says so.
    @State private var notRecognised = false
    /// The system prompt does not start by itself: the vault was just locked with a notice (the saved key is probably stale, so
    /// the prompt would only fail), or it failed once. The Use Touch ID button still asks.
    @State private var autoPromptOff: Bool
    @State private var prompter = BiometricPrompter()
    @FocusState private var focused: Bool
    @AppStorage("vaultSource") private var vaultSource = ""

    init(session: VaultSession, gate: UnlockGate, embedded: Bool = false, footnote: String? = nil, cancel: (() -> Void)? = nil) {
        self.session = session
        self.gate = gate
        self.embedded = embedded
        self.footnote = footnote
        self.cancel = cancel
        _autoPromptOff = State(initialValue: gate.lockNotice != nil)
    }

    private var biometry: BiometryKind? {
        guard session.reference?.biometricUnlock == true else { return nil }
        return session.biometry
    }

    private var vaultName: String { session.reference.map { VaultName.short($0.name) } ?? "Psss" }

    private var canUnlock: Bool { !password.isEmpty || keyFile != nil }

    private var introLine: String {
        guard let biometry else { return String(localized: "Enter the vault password.") }
        switch biometry {
        case .touchID: return String(localized: "Touch ID or enter the vault password.")
        default: return String(localized: "Use \(biometry.label) or enter the vault password.")
        }
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background { if !embedded { Rectangle().fill(.background) } }
        .overlay(alignment: .topLeading) {
            if let cancel {
                Button("Cancel", action: cancel).disabled(working && !unlockingWithBiometrics).padding(16)
            }
        }
        .biometricAutoPrompt(prompter: prompter, vault: session.reference?.id, enabled: biometry != nil && !missing && !autoPromptOff) {
            await askBiometrics()
        }
        .onChange(of: session.reference?.id) { vaultChanged() }
        .sheet(isPresented: $explaining) { PasswordExplainerSheet() }
        .sheet(isPresented: $lost) {
            LostPasswordSheet(session: session, vaultName: vaultName,
                              onForgotten: { forgotten() })
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
                    keyFileRequested = true
                    keyFileName = url.lastPathComponent
                    problem = nil
                } catch {
                    problem = (error as? KDBXError)?.message ?? String(localized: "That file can't be used as a key file.")
                }
            }
        }
        // Embedded in the main window, the window's own add-vault flow and File menu item apply.
        .modifier(LockScreenAddVault(enabled: !embedded, session: session, choice: $addChoice, working: working) { gate.markUnlocked() })
    }

    private var content: some View {
        VStack(spacing: 16) {
            LockHeader(biometry: nil, vaultName: vaultName, opening: opening, showsTitle: !embedded)
            if !embedded {
                statusLine
                vaultSelector
            }
            form
            // The screen is centred, so the notice appearing under the field would move the field up. An invisible copy of the
            // notice below the buttons holds the same height until the notice takes its place, so the field never moves while
            // Unlock stays where it is when nothing is happening.
            if !embedded && !(working && !unlockingWithBiometrics) && !hasMessage {
                progressNotice.hidden().accessibilityHidden(true)
            }
        }
        .frame(maxWidth: 340)
        .padding(.horizontal, 24)
        .padding(.vertical, 24)
    }

    /// The one line under the title. Face ID or Touch ID progress takes its place; the password check shows under the field instead.
    @ViewBuilder private var statusLine: some View {
        if working && unlockingWithBiometrics {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Opening your vault…")
            }
            .accessibilityElement(children: .combine)
        } else {
            Text(introLine).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Under the password field, in the one place for notices: a problem replaces "not recognised", which replaces a lock notice.
    @ViewBuilder private var messageLine: some View {
        if let problem {
            LockNotice(kind: .warning, text: problem,
                       action: wrongPassword && UnlockKeyFile.offersChoice(rowShown: showsKeyFileRow) ? ("Choose Key File…", { choose(.keyFile) }) : nil)
        } else if notRecognised, let biometry {
            LockNotice(kind: .info, text: String(localized: "\(biometry.label) didn't recognise you. Try again, or enter the vault password."))
        } else if let notice = gate.lockNotice {
            // Information, not a mistake in what the person typed, so not a warning. A newer problem replaces it.
            LockNotice(kind: .info, text: notice)
        }
    }

    private var hasMessage: Bool { problem != nil || (notRecognised && biometry != nil) || gate.lockNotice != nil }

    private var progressNotice: some View {
        LockNotice(kind: .progress, title: "Checking your vault password…",
                   text: String(localized: "This takes a moment on purpose: it makes guessing your vault password very slow. Keep this window open."))
    }

    private var form: some View {
        UnlockForm(vaultName: embedded ? vaultName : nil, password: $password, focused: $focused, biometry: biometry, working: working,
                   fieldDisabled: missing, canUnlock: canUnlock, footnote: footnote,
                   unlock: unlock, useBiometrics: { Task { await askBiometrics() } },
                   locateFile: missing ? { choose(.relinkVault) } : nil,
                   forgotPassword: { lost = true }, help: { explaining = true }) {
            // Under the field, where it was typed. No space is held for it, so the idle screen stays compact.
            if working && !unlockingWithBiometrics {
                progressNotice
            } else {
                messageLine
            }
        } keyFile: {
            keyFileRow
        }
        .onAppear { focused = true }
    }

    /// The Key file row shows only when the vault is known to use a key file (Psss records that after the first unlock), a file is
    /// chosen, or the person asked for one from the wrong-password notice. Never a standing control for a vault without one.
    private var showsKeyFileRow: Bool {
        UnlockKeyFile.shows(usesKeyFile: session.reference?.usesKeyFile == true, chosen: keyFile != nil, requested: keyFileRequested)
    }

    @ViewBuilder private var keyFileRow: some View {
        if showsKeyFileRow {
            KeyFileRow(fileName: keyFile == nil ? nil : (keyFileName ?? ""), choose: { choose(.keyFile) }, remove: {
                keyFile = nil; keyFileName = nil; keyFileRequested = false
            })
        }
    }

    /// Opens the screen's one file picker for `purpose`. The keyboard first: a picker requested while the password field holds
    /// focus is often dropped on iPhone and iPad, so the field lets go first (which closes the keyboard) and the picker follows
    /// once the keyboard has gone.
    private func choose(_ purpose: FilePurpose) {
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
    }

    /// After the forgotten vault: another remembered vault takes its place on this lock screen (the change of vault resets the
    /// form), or the welcome screen shows.
    private func forgotten() {
        if session.reference == nil { vaultSource = ""; gate.markUnlocked() }
    }

    /// The vault this screen opens changed (chosen in the selector or the sidebar, or the previous one was forgotten): start from
    /// a clean form and say so at once when its file is gone. The automatic prompt follows the vault by itself.
    private func vaultChanged() {
        prompter.cancel()
        password = ""; keyFile = nil; keyFileName = nil
        problem = nil; notRecognised = false
        keyFileRequested = false; wrongPassword = false
        gate.lockNotice = nil
        autoPromptOff = false
        missing = session.reference.map { !$0.isReachable } ?? false
        if missing { problem = String(localized: "“\(vaultName)” can’t be found. Its file has moved or been deleted. Choose another vault, locate the file, or forget this vault under Forgot Password.") }
    }

    /// Shows the system's Face ID or Touch ID prompt (biometric only; the vault password field is the fallback) and, when the
    /// person passes, opens the vault with that evaluated context so the saved key is read without a second prompt. Called by the
    /// automatic prompt and by the Use Touch ID button.
    private func askBiometrics() async {
        guard let biometry, !missing, !working else { return }
        notRecognised = false
        switch await prompter.evaluate(reason: String(localized: "Unlock \(vaultName).")) {
        case .evaluated(let context):
            await unlockWithBiometrics(evaluated: context)
        case .cancelled:
            break
        case .notRecognised:
            problem = nil
            notRecognised = true
            refocus()
        case .unavailable:
            gate.lockNotice = nil
            autoPromptOff = true
            problem = String(localized: "\(biometry.label) cannot be used right now. Enter the vault password this time.")
            refocus()
        }
    }

    /// `evaluated` already passed the system prompt: the saved key is read with it.
    private func unlockWithBiometrics(evaluated: LAContext) async {
        guard !working else { return }
        working = true
        unlockingWithBiometrics = true
        // The icon changes as the attempt starts, not when the vault has opened; a failure puts the dots back.
        opening = true
        problem = nil
        notRecognised = false
        // The lock notice stays until the unlock succeeds or a new problem replaces it: cancelling the prompt explains nothing else.
        defer { working = false; unlockingWithBiometrics = false; opening = false }
        do {
            try await session.unlockWithBiometrics(evaluated: EvaluatedContext(context: evaluated), accepted: {})
            password = ""
            gate.lockNotice = nil
            gate.markUnlocked()
        } catch BiometricKeyError.cancelled {
            refocus()
        } catch BiometricKeyError.unavailable {
            gate.lockNotice = nil
            autoPromptOff = true
            problem = String(localized: "\(biometry?.label ?? "Face ID") cannot be used right now. Enter the vault password this time.")
            refocus()
        } catch BiometricKeyError.invalidated {
            gate.lockNotice = nil
            autoPromptOff = true
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
        guard !working, canUnlock else { return }
        prompter.cancel()
        working = true
        opening = true
        problem = nil
        wrongPassword = false
        notRecognised = false
        gate.lockNotice = nil
        Task {
            do {
                try await session.unlock(credentials: .init(password: password.isEmpty ? nil : password, keyFile: keyFile))
                password = ""; keyFile = nil; keyFileName = nil
                gate.markUnlocked()
            } catch {
                if case VaultStoreError.fileMissing = error { missing = true }
                if case KDBXError.wrongCredentials = error {
                    wrongPassword = true
                    problem = String(localized: "That didn’t open \(vaultName). Check Caps Lock and your keyboard language. If this vault uses a key file, choose it.")
                } else {
                    problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription
                }
                password = ""
                working = false
                opening = false
                refocus()
            }
            working = false
        }
    }

    /// The Vault row: "Vault" on the left, the vault that will open with the pop-up chevrons on the right, the system's own pop-up
    /// idiom (a Settings row on iPhone and iPad, a pop-up button on the Mac). Its menu is the vault switcher's, every vault padlocked
    /// closed, ending in the add-vault items. Shown on every full-screen lock screen, also with one vault, because adding is the way
    /// to a file that is not listed (owner, 2026-11-24).
    private var vaultSelector: some View {
        VaultRow(session: session, state: currentState, context: .lockScreen, choose: { id in
            guard id != session.reference?.id else { return }
            session.show(id)
        }, add: { addChoice = $0 })
        // Not disabled while the system prompt is up: it covers the screen then, and a disabled-then-enabled menu button misses
        // the first tap that follows the prompt's dismissal (iPad). Only the password check holds it still.
        .disabled(working && !unlockingWithBiometrics)
    }

    /// The current vault's state for the Vault row: locked here by definition, so Locked, Needs password or not available.
    private var currentState: VaultState {
        guard let reference = session.reference else { return .locked }
        return session.state(of: reference)
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

/// The full-screen lock screen's own add-vault flow and File › Add Vault… item. Not applied when the form is embedded in the main
/// window, which has its own.
private struct LockScreenAddVault: ViewModifier {
    let enabled: Bool
    let session: VaultSession
    @Binding var choice: AddVaultChoice?
    let working: Bool
    let added: () -> Void

    func body(content: Content) -> some View {
        if enabled {
            content
                .addVaultFlow($choice, session: session, onAdded: added)
                .focusedSceneValue(\.addVault, working ? nil : { choice = .create })
        } else {
            content
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
    let onForgotten: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsForget = false

    private var managed: Bool { session.reference?.managed == true }

    private var next: String {
        session.reference.map { RemoveVaultText.whatShowsNext(session: session, removing: $0.id) } ?? ""
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
                    // The same Remove Vault as the vault's Settings page: only a button that deletes says Delete (owner, 2026-11-25).
                    Button("Remove This Vault…") { confirmsForget = true }
                } header: {
                    Text("Or let go of it")
                } footer: {
                    if let reference = session.reference { Text(verbatim: RemoveVaultText.footer(reference)) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Forgot Password")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .modifier(RemoveVaultAlert(isPresented: $confirmsForget, reference: session.reference, next: next) { deletingFile in
                session.forget(deletingFile: deletingFile)
                dismiss()
                onForgotten()
            })
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
