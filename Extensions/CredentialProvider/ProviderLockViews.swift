import SwiftUI
import UniformTypeIdentifiers

// The screens of a vault that is not open yet (plan `vault-switcher-and-extension-style`, sections 2 and 3; mock `#/autofill`, frames
// J to R and Z). The Vault row stays at the top of every one of them, so another vault is one choice away; Unlock sits at its
// trailing end when the vault is locked, and with one vault (no row) the notice carries it. Not available vaults have no Unlock.

/// One notice under the Vault row: what is true now, in the vault's name, and what Psss will do. `unlock` is the button's action
/// for a locked vault and nil for one that is not available.
struct ProviderNotice {
    var tone: ProviderNotices.Tone
    var text: String
    var unlock: (() -> Void)?

    init(_ notice: ProviderNotices.Notice, unlock: (() -> Void)? = nil) {
        tone = notice.tone; text = notice.text; self.unlock = unlock
    }
}

/// The notice. With one vault there is no Vault row to carry Unlock, so the notice carries it (`carriesUnlock`).
struct ProviderNoticeView: View {
    let notice: ProviderNotice
    let carriesUnlock: Bool

    var body: some View {
        let kind: LockNotice.Kind = notice.tone == .info ? .info : .warning
        if carriesUnlock, let unlock = notice.unlock {
            LockNotice(kind: kind, text: notice.text, action: (title: "Unlock", run: unlock))
        } else {
            LockNotice(kind: kind, text: notice.text)
        }
    }
}

/// The screen of a vault that is locked, needs its password or is not available: the Vault row and one notice.
struct ProviderLockedScreen: View {
    let title: LocalizedStringKey
    var vaults: ProviderVaultSwitch?
    let notice: ProviderNotice
    let cancel: () -> Void

    var body: some View {
        ProviderScreen(heading: title, cancel: ProviderAction(title: "Cancel", run: cancel), vaults: vaults) {
            ProviderNoticeView(notice: notice, carriesUnlock: vaults == nil)
                .padding(16)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }
}

/// The screen while another vault opens (after the Vault row's choice, before Face ID answers): the Vault row with the new vault's
/// name and a neutral progress line. Nothing of the previous vault's list or search is left on screen.
struct ProviderLoadingScreen: View {
    let title: LocalizedStringKey
    var vaults: ProviderVaultSwitch?
    let cancel: () -> Void

    var body: some View {
        ProviderScreen(heading: title, cancel: ProviderAction(title: "Cancel", run: cancel), vaults: vaults) {
            VStack(spacing: 12) {
                ProgressView()
                Text("Opening…").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
        }
    }
}

/// "No vault yet": nothing has been created, or only the sample vault exists, so there is nothing to open and nothing to switch.
struct NoVaultYet: View {
    let close: () -> Void

    var body: some View {
        ProviderScreen(primary: ProviderAction(title: "Close", run: close)) {
            VStack(spacing: 16) {
                Text("No vault yet").font(.title2.bold()).multilineTextAlignment(.center)
                Text("Open Psss and create a vault. Then come back here to fill your logins. The sample vault is not available for AutoFill.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                InlinePrimary(title: "Close", action: close)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
        }
    }
}

/// The app's lock screen inside the sheet (mock `#/autofill`, frames L to O; `#/unlock-screen`): the Vault row, the vault password,
/// the Key file row only when the vault is known to use a key file or after "Choose Key File…" in the wrong-password notice, and
/// Unlock. No More Options, no Forgot Password (that help lives in the app, which a sheet cannot open). Cancel goes back to the
/// locked list. The password and the key file bytes live only in this view's state and are cleared when an attempt ends; nothing
/// is logged or saved, and the extension saves no Face ID key after this unlock.
struct ProviderPasswordUnlock: View {
    /// The vault's name, already safe for a sentence (`VaultName.sentence`).
    let name: String
    var vaults: ProviderVaultSwitch?
    let usesKeyFile: Bool
    /// Tries to open the vault with what was typed. Throws what the screen should say; returns when the vault is open or when
    /// the caller has already shown another screen.
    let unlock: (KDBXCredentials) async throws -> Void
    let cancel: () -> Void

    @State private var password = ""
    @State private var keyFile: Data?
    @State private var keyFileName: String?
    @State private var keyFileRequested = false
    @State private var picking = false
    @State private var wrongPassword = false
    @State private var problem: String?
    @State private var working = false
    @FocusState private var focused: Bool

    private var showsKeyFileRow: Bool {
        UnlockKeyFile.shows(usesKeyFile: usesKeyFile, chosen: keyFile != nil, requested: keyFileRequested)
    }

    private var canSubmit: Bool { !working && !(password.isEmpty && keyFile == nil) }

    var body: some View {
        ProviderScreen(heading: "Unlock \(name)", cancel: ProviderAction(title: "Cancel", run: cancel),
                       primary: ProviderAction(title: "Unlock", isEnabled: canSubmit, run: submit), vaults: vaults) {
            ScrollView {
                VStack(spacing: 16) {
                    UnlockPasswordField(text: $password, focused: $focused, working: working, onSubmit: submit)
                    if showsKeyFileRow {
                        KeyFileRow(fileName: keyFile == nil ? nil : (keyFileName ?? ""), choose: choose, remove: {
                            keyFile = nil; keyFileName = nil; keyFileRequested = false
                        })
                        .disabled(working)
                    }
                    InlinePrimary(title: "Unlock", isEnabled: canSubmit, action: submit)
                    notice
                    if !working {
                        Text("Opens \(name) for this sheet only. Psss closes it when the sheet closes.")
                            .foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .onAppear { focused = true }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.data]) { result in
            guard let url = try? result.get() else { return }
            // Read inside the security scope, keep only the bytes, and only until the attempt ends.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                _ = try KDBXCredentials.keyFileHash(data)
                keyFile = data
                keyFileName = url.lastPathComponent
                keyFileRequested = true
                problem = nil
                wrongPassword = false
            } catch {
                problem = (error as? KDBXError)?.message ?? String(localized: "That file can’t be used as a key file.")
                wrongPassword = false
            }
        }
    }

    @ViewBuilder private var notice: some View {
        if working {
            LockNotice(kind: .progress, title: "Checking your vault password…",
                       text: String(localized: "This takes a moment on purpose: it makes guessing your vault password very slow. Keep this sheet open."))
        } else if let problem {
            if wrongPassword && UnlockKeyFile.offersChoice(rowShown: showsKeyFileRow) {
                LockNotice(kind: .warning, text: problem, action: (title: "Choose Key File…", run: choose))
            } else {
                LockNotice(kind: .warning, text: problem)
            }
        }
    }

    /// The picker waits until the keyboard has gone: one requested while the password field holds focus is often dropped.
    private func choose() {
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

    private func submit() {
        guard canSubmit else { return }
        working = true
        problem = nil
        wrongPassword = false
        let credentials = KDBXCredentials(password: password.isEmpty ? nil : password, keyFile: keyFile)
        Task { @MainActor in
            do {
                try await unlock(credentials)
                clear()
            } catch ExtensionUnlockError.tooMuchMemory {
                problem = ProviderNotices.openPsss(name: name).text
                clear()
            } catch KDBXError.wrongCredentials {
                wrongPassword = true
                problem = ProviderNotices.wrongPassword(name: name)
                clear()
            } catch {
                problem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.messageInProvider
                    ?? String(localized: "Psss could not open this vault. Try again.")
                clear()
            }
            working = false
            if problem != nil { refocus() }
        }
    }

    /// The typed password goes at the end of every attempt, whatever its result.
    private func clear() { password = "" }

    /// The cursor goes back into the field, if it left it during the attempt.
    private func refocus() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            focused = true
        }
    }
}
