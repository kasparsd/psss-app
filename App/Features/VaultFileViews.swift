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
    @State private var name = String(localized: "Passwords")
    @State private var password = ""
    @State private var confirmation = ""
    @State private var keyFile: Data?
    @State private var working = false
    @State private var problem: String?
    /// Whether Psss's folder in iCloud Drive can be used right now. Nil until asked, which can take a moment.
    @State private var iCloudAvailable: Bool?
    @State private var location = VaultLocation.iCloudDrive

    private var canCreate: Bool { !password.isEmpty && password == confirmation && !working }
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
                        TextField("Name", text: $name).multilineTextAlignment(.trailing)
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
                    Text("You enter it each time the vault unlocks. Psss cannot reset it, so keep a copy somewhere safe. You also need it if you reinstall Psss: Face ID and Touch ID are set up again afterwards.")
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
    @State private var otherFile: URL?
    @State private var explaining = false
    @State private var lost = false
    @State private var triedBiometric = false
    @State private var unlockingWithBiometrics = false
    /// An unlock attempt is under way: the password was submitted, or Face ID or Touch ID was asked. Off again with any failure
    /// or cancel; nothing waits for it. The lock icon shows the name meanwhile.
    @State private var opening = false
    /// "Use Password…" was pressed: the password form is shown in place.
    @State private var formRequested = false
    /// Face ID or Touch ID looked and did not recognise the person. The form opens with a line that says so.
    @State private var notRecognised = false
    @FocusState private var focused: Bool
    #if os(macOS)
    @State private var listener = TouchIDListener()
    @Environment(\.controlActiveState) private var controlActiveState
    #else
    /// The scene went to the background since Face ID last ran, so coming back asks again. The Face ID sheet itself makes the
    /// scene inactive and active, which must not start another attempt.
    @State private var leftScene = false
    #endif
    @Environment(\.scenePhase) private var scenePhase
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

    /// The password form is shown straight away when there is nothing else to try (no biometrics, a missing file) or when
    /// something needs the password (a problem, "not recognised", a lock notice); otherwise "Use Password…" shows it.
    private var showForm: Bool {
        formRequested || biometry == nil || missing || problem != nil || notRecognised || gate.lockNotice != nil
    }

    /// Mac: the sensor is being asked and the embedded view shows. iPhone and iPad: Face ID is not running in the background,
    /// so this is only true while the system sheet is up (`working`).
    private var listening: Bool {
        #if os(macOS)
        listener.isListening && !working
        #else
        false
        #endif
    }

    private var introLine: String {
        guard let biometry else { return String(localized: "Enter the vault password to open “\(vaultName)”.") }
        #if os(macOS)
        if controlActiveState != .key {
            return String(localized: "Click this window, then use \(biometry.label) or enter the vault password.")
        }
        #endif
        switch biometry {
        case .touchID: return String(localized: "Touch ID or enter the vault password to open “\(vaultName)”.")
        default: return String(localized: "Use \(biometry.label) or enter the vault password to open “\(vaultName)”.")
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
        .background(.background)
        .onAppear { startBiometricsOnAppear() }
        .task {
            // Like Apple Passwords, ask for Face ID straight away. Not when the vault was just locked because it changed
            // elsewhere: the saved key is probably stale, so the prompt would only fail. The notice says to enter the vault
            // password, and the glyph still tries.
            #if os(iOS)
            guard !triedBiometric else { return }
            triedBiometric = true
            await startFaceID(automatic: true)
            #endif
        }
        #if os(macOS)
        // The sensor answers only the app in front, so listen while this window is key and stop when it is not.
        .onChange(of: controlActiveState) { _, state in
            if state == .key { startBiometrics(automatic: true) } else { listener.stop() }
        }
        .onDisappear { listener.stop() }
        #else
        // Coming back to the app asks again; the system sheet's own inactive and active changes do not.
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { leftScene = true }
            else if phase == .active, leftScene {
                leftScene = false
                Task { await startFaceID(automatic: true) }
            }
        }
        #endif
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
    }

    private var content: some View {
        VStack(spacing: 16) {
            LockHeader(biometry: biometry, listening: listening, dimmed: working || !listening, vaultName: vaultName, opening: opening,
                       retry: { startBiometrics(automatic: false) }, context: lockContext)
            statusLine
            messageLine
            vaultSelector
            if showForm {
                form
            } else if !working {
                Button("Use Password…") { formRequested = true }
                    .buttonStyle(.bordered).controlSize(.large)
            }
        }
        .frame(maxWidth: 340)
        .padding(.horizontal, 24)
        .padding(.vertical, 24)
    }

    private var lockContext: LAContext? {
        #if os(macOS)
        listener.context
        #else
        nil
        #endif
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

    /// Where problems appear, as before: a problem replaces "not recognised", which replaces a lock notice.
    @ViewBuilder private var messageLine: some View {
        if let problem {
            ProblemText(text: problem)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        } else if notRecognised, let biometry {
            Text("\(biometry.label) didn't recognise you. Try again, or enter the vault password.")
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        } else if let notice = gate.lockNotice {
            // Information, not a mistake in what the person typed, so not red. A newer problem replaces it.
            Text(notice).foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var form: some View {
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
                .opacity(working ? 0.5 : 1)
            // Under the field, where it was typed. No space is held for it, so the idle screen stays compact.
            if working && !unlockingWithBiometrics {
                WorkingNotice(text: "Checking your vault password…")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            keyFileRow
            if missing {
                Button { choose(.relinkVault) } label: {
                    Label("Locate Vault File…", systemImage: "folder").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
            } else {
                Button(action: unlock) {
                    Text("Unlock").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(working || (password.isEmpty && keyFile == nil))
                .keyboardShortcut(.defaultAction)
            }
            HStack(spacing: 8) {
                Button("Forgot Password") { lost = true }
                Button("Help") { explaining = true }
            }
            .buttonStyle(.bordered)
            .foregroundStyle(.primary)
            .disabled(working)
            // The screen is centred, so the notice appearing under the field would move the field up. An invisible copy of the
            // notice below the buttons holds the same height until the notice takes its place, so the field never moves while
            // Unlock stays where it is when nothing is happening.
            if !(working && !unlockingWithBiometrics) {
                WorkingNotice(text: "Checking your vault password…")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hidden()
                    .accessibilityHidden(true)
            }
        }
        .onAppear { focused = true }
    }

    /// A vault that uses a key file shows its row. For any other vault (or one whose reference does not know yet) a small button
    /// adds one, so a key file is never out of reach.
    @ViewBuilder private var keyFileRow: some View {
        if session.reference?.usesKeyFile == true || keyFile != nil {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Key file")
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
        } else {
            Button("Use a Key File…") { choose(.keyFile) }
                .buttonStyle(.borderless)
                .disabled(working)
        }
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

    /// After the forgotten vault: another remembered vault takes its place on this lock screen, or the welcome screen shows.
    private func forgotten() {
        if session.reference == nil { vaultSource = ""; gate.markUnlocked() } else { vaultChanged() }
    }

    /// The vault this screen opens changed (chosen in the selector, or the previous one was forgotten): start from a clean
    /// form, say so at once when its file is gone, and ask for Face ID or Touch ID for the new vault.
    private func vaultChanged() {
        password = ""; keyFile = nil; keyFileName = nil
        problem = nil; notRecognised = false; formRequested = false
        gate.lockNotice = nil
        missing = session.reference.map { !$0.isReachable } ?? false
        if missing { problem = String(localized: "“\(vaultName)” can’t be found. Its file has moved or been deleted. Choose another vault above, locate the file, or forget this vault under Forgot Password.") }
        #if os(macOS)
        listener.stop()
        #endif
        startBiometrics(automatic: true)
    }

    /// "Unlock Vault:" and a pop-up of every available or remembered vault, with "Open Another Vault…" last. Shown on every lock
    /// screen, also with one vault, because the last item is the way to a file that is not listed.
    private var vaultSelector: some View {
        HStack(spacing: 8) {
            Text("Unlock Vault:").foregroundStyle(.secondary)
            Menu {
                ForEach(session.knownVaults, id: \.id) { vault in
                    // A toggle in a menu shows the checkmark for the current vault. The second Text (where it lives, or
                    // "Not found") is the item's subtitle.
                    Toggle(isOn: Binding(get: { vault.id == session.reference?.id },
                                         set: { _ in
                        guard vault.id != session.reference?.id else { return }
                        session.switchTo(vault.id)
                        vaultChanged()
                    })) {
                        Text(vault.name)
                        Text(vault.isReachable ? vault.menuLocation : String(localized: "Not found"))
                    }
                }
                Divider()
                Button("Open Another Vault…") { choose(.otherVault) }
            } label: {
                Text(vaultName)
            }
            .menuIndicator(.visible)
            .buttonStyle(.bordered)
            .foregroundStyle(.primary)
            .fixedSize()
            .disabled(working)
            .accessibilityLabel(Text("Vault: \(vaultName)"))
            .help("Choose a vault")
        }
    }

    /// Mac and iPhone/iPad entry points. `automatic` is the screen appearing, the window becoming key or the scene becoming
    /// active; false is a tap on the glyph. An automatic start is skipped when the vault was just locked with a notice (the saved
    /// key is probably stale); the glyph still tries.
    private func startBiometrics(automatic: Bool) {
        #if os(macOS)
        guard biometry != nil, !missing, !working, !(automatic && gate.lockNotice != nil) else { return }
        notRecognised = false
        listener.start(reason: String(localized: "Unlock \(vaultName).")) { outcome in
            switch outcome {
            case .matched(let context):
                Task { await unlockWithBiometrics(evaluated: context) }
            case .notRecognised:
                problem = nil
                notRecognised = true
            case .unavailable:
                gate.lockNotice = nil
                problem = String(localized: "\(biometry?.label ?? "Touch ID") cannot be used right now. Enter the vault password this time.")
            }
        }
        #else
        Task { await startFaceID(automatic: automatic) }
        #endif
    }

    private func startBiometricsOnAppear() {
        #if os(macOS)
        if controlActiveState == .key { startBiometrics(automatic: true) }
        #endif
    }

    #if os(iOS)
    private func startFaceID(automatic: Bool) async {
        guard biometry != nil, !missing, !working, !(automatic && gate.lockNotice != nil) else { return }
        notRecognised = false
        await unlockWithBiometrics()
    }
    #endif

    /// `evaluated` is the Mac's embedded Touch ID context, which already passed: the saved key is read without a second prompt.
    private func unlockWithBiometrics(evaluated: LAContext? = nil) async {
        guard !working else { return }
        working = true
        unlockingWithBiometrics = true
        // The icon starts changing as the attempt starts, not when the vault has opened; a failure or cancel puts the dots back.
        opening = true
        problem = nil
        notRecognised = false
        // The lock notice stays until the unlock succeeds or a new problem replaces it: cancelling the prompt explains nothing else.
        defer { working = false; unlockingWithBiometrics = false; opening = false }
        do {
            try await session.unlockWithBiometrics(evaluated: evaluated.map(EvaluatedContext.init), accepted: {})
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
        opening = true
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
                opening = false
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
                    Button("Forget This Vault…", role: .destructive) { confirmsForget = true }
                } header: {
                    Text("Or let go of it")
                } footer: {
                    Text(managed
                         ? forgetManagedFooter
                         : String(localized: "Forgetting removes \(vaultName) from Psss. Your file is not deleted."))
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Forgot Password")
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
