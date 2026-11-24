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
            Section {
                LabeledContent("Name", value: reference.name)
                LabeledContent("Location", value: managed ? String(localized: "On this device") : reference.fileName)
                if let store {
                    LabeledContent("Items", value: (itemCount ?? store.items().count).formatted())
                    if let modified = store.lastModified {
                        LabeledContent("Modified", value: modified.formatted(date: .abbreviated, time: .shortened))
                    }
                    DisclosureGroup("Technical details") {
                        LabeledContent("Format", value: store.formatLabel)
                        LabeledContent("Encryption", value: store.kdfSummary)
                    }
                }
            } footer: {
                Text(store == nil
                     ? reference.encryptionDescription + " " + String(localized: "Unlock Psss to see what is inside.")
                     : reference.encryptionDescription)
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
                Button("Save a Copy…") {
                    if let store { copyDocument = (try? VaultFiles.read(store.url)).map(VaultCopy.init) }
                }
                .disabled(store == nil)
                Button("Change Vault Password…") { onChangePassword?() }
                    .disabled(onChangePassword == nil)
            } header: {
                Text("Keep it safe")
            } footer: {
                Text(store == nil
                     ? String(localized: "Psss cannot reset the vault password. A copy is the way back if the file is lost.") + " " + String(localized: "Unlock Psss to save a copy or change the password.")
                     : String(localized: "Psss cannot reset the vault password. A copy is the way back if the file is lost."))
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
        .navigationTitle(reference.name)
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

    private var removeFooter: String {
        if managed {
            let key = savedKeyOn ? String(localized: ", and turns off \(BiometryKind.unlockName) for it") : ""
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
                LabeledContent("Name", value: reference.name)
                LabeledContent("Location", value: reference.managed ? String(localized: "On this device") : reference.fileName)
            } footer: {
                Text("To change this vault, choose it in the vault pop-up on the lock screen. It then opens here.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle(reference.name)
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
        .navigationTitle("Sample vault")
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

/// The line under a vault's name in a vaults list: where it is kept, and whether it opens with Face ID or Touch ID.
func vaultSummary(_ reference: VaultReference) -> String {
    let place = reference.managed ? String(localized: "On this device") : reference.fileName
    return reference.biometricUnlock ? "\(place) · \(BiometryKind.unlockName)" : place
}
