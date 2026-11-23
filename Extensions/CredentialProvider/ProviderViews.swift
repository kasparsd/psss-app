#if os(iOS)
import SwiftUI

/// Shown when AutoFill cannot open the vault: Face ID or Touch ID unlock is off, was reset, or the vault file is out of reach.
struct NotReady: View {
    let close: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Can’t open your vault here").font(.title2.bold()).multilineTextAlignment(.center)
                Text("AutoFill opens your vault with Face ID or Touch ID, so you never type the vault password here. If you have not created a vault yet, open Psss and create one. Then unlock it with your vault password and turn on Face ID or Touch ID. Vaults you opened from Files must be moved into Psss first. Nothing was changed.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Close", action: close).buttonStyle(.borderedProminent).controlSize(.large)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
            .navigationTitle("Psss")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Shown when a login or passkey could not be written to the vault, so nothing is reported to the system as saved.
struct SaveFailed: View {
    enum Subject { case login, passkey }

    var subject: Subject = .login
    let reason: String
    let close: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                switch subject {
                case .login:
                    Text("Can’t save this login").font(.title2.bold()).multilineTextAlignment(.center)
                    Text("The login was not saved. \(reason) Your vault was not changed.")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                case .passkey:
                    Text("Can’t save this passkey").font(.title2.bold()).multilineTextAlignment(.center)
                    Text("The passkey was not saved. \(reason) Nothing was changed.")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                Button("Close", action: close).buttonStyle(.borderedProminent).controlSize(.large)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
            .navigationTitle("Psss")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Shown when the person taps the key in the keyboard bar or chooses Passwords from AutoFill.
struct FillList: View {
    let host: String
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
    let cancel: () -> Void
    @State private var search = ""

    private var matches: [VaultItem] { items.filter { SharedVault.matches($0, host: host) } }
    private var others: [VaultItem] {
        let query = search.trimmingCharacters(in: .whitespaces)
        return items.filter { !matches.contains($0.id) && (query.isEmpty || $0.displayTitle.localizedStandardContains(query)
            || $0.account.localizedStandardContains(query)) }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            .prefix(40).map { $0 }
    }

    var body: some View {
        NavigationStack {
            List {
                if !matches.isEmpty {
                    Section {
                        ForEach(matches) { row($0) }
                    } header: {
                        Text("For \(host)")
                    }
                }
                Section(matches.isEmpty ? "" : String(localized: "Other logins")) {
                    ForEach(others) { row($0) }
                }
            }
            .searchable(text: $search, prompt: "Search")
            .navigationTitle("Psss")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) } }
        }
    }

    private func row(_ item: VaultItem) -> some View {
        Button { choose(item) } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(verbatim: item.displayTitle)
                    Text(verbatim: item.account).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Text("Fill").foregroundStyle(Color.accentColor)
            }
        }
        .foregroundStyle(.primary)
    }
}

private extension Array where Element == VaultItem {
    func contains(_ id: VaultItem.ID) -> Bool { contains { $0.id == id } }
}

/// Shown when a suggestion in the keyboard bar was tapped and the system needs our interface.
struct FillConfirm: View {
    let item: VaultItem
    let fill: () -> Void
    let cancel: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer()
                Text(verbatim: item.displayTitle).font(.title.weight(.semibold))
                Text(verbatim: item.account).foregroundStyle(.secondary)
                Button(action: fill) { Text("Fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.horizontal)
                Text("The prototype has no unlock step yet.").font(.footnote).foregroundStyle(.secondary)
                Spacer()
            }
            .navigationTitle("Psss")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) } }
        }
    }
}

/// The save prompt: site, account and name are already filled in, and nothing asks where to store it.
struct SaveLogin: View {
    let host: String
    let account: String
    let password: String
    @State var title: String
    let existing: VaultItem?
    let save: (String) -> Void
    let cancel: () -> Void

    init(host: String, account: String, password: String, title: String, existing: VaultItem?,
         save: @escaping (String) -> Void, cancel: @escaping () -> Void) {
        self.host = host; self.account = account; self.password = password
        _title = State(initialValue: existing?.title ?? "")
        self.existing = existing; self.save = save; self.cancel = cancel
    }

    private var isUpdate: Bool { existing != nil }
    private var passwordChanged: Bool { existing.map { $0.secret != password } ?? false }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $title, prompt: Text(verbatim: host))
                    LabeledContent("Website", value: host)
                    LabeledContent("Username", value: account)
                    LabeledContent("Password", value: "••••••••••")
                }
                if isUpdate && !passwordChanged {
                    Section { Text("This login is already saved.").foregroundStyle(.secondary) }
                }
                Section {
                    Button { save(title) } label: {
                        Text(isUpdate ? "Update login" : "Save login").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .disabled(isUpdate && !passwordChanged)
                }
            }
            .navigationTitle(isUpdate ? "Update password" : "Save password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now", action: cancel) } }
        }
    }
}

/// Choosing a passkey when more than one matches the site.
struct PasskeyPick: View {
    let rpID: String
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
    let cancel: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Passkeys for \(rpID)") {
                    if items.isEmpty { Text("No passkeys for this site yet.").foregroundStyle(.secondary) }
                    ForEach(items) { item in
                        Button { choose(item) } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(verbatim: item.displayTitle)
                                    Text(verbatim: item.account).font(.subheadline).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("Sign in").foregroundStyle(Color.accentColor)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }
            .navigationTitle("Psss")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) } }
        }
    }
}
#endif
