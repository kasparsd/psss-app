#if os(macOS) && DEBUG
import AppKit
import SwiftUI

/// The system's search field. It keeps the keyboard while arrows move the list's selection.
struct MenuBarSearchField: NSViewRepresentable {
    let text: String
    let prompt: String
    /// Takes the keyboard each time either changes: opening the panel selects the text, coming back from an item keeps the caret
    /// at its end.
    let openings: Int
    let returns: Int
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
        guard active else {
            // The hidden field must not keep the keyboard.
            if field.currentEditor() != nil { Task { @MainActor in field.window?.makeFirstResponder(nil) } }
            return
        }
        let seen = context.coordinator.seen
        guard seen?.openings != openings || seen?.returns != returns else { return }
        let back = seen != nil && seen?.openings == openings
        context.coordinator.seen = (openings, returns)
        // After the panel has become key.
        Task { @MainActor in
            field.window?.makeFirstResponder(field)
            if back { field.currentEditor()?.selectedRange = NSRange(location: (field.stringValue as NSString).length, length: 0) }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var parent: MenuBarSearchField
        var seen: (openings: Int, returns: Int)?

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
    var shape = DisplayText.Shape.line
    var id: String { label }

    static func of(_ item: VaultItem) -> [MenuBarField] {
        var fields: [MenuBarField] = []
        func add(_ label: String, _ value: String, secret: Bool = false, link: URL? = nil, shape: DisplayText.Shape = .line) {
            if !value.isEmpty { fields.append(MenuBarField(label: label, value: value, secret: secret, link: link, shape: shape)) }
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
            add(String(localized: "Street"), item.address.street, secret: hidden("addressStreet"), shape: .lines)
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
        add(String(localized: "Note"), item.notes, secret: item.kind == .secureNote || hidden("notes"), shape: .asStored)
        for field in item.otherFields ?? [] where !fields.contains(where: { $0.label == field.key }) {
            add(field.key, field.value, secret: field.concealed, shape: .lines)
        }
        return fields
    }

    func currentValue(of item: VaultItem) -> String? {
        isCode ? TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: .now) : value
    }
}

struct MenuBarSearchView: View {
    @Bindable var model: MenuBarModel

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
                .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
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
                $0.kind == .login && $0.fullName.lowercased().split { !$0.isLetter && !$0.isNumber }.contains(Substring(front))
            }
            let listed = pageIDs.union(named.map(\.id))
            var recent = RecentlyUsed.group(from: items).filter { !listed.contains($0.id) }
            var recentTitle = String(localized: "Recently used")
            if recent.isEmpty, forPage.isEmpty, named.isEmpty {
                recent = Array(items.sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }.prefix(8))
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
                MenuBarItemPage(model: model, item: shown)
                    .id(shown.id)
                    .offset(x: swiped * width)
                    .transition(.move(edge: .trailing))
            }
        }
        .clipped()
        .animation(model.swipe == nil ? .snappy(duration: 0.22) : nil, value: shown?.id)
        // The open item was deleted or has gone from the vault.
        .onChange(of: shown == nil, initial: true) { _, gone in if gone, model.opened != nil { model.dropPage() } }
    }

    private func list(groups: [Group], flat: [VaultItem], selected: VaultItem?, noneForPage: Bool) -> some View {
        VStack(spacing: 8) {
            MenuBarSearchField(text: model.query, prompt: String(localized: "Search \(model.vaultName)"),
                               openings: model.openings, returns: model.returns, active: model.opened == nil,
                               change: { model.type($0) },
                               move: { step in
                                   guard !flat.isEmpty else { return }
                                   let at = flat.firstIndex { $0.id == selected?.id } ?? -1
                                   model.pick(flat[min(max(at + step, 0), flat.count - 1)].id)
                               },
                               open: { if let selected { model.open(selected.id) } },
                               submit: { modifiers in if let selected { model.copyMain(of: selected, modifiers: modifiers) } },
                               cancel: { model.close(false) })
                .padding([.horizontal, .top], MenuBarController.inset)
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
                        Button("Show \(count) in \(VaultName.short(vault.name))") {
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

    private var subtitle: Text { item.shownAccount.isEmpty ? Text(item.kind.label) : Text(verbatim: item.shownAccount) }
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

/// One line for Back and what is on screen, to leave the height for what follows. A second, hidden Back keeps the middle in the
/// middle until a long name needs the room.
struct MenuBarTopLine<Icon: View>: View {
    let title: String
    let help: LocalizedStringKey
    let back: () -> Void
    @ViewBuilder let icon: Icon

    var body: some View {
        HStack(spacing: 10) {
            button.help(help).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                icon
                Text(title).font(.headline).lineLimit(2).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
            }
            .layoutPriority(1)
            button.hidden().accessibilityHidden(true).frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding([.horizontal, .top], MenuBarController.inset)
    }

    private var button: some View {
        Button(action: back) { Label("Back", systemImage: "chevron.backward") }.fixedSize()
    }
}

/// An item's own page over the list: Back, who it is, and every value with its own copy button.
struct MenuBarItemPage: View {
    @Bindable var model: MenuBarModel
    let item: VaultItem

    /// Says so when the login was saved for a site other than the one in front.
    private var otherSite: String? {
        guard let host = model.page.host, item.kind == .login, !item.website.isEmpty, !SharedVault.matches(item, host: host) else { return nil }
        if item.concealedFields?.contains("website") == true { return String(localized: "Saved for another website, not the page in front.") }
        let saved: String = SiteMatch.normalizedHost(item.website)
        guard !saved.isEmpty else { return String(localized: "Saved for another website, not the page in front.") }
        return String(localized: "Saved for \(DisplayText.safe(saved)), not the page in front.")
    }

    var body: some View {
        VStack(spacing: 0) {
            MenuBarTopLine(title: item.displayTitle, help: "Esc or ←", back: { model.back() }) { ItemIcon(item: item) }
            Form {
                Section {
                    if let otherSite { Text(otherSite) }
                    ForEach(MenuBarField.of(item)) { field in
                        let key = "\(item.id)-\(field.label)"
                        MenuBarFieldRow(item: item, field: field, shown: model.revealed.contains(key),
                                        toggle: { model.toggleShown(key) },
                                        copy: { if let value = field.currentValue(of: item) { model.copy(value, as: field.label, from: item.id) } })
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            // The form brings its own space above the first section.
            .contentMargins(.top, 0, for: .scrollContent)
        }
        .background { keys }
    }

    /// ← goes back. Return and Escape are handled by the panel, which can tell Shift and Option apart.
    private var keys: some View {
        SwiftUI.Group {
            Button("") { model.back() }.keyboardShortcut(.leftArrow, modifiers: [])
        }
        .opacity(0)
        .accessibilityHidden(true)
    }
}

extension MenuBarModel {
    /// Return copies the password or card number, with Shift the username, with Option the verification code.
    func copyMain(of item: VaultItem, modifiers: NSEvent.ModifierFlags) {
        guard store != nil else { return }
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
        // A code goes the way its button does, so the row says “Copied” too.
        if let field, field.isCode { codes.copy(item) { codeCopied(item) } }
        else if let field, let value = field.currentValue(of: item) { copy(value, as: field.label, from: item.id) }
    }
}

/// Label above value. The row copies, except a web address, which opens; the eye stays its own button.
struct MenuBarFieldRow: View {
    let item: VaultItem
    let field: MenuBarField
    let shown: Bool
    let toggle: () -> Void
    let copy: () -> Void

    var body: some View {
        // A field's name comes from the file.
        let name = DisplayText.safe(field.label)
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    if field.isCode {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            CodeDigits(code: TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) ?? "")
                        }
                    } else if let link = field.link, !field.secret {
                        Link(destination: link) { Text(DisplayText.value(field.value)).lineLimit(1).truncationMode(.middle) }
                    } else if field.secret, !shown {
                        Text(String(repeating: "\u{2022}", count: 10)).accessibilityLabel("Hidden")
                    } else {
                        Text(field.secret ? field.value : DisplayText.shown(field.value, as: field.shape)).monospaced(field.secret).lineLimit(6)
                    }
                    if field.secret {
                        Button(action: toggle) {
                            Image(systemName: shown ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                        .help(shown ? "Hide \(name)" : "Show \(name)")
                        .accessibilityLabel(shown ? "Hide \(name)" : "Show \(name)")
                    }
                }
            }
            Spacer()
            Button(action: copy) { Image(systemName: "doc.on.doc") }
                .buttonStyle(.borderless)
                .help("Copy \(name)")
                .accessibilityLabel("Copy \(name)")
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: copy)
    }
}
#endif
