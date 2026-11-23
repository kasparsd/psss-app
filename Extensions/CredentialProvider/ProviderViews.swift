import SwiftUI

// The screens of the AutoFill provider. They are shared by iPhone, iPad and Mac. Each screen has a title and body text and uses
// no other type size; secondary information is the secondary foreground style. On iOS a screen is a navigation stack with Cancel
// in the bar. On the Mac the extension is shown in a system sheet, so a screen is a fixed-size panel with its buttons in a
// footer: Cancel (Escape) and the main button (Return) at the trailing edge.

/// A button the screen scaffold places for the platform.
struct ProviderAction {
    let title: LocalizedStringKey
    var isEnabled = true
    let run: () -> Void
}

/// The frame every provider screen sits in.
struct ProviderScreen<Content: View>: View {
    /// Mac only: the heading above the content (iOS shows "Psss" in the navigation bar).
    var heading: LocalizedStringKey?
    /// Cancel in the navigation bar on iOS, in the footer on the Mac.
    var cancel: ProviderAction?
    /// Mac only: the default button in the footer. On iOS the content carries its own main button (see `InlinePrimary`).
    var primary: ProviderAction?
    /// Mac only: a button at the leading edge of the footer, to leave a second level.
    var back: ProviderAction?
    @ViewBuilder var content: Content

    var body: some View {
        #if os(iOS)
        NavigationStack {
            content
                .navigationTitle("Psss")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if let cancel {
                        ToolbarItem(placement: .cancellationAction) { Button(cancel.title, action: cancel.run) }
                    }
                }
        }
        #else
        VStack(spacing: 0) {
            if let heading {
                Text(heading).font(.title2.bold()).frame(maxWidth: .infinity, alignment: .leading)
                    .padding([.horizontal, .top], 20).padding(.bottom, 8)
            }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            HStack {
                if let back { Button(back.title, action: back.run) }
                Spacer()
                if let cancel {
                    Button(cancel.title, action: cancel.run).keyboardShortcut(.cancelAction)
                }
                if let primary {
                    Button(primary.title, action: primary.run).keyboardShortcut(.defaultAction).disabled(!primary.isEnabled)
                }
            }
            .padding(16)
        }
        .frame(minWidth: 460, idealWidth: 480, minHeight: 360, idealHeight: 420)
        .onExitCommand { (cancel ?? primary)?.run() }
        #endif
    }
}

/// The main button of a screen. On iOS it sits in the content. On the Mac the screen's footer carries it, so this is empty.
private struct InlinePrimary: View {
    let title: LocalizedStringKey
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        #if os(iOS)
        Button(action: action) { Text(title).frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isEnabled)
        #else
        EmptyView()
        #endif
    }
}

/// Shown when AutoFill cannot open the vault: Face ID or Touch ID unlock is off, was reset, or the vault file is out of reach.
struct NotReady: View {
    let close: () -> Void

    var body: some View {
        ProviderScreen(primary: ProviderAction(title: "Close", run: close)) {
            VStack(spacing: 16) {
                Text("Can’t open your vault here").font(.title2.bold()).multilineTextAlignment(.center)
                Text(Self.explanation).foregroundStyle(.secondary).multilineTextAlignment(.center)
                InlinePrimary(title: "Close", action: close)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
        }
    }

    private static var explanation: LocalizedStringKey {
        #if os(iOS)
        "AutoFill opens your vault with Face ID or Touch ID, so you never type the vault password here. If you have not created a vault yet, open Psss and create one. Then unlock it with your vault password and turn on Face ID or Touch ID. Vaults you opened from Files must be moved into Psss first. Nothing was changed."
        #else
        "AutoFill opens your vault with Touch ID, so you never type the vault password here. If you have not created a vault yet, open Psss and create one. Then unlock it with your vault password and turn on Touch ID. Nothing was changed."
        #endif
    }
}

/// Shown when a login or passkey could not be written to the vault, so nothing is reported to the system as saved.
struct SaveFailed: View {
    enum Subject { case login, passkey }

    var subject: Subject = .login
    let reason: String
    let close: () -> Void

    var body: some View {
        ProviderScreen(primary: ProviderAction(title: "Close", run: close)) {
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
                InlinePrimary(title: "Close", action: close)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
        }
    }
}

/// One login in a list: name and account, and the action it triggers.
private struct LoginRow: View {
    let item: VaultItem
    /// Shown after the account, so a login for another site says which site it belongs to.
    var showsSite = false
    let verb: LocalizedStringKey
    var isDefault = false
    let action: () -> Void

    private var detail: String {
        let site = SharedVault.host(item.website)
        return showsSite && !site.isEmpty ? "\(item.account) · \(site)" : item.account
    }

    var body: some View {
        let button = Button(action: action) {
            HStack {
                VStack(alignment: .leading) {
                    Text(verbatim: item.displayTitle)
                    if !detail.isEmpty { Text(verbatim: detail).foregroundStyle(.secondary) }
                }
                Spacer()
                Text(verb).foregroundStyle(Color.accentColor)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        if isDefault { button.keyboardShortcut(.defaultAction) } else { button }
    }
}

/// Shown when the person taps the key in the keyboard bar or chooses Passwords from AutoFill.
///
/// Logins saved for the site come first, and when exactly one matches it is the default action. Logins for other sites are
/// behind the labeled button "Other Logins…", and choosing one asks for a confirmation that names both sites. On a plain `http`
/// page no login is offered automatically: the page's own logins are behind a button and ask for confirmation too. When the
/// site is unknown, every login is "other".
struct FillList: View {
    let site: FillSite
    /// Every login that has a password.
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
    let cancel: () -> Void

    @State private var showOthers = false
    @State private var showSiteLogins = false
    @State private var search = ""
    @State private var pending: Pending?

    /// A choice waiting for the confirmation.
    private struct Pending: Identifiable {
        let item: VaultItem
        let otherSite: Bool
        let plainHTTP: Bool
        var id: UUID { item.id }
    }

    private var plainHTTP: Bool { if case .plainHTTP = site { true } else { false } }

    private var siteLogins: [VaultItem] {
        guard let host = site.host else { return [] }
        return items.filter { SharedVault.matches($0, host: host) }
    }

    private var others: [VaultItem] {
        let own = Set(siteLogins.map(\.id))
        let query = search.trimmingCharacters(in: .whitespaces)
        return items.filter { !own.contains($0.id) && (query.isEmpty || $0.displayTitle.localizedStandardContains(query)
            || $0.account.localizedStandardContains(query)) }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            .prefix(40).map { $0 }
    }

    var body: some View {
        screen
            .alert(alertTitle, isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), presenting: pending) { pending in
                // Cancel is the default: continuing takes a deliberate choice.
                Button("Fill Anyway") { choose(pending.item) }
                Button("Cancel", role: .cancel) {}.keyboardShortcut(.defaultAction)
            } message: { pending in
                Text(message(for: pending))
            }
    }

    @ViewBuilder private var screen: some View {
        #if os(iOS)
        ProviderScreen(cancel: ProviderAction(title: "Cancel", run: cancel)) {
            mainContent.navigationDestination(isPresented: $showOthers) { othersContent }
        }
        #else
        if showOthers {
            ProviderScreen(heading: "Other Logins", cancel: ProviderAction(title: "Cancel", run: cancel),
                           back: ProviderAction(title: "Back") { showOthers = false; search = "" }) { othersContent }
        } else {
            ProviderScreen(heading: "Choose a Login", cancel: ProviderAction(title: "Cancel", run: cancel)) { mainContent }
        }
        #endif
    }

    // MARK: Screens

    private var mainContent: some View {
        VStack(spacing: 0) {
            List {
                switch site {
                case .secure(let host):
                    if siteLogins.isEmpty {
                        Section { Text("No logins are saved for \(host).").foregroundStyle(.secondary) }
                    } else {
                        Section { ForEach(siteLogins) { row($0, isDefault: siteLogins.count == 1) } } header: { Text("For \(host)") }
                    }
                case .plainHTTP(let host):
                    Section {
                        Text("\(host) is not encrypted (http), so Psss does not offer logins here by itself.").foregroundStyle(.secondary)
                        if !showSiteLogins {
                            Button("Show Logins for \(host)…") { showSiteLogins = true }
                        }
                    }
                    if showSiteLogins {
                        Section { ForEach(siteLogins) { row($0) } } header: { Text("For \(host)") }
                    }
                case .unknown:
                    Section { Text("Psss could not tell which site this is.").foregroundStyle(.secondary) }
                }
            }
            HStack {
                Button("Other Logins…") { showOthers = true }
                #if os(iOS)
                    .buttonStyle(.bordered).controlSize(.large)
                #endif
                Spacer()
            }
            .padding(16)
        }
    }

    private var othersContent: some View {
        VStack(spacing: 0) {
            #if os(macOS)
            TextField("Search", text: $search).textFieldStyle(.roundedBorder).padding([.horizontal, .bottom], 16)
            #endif
            List {
                if others.isEmpty {
                    Text("No other logins match.").foregroundStyle(.secondary)
                } else {
                    ForEach(others) { row($0, showsSite: true, verb: "Fill…") }
                }
            }
        }
        #if os(iOS)
        .searchable(text: $search, prompt: "Search")
        #endif
    }

    private func row(_ item: VaultItem, showsSite: Bool = false, verb: LocalizedStringKey = "Fill", isDefault: Bool = false) -> some View {
        LoginRow(item: item, showsSite: showsSite, verb: plainHTTP && !showsSite ? "Fill…" : verb, isDefault: isDefault) { select(item) }
    }

    // MARK: Confirmation

    private func select(_ item: VaultItem) {
        let ownSite = site.host.map { SharedVault.matches(item, host: $0) } ?? false
        if ownSite && !plainHTTP {
            choose(item)
        } else {
            pending = Pending(item: item, otherSite: !ownSite, plainHTTP: plainHTTP)
        }
    }

    private var alertTitle: LocalizedStringKey {
        pending?.otherSite == false ? "Fill on a page that is not encrypted?" : "Fill a login from another site?"
    }

    private func message(for pending: Pending) -> String {
        let httpWarning = String(localized: "This page is not encrypted (http), so anything filled here can be read on the network.")
        guard pending.otherSite else { return httpWarning }
        let name = pending.item.displayTitle
        let saved = SharedVault.host(pending.item.website)
        let savedFor = saved.isEmpty ? String(localized: "“\(name)” has no website saved") : String(localized: "“\(name)” was saved for \(saved)")
        let base: String
        if let host = site.host {
            base = String(localized: "\(savedFor), and you are signing in to \(host). Only continue if you trust this page.")
        } else {
            base = String(localized: "\(savedFor), and Psss could not tell which site you are signing in to. Only continue if you trust this page.")
        }
        return pending.plainHTTP ? base + " " + httpWarning : base
    }
}

/// Shown when the person asks for a verification code. Only logins that have a code and belong to the site are listed: there is
/// no way to choose a code for another site.
struct CodeList: View {
    /// The requesting site, nil when it could not be read.
    let host: String?
    /// The logins that passed `ReleaseCheck.oneTimeCode` for this site.
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
    let cancel: () -> Void

    var body: some View {
        ProviderScreen(heading: "Choose a Code", cancel: ProviderAction(title: "Cancel", run: cancel)) {
            List {
                if let host {
                    if items.isEmpty {
                        Text("No verification codes are saved for \(host).").foregroundStyle(.secondary)
                    } else {
                        Section { ForEach(items) { item in LoginRow(item: item, verb: "Use Code", isDefault: items.count == 1) { choose(item) } } }
                        header: { Text("For \(host)") }
                    }
                } else {
                    Text("Psss could not tell which site this is.").foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Shown when a suggestion in the keyboard bar or the AutoFill menu was chosen and the system needs our interface, which
/// unlocked first.
struct FillConfirm: View {
    let item: VaultItem
    var verb: LocalizedStringKey = "Fill"
    let fill: () -> Void
    let cancel: () -> Void

    var body: some View {
        ProviderScreen(cancel: ProviderAction(title: "Cancel", run: cancel), primary: ProviderAction(title: verb, run: fill)) {
            VStack(spacing: 16) {
                Spacer()
                Text(verbatim: item.displayTitle).font(.title2.bold()).multilineTextAlignment(.center)
                Text(verbatim: item.account).foregroundStyle(.secondary)
                InlinePrimary(title: verb, action: fill).padding(.horizontal)
                Spacer()
            }
            .padding(24)
        }
    }
}

#if os(iOS)
/// The save prompt: site, account and name are already filled in, and nothing asks where to store it. The system sends save
/// requests to providers on iOS only.
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
#endif

/// Choosing a passkey when more than one matches the site.
struct PasskeyPick: View {
    let rpID: String
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
    let cancel: () -> Void

    var body: some View {
        ProviderScreen(heading: "Choose a Passkey", cancel: ProviderAction(title: "Cancel", run: cancel)) {
            List {
                Section("Passkeys for \(rpID)") {
                    if items.isEmpty { Text("No passkeys for this site yet.").foregroundStyle(.secondary) }
                    ForEach(items) { item in LoginRow(item: item, verb: "Sign in", isDefault: items.count == 1) { choose(item) } }
                }
            }
        }
    }
}
