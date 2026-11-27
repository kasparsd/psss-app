import SwiftUI

/// A verification code that arrived as an `otpauth://` link (a site's “set up authenticator” button), waiting for the person to say
/// which login it belongs to. See docs/verification-codes.md, “Opening a site's setup link”.
struct IncomingCode: Identifiable {
    let id = UUID()
    let result: TOTPParse
}

/// Owned by the app, so a link that arrives while the vault is locked, or before any window shows it, waits for the unlocked vault.
/// Nothing is saved from the link itself: the vault shows `IncomingCodeSheet`, and only its confirm button writes.
@MainActor @Observable
final class IncomingCodeRequests {
    var pending: IncomingCode?

    /// Reads the link. A link that is not a code Psss can make still opens the sheet, which says why and saves nothing.
    func receive(_ url: URL) {
        guard url.scheme?.lowercased() == "otpauth" else { return }
        pending = IncomingCode(result: TOTP.parse(url.absoluteString))
    }

    /// Drops the link and the secret it holds, when the sheet closes or the vault locks.
    func clear() { pending = nil }
}

/// Opens when a site's setup link opens Psss: shows the code found, asks which login it belongs to (suggesting the likely ones), then
/// the same confirm step as Add verification code. Choosing a login saves nothing; only Save code or Replace code does.
struct IncomingCodeSheet: View {
    let result: TOTPParse
    let logins: [VaultItem]
    /// Stores the code in the login. Returns false when the vault refused the write (the vault screen then explains why).
    let onSave: (VaultItem, TOTPSetup) -> Bool
    /// Starts a new, unsaved login that holds the code. The vault opens its editor once this sheet has gone.
    let onNewLogin: (TOTPSetup) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: VaultItem?
    @State private var saved = false
    @State private var search = ""

    var body: some View {
        NavigationStack {
            Group {
                if case .setup(let setup) = result {
                    if let chosen {
                        ScrollView { step(setup, chosen).fixedSize(horizontal: false, vertical: true).padding().frame(maxWidth: .infinity) }
                    } else {
                        picker(setup)
                    }
                } else {
                    ScrollView { problem.fixedSize(horizontal: false, vertical: true).padding().frame(maxWidth: .infinity) }
                }
            }
            .navigationTitle("Add verification code")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !saved { Button("Cancel") { dismiss() } }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 450, minHeight: 440)
        #else
        .presentationDetents([.large])
        #endif
    }

    // MARK: Which login

    private func picker(_ setup: TOTPSetup) -> some View {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let all = logins.sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
        let suggested = query.isEmpty ? IncomingCodeMatch.suggested(for: setup, among: logins) : []
        let suggestedIDs = Set(suggested.map(\.id))
        let rest = all.filter { item in
            !suggestedIDs.contains(item.id) && (query.isEmpty || !PickerSearch.fields(of: item, query: query).isEmpty)
        }
        return List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(setup.shownIssuer.isEmpty ? "Found a verification code" : "Found a code for \(setup.shownIssuer)")
                        .font(.title2.weight(.semibold))
                    if !setup.shownAccount.isEmpty { Text(setup.shownAccount).foregroundStyle(.secondary) }
                    Text("Choose the login it belongs to. Nothing is saved until you confirm.").foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            Section {
                Button {
                    onNewLogin(setup)
                    dismiss()
                } label: {
                    Label(setup.shownIssuer.isEmpty ? "New login with this code" : "New login for \(setup.shownIssuer)", systemImage: "plus")
                }
            } footer: {
                Text("It opens the new login to review. Nothing is saved until you save it.")
            }
            if !suggested.isEmpty {
                Section("Likely") { ForEach(suggested) { row($0) } }
            }
            if !rest.isEmpty {
                Section(suggested.isEmpty ? "Logins" : "Other logins") { ForEach(rest) { row($0) } }
            } else if suggested.isEmpty {
                Section { Text(logins.isEmpty ? "You have no logins yet. Make a new one above." : "No login matches that.").foregroundStyle(.secondary) }
            }
        }
        .searchable(text: $search, prompt: "Search logins")
    }

    private func row(_ item: VaultItem) -> some View {
        Button { chosen = item } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.displayTitle)
                    let account = DisplayText.safe(item.account)
                    if !account.isEmpty { Text(account).foregroundStyle(.secondary) }
                    if item.totpUsable { Text("Has a code. Saving replaces it.").foregroundStyle(.secondary) }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    // MARK: Confirm, saved, problem

    @ViewBuilder private func step(_ setup: TOTPSetup, _ login: VaultItem) -> some View {
        if saved {
            CodeSavedContent(loginName: login.displayTitle, remindToDeleteScreenshot: false) { dismiss() }
        } else {
            CodeConfirmContent(setup: setup, loginName: login.displayTitle, hasExistingCode: login.totpUsable,
                               secondary: (title: "Choose another login", action: { chosen = nil })) {
                if onSave(login, setup) { saved = true } else { dismiss() }
            }
        }
    }

    private var problem: some View {
        VStack(spacing: 16) {
            Label { Text(result == .empty ? "This link holds no setup key." : result.problemText).multilineTextAlignment(.leading) } icon: { WarningSymbol() }
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("This link was not saved. Look for “Can’t scan?” on the site to get the setup key, then use Add code on a login.")
                .multilineTextAlignment(.center)
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
    }
}
