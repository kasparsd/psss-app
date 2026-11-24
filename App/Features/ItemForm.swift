import SwiftUI

extension ItemField {
    /// The field's name on the item page, by kind.
    func label(for kind: ItemKind) -> LocalizedStringResource {
        switch self {
        case .website: "Website"
        case .account: kind == .creditCard ? "Name on card" : kind == .wifi ? "Network name" : "Username"
        case .secret:
            switch kind {
            case .login: "Password"
            case .creditCard: "Card number"
            case .keePassEntry: "Value"
            case .secureNote: "Secret"
            case .wifi: "Password"
            }
        case .expiry: "Expiry"
        case .securityCode: "Security code"
        case .validFrom: "Valid from"
        case .pin: "PIN"
        case .issuer: "Card issuer"
        case .notes: kind == .secureNote ? "Note" : "Notes"
        }
    }

    /// The field's caption in the form: the same name, with "(optional)" on every field that may be left empty.
    func formLabel(for kind: ItemKind) -> String {
        let name = String(localized: label(for: kind))
        return VaultItem.isOptional(self, for: kind) ? String(localized: "\(name) (optional)") : name
    }
}

extension ItemKind {
    /// The title of the sheet that adds one.
    var newTitle: LocalizedStringKey {
        switch self {
        case .login: "New Login"
        case .creditCard: "New Card"
        case .secureNote: "New Note"
        case .keePassEntry: "New Custom Item"
        case .wifi: "New Wi-Fi Network"
        }
    }
}

/// The fields of an item as a form, in the groups and the order of the item page (owner, 2026-11-24): one card per group.
/// The icon and the name field above the first card; 1. what you copy to sign in or pay (`VaultItem.firstCardFields`), or a note's
/// text; 2. a login's verification code, under its own heading; 3. notes; 4. a passkey, as the page shows it; then Move to Recently
/// Deleted for an item that exists. Used by the item page when Edit turns it into the editor, and by the sheet that adds a new item,
/// so the order and the field behaviours (expiry formatting, number pads, the setup key field, info buttons, masking) are written
/// once.
struct ItemFields: View {
    @Binding var item: VaultItem
    /// A new item: its first field takes focus. An existing item's page does not grab the keyboard.
    var isNew = false
    /// The host presents `VerificationCodeSheet` for manual setup or an explicitly pasted image.
    @Binding var codeInput: VerificationCodeInput?
    var mapFieldsLabel: LocalizedStringResource = "Show as Card or Login…"
    var onMapFields: (() -> Void)?
    var canMapFields = true
    /// Set only when editing an existing item.
    var onDelete: (() -> Void)?
    /// A field to start with focused when editing an existing item (from a field's Add on the item page).
    var focusField: ItemField?
    @FocusState private var focused: ItemField?

    var body: some View {
        Group {
            first
            if item.kind == .wifi { wifiGroup }
            if item.kind == .login { codeGroup }
            if item.kind != .secureNote { Section { input(.notes) } }
            if let passkey = item.passkey {
                Section { PasskeyCard.row(passkey) } header: { PasskeyCard.heading } footer: { PasskeyCard.footer(passkey) }
            }
            if let fields = item.otherFields, !fields.isEmpty {
                Section {
                    ForEach(fields, content: otherField)
                } header: {
                    Text("Other fields").font(.body)
                }
            }
            if let onMapFields {
                Section {
                    Button(mapFieldsLabel, action: onMapFields).disabled(!canMapFields)
                } footer: {
                    if !canMapFields { Text("Save your changes first.").font(.body) }
                }
            }
            if let onDelete { deleteGroup(onDelete) }
        }
        .task {
            if let focusField { focused = focusField; return }
            guard isNew else { return }
            switch item.kind {
            // A new login starts at Website; with the website already there (added from a search) at Username.
            case .login, .keePassEntry: focused = item.website.isEmpty ? .website : .account
            case .creditCard: focused = .secret
            case .secureNote: focused = .notes
            case .wifi: focused = .account
            }
        }
    }

    // MARK: Groups

    /// A Wi-Fi network's security and whether it hides its name.
    private var wifiGroup: some View {
        Section {
            Picker("Security", selection: $item.wifiSecurity) {
                ForEach(WiFiSecurity.allCases) { Text(verbatim: $0.label).tag($0) }
            }
            Toggle("Hidden network", isOn: $item.wifiHidden)
        }
    }

    private var first: some View {
        Section {
            if item.kind == .secureNote {
                input(.notes)
            } else {
                ForEach(VaultItem.firstCardFields(for: item.kind), id: \.self) { input($0) }
            }
        } header: {
            ItemIdentity(item: item, name: item.concealedFields?.contains("title") == true ? nil : $item.title)
        }
    }

    /// A login's verification code: one card under one heading. The setup key field has its action on the same line; Remove code,
    /// being destructive, has its own row.
    private var codeGroup: some View {
        Section {
            CodeImagePaste(onPaste: { codeInput = .pastedImage($0) }) {
                labeled(String(localized: "Setup key (optional)")) {
                    HStack(spacing: 8) {
                        SecureField("Setup key", text: $item.otpSecret, prompt: Text("Setup key or otpauth:// link"))
                            .secretEntry()
                        Button(item.otpSecret.isEmpty ? "Add code" : "Replace code") { codeInput = .manual }
                            .buttonStyle(.bordered)
                            .fixedSize()
                    }
                    if item.totpInvalid {
                        Label("That is not a valid setup key.", systemImage: "exclamationmark.triangle")
                    }
                }
            }
            if !item.otpSecret.isEmpty {
                Button("Remove code", role: .destructive) {
                    item.otpSecret = ""
                    item.otpSettings = .standard
                }
                .buttonStyle(.bordered)
            }
        } header: {
            HStack(spacing: 4) {
                Text("Verification code")
                InfoButton(topic: HelpTopics.setupKey)
            }
        }
    }

    private func deleteGroup(_ delete: @escaping () -> Void) -> some View {
        // Nothing more is asked: the item goes to Recently Deleted and Undo follows. It is not gone, so the button is in the default
        // colour (owner, 2026-11-24); red is for Delete Now… and Delete All…, which remove for good.
        Section {
            // A button for the whole item, not a field of any group: it stands on the page, outside the grouped background.
            HStack {
                Spacer()
                Button(RecentlyDeletedText.moveButton, action: delete).buttonStyle(.bordered).fixedSize()
                Spacer()
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } footer: {
            Text(verbatim: RecentlyDeletedText.editorDeleteLine).font(.body).frame(maxWidth: .infinity)
        }
    }

    // MARK: Fields

    private func otherField(_ field: StoredItemField) -> some View {
        let name = field.key.isEmpty ? String(localized: "Unnamed field") : field.key
        let value = Binding(get: { item.otherFieldEdits?[field.id] ?? field.value },
                            set: { item.editOtherField(field, value: $0) })
        return labeled(name) {
            if field.concealed {
                SecureField(name, text: value).secretEntry()
            } else {
                TextField(name, text: value, axis: .vertical).lineLimit(1...6)
            }
        }
    }

    /// One field: its caption, with "(optional)" where it may be left empty, and the control that suits it.
    @ViewBuilder
    private func input(_ field: ItemField) -> some View {
        let name = String(localized: field.label(for: item.kind))
        labeled(field.formLabel(for: item.kind), info: field == .securityCode ? HelpTopics.securityCode : nil) {
            if item.concealedFields?.contains(field.rawValue) == true && field != .secret && field != .securityCode && field != .pin {
                SecureField(name, text: Binding(get: { item[field] }, set: { item[field] = $0 })).secretEntry()
            } else {
                switch field {
                case .website:
                    TextField(name, text: $item.website, prompt: Text("example.com"))
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                case .account:
                    if item.kind == .creditCard {
                        TextField(name, text: $item.account, prompt: Text(verbatim: ""))
                            .autocorrectionDisabled()
                    } else {
                        TextField(name, text: $item.account, prompt: Text(verbatim: ""))
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                            .autocorrectionDisabled()
                    }
                case .secret:
                    SecureField(name, text: $item.secret, prompt: Text(verbatim: "")).secretEntry()
                case .expiry:
                    TextField(name, text: $item.expiry, prompt: Text("MM/YY"))
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                        .onAppear { item.expiry = CardExpiry.displayed(item.expiry) }
                        .onChange(of: item.expiry) { _, text in
                            let clean = CardExpiry.normalizedInput(text)
                            if clean != text { item.expiry = clean }
                        }
                case .securityCode:
                    SecureField(name, text: $item.securityCode, prompt: Text(verbatim: ""))
                        .secretEntry()
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                case .validFrom:
                    TextField(name, text: $item.validFrom, prompt: Text("MM/YY"))
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                        .onAppear { item.validFrom = CardExpiry.displayed(item.validFrom) }
                        .onChange(of: item.validFrom) { _, text in
                            let clean = CardExpiry.normalizedInput(text)
                            if clean != text { item.validFrom = clean }
                        }
                case .pin:
                    SecureField(name, text: $item.pin, prompt: Text(verbatim: ""))
                        .secretEntry()
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                case .issuer:
                    TextField(name, text: $item.issuer, prompt: Text(verbatim: ""))
                case .notes:
                    TextField(name, text: $item.notes, prompt: Text(verbatim: ""), axis: .vertical)
                        .lineLimit(item.kind == .secureNote ? 6...20 : 3...8)
                }
            }
        }
        .focused($focused, equals: field)
    }

    /// A visible caption above each field, like the item page, so a filled field never loses its name.
    private func labeled<Content: View>(_ label: String, info: HelpTopic? = nil, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(verbatim: label).foregroundStyle(.secondary)
                if let info { InfoButton(topic: info) }
            }
            content().labelsHidden()
        }
    }
}

/// The icon and name, centred, above the first card of an item page (owner, 2026-11-24). With `name`, while the item is edited or
/// added, the heading is the name field: the same size and weight, on a quiet field background so it reads as editable. With no name
/// typed it shows the name the item gets by itself (`derivedTitle`) as its placeholder, which follows the website, username or card
/// number as they are typed. Outside editing a typed and a derived name look the same.
struct ItemIdentity: View {
    let item: VaultItem
    var name: Binding<String>?

    var body: some View {
        VStack(spacing: 8) {
            ItemIcon(item: item, size: 64)
            if let name {
                TextField("Name", text: name, prompt: Text(verbatim: item.derivedTitle).foregroundStyle(Color.secondary))
                    .textFieldStyle(.plain)
                    .font(.title.weight(.semibold))
                    .foregroundStyle(Color.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityLabel("Name")
                    .help("Name")
            } else {
                Text(item.displayTitle)
                    .font(.title.weight(.semibold))
                    .foregroundStyle(Color.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .textCase(nil)
        .padding(.vertical, 8)
    }
}

/// The passkey card of a login, the same on the item page and while it is edited (a passkey is made by the site, never typed).
enum PasskeyCard {
    static func row(_ passkey: PasskeyRecord) -> some View {
        Label {
            Text("Saved \(passkey.created.formatted(date: .abbreviated, time: .omitted)) for \(passkey.rpID)")
        } icon: {
            Image(systemName: "person.badge.key")
        }
    }

    @MainActor static var heading: some View {
        HStack(spacing: 4) {
            Text("Passkey")
            InfoButton(topic: HelpTopics.passkeys)
        }
    }

    static func footer(_ passkey: PasskeyRecord) -> some View {
        Text("Sign in on \(passkey.rpID) with this passkey. It never leaves your vault.")
    }
}

extension View {
    /// The sheet that reads a setup key from paste, image or camera. A saved code is stored at once (`keepDraft`), so it survives
    /// leaving the app to type it into the site.
    func codeSheet(item: Binding<VaultItem>, input: Binding<VerificationCodeInput?>, keepDraft: @escaping (VaultItem) -> Void) -> some View {
        sheet(item: input) { input in
            VerificationCodeSheet(loginName: item.wrappedValue.displayTitle, hasExistingCode: item.wrappedValue.totpUsable, input: input) { setup in
                item.wrappedValue.otpSecret = setup.secret
                item.wrappedValue.otpSettings = setup.settings
                if item.wrappedValue.canSave { keepDraft(item.wrappedValue.savedForm) }
            }
        }
    }
}

/// The sheet that adds a new item: there is no page to edit in place. Existing items are edited on their own page (`ItemDetail`).
/// Cancel, Escape and a swipe down never lose typed text without asking: Cancel and Escape ask "Discard Changes?" once something
/// was typed, and the swipe is held back until then (SwiftUI does not report a refused swipe, so the question comes from Cancel).
struct NewItemSheet: View {
    @State private var item: VaultItem
    /// The item as the sheet opened, or as it was last stored (a code kept with `onKeepDraft`): what Cancel compares with.
    @State private var baseline: VaultItem
    let onSave: (VaultItem) -> Void
    /// Stores the login without closing the sheet, so a code survives leaving the app to type it into the site.
    let onKeepDraft: (VaultItem) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var codeInput: VerificationCodeInput?
    @State private var confirmsDiscard = false

    init(item: VaultItem, onSave: @escaping (VaultItem) -> Void, onKeepDraft: @escaping (VaultItem) -> Void) {
        _item = State(initialValue: item)
        _baseline = State(initialValue: item)
        self.onSave = onSave
        self.onKeepDraft = onKeepDraft
    }

    private var hasTypedText: Bool { item.hasChanges(from: baseline) }

    var body: some View {
        NavigationStack {
            Form {
                ItemFields(item: $item, isNew: true, codeInput: $codeInput)
            }
            .formStyle(.grouped)
            // The form always scrolls and dragging it lowers the keyboard, which otherwise covers the lower rows on iPad.
            .scrollDisabled(false)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationTitle(item.kind.newTitle)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: cancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(item.savedForm) }
                        .disabled(!item.canSave)
                }
            }
        }
        .modifier(SheetSize())
        .interactiveDismissDisabled(hasTypedText)
        .codeSheet(item: $item, input: $codeInput, keepDraft: { kept in
            onKeepDraft(kept)
            baseline = item
        })
        .modifier(DiscardChanges(isPresented: $confirmsDiscard, message: "This new item is not saved.") { dismiss() })
    }

    /// Cancel with something typed asks first; with nothing typed it closes at once.
    private func cancel() {
        if hasTypedText { confirmsDiscard = true } else { dismiss() }
    }
}

/// "Discard Changes?" when Cancel is chosen with unsaved changes: a confirmation dialog on Mac; an alert on iPhone and iPad, because
/// iOS 26 draws a confirmation dialog as a popover that has no Keep Editing choice (see `ConfirmDeletion`). The same question for an
/// item edited in place and for a new item in its sheet.
struct DiscardChanges: ViewModifier {
    @Binding var isPresented: Bool
    var message: LocalizedStringKey = "The changes you made to this item are not saved."
    let discard: () -> Void

    func body(content: Content) -> some View {
        #if os(macOS)
        content.confirmationDialog("Discard Changes?", isPresented: $isPresented, titleVisibility: .visible) { buttons } message: { Text(message) }
        #else
        content.alert("Discard Changes?", isPresented: $isPresented) { buttons } message: { Text(message) }
        #endif
    }

    @ViewBuilder private var buttons: some View {
        Button("Discard Changes", role: .destructive, action: discard)
        Button("Keep Editing", role: .cancel) {}
    }
}

struct SheetSize: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.frame(minWidth: 450, minHeight: 360).frame(idealHeight: 560)
        #else
        // iPad: the tallest sheet the screen allows, so the fields show with little scrolling; the default form sheet is a short card.
        content.presentationSizing(.page)
        #endif
    }
}
