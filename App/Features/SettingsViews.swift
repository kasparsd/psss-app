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
    /// Which page the Mac Settings window should show. Set it, then call `openSettings()` from the environment; the window
    /// switches to the Vaults pane, selects the page and clears this.
    var page: SettingsPage?

    /// Asks for Settings at a page. The caller then opens the window with `@Environment(\.openSettings)`.
    func show(_ page: SettingsPage) { self.page = page }
}

/// A place in the Mac Settings window that others can open it at.
enum SettingsPage: Hashable {
    /// A vault's own page, by the vault's id in the vault list.
    case vault(UUID)
    /// The "Add Vault" row of the Vaults pane.
    case addVault
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
            #if os(macOS)
            // One row with a push button, not three chevron rows (mock `#/settings` B1).
            MacHelpRow()
            #else
            ForEach(HelpTopics.all) { HelpRow(topic: $0) }
            #endif
        }
    }

    /// The footer under the Vaults group.
    static var vaultsFooter: LocalizedStringKey {
        "Each vault has its own password, file and \(BiometryKind.unlockName) setting."
    }
}

#if os(macOS)
/// The Mac's Help row: what it covers, and a Psss Help push button that shows the topics in a popover.
private struct MacHelpRow: View {
    @State private var shown = false

    var body: some View {
        LabeledContent {
            Button("Psss Help") { shown = true }
                .popover(isPresented: $shown) {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(HelpTopics.all) { topic in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(verbatim: topic.title).font(.headline)
                                Text(verbatim: topic.text).font(.body).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .frame(width: 320, alignment: .leading)
                }
        } label: {
            Text("Copying, verification codes and passkeys")
        }
    }
}
#endif

/// Forgets (or deletes) the open vault. Another remembered vault takes its place on the lock screen; with none left, the welcome
/// screen shows.
@MainActor
func leaveOpenVault(session: VaultSession, gate: UnlockGate, vaultSource: inout String, deletingFile: Bool = true) {
    VaultIdentities.remove()
    session.forget(deletingFile: deletingFile)
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
            // One group for the vault: what it is, where its file is, and what can be done to it, including Remove Vault… (owner,
            // 2026-11-25: the actions belong with the vault's details; Remove deletes nothing by itself, the confirmation says).
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
                removeButton
                #else
                saveCopyButton
                changePasswordButton
                removeButton
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
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle(VaultName.short(reference.name))
        #endif
        // The exporter belongs to the page that asks for it.
        .fileExporter(isPresented: Binding(get: { copyDocument != nil }, set: { if !$0 { copyDocument = nil } }),
                      document: copyDocument, contentType: .keePassVault,
                      defaultFilename: reference.name) { _ in copyDocument = nil }
        .modifier(RemoveVaultAlert(isPresented: $confirmsLeaving, reference: reference, next: whatShowsNext,
                                   saveCopy: store == nil ? nil : { saveCopy() },
                                   remove: { deletingFile in leave(deletingFile: deletingFile) }))
        .alert("Could not turn it on", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK") { problem = nil }
        } message: {
            Text(problem ?? "")
        }
    }

    private func leave(deletingFile: Bool) {
        leaveOpenVault(session: session, gate: gate, vaultSource: &vaultSource, deletingFile: deletingFile)
        afterLeaving()
    }

    private func saveCopy() {
        if let store { copyDocument = (try? VaultFiles.read(store.url)).map(VaultCopy.init) }
    }

    private var whatShowsNext: String {
        session.remembered.isEmpty
            ? String(localized: "Psss then shows the welcome screen.")
            : String(localized: "Psss then shows your next vault.")
    }

    private var saveCopyButton: some View {
        Button("Save a Copy…", action: saveCopy).disabled(store == nil)
    }

    /// Remove Vault… for every vault, in the vault's group; the confirmation says what happens to the file (owner, 2026-11-25).
    private var removeButton: some View {
        Button("Remove Vault…") { confirmsLeaving = true }
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
        return (parts + [RemoveVaultText.footer(reference)] + locked).joined(separator: " ")
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

/// The words of Remove Vault (owner, 2026-11-25, mock `#/settings` B2 to B5, B9): only a button that deletes says Delete, and
/// every message says where the file stays. A vault kept only on iPhone or iPad sits in Psss's own storage, which Files cannot
/// reach, so keeping it there would lose it anyway: removing it deletes it. On the Mac, Finder reaches it, so Remove keeps it.
@MainActor
enum RemoveVaultText {
    static var deviceName: String {
        switch AutoFillDevice.current {
        case .iPhone: String(localized: "iPhone")
        case .iPad: String(localized: "iPad")
        case .mac: String(localized: "Mac")
        }
    }

    /// The sentence in the vault group's footer.
    static func footer(_ reference: VaultReference) -> String {
        guard reference.managed else {
            return String(localized: "Removing it keeps the file in \(reference.menuLocation): you can open it again.")
        }
        #if os(macOS)
        return String(localized: "Removing it asks whether to keep the file on this Mac or delete it.")
        #else
        return String(localized: "It is kept only on this \(deviceName), so removing it deletes the file. Save a copy first if you may need it.")
        #endif
    }

    static func message(_ reference: VaultReference?, next: String) -> String {
        guard let reference, reference.managed else {
            let place = reference?.menuLocation ?? String(localized: "its folder")
            return String(localized: "Psss stops using this vault on this \(deviceName). The file stays in \(place) and you can open it again.") + " " + next
        }
        #if os(macOS)
        return String(localized: "Psss stops using this vault on this Mac. Remove Vault keeps the file on this Mac, in Psss’s folder. Delete File deletes it and its backups, and cannot be undone.") + " " + next
        #else
        return String(localized: "It is kept only on this \(deviceName), so removing it deletes the vault and its backups. Without another copy of the file, your logins are gone. This cannot be undone.") + " " + next
        #endif
    }
}

/// The Remove Vault confirmation, the same on the vault's Settings page and under Forgot Password on the lock screen.
struct RemoveVaultAlert: ViewModifier {
    @Binding var isPresented: Bool
    let reference: VaultReference?
    /// What shows after: the welcome screen or the next vault.
    let next: String
    /// Offered beside Delete Vault for a vault kept only on iPhone or iPad, when a copy can be made now.
    var saveCopy: (() -> Void)?
    let remove: (_ deletingFile: Bool) -> Void

    func body(content: Content) -> some View {
        let managed = reference?.managed == true
        content.alert(String(localized: "Remove \(reference?.name ?? "")?"), isPresented: $isPresented) {
            if !managed {
                Button("Remove Vault") { remove(false) }
            } else {
                #if os(macOS)
                Button("Remove Vault") { remove(false) }
                Button("Delete File", role: .destructive) { remove(true) }
                #else
                Button("Delete Vault", role: .destructive) { remove(true) }
                if let saveCopy { Button("Save a Copy…", action: saveCopy) }
                #endif
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(verbatim: RemoveVaultText.message(reference, next: next))
        }
    }
}
