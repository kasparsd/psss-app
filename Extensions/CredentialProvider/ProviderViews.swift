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
    /// The screen's title: the navigation title on iOS, a heading above the content on the Mac. Screens whose title is in their
    /// content have none on either platform.
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
                .navigationTitle(heading ?? "")
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
                // Escape is `.cancelAction` on exactly one visible button: Back when the screen has one, else Cancel.
                // A screen with only a main button also closes on Escape, through a hidden twin of that button.
                if let back { Button(back.title, action: back.run).keyboardShortcut(.cancelAction) }
                Spacer()
                if let cancel {
                    if back == nil { Button(cancel.title, action: cancel.run).keyboardShortcut(.cancelAction) }
                    else { Button(cancel.title, action: cancel.run) }
                }
                if let primary {
                    Button(primary.title, action: primary.run).keyboardShortcut(.defaultAction).disabled(!primary.isEnabled)
                    if cancel == nil, back == nil {
                        Button(primary.title, action: primary.run).keyboardShortcut(.cancelAction)
                            .opacity(0).frame(width: 0).accessibilityHidden(true)
                    }
                }
            }
            .padding(16)
        }
        .frame(minWidth: 460, idealWidth: 480, minHeight: 360, idealHeight: 420)
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

/// The label above a group of rows: body-size secondary text, not the system's smaller header size.
private struct GroupLabel: View {
    let text: String
    var body: some View {
        Text(verbatim: text).foregroundStyle(.secondary).listRowSeparator(.hidden)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Why AutoFill cannot open the vault.
enum NotReadyReason {
    /// No vault has been created.
    case noVault
    /// Unlock with Face ID or Touch ID is off, was reset, or cannot be used now.
    case biometryOff
    /// The vault file cannot be found.
    case fileMissing
    /// The key exists but biometry cannot be used right now (a lockout, biometry unavailable, a busy Keychain).
    case unavailableNow
    /// The vault could not be opened for a reason that has nothing to do with biometry (a damaged or unreadable file).
    case vaultUnreadable

    var title: String {
        switch self {
        case .noVault: String(localized: "No vault yet")
        default: String(localized: "Can’t open your vault here")
        }
    }

    var sentence: String {
        switch self {
        case .noVault:
            String(localized: "Open Psss and create a vault. Then come back here to fill your logins. The sample vault is not available for AutoFill.")
        case .biometryOff:
            String(localized: "Open Psss, unlock with your vault password and turn on \(BiometryKind.nameForMessages).")
        case .fileMissing:
            String(localized: "Psss cannot find the vault file. Open Psss to locate it.")
        case .unavailableNow:
            String(localized: "\(BiometryKind.nameForMessages) is not available right now. Open Psss and unlock with your vault password, then try again.")
        case .vaultUnreadable:
            String(localized: "Psss could not open your vault. Open Psss to see what is wrong.")
        }
    }
}

/// Shown when AutoFill cannot open the vault: Face ID or Touch ID unlock is off, was reset, or the vault file is out of reach.
struct NotReady: View {
    let reason: NotReadyReason
    let close: () -> Void

    var body: some View {
        ProviderScreen(primary: ProviderAction(title: "Close", run: close)) {
            VStack(spacing: 16) {
                Text(verbatim: reason.title).font(.title2.bold()).multilineTextAlignment(.center)
                Text(verbatim: reason.sentence).foregroundStyle(.secondary).multilineTextAlignment(.center)
                InlinePrimary(title: "Close", action: close)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
        }
    }
}

/// Shown when a login or passkey could not be written to the vault, so nothing is reported to the system as saved.
struct SaveFailed: View {
    enum Subject { case login, passkey }

    var subject: Subject = .login
    /// The whole body sentence. It already says nothing was changed and what to do.
    let reason: String
    let close: () -> Void

    var body: some View {
        ProviderScreen(primary: ProviderAction(title: "Close", run: close)) {
            VStack(spacing: 16) {
                switch subject {
                case .login:
                    Text("Can’t save this login").font(.title2.bold()).multilineTextAlignment(.center)
                    Text(verbatim: reason)
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                case .passkey:
                    Text("Can’t save this passkey").font(.title2.bold()).multilineTextAlignment(.center)
                    Text(verbatim: reason)
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

    private var account: String { DisplayText.safe(item.account, empty: "") }
    /// Shown after the account, so a login for another site says which site it belongs to.
    private var site: String { showsSite ? HostDisplay.shown(SharedVault.host(item.website)) : "" }

    var body: some View {
        let button = Button(action: action) {
            HStack {
                VStack(alignment: .leading) {
                    Text(verbatim: DisplayText.title(of: item))
                    // The account and the site are separate lines, so neither can run into the other.
                    if !account.isEmpty { Text(verbatim: account).foregroundStyle(.secondary) }
                    if !site.isEmpty { Text(verbatim: site).foregroundStyle(.secondary) }
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

/// The passkeys a page's passkey request can use, listed above the logins when the list answers such a request.
struct PasskeyChoice {
    let rpID: String
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
}

/// Shown when the person taps the key in the keyboard bar or chooses Passwords from AutoFill. Also the list for a page with a
/// passkey request pending (sites such as Google ask for a passkey first): the passkeys for the request come first, then the
/// same logins and the same "Other Logins…" route, with the same confirmations.
///
/// Logins saved for the site come first, and when exactly one matches it is the default action. Logins for other sites are
/// behind the labeled button "Other Logins…", and choosing one asks for a confirmation that names both sites. On a plain `http`
/// page no login is offered automatically: the page's own logins are behind a button and ask for confirmation too. When the
/// site is unknown, every login is "other".
struct FillList: View {
    let site: FillSite
    /// Every login that has a password.
    let items: [VaultItem]
    /// Set when the list answers a passkey request: its passkeys are listed above the logins.
    let passkeys: PasskeyChoice?
    let choose: (VaultItem) -> Void
    let cancel: () -> Void

    @State private var showOthers: Bool
    @State private var showSiteLogins = false
    @State private var search = ""
    @State private var pending: Pending?

    /// `startOnOthers` and `confirming` start the screen on the Other Logins list or with a confirmation open. Only the
    /// interface harness uses them; the provider leaves both at their defaults.
    init(site: FillSite, items: [VaultItem], passkeys: PasskeyChoice? = nil,
         choose: @escaping (VaultItem) -> Void, cancel: @escaping () -> Void,
         startOnOthers: Bool = false, confirming: VaultItem? = nil) {
        self.site = site; self.items = items; self.passkeys = passkeys; self.choose = choose; self.cancel = cancel
        _showOthers = State(initialValue: startOnOthers)
        _pending = State(initialValue: confirming.map { item in
            let own = site.host.map { SharedVault.matches(item, host: $0) } ?? false
            let http: Bool = if case .plainHTTP = site { true } else { false }
            return Pending(item: item, otherSite: !own, plainHTTP: http)
        })
    }

    /// A choice waiting for the confirmation.
    private struct Pending: Identifiable {
        let item: VaultItem
        let otherSite: Bool
        let plainHTTP: Bool
        var id: UUID { item.id }
    }

    private var plainHTTP: Bool { if case .plainHTTP = site { true } else { false } }

    private var passkeyItems: [VaultItem] { passkeys?.items ?? [] }

    /// "Choose a Login or Passkey" when passkeys are listed, else "Choose a Login".
    private var heading: LocalizedStringKey { passkeyItems.isEmpty ? "Choose a Login" : "Choose a Login or Passkey" }

    /// The label above the site's logins. In a passkey request it says "Logins", so it cannot be read as the passkeys' label.
    private func siteLabel(_ host: String) -> String {
        passkeys == nil ? String(localized: "For \(HostDisplay.shown(host))") : String(localized: "Logins for \(HostDisplay.shown(host))")
    }

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
        // A system alert cannot make Cancel visibly the preferred choice on iPhone and iPad (the default-action shortcut changes
        // nothing in the iOS 26 alert), nor both the default (Return) and the cancel button (Escape) on the Mac. So all three
        // platforms show one sheet of ours: Cancel prominent, Fill Anyway secondary.
        screen.sheet(item: $pending) { pending in
            ConfirmSheet(title: alertTitle(for: pending), lines: lines(for: pending), confirmTitle: "Fill Anyway",
                         confirm: { self.pending = nil; choose(pending.item) }, cancel: { self.pending = nil })
        }
    }

    @ViewBuilder private var screen: some View {
        #if os(iOS)
        ProviderScreen(heading: heading, cancel: ProviderAction(title: "Cancel", run: cancel)) {
            mainContent.navigationDestination(isPresented: $showOthers) {
                othersContent.navigationTitle("Other Logins").navigationBarTitleDisplayMode(.inline)
            }
        }
        #else
        if showOthers {
            ProviderScreen(heading: "Other Logins", cancel: ProviderAction(title: "Cancel", run: cancel),
                           back: ProviderAction(title: "Back") { showOthers = false; search = "" }) { othersContent }
        } else {
            ProviderScreen(heading: heading, cancel: ProviderAction(title: "Cancel", run: cancel)) { mainContent }
        }
        #endif
    }

    // MARK: Screens

    private var mainContent: some View {
        VStack(spacing: 0) {
            List {
                if let passkeys, !passkeys.items.isEmpty {
                    Section {
                        GroupLabel(text: String(localized: "Passkeys for \(HostDisplay.shown(passkeys.rpID))"))
                        ForEach(passkeys.items) { item in LoginRow(item: item, verb: "Sign in") { passkeys.choose(item) } }
                    }
                }
                switch site {
                case .secure(let host):
                    if siteLogins.isEmpty {
                        // With passkeys listed above, an empty login section would only repeat what the list already shows.
                        if passkeyItems.isEmpty {
                            Section {
                                if passkeys == nil {
                                    Text("No logins are saved for \(HostDisplay.shown(host)).").foregroundStyle(.secondary)
                                } else {
                                    Text("No passkeys or logins are saved for \(HostDisplay.shown(host)).").foregroundStyle(.secondary)
                                }
                            }
                        }
                    } else {
                        Section {
                            GroupLabel(text: siteLabel(host))
                            // Return fills the one login only when no passkey sits beside it.
                            ForEach(siteLogins) { row($0, isDefault: siteLogins.count == 1 && passkeyItems.isEmpty) }
                        }
                    }
                case .plainHTTP(let host):
                    Section {
                        Text("\(HostDisplay.shown(host)) is not encrypted (http), so Psss does not offer logins here by itself.").foregroundStyle(.secondary)
                        if !showSiteLogins {
                            Button("Show Logins for \(HostDisplay.shown(host))…") { showSiteLogins = true }
                        }
                    }
                    if showSiteLogins {
                        Section {
                            GroupLabel(text: siteLabel(host))
                            ForEach(siteLogins) { row($0) }
                        }
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

    private func alertTitle(for pending: Pending?) -> LocalizedStringKey {
        pending?.otherSite == false ? "Fill on a page that is not encrypted?" : "Fill a login from another site?"
    }

    /// The lines of the confirmation, one paragraph each, in the same order on every platform: the saved site,
    /// the site being signed in to, the login's name and account, then the sentences. Each line about the login is a fixed label
    /// and a value. Values from the vault (the name and the account) are in quotes, so text in them that looks like one of our
    /// labels reads as the vault's; the site names are ours and have none.
    private func lines(for pending: Pending) -> [ConfirmLine] {
        let httpWarning = ConfirmLine(String(localized: "This page is not encrypted (http), so anything filled here can be read on the network."))
        guard pending.otherSite else { return [httpWarning] }
        let website = pending.item.website.trimmingCharacters(in: .whitespacesAndNewlines)
        let saved = HostDisplay.shown(SharedVault.host(pending.item.website))
        let savedValue = website.isEmpty ? String(localized: "no website") : (saved.isEmpty ? String(localized: "a site Psss could not read") : saved)
        let pageValue = site.host.map { HostDisplay.shown($0) } ?? String(localized: "an unknown site")
        var lines = [
            ConfirmLine(String(localized: "Saved for:"), savedValue),
            ConfirmLine(String(localized: "You are signing in to:"), pageValue),
            ConfirmLine(String(localized: "Login:"), DisplayText.quoted(DisplayText.title(of: pending.item)))
        ]
        let account = DisplayText.safe(pending.item.account, empty: "")
        if !account.isEmpty { lines.append(ConfirmLine(String(localized: "Account:"), DisplayText.quoted(account))) }
        lines.append(ConfirmLine(String(localized: "Only continue if you trust this page.")))
        if pending.plainHTTP { lines.append(httpWarning) }
        return lines
    }
}

/// One line of the confirmation: a sentence, or fixed text and a value.
struct ConfirmLine {
    let label: String
    let value: String?
    init(_ label: String, _ value: String? = nil) { self.label = label; self.value = value }
    /// The line as plain text.
    var plain: String { value.map { "\(label) \($0)" } ?? label }
}

/// The confirmation before filling a login from another site or on an unencrypted page. The safe choice, Cancel, is the default
/// button: filled and answering Return (and Escape on the Mac). "Fill Anyway" is the plain button beside or below it, never red:
/// continuing is not a deletion. Mac: the action on the left, Cancel at the trailing edge, as in a standard Mac alert. iPhone and
/// iPad: two full-width buttons, Cancel first.
private struct ConfirmSheet: View {
    let title: LocalizedStringKey
    /// A line with a value is one `Text` of one size: the label in secondary style, the value in primary.
    let lines: [ConfirmLine]
    let confirmTitle: LocalizedStringKey
    let confirm: () -> Void
    let cancel: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize
    /// The height of the text, so the Mac sheet is as tall as its text up to a limit and scrolls beyond it.
    /// Zero until the text has been measured, so the first layout uses `estimatedHeight` instead of a one-point sheet.
    @State private var contentHeight: CGFloat = 0

    /// Padding, a title of one or two lines, and about two lines of text per row. The measured height replaces it at once.
    private var estimatedHeight: CGFloat { 40 + 56 + CGFloat(lines.count) * 48 }

    /// The title and the lines. Every line wraps, whatever its length or the text size, and none is ever cut short: the sites are
    /// the whole point of this sheet, and a host that ends in an ellipsis could hide which site it is. The whole sheet scrolls if
    /// the text does not fit, and the buttons stay below it.
    private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            #if os(macOS)
            Text(title).font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
            #else
            Text(title).font(.title2.bold()).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            #endif
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Group {
                        if let value = line.value {
                            // One paragraph, so a long value cannot push the label out of view.
                            Text("\(Text(verbatim: line.label).foregroundStyle(.secondary)) \(Text(verbatim: value))")
                        } else {
                            Text(verbatim: line.label)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        #if os(macOS)
        VStack(spacing: 0) {
            ScrollView {
                content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .frame(height: min(contentHeight > 0 ? contentHeight : estimatedHeight, 420))
            HStack {
                Spacer()
                Button(confirmTitle, action: confirm)
                Button("Cancel", action: cancel).keyboardShortcut(.defaultAction)
                // Escape does the same as Cancel; only one button can carry each shortcut.
                Button("Cancel", action: cancel).keyboardShortcut(.cancelAction).opacity(0).frame(width: 0).accessibilityHidden(true)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 420)
        #else
        ScrollView { content }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 12) {
                    Button(action: cancel) { Text("Cancel").frame(maxWidth: .infinity).fixedSize(horizontal: false, vertical: true) }
                        .buttonStyle(.borderedProminent).controlSize(.large).keyboardShortcut(.defaultAction)
                    Button(action: confirm) { Text(confirmTitle).frame(maxWidth: .infinity).fixedSize(horizontal: false, vertical: true) }
                        .buttonStyle(.bordered).controlSize(.large)
                }
                .padding(20)
                .background(.bar)
            }
            // At the accessibility text sizes the text needs the whole height from the start.
            .presentationDetents(typeSize.isAccessibilitySize ? [.large] : [.medium, .large])
        #endif
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
                        Text("No verification codes are saved for \(HostDisplay.shown(host)).").foregroundStyle(.secondary)
                    } else {
                        Section {
                            GroupLabel(text: String(localized: "For \(HostDisplay.shown(host))"))
                            ForEach(items) { item in LoginRow(item: item, verb: "Use Code", isDefault: items.count == 1) { choose(item) } }
                        }
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

    /// The site the login was saved for.
    private var site: String { HostDisplay.shown(SharedVault.host(item.website)) }

    var body: some View {
        ProviderScreen(cancel: ProviderAction(title: "Cancel", run: cancel), primary: ProviderAction(title: verb, run: fill)) {
            VStack(spacing: 16) {
                Spacer()
                Text(verbatim: DisplayText.title(of: item)).font(.title2.bold()).multilineTextAlignment(.center)
                Text(verbatim: DisplayText.safe(item.account, empty: "")).foregroundStyle(.secondary)
                if !site.isEmpty { Text("for \(site)").foregroundStyle(.secondary) }
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
                    TextField("Name", text: $title, prompt: Text(verbatim: HostDisplay.shown(host)))
                    LabeledContent("Website", value: HostDisplay.shown(host))
                    LabeledContent("Username", value: DisplayText.safe(account, empty: ""))
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
