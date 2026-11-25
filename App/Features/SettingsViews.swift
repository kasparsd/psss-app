import SwiftUI

// Settings (owner, 2026-11-24, mock `#/settings`): two kinds of thing, kept apart. The app's own rows apply to every vault;
// each vault has a page of its own that holds everything about it, leaving it included. These views are shared: the iPhone
// and iPad sheet pushes them in a navigation stack, the Mac Settings window (`MacSettingsView`) shows them in panes. One copy
// of the words.

/// Things the Mac Settings window asks of the vault window, which owns the sheet for them.
@MainActor
@Observable
final class SettingsRequests {
    /// Change Vault Password: its sheet belongs to the vault window, so the Settings window asks for it.
    var changePassword = false
}

/// A vault's name in the Settings list: the name alone (where and how it is kept is on its page), and at the trailing end the
/// warning glyph only when the vault is not available (not downloaded yet, not found, can't be read), with the reason spoken.
/// No second line and no padlocks (owner, 2026-11-24, mock `#/settings`).
struct VaultListName: View {
    let session: VaultSession
    let reference: VaultReference
    let unlocked: Bool

    var body: some View {
        let state = session.state(of: reference, unlocked: unlocked)
        HStack {
            Text(verbatim: VaultName.short(reference.name))
            if !state.isAvailable {
                Spacer(minLength: 8)
                Image(systemName: state.symbol)
                    .foregroundStyle(.orange)
                    .accessibilityLabel(Text(verbatim: state.spoken))
                    .help(Text(verbatim: state.spoken))
            }
        }
    }
}

/// The app's own rows: when it locks, AutoFill, help. They cover every vault and show without one.
struct AppSettingsSections: View {
    /// The sample vault is open: the lock footer then describes the device passcode.
    let isSample: Bool
    let lockNow: () -> Void
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue

    var body: some View {
        Section {
            Picker(selection: $lockTiming) {
                ForEach(LockTiming.allCases) { Text($0.title).tag($0.rawValue) }
            } label: {
                Text("Lock")
            }
            Button("Lock Now", action: lockNow)
        } header: {
            Text("Locking")
        } footer: {
            Text(isSample
                 ? "Psss unlocks with Face ID, Touch ID or your device passcode. AutoFill always asks."
                 : "Applies to every vault.")
        }
        AutoFillSetupSection()
        #if os(iOS)
        // iOS does not say which app opens a site's setup link, so this is a standing line, not a status.
        Section {
            Text("To open a site's “set up authenticator” link in Psss, choose Psss under Settings, Passwords, Verification Codes, Set Up Codes In.")
        } header: {
            Text("Verification codes")
        }
        #endif
        Section("Help") {
            ForEach(HelpTopics.all) { HelpRow(topic: $0) }
        }
    }

    /// The footer under the Vaults group.
    static var vaultsFooter: LocalizedStringKey {
        "Each vault has its own password, file and \(BiometryKind.unlockName) setting."
    }
}

/// Forgets (or deletes) the open vault. Another remembered vault takes its place on the lock screen; with none left, the welcome
/// screen shows.
@MainActor
func leaveOpenVault(session: VaultSession, gate: UnlockGate, vaultSource: inout String) {
    VaultIdentities.remove()
    session.forget()
    if session.reference == nil { vaultSource = "" } else { gate.lock() }
}

/// One vault's page. It works from the vault's reference, which holds nothing secret, so the Mac Settings window can show it
/// while the vault is locked; what needs the open vault (its contents, a copy, a new password) is `nil` or off then, and the
/// page says so.
struct VaultSettingsPage: View {
    let session: VaultSession
    let gate: UnlockGate
    let reference: VaultReference
    /// The open vault, or nil while locked.
    let store: KeePassVaultStore?
    let itemCount: Int?
    /// Opens Change Vault Password; nil when it cannot be asked for now.
    let onChangePassword: (() -> Void)?
    /// Runs after the vault was forgotten or deleted.
    let afterLeaving: () -> Void

    @AppStorage("vaultSource") private var vaultSource = ""
    @State private var copyDocument: VaultCopy?
    @State private var confirmsLeaving = false
    @State private var problem: String?

    private var managed: Bool { reference.managed }
    private var savedKeyOn: Bool { session.reference?.biometricUnlock == true }

    var body: some View {
        Form {
            // One group for the vault: what it is, where its file is, and the two things done to the file (owner, 2026-11-25:
            // the actions belong with the vault's details). Leaving it stays last, in its own group (HIG: destructive apart).
            Section {
                LabeledContent("Name", value: VaultName.short(reference.name))
                VaultLocationRows(reference: reference)
                if let store {
                    LabeledContent("Items", value: (itemCount ?? store.items().count).formatted())
                    if let modified = store.lastModified {
                        LabeledContent("Modified", value: modified.formatted(date: .abbreviated, time: .shortened))
                    }
                }
                #if os(macOS)
                // The file actions share a row; the password is a labeled row with Change… at the right, as macOS draws a
                // password in Users & Groups (owner, 2026-11-25).
                HStack(spacing: 8) {
                    VaultLocationRows.showInFinder(reference)
                    saveCopyButton
                }
                LabeledContent("Vault Password") {
                    Button("Change…") { onChangePassword?() }
                        .disabled(onChangePassword == nil)
                        .accessibilityLabel(Text("Change Vault Password"))
                }
                #else
                saveCopyButton
                changePasswordButton
                #endif
                if let store {
                    DisclosureGroup("Technical details") {
                        LabeledContent("Format", value: store.formatLabel)
                        LabeledContent("Encryption", value: store.kdfSummary)
                    }
                }
            } footer: {
                Text(vaultFooter)
            }
            Section {
                Toggle("Unlock with \(BiometryKind.unlockName)", isOn: Binding(
                    get: { savedKeyOn },
                    set: { on in
                        if on { do { try session.enableBiometric() } catch { problem = String(localized: "The key could not be saved on this device. AutoFill needs a passcode set in Settings.") } }
                        else { session.turnOffSavedKey() }
                    }))
                    // Turning it on saves the key of the open vault, so it needs the vault open; turning it off does not.
                    .disabled(store == nil && !savedKeyOn)
            } header: {
                Text("Unlock")
            } footer: {
                let copy = AutoFillCopy(device: .current)
                Text(savedKeyOn ? copy.savedKeyOnFooter
                     : store == nil ? copy.savedKeyOffFooter + " " + String(localized: "Unlock Psss first.") : copy.savedKeyOffFooter)
            }
            Section {
                if managed {
                    Button("Delete Vault…", role: .destructive) { confirmsLeaving = true }
                } else {
                    Button("Forget Vault…") { confirmsLeaving = true }
                }
            } header: {
                Text("Remove")
            } footer: {
                Text(removeFooter)
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle(VaultName.short(reference.name))
        #endif
        // The exporter belongs to the page that asks for it.
        .fileExporter(isPresented: Binding(get: { copyDocument != nil }, set: { if !$0 { copyDocument = nil } }),
                      document: copyDocument, contentType: .keePassVault,
                      defaultFilename: reference.name) { _ in copyDocument = nil }
        .alert(managed ? String(localized: "Delete \(reference.name)?") : String(localized: "Forget \(reference.name)?"),
               isPresented: $confirmsLeaving) {
            if managed {
                Button("Delete Vault", role: .destructive) { leave() }
            } else {
                Button("Forget Vault") { leave() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(removeMessage)
        }
        .alert("Could not turn it on", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK") { problem = nil }
        } message: {
            Text(problem ?? "")
        }
    }

    private func leave() {
        leaveOpenVault(session: session, gate: gate, vaultSource: &vaultSource)
        afterLeaving()
    }

    private var whatShowsNext: String {
        session.remembered.isEmpty
            ? String(localized: "Psss then shows the welcome screen.")
            : String(localized: "Psss then shows your next vault.")
    }

    private var saveCopyButton: some View {
        Button("Save a Copy…") {
            if let store { copyDocument = (try? VaultFiles.read(store.url)).map(VaultCopy.init) }
        }
        .disabled(store == nil)
    }

    private var changePasswordButton: some View {
        Button("Change Vault Password…") { onChangePassword?() }
            .disabled(onChangePassword == nil)
    }

    /// What the file is, that Psss cannot reset its password, and (while locked) that the rest needs it unlocked.
    private var vaultFooter: String {
        let parts = [reference.encryptionDescription,
                     String(localized: "Psss cannot reset the vault password. A copy is the way back if the file is lost.")]
        let locked = store == nil ? [String(localized: "Unlock Psss to see what is inside, save a copy or change the password.")] : []
        return (parts + locked).joined(separator: " ")
    }

    private var removeFooter: String {
        if managed {
            let key = savedKeyOn ? String(localized: ", and removes its saved \(BiometryKind.keyName) key") : ""
            return String(localized: "Deletes \(reference.name) and its backup copies from this device\(key). Without another copy of the file, your logins are gone. This cannot be undone.")
        }
        return String(localized: "Psss stops using \(reference.name) on this device. The file is not deleted and you can open it again.")
    }

    private var removeMessage: String {
        if managed {
            return String(localized: "The vault and its backups are deleted from this device. Without another copy of the file, your logins are gone. This cannot be undone.") + " " + whatShowsNext
        }
        return String(localized: "Psss stops using this vault on this device. The file is not deleted and you can open it again.") + " " + whatShowsNext
    }
}

/// A vault Psss remembers but is not the active one: its name and where it is, and how to change it.
struct OtherVaultSettingsPage: View {
    let reference: VaultReference

    var body: some View {
        Form {
            Section {
                LabeledContent("Name", value: VaultName.short(reference.name))
                VaultLocationRows(reference: reference)
            } footer: {
                Text("To change this vault, choose it with the vault switcher or on the lock screen. It then opens here.")
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle(VaultName.short(reference.name))
        #endif
    }
}

/// The sample vault's page: nothing in it is kept, and the way to a real vault is the welcome screen.
struct SampleSettingsPage: View {
    let session: VaultSession
    let gate: UnlockGate
    let afterLeaving: () -> Void
    @AppStorage("vaultSource") private var vaultSource = ""
    @State private var confirmsClosing = false

    var body: some View {
        Form {
            Section {
                Text("A made-up vault to look around in. Nothing you change here is saved: it is gone when Psss locks or quits.")
            }
            Section {
                Button("Close Sample Vault") { confirmsClosing = true }
            } header: {
                Text("Leave the sample")
            } footer: {
                Text("Shows the welcome screen, where you create a vault, open a vault file or import your logins.")
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle("Sample vault")
        #endif
        .alert("Close the sample vault?", isPresented: $confirmsClosing) {
            Button("Close Sample Vault") {
                leaveOpenVault(session: session, gate: gate, vaultSource: &vaultSource)
                afterLeaving()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The sample vault closes and the welcome screen shows again. Nothing from it was saved on this device.")
        }
    }
}


/// Where a vault's file is: the place in words ("On this device", "iCloud Drive › Psss", a folder) and, for a file the person
/// opened, its name. A vault Psss created keeps its file under an internal name, so no File row. On the Mac the Location
/// tooltip is the full path, and the vault page puts **Show in Finder** (`showInFinder`) beside Save a Copy… (owner, 2026-11-25). iPhone and iPad have no Show in Files: Files has no reliable way to open at a file (docs/roadmap.md).
struct VaultLocationRows: View {
    let reference: VaultReference

    var body: some View {
        let url = reference.fileURL
        LabeledContent("Location") {
            Text(verbatim: reference.menuLocation)
                #if os(macOS)
                .help(Text(verbatim: url?.path ?? reference.fileName))
                #endif
        }
        if !reference.managed {
            LabeledContent("File") {
                Text(verbatim: DisplayText.safe(reference.fileName, empty: String(localized: "Unknown")))
                    .lineLimit(1).truncationMode(.middle)
                    #if os(macOS)
                    .textSelection(.enabled)
                    #endif
            }
        }
    }

    #if os(macOS)
    /// **Show in Finder** for a vault: opens the folder with its file selected.
    static func showInFinder(_ reference: VaultReference) -> some View {
        let url = reference.fileURL
        return Button("Show in Finder") { if let url { reveal(url, scoped: !reference.managed) } }
            .disabled(url == nil || !reference.isReachable)
    }

    /// Opens Finder at the file. A file opened in place is reached through its security-scoped bookmark.
    static func reveal(_ url: URL, scoped: Bool) {
        let accessing = scoped && url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
    #endif
}
