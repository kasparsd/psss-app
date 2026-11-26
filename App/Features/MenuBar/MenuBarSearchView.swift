#if os(macOS) && DEBUG
import AppKit
import SwiftUI

/// The system's search field. It keeps the keyboard while arrows move the list's selection.
struct MenuBarSearchField: NSViewRepresentable {
    let text: String
    let prompt: String
    /// Takes the keyboard each time this changes.
    let focus: Int
    /// False while an item's page covers the list.
    let active: Bool
    let change: (String) -> Void
    let move: (Int) -> Void
    /// → with the cursor at the end of the text.
    let open: () -> Void
    let submit: (NSEvent.ModifierFlags) -> Void
    let cancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.delegate = context.coordinator
        field.controlSize = .large
        field.sendsSearchStringImmediately = true
        return field
    }

    func updateNSView(_ field: NSSearchField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text { field.stringValue = text }
        field.placeholderString = prompt
        field.setAccessibilityLabel(prompt)
        guard active, context.coordinator.focused != focus else { return }
        context.coordinator.focused = focus
        // After the panel has become key.
        Task { @MainActor in field.window?.makeFirstResponder(field) }
    }

    @MainActor
    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var parent: MenuBarSearchField
        var focused: Int?

        init(_ parent: MenuBarSearchField) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            if let field = notification.object as? NSSearchField { parent.change(field.stringValue) }
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy command: Selector) -> Bool {
            switch command {
            case #selector(NSResponder.moveUp(_:)): parent.move(-1)
            case #selector(NSResponder.moveDown(_:)): parent.move(1)
            case #selector(NSResponder.moveRight(_:)):
                let at = textView.selectedRange()
                guard at.length == 0, at.location == (textView.string as NSString).length else { return false }
                parent.open()
            // Return, also with Shift or Option, which arrive as their own commands.
            case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)),
                 #selector(NSResponder.insertLineBreak(_:)):
                parent.submit(NSApp.currentEvent?.modifierFlags ?? [])
            case #selector(NSResponder.cancelOperation(_:)):
                // The field's own Escape clears the text first.
                if !control.stringValue.isEmpty { return false }
                parent.cancel()
            default: return false
            }
            return true
        }
    }
}

/// One value of an item, as the panel lists and copies it.
struct MenuBarField: Identifiable {
    let label: String
    let value: String
    var secret = false
    var link: URL?
    /// A verification code is computed when it is shown or copied.
    var isCode = false
    var id: String { label }

    static func of(_ item: VaultItem) -> [MenuBarField] {
        var fields: [MenuBarField] = []
        func add(_ label: String, _ value: String, secret: Bool = false, link: URL? = nil) {
            if !value.isEmpty { fields.append(MenuBarField(label: label, value: value, secret: secret, link: link)) }
        }
        // Values the file marks as protected stay hidden here as on the item page.
        func hidden(_ key: String) -> Bool { item.concealedFields?.contains(key) == true }
        switch item.kind {
        case .login:
            add(String(localized: "Username"), item.account, secret: hidden("account"))
            add(String(localized: "Password"), item.secret, secret: true)
            if TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: .now) != nil {
                fields.append(MenuBarField(label: String(localized: "Verification code"), value: "", isCode: true))
            }
            add(String(localized: "Website"), item.website, secret: hidden("website"), link: SiteMatch.webAddress(item.website))
        case .creditCard:
            add(String(localized: "Name on card"), item.account, secret: hidden("account"))
            add(String(localized: "Card number"), item.secret, secret: true)
            add(String(localized: "Expiry"), CardExpiry.displayed(item.expiry), secret: hidden("expiry"))
            add(String(localized: "Security code"), item.securityCode, secret: true)
            add(String(localized: "PIN"), item.pin, secret: true)
            add(String(localized: "Valid from"), CardExpiry.displayed(item.validFrom), secret: hidden("validFrom"))
            add(String(localized: "Issuer"), item.issuer, secret: hidden("issuer"))
        case .wifi:
            add(String(localized: "Network"), item.account, secret: hidden("account"))
            add(String(localized: "Password"), item.secret, secret: true)
        case .address:
            add(String(localized: "Full name"), item.account, secret: hidden("account"))
            add(String(localized: "Organization"), item.address.organization, secret: hidden("addressOrganization"))
            add(String(localized: "Street"), item.address.street, secret: hidden("addressStreet"))
            add(String(localized: "City"), item.address.city, secret: hidden("addressCity"))
            add(String(localized: "Region"), item.address.region, secret: hidden("addressRegion"))
            add(String(localized: "Postal code"), item.address.postalCode, secret: hidden("addressPostalCode"))
            add(String(localized: "Country"), item.address.country, secret: hidden("addressCountry"))
            add(String(localized: "Email"), item.address.email, secret: hidden("addressEmail"))
            add(String(localized: "Phone"), item.address.phone, secret: hidden("addressPhone"))
        case .secureNote, .keePassEntry:
            add(String(localized: "Username"), item.account, secret: hidden("account"))
            add(String(localized: "Password"), item.secret, secret: true)
            add(String(localized: "Website"), item.website, secret: hidden("website"), link: SiteMatch.webAddress(item.website))
        }
        add(String(localized: "Note"), item.notes, secret: item.kind == .secureNote || hidden("notes"))
        for field in item.otherFields ?? [] where !fields.contains(where: { $0.label == field.key }) {
            add(field.key, field.value, secret: field.concealed)
        }
        return fields
    }

    func currentValue(of item: VaultItem) -> String? {
        isCode ? TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: .now) : value
    }
}

struct MenuBarSearchView: View {
    @Bindable var model: MenuBarModel
    let openApp: () -> Void

    private struct Group: Identifiable {
        let title: String
        let items: [VaultItem]
        var id: String { title }
    }

    private var query: String { model.query.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// The most results a search lists; typing more narrows them.
    private static let limit = 50

    private func groups(_ items: [VaultItem]) -> [Group] {
        let host = model.page.host
        // The exact site comes before one that only covers it as a subdomain.
        let forPage = host.map { host in
            items.filter { $0.kind == .login && SharedVault.matches($0, host: host) }
                .sorted { SiteMatch.normalizedHost($0.website) == host && SiteMatch.normalizedHost($1.website) != host }
        } ?? []
        let pageIDs = Set(forPage.map(\.id))
        let groups: [Group]
        if !query.isEmpty {
            let all = items.filter { ItemSearch.matches($0, query: query) }
                .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            // The page's own logins are never cut off.
            let found = Array(all.prefix(Self.limit))
            if host != nil {
                groups = [Group(title: String(localized: "For This Site"), items: forPage.filter { ItemSearch.matches($0, query: query) }),
                          Group(title: String(localized: "Other Matches"), items: Array(all.filter { !pageIDs.contains($0.id) }.prefix(Self.limit)))]
            } else {
                groups = [Group(title: String(localized: "Logins"), items: found.filter { $0.kind == .login }),
                          Group(title: String(localized: "Cards"), items: found.filter { $0.kind == .creditCard }),
                          Group(title: String(localized: "Notes and Other"), items: found.filter { $0.kind != .login && $0.kind != .creditCard })]
            }
        } else {
            // An app is matched by a whole word of its name; a browser never, so “Zen” does not suggest Zendesk.
            let isBrowser = model.page != .notBrowser
            let front = model.frontName.lowercased()
            let named = isBrowser || front.isEmpty ? [] : items.filter {
                $0.kind == .login && $0.displayTitle.lowercased().split { !$0.isLetter && !$0.isNumber }.contains(Substring(front))
            }
            let listed = pageIDs.union(named.map(\.id))
            var recent = RecentlyUsed.group(from: items).filter { !listed.contains($0.id) }
            var recentTitle = String(localized: "Recently used")
            if recent.isEmpty, forPage.isEmpty, named.isEmpty {
                recent = Array(items.sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }.prefix(8))
                recentTitle = String(localized: "Items")
            }
            let first = host.map { Group(title: String(localized: "For \($0)"), items: forPage) }
                ?? Group(title: String(localized: "Named like \(model.frontName)"), items: named)
            groups = [first, Group(title: recentTitle, items: recent)]
        }
        return groups.filter { !$0.items.isEmpty }
    }

    var body: some View {
        let items = model.items()
        let groups = groups(items)
        let flat = groups.flatMap(\.items)
        let noneForPage = query.isEmpty && model.page.host.map { host in !items.contains { $0.kind == .login && SharedVault.matches($0, host: host) } } == true
        // Nothing saved for the page, or the page not known yet: nothing is selected, so Return copies nothing.
        let picked = flat.first { $0.id == model.selection }
        // While the page is being read, only a choice made in this opening counts.
        // A chosen row that the page's answer took off the list is not replaced by another.
        let gone = model.chosen && model.selection != nil && picked == nil
        let selected = model.page == .reading ? (model.chosen ? picked : nil) : picked ?? (noneForPage || gone ? nil : flat.first)

        // A page whose item has gone shows the list again.
        let shown = items.first { $0.id == model.opened }
        let width = MenuBarController.panelSize.width
        let swiped = min(max(model.swipe ?? 0, 0), 1)

        ZStack {
            // The list stays underneath, so it comes back where it was left.
            list(groups: groups, flat: flat, selected: selected, noneForPage: noneForPage)
                .offset(x: shown == nil ? 0 : (swiped - 1) * width)
                .opacity(shown != nil && model.swipe == nil ? 0 : 1)
                .allowsHitTesting(shown == nil)
                .accessibilityHidden(shown != nil)
            if let shown {
                MenuBarItemPage(model: model, item: shown, openApp: openApp)
                    .id(shown.id)
                    .offset(x: swiped * width)
                    .transition(.move(edge: .trailing))
            }
        }
        .clipped()
        .animation(model.swipe == nil ? .snappy(duration: 0.22) : nil, value: shown?.id)
        // The hidden search field must not keep the keyboard.
        .onChange(of: model.opened) { _, id in if id != nil { NSApp.keyWindow?.makeFirstResponder(nil) } }
    }

    private func list(groups: [Group], flat: [VaultItem], selected: VaultItem?, noneForPage: Bool) -> some View {
        VStack(spacing: 8) {
            MenuBarSearchField(text: model.query, prompt: String(localized: "Search \(model.vaultName)"),
                               focus: model.openings + model.returns, active: model.opened == nil,
                               change: { model.type($0) },
                               move: { step in
                                   guard !flat.isEmpty else { return }
                                   let at = flat.firstIndex { $0.id == selected?.id } ?? -1
                                   model.pick(flat[min(max(at + step, 0), flat.count - 1)].id)
                               },
                               open: { if let selected { model.open(selected.id) } },
                               submit: { modifiers in if let selected { model.copyMain(of: selected, modifiers: modifiers) } },
                               cancel: { model.close(false) })
                .padding(.horizontal)
            if flat.isEmpty, !query.isEmpty {
                nothingFound
            } else {
                ScrollViewReader { proxy in
                    List(selection: Binding(get: { selected?.id }, set: { if let id = $0 { model.pick(id) } })) {
                        if query.isEmpty { pageCard }
                        if noneForPage, let host = model.page.host {
                            card {
                                Text("No login for \(host) in \(model.vaultName).")
                                Button("New Login for This Site") { model.startLogin(website: host) }
                            }
                        }
                        ForEach(groups) { group in
                            Section(group.title) {
                                ForEach(group.items) { item in
                                    MenuBarItemRow(model: model, item: item)
                                        .tag(item.id)
                                        .id(item.id)
                                        .itemRowInsets(first: item.id == group.items.first?.id, last: item.id == group.items.last?.id)
                                }
                            }
                        }
                    }
                    .itemListStyle()
                    .scrollContentBackground(.hidden)
                    .onChange(of: model.selection) { _, id in if let id { proxy.scrollTo(id) } }
                }
            }
        }
    }

    @ViewBuilder
    private var pageCard: some View {
        switch model.page {
        case .reading:
            Text("Reading the page…").foregroundStyle(.secondary).selectionDisabled()
        case .notAsked:
            card {
                Text("Show logins for the page in \(model.frontName)").font(.headline)
                Text("macOS will ask to let Psss control \(model.frontName), and will say this gives access to its data and actions. Psss reads only the front tab’s address, when this panel opens.")
                HStack {
                    Button("Not Now") { model.declinePage() }
                    Button("Allow in \(model.frontName)…") { model.allowPage() }.buttonStyle(.borderedProminent)
                }
            }
        case .denied:
            card {
                Text("Psss isn’t allowed to read the page in \(model.frontName).")
                Button("Open System Settings…") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
                    model.close(false)
                }
            }
        case .declined:
            card {
                Text("Psss doesn’t read the page in \(model.frontName).")
                Button("Allow in \(model.frontName)…") { model.allowPage() }
            }
        case .unreadable:
            Text("Psss can’t read the page in \(model.frontName) yet. Search by name.").foregroundStyle(.secondary).selectionDisabled()
        case .notBrowser, .none, .host:
            EmptyView()
        }
    }

    private func card(@ViewBuilder _ content: () -> some View) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) { content() }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
        }
        .selectionDisabled()
        .listRowSeparator(.hidden)
    }

    private var nothingFound: some View {
        ContentUnavailableView {
            Label("No Results", systemImage: "magnifyingglass")
        } description: {
            Text("Nothing in \(model.vaultName) matches “\(query)”.")
        } actions: {
            if model.sample == nil {
                ForEach(model.session.openVaults.filter { $0.id != model.vaultID }, id: \.id) { vault in
                    let count = model.session.store(for: vault.id)?.items().filter { ItemSearch.matches($0, query: query) }.count ?? 0
                    if count > 0 {
                        Button("Show \(count) in \(vault.name)") {
                            let typed = model.query
                            model.choose(vault.id)
                            model.type(typed)
                        }
                    }
                }
            }
            Button("New Login…") { model.startLogin(website: model.page.host ?? "") }
        }
    }
}

struct MenuBarItemRow: View {
    let model: MenuBarModel
    let item: VaultItem

    private var subtitle: Text { item.visibleAccount.isEmpty ? Text(item.kind.label) : Text(verbatim: item.visibleAccount) }
    private func open() { model.open(item.id) }

    private var chevron: some View {
        Image(systemName: "chevron.forward").foregroundStyle(.tertiary).accessibilityHidden(true)
    }

    /// The rows of the app's own lists. A login with a code shows it live, as its own button; the rest of the row opens the item.
    var body: some View {
        if item.kind != .creditCard, item.kind != .address, item.makesCode {
            HStack(spacing: 8) {
                ItemListRow(item: item, subtitle: subtitle, glyphs: item.traits.filter { $0 == .passkey }, glyphColumns: [.passkey],
                            open: open, openHint: "Opens the item") {
                    CodeCopyButton(item: item, state: model.codes, used: { model.codeCopied(item) })
                }
                Button(action: open) { chevron.contentShape(Rectangle()) }.buttonStyle(.plain).accessibilityHidden(true)
            }
        } else {
            Button(action: open) {
                HStack(spacing: 8) {
                    switch item.kind {
                    case .creditCard: CardListRow(card: item)
                    case .address: AddressListRow(address: item)
                    default: ItemListRow(item: item, subtitle: subtitle, glyphs: item.traits.filter(ItemTrait.glyphColumns.contains))
                    }
                    chevron
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the item")
        }
    }
}

/// An item's own page over the list: Back, who it is, every value with its own copy button, and the way into the app.
struct MenuBarItemPage: View {
    @Bindable var model: MenuBarModel
    let item: VaultItem
    let openApp: () -> Void

    /// Says so when the login was saved for a site other than the one in front.
    private var otherSite: String? {
        guard let host = model.page.host, item.kind == .login, !item.website.isEmpty, !SharedVault.matches(item, host: host) else { return nil }
        if item.concealedFields?.contains("website") == true { return String(localized: "Saved for another website, not the page in front.") }
        let saved: String = SiteMatch.normalizedHost(item.website)
        return String(localized: "Saved for \(saved), not the page in front.")
    }

    var body: some View {
        VStack(spacing: 0) {
            // One line for Back and who this is, to leave the height for the values.
            HStack(spacing: 10) {
                Button { model.back() } label: { Label("Back", systemImage: "chevron.backward") }
                    .help("Esc or ←")
                ItemIcon(item: item)
                Text(item.displayTitle).font(.headline).lineLimit(1).truncationMode(.middle).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
            }
            .padding(.horizontal)
            Form {
                Section {
                    if let otherSite { Text(otherSite) }
                    ForEach(MenuBarField.of(item)) { MenuBarFieldRow(model: model, item: item, field: $0) }
                }
                Section {
                    Button("Show in Psss", action: openApp)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
        .background { keys }
    }

    /// Return copies as it does in the list, and ← goes back. The app is not in front and no field has the keyboard here.
    private var keys: some View {
        SwiftUI.Group {
            Button("") { model.copyMain(of: item, modifiers: []) }.keyboardShortcut(.return, modifiers: [])
            Button("") { model.copyMain(of: item, modifiers: .shift) }.keyboardShortcut(.return, modifiers: .shift)
            Button("") { model.copyMain(of: item, modifiers: .option) }.keyboardShortcut(.return, modifiers: .option)
            Button("") { model.back() }.keyboardShortcut(.leftArrow, modifiers: [])
            Button("") { model.back() }.keyboardShortcut(.cancelAction)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }
}

extension MenuBarModel {
    /// Return copies the password or card number, with Shift the username, with Option the verification code.
    func copyMain(of item: VaultItem, modifiers: NSEvent.ModifierFlags) {
        let fields = MenuBarField.of(item)
        let field: MenuBarField?
        if modifiers.contains(.shift) {
            field = fields.first { $0.label == String(localized: "Username") }
        } else if modifiers.contains(.option) {
            field = fields.first { $0.isCode }
        } else {
            let main = item.kind == .creditCard ? String(localized: "Card number") : String(localized: "Password")
            field = fields.first { $0.label == main } ?? fields.first { $0.secret } ?? fields.first
        }
        if let field, let value = field.currentValue(of: item) { copy(value, as: field.label, from: item.id) }
    }
}

/// Label above value. The row copies, except a web address, which opens; the eye stays its own button.
struct MenuBarFieldRow: View {
    @Bindable var model: MenuBarModel
    let item: VaultItem
    let field: MenuBarField

    private var key: String { "\(item.id)-\(field.label)" }
    private var shown: Bool { model.revealed.contains(key) }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(field.label).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    if field.isCode {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            Text(TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) ?? "").monospacedDigit()
                        }
                    } else if let link = field.link, !field.secret {
                        Link(field.value, destination: link).lineLimit(1)
                    } else if field.secret, !shown {
                        Text(String(repeating: "\u{2022}", count: 10)).accessibilityLabel("Hidden")
                    } else {
                        Text(field.value).monospaced(field.secret).lineLimit(6)
                    }
                    if field.secret {
                        Button {
                            if shown { model.revealed.remove(key) } else { model.revealed.insert(key) }
                        } label: {
                            Image(systemName: shown ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                        .help(shown ? "Hide \(field.label)" : "Show \(field.label)")
                        .accessibilityLabel(shown ? "Hide \(field.label)" : "Show \(field.label)")
                    }
                }
            }
            Spacer()
            Button(action: copy) { Image(systemName: "doc.on.doc") }
                .buttonStyle(.borderless)
                .help("Copy \(field.label)")
                .accessibilityLabel("Copy \(field.label)")
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture(perform: copy)
    }

    private func copy() {
        if let value = field.currentValue(of: item) { model.copy(value, as: field.label, from: item.id) }
    }
}
#endif
