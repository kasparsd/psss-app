import SwiftUI

// The screens of the AutoFill provider. They are shared by iPhone, iPad and Mac. Each screen has a title and body text and uses
// no other type size; secondary information is the secondary foreground style. On iOS a screen is a navigation stack with Cancel
// in the bar. On the Mac the extension is shown in a system sheet, so a screen is a fixed-size panel with its buttons in a
// footer: Cancel (Escape) and the main button (Return) at the trailing edge.

/// A button the screen scaffold places for the platform.
struct ProviderAction {
    /// A `Text`, so a title built at run time (“Update Gitforge (sam.r)”) can be shown verbatim: as a `LocalizedStringKey` it is
    /// read as Markdown, and the device showed the account in link colour, invisible on the prominent button.
    let title: Text
    var isEnabled = true
    let run: () -> Void

    init(title: LocalizedStringKey, isEnabled: Bool = true, run: @escaping () -> Void) {
        self.title = Text(title); self.isEnabled = isEnabled; self.run = run
    }

    init(verbatim title: String, isEnabled: Bool = true, run: @escaping () -> Void) {
        self.title = Text(verbatim: title); self.isEnabled = isEnabled; self.run = run
    }
}

/// What a screen needs to show the Vault row (owner, 2026-11-24, mock `#/autofill`): the session, the current vault's state, what
/// to do when another vault is chosen and, for a locked vault, what Unlock does. Nil on a screen with fewer than two vaults.
struct ProviderVaultSwitch {
    let session: VaultSession
    let state: VaultState
    let choose: (UUID) -> Void
    /// The Unlock button at the row's trailing end; nil leaves it out (an open vault, a vault that is not available).
    var unlock: (() -> Void)?

    /// The current vault's name, safe inside a sentence.
    @MainActor var name: String { VaultName.sentence(session.reference?.name ?? "") }
}

/// The shared Vault row above every AutoFill screen's content: the label "Vault" on the left, the current vault's name with a chevron
/// on the right (the app's vault menu), and a labeled Unlock button at the trailing end while the vault is locked. Adding a vault
/// happens in the app, so there is no Add Vault row here.
private struct ProviderVaultRow: View {
    let vaults: ProviderVaultSwitch

    var body: some View {
        VaultRow(session: vaults.session, state: vaults.state, choose: vaults.choose, unlock: vaults.unlock)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
    }
}

/// Where the search field sits: at the foot of the screen on iPhone (the system's), under the Vault row on iPad and Mac, with the
/// Name, Website and Username pills directly under it.
enum ProviderLayout {
    static var inlineSearch: Bool {
        #if os(macOS)
        true
        #else
        UIDevice.current.userInterfaceIdiom == .pad
        #endif
    }
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
    /// The vault switcher: the Vault row above the content, on every platform.
    var vaults: ProviderVaultSwitch?
    @ViewBuilder var content: Content

    var body: some View {
        #if os(iOS)
        NavigationStack {
            VStack(spacing: 0) {
                if let vaults { ProviderVaultRow(vaults: vaults) }
                content
            }
                .navigationTitle(heading ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if let cancel {
                        ToolbarItem(placement: .cancellationAction) { Button(action: cancel.run) { cancel.title } }
                    }
                }
        }
        #else
        VStack(spacing: 0) {
            if let heading {
                HStack {
                    Text(heading).font(.title2.bold())
                    Spacer(minLength: 0)
                }
                .padding([.horizontal, .top], 20).padding(.bottom, 8)
            }
            if let vaults { ProviderVaultRow(vaults: vaults) }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            HStack {
                // Escape is `.cancelAction` on exactly one visible button: Back when the screen has one, else Cancel.
                // A screen with only a main button also closes on Escape, through a hidden twin of that button.
                if let back { Button(action: back.run) { back.title }.keyboardShortcut(.cancelAction) }
                Spacer()
                if let cancel {
                    if back == nil { Button(action: cancel.run) { cancel.title }.keyboardShortcut(.cancelAction) }
                    else { Button(action: cancel.run) { cancel.title } }
                }
                if let primary {
                    Button(action: primary.run) { primary.title }.keyboardShortcut(.defaultAction).disabled(!primary.isEnabled)
                    if cancel == nil, back == nil {
                        Button(action: primary.run) { primary.title }.keyboardShortcut(.cancelAction)
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
struct InlinePrimary: View {
    let title: Text
    var isEnabled = true
    let action: () -> Void

    init(title: LocalizedStringKey, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.title = Text(title); self.isEnabled = isEnabled; self.action = action
    }

    init(verbatim title: String, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.title = Text(verbatim: title); self.isEnabled = isEnabled; self.action = action
    }

    var body: some View {
        #if os(iOS)
        Button(action: action) { title.frame(maxWidth: .infinity).multilineTextAlignment(.center) }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isEnabled)
            .fixedSize(horizontal: false, vertical: true)
        #else
        EmptyView()
        #endif
    }
}

/// The heading above a card of rows, outside the card (mock `#/autofill`: "For gitforge.example"): body-size secondary text, not
/// the system's smaller header size, in the system's section header position.
private struct SectionHead: View {
    let text: String
    var body: some View {
        Text(verbatim: text).font(.body).foregroundStyle(.secondary).textCase(nil)
            .accessibilityAddTraits(.isHeader)
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

/// One login or card in a list, in the app's list row (icon, name, one line under it, the passkey glyph) with its button at the
/// trailing end (owner, 2026-11-24, mock `#/autofill`). The button is a real, bordered button, not a word in the accent
/// color; the default one is prominent. Tapping the name opens the item's values when `openValues` is set, else it does what the
/// button does.
private struct LoginRow: View {
    let item: VaultItem
    /// Shown after the account, so a login for another site says which site it belongs to.
    var showsSite = false
    let verb: LocalizedStringKey
    var isDefault = false
    /// The line under the name when the list supplies its own (a search result with the match in bold). Nil: the account.
    var subtitle: Text?
    /// A supplied line may take two lines ("Saved for <site>" names a site that must be read in full).
    var subtitleLines = 1
    /// The text searched for: the part of the name that holds it is in bold.
    var titleHighlight = ""
    var openValues: (() -> Void)?
    let action: () -> Void

    /// The second line, as the app's list draws it: the account, and the website when the name is the account (or the login has no
    /// account). A list that shows other sites' logins (`showsSite`) always adds the website after the account.
    private var line: Text? {
        if let subtitle { return subtitle }
        guard let text = RowLine.text(for: item, showsSite: showsSite) else { return nil }
        return Text(verbatim: text)
    }

    var body: some View {
        ItemListRow(item: item, subtitle: line, subtitleLines: subtitleLines, titleHighlight: titleHighlight,
                    glyphs: item.passkey == nil ? [] : [.passkey], glyphColumns: [.passkey],
                    open: openValues ?? action) {
            let button = Button(verb, action: action)
            if isDefault {
                button.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            } else {
                button.buttonStyle(.bordered)
            }
        }
    }
}

/// One single value of an item: its label, a safe preview and its button (Use or Copy).
private struct ValueRow: View {
    let value: PickerValue
    let verb: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(verbatim: value.label)
                Text(verbatim: value.preview).foregroundStyle(.secondary)
            }
            Spacer()
            Button(verb, action: action).buttonStyle(.bordered)
        }
    }
}

/// The values of one item, to fill the whole login or to use one value. For a login from another site, or on a page that is not
/// encrypted, `lines` names the two sites (and the network warning) above the buttons: this screen is the confirmation, so the
/// person sees the mismatch before choosing. `fill` is nil for a card, which has no login to fill. The Vault row is on this
/// screen too; choosing another vault there returns to that vault's list.
private struct ItemValues: View {
    let item: VaultItem
    let lines: [ConfirmLine]
    let fill: (() -> Void)?
    /// "Use" when the value is inserted into the field the person tapped, "Copy" when it goes to the clipboard.
    let verb: LocalizedStringKey
    let use: (PickerValue) -> Void
    let cancel: () -> Void
    let back: () -> Void
    var vaults: ProviderVaultSwitch?

    private var values: [PickerValue] { PickerSearch.values(of: item) }
    private var fillTitle: LocalizedStringKey { "Fill Username and Password" }

    private var list: some View {
        List {
            #if os(macOS)
            Section { Text(verbatim: DisplayText.title(of: item)).font(.title2.bold()) }
            #endif
            if !lines.isEmpty {
                Section {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        if let value = line.value {
                            Text("\(Text(verbatim: line.label).foregroundStyle(.secondary)) \(Text(verbatim: value))")
                        } else {
                            Text(verbatim: line.label)
                        }
                    }
                }
            }
            #if os(iOS)
            if let fill {
                Section { InlinePrimary(title: fillTitle, action: fill) }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            #endif
            Section {
                ForEach(values) { value in ValueRow(value: value, verb: verb) { use(value) } }
            } header: {
                SectionHead(text: fill == nil ? String(localized: "Use one value") : String(localized: "Or use one value"))
            }
        }
    }

    var body: some View {
        #if os(iOS)
        VStack(spacing: 0) {
            if let vaults { ProviderVaultRow(vaults: vaults) }
            list
        }
        .navigationTitle(DisplayText.title(of: item)).navigationBarTitleDisplayMode(.inline)
        #else
        ProviderScreen(cancel: ProviderAction(title: "Cancel", run: cancel),
                       primary: fill.map { ProviderAction(title: fillTitle, run: $0) },
                       back: ProviderAction(title: "Back", run: back), vaults: vaults) { list }
        #endif
    }
}

/// Shown after a value was copied: where it went, how long it stays, and one button to finish.
private struct ValueCopied: View {
    let label: String
    let done: () -> Void

    var body: some View {
        ProviderScreen(primary: ProviderAction(title: "Done", run: done)) {
            VStack(spacing: 16) {
                Text("\(label) copied").font(.title2.bold()).multilineTextAlignment(.center)
                #if os(macOS)
                Text("Paste it into the field with ⌘V. It is removed from the clipboard after 60 seconds, and Psss marks it so clipboard managers skip it.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                #else
                Text("Paste it into the field. It is removed from the clipboard after 60 seconds and stays on this device.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                #endif
                InlinePrimary(title: "Done", action: done)
            }
            .padding(24)
            .frame(maxHeight: .infinity)
        }
    }
}

/// The passkeys a page's passkey request can use, listed above the logins when the list answers such a request.
struct PasskeyChoice {
    let rpID: String
    let items: [VaultItem]
    let choose: (VaultItem) -> Void
}

/// A warning above an action that accepts a risk: a warning sign in the warning color and body text. Red stays for deletion.
private struct WarningNotice: View {
    let text: String

    var body: some View {
        Label {
            Text(verbatim: text)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The footer of a list: what a tap on a name does, or that the list is cut. A section footer, so it sits on the screen’s own
/// background under the card (owner, 2026-11-24), never in a row, where people find it. Body size, like every other line.
private struct ListFooter: View {
    let shown: Int
    let total: Int
    let fallback: LocalizedStringKey
    var body: some View {
        Group {
            if total > shown {
                Text("Showing \(shown) of \(total) items. Type to narrow the list.")
            } else {
                Text(fallback)
            }
        }
        .font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
        .frame(maxWidth: .infinity).padding(.top, 8)
    }
}

/// The search field and its pills where the screen has them in line: under the Vault row on iPad and Mac, with the pills directly
/// under the field. On iPhone the system's search field sits at the foot and `PickerPills` alone is under the Vault row.
private struct InlineSearchField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    /// The pills follow directly, so the field leaves less room below it.
    let hasPills: Bool

    var body: some View {
        TextField("Search all items", text: $text).textFieldStyle(.roundedBorder)
            .searchInput()
            .padding(.horizontal, 16).padding(.bottom, hasPills ? 8 : 12)
            .focused(focused)
            // Once, when the field first appears. Setting focus again later (a screen redraw) must not move the caret under typing.
            .task { if !focused.wrappedValue { focused.wrappedValue = true } }
    }
}

extension View {
    /// A search for names, sites and accounts: never capitalised (“Work”, “E”) and never corrected into another word.
    func searchInput() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }

    /// No gap between the pills above and the first heading of the list.
    @ViewBuilder fileprivate func flushTop(_ on: Bool) -> some View {
        if on { contentMargins(.top, 0, for: .scrollContent) } else { self }
    }

    /// The system's search field at the foot of the screen, on iPhone only; iPad and Mac put an `InlineSearchField` in the content.
    @ViewBuilder fileprivate func footSearch(_ text: Binding<String>, focused: FocusState<Bool>.Binding? = nil) -> some View {
        #if os(iOS)
        if ProviderLayout.inlineSearch {
            self
        } else if let focused {
            self.searchable(text: text, prompt: "Search all items")
                .searchFocused(focused)
                .searchInput()
                .searchPresentationToolbarBehavior(.avoidHidingContent)
                // The search field has focus when the picker opens, so the person can type at once.
                .task { if !focused.wrappedValue { focused.wrappedValue = true } }
        } else {
            self.searchable(text: text, prompt: "Search all items")
                .searchInput()
                .searchPresentationToolbarBehavior(.avoidHidingContent)
        }
        #else
        self
        #endif
    }
}

/// Shown when the person taps the key in the keyboard bar or chooses Passwords from AutoFill. Also the list for a page with a
/// passkey request pending (sites such as Google ask for a passkey first): the passkeys for the request come first under
/// "Passkeys for <site>" with Sign In, then the same logins under "Logins", with the same search and the same confirmations.
///
/// One screen. Logins saved for the site come first, each with a Fill button, and when exactly one matches it is the default
/// action. A search field (bottom on iPhone, under the Vault row on iPad and Mac) searches the whole vault by name, account and
/// saved site; other items appear only once the person types, and filling one from another site asks for a confirmation that
/// names both sites. Tapping a name opens the item's values (fill one field). On a plain `http` page no login is offered
/// automatically: the page's own logins are behind a button and ask for confirmation too. When the site is unknown, every login is
/// "other". With two or more vaults, a site with nothing in this vault says so under its heading and points to the Vault row.
struct FillList: View {
    let site: FillSite
    /// Every item the picker can offer (`PickerSearch.offerable`).
    let items: [VaultItem]
    /// Set when the list answers a passkey request: its passkeys are listed above the logins.
    let passkeys: PasskeyChoice?
    let choose: (VaultItem) -> Void
    /// Puts one value into the field the person tapped. Nil where the system gives no such call from this list: the value is
    /// then copied.
    let insert: ((VaultItem, String) -> Void)?
    let cancel: () -> Void
    /// The Vault row, when there are two or more vaults.
    var vaults: ProviderVaultSwitch?

    @State private var showSiteLogins = false
    @State private var search = ""
    @State private var chosenFields: Set<SearchField> = []
    @FocusState private var searchFocused: Bool
    @State private var pending: Pending?
    @State private var detail: VaultItem?
    @State private var copied: PickerValue?

    init(site: FillSite, items: [VaultItem], passkeys: PasskeyChoice? = nil,
         vaults: ProviderVaultSwitch? = nil,
         choose: @escaping (VaultItem) -> Void, insert: ((VaultItem, String) -> Void)? = nil, cancel: @escaping () -> Void) {
        self.site = site; self.items = items; self.passkeys = passkeys; self.choose = choose; self.insert = insert
        self.cancel = cancel; self.vaults = vaults
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

    private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// "Sign In" for a passkey request that has passkeys to offer, else "Choose a Login".
    private var heading: LocalizedStringKey { passkeyItems.isEmpty ? "Choose a Login" : "Sign In" }

    /// The heading above the site's logins. Under a passkey section it says "Logins", so it cannot be read as the passkeys' heading.
    private func siteLabel(_ host: String) -> String {
        passkeyItems.isEmpty ? String(localized: "For \(HostDisplay.shown(host))") : String(localized: "Logins")
    }

    private var siteLogins: [VaultItem] {
        guard let host = site.host else { return [] }
        return items.filter { $0.kind == .login && SharedVault.matches($0, host: host) }
    }

    private func isOwnSite(_ item: VaultItem) -> Bool {
        site.host.map { SharedVault.matches(item, host: $0) } ?? false
    }

    var body: some View {
        // A system alert cannot make Cancel visibly the preferred choice on iPhone and iPad (the default-action shortcut changes
        // nothing in the iOS 26 alert), nor both the default (Return) and the cancel button (Escape) on the Mac. So all three
        // platforms show one sheet of ours: Cancel prominent, Fill Anyway secondary.
        Group {
            if let copied {
                ValueCopied(label: copied.label, done: cancel)
            } else {
                screen
            }
        }
        .sheet(item: $pending) { pending in
            ConfirmSheet(title: alertTitle(for: pending), lines: lines(for: pending), confirmTitle: "Fill Anyway",
                         confirm: { self.pending = nil; choose(pending.item) }, cancel: { self.pending = nil })
        }
    }

    @ViewBuilder private var screen: some View {
        #if os(iOS)
        ProviderScreen(heading: heading, cancel: ProviderAction(title: "Cancel", run: cancel), vaults: vaults) {
            mainContent
                .footSearch($search, focused: $searchFocused)
                .navigationDestination(isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } })) {
                    if let detail { detailView(detail) }
                }
        }
        #else
        if let detail {
            detailView(detail)
        } else {
            ProviderScreen(heading: heading, cancel: ProviderAction(title: "Cancel", run: cancel), vaults: vaults) { mainContent }
        }
        #endif
    }

    // MARK: Screens

    private var mainContent: some View {
        VStack(spacing: 0) {
            if ProviderLayout.inlineSearch {
                InlineSearchField(text: $search, focused: $searchFocused, hasPills: !query.isEmpty)
            }
            // Where the text was found, and how many results found it there: directly under the Vault row on iPhone, directly
            // under the search field on iPad and Mac, and no gap above the list.
            if !query.isEmpty {
                SearchFieldPills(counts: PickerSearch.counts(items, query: query), chosen: $chosenFields)
            }
            List {
                if !query.isEmpty {
                    resultsSection
                } else {
                    browseSections
                }
            }
            .flushTop(!query.isEmpty)
        }
    }

    /// The line under a heading when this vault has nothing for the page: with two or more vaults it names the site and the vault and
    /// points to the Vault row, because the person may not know the login is in the other one.
    private func emptyLine(host: String, passkeysToo: Bool) -> String {
        let shown = HostDisplay.shown(host)
        if let vaults {
            return passkeysToo
                ? String(localized: "No passkeys or logins for \(shown) in \(vaults.name). Choose another vault above.")
                : String(localized: "No logins for \(shown) in \(vaults.name). Choose another vault above.")
        }
        return passkeysToo
            ? String(localized: "No passkeys or logins are saved for \(shown). Search to use another item.")
            : String(localized: "No logins are saved for \(shown). Search to use another item.")
    }

    /// With nothing typed: the passkeys, then the site's logins, never another site's.
    @ViewBuilder private var browseSections: some View {
        if let passkeys, !passkeys.items.isEmpty {
            Section {
                ForEach(passkeys.items) { item in LoginRow(item: item, verb: "Sign In", isDefault: passkeys.items.count == 1) { passkeys.choose(item) } }
            } header: {
                SectionHead(text: String(localized: "Passkeys for \(HostDisplay.shown(passkeys.rpID))"))
            }
        }
        switch site {
        case .secure(let host):
            if siteLogins.isEmpty {
                // With passkeys listed above, an empty login section would only repeat what the list already shows.
                if passkeyItems.isEmpty {
                    Section {
                        Text(verbatim: emptyLine(host: host, passkeysToo: passkeys != nil)).foregroundStyle(.secondary)
                    } header: {
                        SectionHead(text: String(localized: "For \(HostDisplay.shown(host))"))
                    }
                }
            } else {
                Section {
                    // Return fills the one login only when no passkey sits beside it.
                    ForEach(siteLogins) { row($0, isDefault: siteLogins.count == 1 && passkeyItems.isEmpty) }
                } header: {
                    SectionHead(text: siteLabel(host))
                } footer: {
                    ListFooter(shown: siteLogins.count, total: siteLogins.count, fallback: "Tap a name to use one value instead.")
                }
            }
        case .plainHTTP(let host):
            // A warning, not a hint: the page can be read on the network. The button is the person accepting that risk.
            Section {
                WarningNotice(text: String(localized: "\(HostDisplay.shown(host)) is not encrypted (http). Anything filled here can be read on the network, so Psss does not offer logins by itself."))
                if !showSiteLogins {
                    Button("Show Logins Anyway") { showSiteLogins = true }
                        .buttonStyle(.bordered)
                }
            }
            if showSiteLogins {
                Section {
                    ForEach(siteLogins) { row($0) }
                } header: {
                    SectionHead(text: siteLabel(host))
                } footer: {
                    ListFooter(shown: siteLogins.count, total: siteLogins.count, fallback: "Tap a name to use one value instead.")
                }
            }
        case .unknown:
            Section { Text("Psss could not tell which site this is. Search to use another item.").foregroundStyle(.secondary) }
        }
    }

    /// With text typed: every item in the vault that matches, A to Z, each naming its saved site.
    @ViewBuilder private var resultsSection: some View {
        let found = PickerSearch.matches(items, query: query, in: chosenFields)
        Section {
            if found.isEmpty {
                Text("No items match “\(query)”.").foregroundStyle(.secondary)
            } else {
                ForEach(found.prefix(PickerSearch.limit)) { row($0, searchLine: resultLine(for: $0)) }
            }
        } header: {
            SectionHead(text: String(localized: "Search results"))
        } footer: {
            if !found.isEmpty {
                ListFooter(shown: min(found.count, PickerSearch.limit), total: found.count, fallback: "Tap a name to use one value instead.")
            }
        }
    }

    /// The screen of one item's values. A login from another site, or on a page that is not encrypted, names both sites here,
    /// which is the confirmation, so "Fill Username and Password" asks nothing more.
    private func detailView(_ item: VaultItem) -> some View {
        let own = isOwnSite(item)
        let confirmLines = item.kind == .login && (!own || plainHTTP)
            ? lines(for: Pending(item: item, otherSite: !own, plainHTTP: plainHTTP), namesItem: false) : []
        return ItemValues(item: item, lines: confirmLines,
                          fill: item.kind == .login ? { detail = nil; choose(item) } : nil,
                          verb: insert == nil ? "Copy" : "Use",
                          use: { useValue($0, of: item) },
                          cancel: cancel, back: { detail = nil }, vaults: vaults)
    }

    /// Releases the one chosen value: inserted into the tapped field where the system allows, else copied.
    private func useValue(_ value: PickerValue, of item: VaultItem) {
        guard let text = ReleaseCheck.value(item: item, role: value.role) else { return }
        if let insert {
            insert(item, text)
        } else {
            Clipboard.copy(text)
            copied = value
        }
    }

    /// A result's second line: the field that matched with the matching part in bold, and “Saved for” in front of a site that is not
    /// the page's own, so a website hit on another site's login is never taken for this site.
    private func resultLine(for item: VaultItem) -> (text: Text, savedFor: Bool) {
        let line = searchSubtitle(item, query: query, chosen: chosenFields)
        let field = ItemSearch.shownField(of: item, query: query, chosen: chosenFields)
        if field == .website, !isOwnSite(item) { return (Text("Saved for \(line)"), true) }
        return (line, false)
    }

    private func row(_ item: VaultItem, searchLine: (text: Text, savedFor: Bool)? = nil, isDefault: Bool = false) -> some View {
        let isLogin = item.kind == .login
        let verb: LocalizedStringKey = !isLogin ? "Choose" : (isOwnSite(item) && !plainHTTP ? "Fill" : "Fill…")
        return LoginRow(item: item, verb: verb, isDefault: isDefault && isLogin, subtitle: searchLine?.text,
                        subtitleLines: searchLine?.savedFor == true ? 2 : 1,
                        titleHighlight: searchLine == nil ? "" : query,
                        openValues: { detail = item }) {
            if isLogin { select(item) } else { detail = item }
        }
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
    private func lines(for pending: Pending, namesItem: Bool = true) -> [ConfirmLine] {
        let httpWarning = ConfirmLine(String(localized: "This page is not encrypted (http), so anything filled here can be read on the network."))
        guard pending.otherSite else { return [httpWarning] }
        let website = pending.item.website.trimmingCharacters(in: .whitespacesAndNewlines)
        let saved = HostDisplay.shown(SharedVault.host(pending.item.website))
        let savedValue = website.isEmpty ? String(localized: "no website") : (saved.isEmpty ? String(localized: "a site Psss could not read") : saved)
        let pageValue = site.host.map { HostDisplay.shown($0) } ?? String(localized: "an unknown site")
        var lines = [
            ConfirmLine(String(localized: "Saved for:"), savedValue),
            ConfirmLine(String(localized: "You are signing in to:"), pageValue)
        ]
        // The item screen already shows the name and the account, so only the sheet repeats them.
        if namesItem {
            lines.append(ConfirmLine(String(localized: "Login:"), DisplayText.quoted(DisplayText.title(of: pending.item))))
            let account = DisplayText.safe(pending.item.account, empty: "")
            if !account.isEmpty { lines.append(ConfirmLine(String(localized: "Account:"), DisplayText.quoted(account))) }
        }
        lines.append(ConfirmLine(String(localized: "Only continue if you trust this page.")))
        if pending.plainHTTP { lines.append(httpWarning) }
        return lines
    }
}

#if os(iOS)
/// Shown when the person taps a field and chooses Psss's text insertion (iOS 18 and later; macOS has no such request). It has no
/// page's site to compare, so there is no "For this site" group and no two-site lines: the search is the whole screen, over every
/// item the picker can offer. Choosing an item opens its values, and Use inserts that one value into the field the person tapped.
struct TextPicker: View {
    let items: [VaultItem]
    var vaults: ProviderVaultSwitch?
    let insert: (VaultItem, String) -> Void
    let cancel: () -> Void

    @State private var search = ""
    @State private var detail: VaultItem?
    @FocusState private var searchFocused: Bool

    private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        let found = PickerSearch.matches(items, query: query)
        ProviderScreen(heading: "Choose Text to Insert", cancel: ProviderAction(title: "Cancel", run: cancel), vaults: vaults) {
            VStack(spacing: 0) {
                if ProviderLayout.inlineSearch { InlineSearchField(text: $search, focused: $searchFocused, hasPills: false) }
                List {
                    Section {
                        if found.isEmpty {
                            if query.isEmpty {
                                Text("No logins or cards are saved yet.").foregroundStyle(.secondary)
                            } else {
                                Text("No items match “\(query)”.").foregroundStyle(.secondary)
                            }
                        } else {
                            ForEach(found.prefix(PickerSearch.limit)) { item in
                                LoginRow(item: item, showsSite: true, verb: "Choose") { detail = item }
                            }
                        }
                    } footer: {
                        if !found.isEmpty {
                            ListFooter(shown: min(found.count, PickerSearch.limit), total: found.count, fallback: "Choose an item, then the value.")
                        }
                    }
                }
            }
            .footSearch($search)
            .navigationDestination(isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } })) {
                if let item = detail {
                    ItemValues(item: item, lines: [], fill: nil, verb: "Use", use: { value in
                        if let text = ReleaseCheck.value(item: item, role: value.role) { insert(item, text) }
                    }, cancel: cancel, back: { detail = nil }, vaults: vaults)
                }
            }
        }
    }
}
#endif

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
/// no way to choose a code for another site without the search and a confirmation that names both sites. The Vault row is on
/// this screen with two or more vaults (mock `#/autofill`, frame V).
struct CodeList: View {
    /// The requesting site, nil when it could not be read.
    let host: String?
    /// The logins that passed `ReleaseCheck.oneTimeCode` for this site.
    let items: [VaultItem]
    /// Every item with a readable code, for the search. A person who opened this list by hand may choose a login saved for
    /// another site, as in the login list; the choice names both sites and asks first. Automatic suggestions never come here.
    var others: [VaultItem] = []
    /// The Vault row, when there are two or more vaults.
    var vaults: ProviderVaultSwitch?
    let choose: (VaultItem) -> Void
    let cancel: () -> Void

    @State private var search = ""
    @State private var pending: VaultItem?
    @FocusState private var searchFocused: Bool

    private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Items whose name, account or saved site contains the query, A to Z by name.
    private var found: [VaultItem] {
        others
            .filter { item in
                item.displayTitle.localizedStandardContains(query)
                    || item.account.localizedStandardContains(query)
                    || item.website.localizedStandardContains(query)
                    || SharedVault.host(item.website).localizedStandardContains(query)
            }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
    }

    private func isOwnSite(_ item: VaultItem) -> Bool {
        host.map { SharedVault.matches(item, host: $0) } ?? false
    }

    private func select(_ item: VaultItem) {
        if isOwnSite(item) { choose(item) } else { pending = item }
    }

    /// The saved site, the site being signed in to, the login, then the warning: the same lines as the login list.
    private func lines(for item: VaultItem) -> [ConfirmLine] {
        let website = item.website.trimmingCharacters(in: .whitespacesAndNewlines)
        let saved = HostDisplay.shown(SharedVault.host(item.website))
        let savedValue = website.isEmpty ? String(localized: "no website") : (saved.isEmpty ? String(localized: "a site Psss could not read") : saved)
        let pageValue = host.map { HostDisplay.shown($0) } ?? String(localized: "an unknown site")
        var lines = [
            ConfirmLine(String(localized: "Saved for:"), savedValue),
            ConfirmLine(String(localized: "You are signing in to:"), pageValue),
            ConfirmLine(String(localized: "Login:"), DisplayText.quoted(DisplayText.title(of: item)))
        ]
        let account = DisplayText.safe(item.account, empty: "")
        if !account.isEmpty { lines.append(ConfirmLine(String(localized: "Account:"), DisplayText.quoted(account))) }
        lines.append(ConfirmLine(String(localized: "Only continue if you trust this page.")))
        return lines
    }

    /// The line under the heading when this vault has no code for the page.
    private func emptyLine(_ host: String) -> String {
        let shown = HostDisplay.shown(host)
        if let vaults {
            return String(localized: "No verification codes for \(shown) in \(vaults.name). Choose another vault above, or search to use a code from another login.")
        }
        return String(localized: "No verification codes are saved for \(shown). Search to use a code from another login.")
    }

    var body: some View {
        ProviderScreen(heading: "Choose a Code", cancel: ProviderAction(title: "Cancel", run: cancel), vaults: vaults) {
            VStack(spacing: 0) {
                if ProviderLayout.inlineSearch { InlineSearchField(text: $search, focused: $searchFocused, hasPills: false) }
                List {
                    if !query.isEmpty {
                        Section {
                            if found.isEmpty {
                                Text("No logins with a code match “\(query)”.").foregroundStyle(.secondary)
                            } else {
                                ForEach(found.prefix(PickerSearch.limit)) { item in
                                    LoginRow(item: item, showsSite: true, verb: isOwnSite(item) ? "Use Code" : "Use Code…") { select(item) }
                                }
                            }
                        }
                    } else if let host {
                        if items.isEmpty {
                            Section {
                                Text(verbatim: emptyLine(host)).foregroundStyle(.secondary)
                            } header: {
                                SectionHead(text: String(localized: "For \(HostDisplay.shown(host))"))
                            }
                        } else {
                            Section {
                                ForEach(items) { item in LoginRow(item: item, verb: "Use Code", isDefault: items.count == 1) { choose(item) } }
                            } header: {
                                SectionHead(text: String(localized: "For \(HostDisplay.shown(host))"))
                            }
                        }
                    } else {
                        Text("Psss could not tell which site this is. Search to use a code from another login.").foregroundStyle(.secondary)
                    }
                }
            }
            .footSearch($search)
        }
        .sheet(item: $pending) { item in
            ConfirmSheet(title: "Use a code from another site?", lines: lines(for: item), confirmTitle: "Use Code Anyway",
                         confirm: { pending = nil; choose(item) }, cancel: { pending = nil })
        }
    }
}

/// The save screens (mock `#/autofill`, frames W to Z): "Save Password" and "Create Passkey". What is saved is shown and cannot be
/// edited here: the name comes from the site, and the website, username and password (or the new passkey) are the request's.
/// With two or more vaults the Vault row is at the top, so the person sees where it goes and can change it; a destination that is
/// locked or not available shows its notice and Save stays dimmed until the vault is open. The button names what it will change:
/// "Save", or "Update Gitforge (sam.r)" when the same website and username are already there (the password changes, nothing else).
struct SaveForm: View {
    enum Kind { case password, passkey }

    let kind: Kind
    let host: String
    let account: String
    /// The login the save would change: same website and username in the destination vault. Nil: a new login is made.
    let existing: VaultItem?
    var vaults: ProviderVaultSwitch?
    /// Set while the destination vault is locked or not available. Save is dimmed.
    var notice: ProviderNotice?
    /// A password already saved as it is: there is nothing to update.
    var alreadySaved = false
    let save: () -> Void
    let cancel: () -> Void

    /// True from the first tap on Save. The write can take seconds (Face ID has already been answered; the vault file and the
    /// system's suggestion list are still to do), and a second tap used to save the login twice. Once set, the button is dimmed and
    /// reads “Saving…”, and further taps do nothing; the sheet closes when the request completes or the failure screen replaces it.
    @State private var saving = false

    private var canSave: Bool { notice == nil && !alreadySaved && !saving }

    private var buttonTitle: String {
        if saving { return String(localized: "Saving…") }
        return kind == .password ? SaveWords.passwordButton(existing: existing) : SaveWords.passkeyButton(existing: existing)
    }

    /// The only way to the save closure: once.
    private func saveOnce() {
        guard canSave else { return }
        saving = true
        save()
    }

    /// "Update Password" when the same website and username are already in the destination vault (the button says the same).
    private var heading: LocalizedStringKey {
        kind == .password ? (existing != nil ? "Update Password" : "Save Password") : "Create Passkey"
    }

    private var content: some View {
        List {
            if let notice {
                Section {
                    ProviderNoticeView(notice: notice, carriesUnlock: vaults == nil)
                }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            Section {
                LabeledContent("Website", value: HostDisplay.shown(host))
                LabeledContent("Username", value: DisplayText.safe(account, empty: ""))
                if kind == .password {
                    LabeledContent("Password", value: "••••••••••")
                } else {
                    LabeledContent("Passkey", value: String(localized: "New"))
                }
            } header: {
                SectionHead(text: kind == .password ? String(localized: "To save") : String(localized: "To create"))
            }
            if alreadySaved {
                Section { Text("This login is already saved with this password.").foregroundStyle(.secondary) }
            }
            #if os(iOS)
            Section {
                InlinePrimary(verbatim: buttonTitle, isEnabled: canSave, action: saveOnce)
            }
            .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            #endif
        }
    }

    var body: some View {
        ProviderScreen(heading: heading, cancel: ProviderAction(title: "Cancel", run: cancel),
                       primary: ProviderAction(verbatim: buttonTitle, isEnabled: canSave, run: saveOnce),
                       vaults: vaults) { content }
    }
}
