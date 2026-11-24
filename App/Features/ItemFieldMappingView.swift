import SwiftUI

/// The sheet that says what each stored field of an item is used for (owner, 2026-11-24; mock: Design/Mocks, “KeePass field
/// mapping”). It lists the stored fields, name and value on the left and a menu on the right, under a Show as row that names the
/// kind. Saving writes the role names and source keys to the same vault. Field names and values are never changed, and saving
/// never checks a value: the item page marks an empty or badly formatted one and Edit corrects it.
struct ItemFieldMappingView: View {
    let item: VaultItem
    /// Named only when the vault changed elsewhere; the sheet itself opens from the item, inside that vault.
    let vault: String
    let hideSignal: Int
    let save: (ItemFieldMapping) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ItemFieldMapping
    @State private var saveProblem: String?
    @State private var needsReopen = false
    @State private var revealedFields: Set<StoredItemField.ID> = []

    init(item: VaultItem, vault: String, hideSignal: Int, save: @escaping (ItemFieldMapping) throws -> Void) {
        self.item = item
        self.vault = vault
        self.hideSignal = hideSignal
        self.save = save
        let card = Self.suggested(for: .creditCard, item: item)
        let kind: ItemKind = item.kind == .creditCard || card[.cardNumber] != nil ? .creditCard : .login
        let initial = item.fieldMapping ?? Self.suggested(for: kind, item: item)
        _draft = State(initialValue: item.fieldMappingNeedsReview == true && item.sourceFields?.isEmpty != false
                       ? ItemFieldMapping(kind: .keePassEntry) : initial)
    }

    private static func suggested(for kind: ItemKind, item: VaultItem) -> ItemFieldMapping {
        var defaults = ItemFieldMapping(kind: kind)
        if kind == item.kind {
            if kind == .creditCard {
                defaults[.cardNumber] = "Password"
                defaults[.cardholder] = "UserName"
                defaults[.expiry] = "Expiry"
                defaults[.securityCode] = "Security code"
            } else if kind == .login {
                defaults[.username] = "UserName"
                defaults[.password] = "Password"
                defaults[.loginWebsite] = "URL"
            }
        }
        if let existing = item.fieldMapping, existing.kind == kind { defaults = existing }
        return .suggested(for: kind, fields: item.sourceFields ?? [], defaults: defaults)
    }

    private var fields: [StoredItemField] { item.sourceFields ?? [] }
    private var eligible: Set<String> { Set(ItemFieldMapping.choices(in: fields).map(\.key)) }
    private var roles: [FieldRole] { FieldRole.mappingRoles(for: draft.kind) }
    private var issues: [(role: FieldRole?, message: String)] { draft.validationIssues(in: fields) }

    var body: some View {
        #if os(macOS)
        form.frame(minWidth: 440, idealWidth: 560, minHeight: 395, idealHeight: 485)
        #else
        NavigationStack {
            form
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { cancelButton }
                    ToolbarItem(placement: .confirmationAction) { saveButton }
                }
        }
        #endif
    }

    /// The title, the Show as row and its line. On Mac they stay put while only the field list scrolls; elsewhere they are the
    /// first rows of one form.
    @ViewBuilder
    private var topRows: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: item.displayTitle).font(.title.weight(.semibold))
            Text("Choose what each field is used for.").foregroundStyle(.secondary)
        }
        .accessibilityAddTraits(.isHeader)
        Section {
            Picker("Show as", selection: Binding(get: { draft.kind }, set: { kind in
                draft = Self.suggested(for: kind, item: item)
                saveProblem = nil
                revealedFields = []
            })) {
                Text("Card").tag(ItemKind.creditCard)
                Text("Login").tag(ItemKind.login)
                Text("Custom item").tag(ItemKind.keePassEntry)
            }
            .pickerStyle(.menu)
        } footer: {
            helpLine
        }
    }

    private var fieldRows: some View {
        Section {
            ForEach(fields) { fieldRow($0) }
        }
    }

    private var form: some View {
        #if os(macOS)
        VStack(spacing: 0) {
            Form { topRows }
                .formStyle(.grouped)
                .scrollDisabled(true)
                .fixedSize(horizontal: false, vertical: true)
            Form { fieldRows }
                .formStyle(.grouped)
            HStack {
                Spacer()
                cancelButton
                saveButton.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .modifier(HidesRevealedValues(signal: hideSignal) { revealedFields = [] })
        .onChange(of: fields) { revealedFields = [] }
        #else
        Form {
            topRows
            fieldRows
        }
        .formStyle(.grouped)
        .modifier(HidesRevealedValues(signal: hideSignal) { revealedFields = [] })
        .onChange(of: fields) { revealedFields = [] }
        #endif
    }

    /// The one line under Show as: how the first guess was made, or what is missing. A problem is the app's problem line.
    @ViewBuilder
    private var helpLine: some View {
        if let problem = saveProblem ?? issues.first?.message {
            ProblemText(text: problem)
        } else {
            Text(helpText).foregroundStyle(.secondary)
        }
    }

    private var helpText: String {
        switch draft.kind {
        case .creditCard:
            String(localized: "Matched from field names. Change any that are wrong. A card needs a card number. Field names and values stay as they are.")
        case .login:
            String(localized: "Matched from field names. Change any that are wrong. Field names and values stay as they are.")
        default:
            String(localized: "A custom item shows every field under its own name. Field names and values stay as they are.")
        }
    }

    private func role(of field: StoredItemField) -> FieldRole? {
        roles.first { draft[$0] == field.key }
    }

    /// Choosing a role moves it from the field that had it, which falls back to Other field, so a role never belongs to two fields.
    private func assign(_ role: FieldRole?, to field: StoredItemField) {
        revealedFields.remove(field.id)
        saveProblem = nil
        for old in roles where draft[old] == field.key { draft[old] = nil }
        guard let role else { return }
        if let previous = draft[role], previous != field.key {
            AccessibilityNotification.Announcement(
                String(localized: "\(String(localized: role.label)) moved from \(previous) to \(field.key)")).post()
        }
        draft[role] = field.key
    }

    private func fieldRow(_ field: StoredItemField) -> some View {
        let role = role(of: field)
        let name = field.key.isEmpty ? String(localized: "Unnamed field") : field.key
        let protected = !field.value.isEmpty && (field.concealed || role?.sensitive == true)
        let shown = revealedFields.contains(field.id)
        let value = field.value.split(whereSeparator: \.isNewline).joined(separator: " ")
        return HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    (field.value.isEmpty ? Text("Empty") : Text(verbatim: protected && !shown ? VaultItem.hiddenMask : value))
                        .font(protected && shown ? .secretValue : .body)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityLabel(protected && !shown ? Text("Hidden") : field.value.isEmpty ? Text("Empty") : Text(verbatim: value))
                    if protected {
                        RevealIconButton(name: name.localizedLowercase, revealed: Binding(
                            get: { revealedFields.contains(field.id) },
                            set: { if $0 { revealedFields.insert(field.id) } else { revealedFields.remove(field.id) } }
                        ))
                    }
                }
            }
            Spacer(minLength: 8)
            if !roles.isEmpty && eligible.contains(field.key) { roleMenu(for: field, current: role, name: name) }
        }
        .font(.body)
    }

    /// What the field is used as. “Other field” is in secondary colour, so the assigned roles stand out; it is never blank.
    private func roleMenu(for field: StoredItemField, current: FieldRole?, name: String) -> some View {
        let currentLabel = current.map { String(localized: $0.label) } ?? String(localized: "Other field")
        return Menu {
            Picker(selection: Binding(get: { current }, set: { assign($0, to: field) })) {
                Text("Other field").tag(nil as FieldRole?)
                ForEach(roles, id: \.self) { Text($0.label).tag(Optional($0)) }
            } label: {
                Text("Use \(name) as")
            }
            .pickerStyle(.inline)
        } label: {
            Text(verbatim: currentLabel)
                .foregroundStyle(current == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
        }
        .menuIndicator(.visible)
        .fixedSize()
        .accessibilityLabel(Text("Use \(name) as"))
        .accessibilityValue(Text(verbatim: currentLabel))
    }

    private var cancelButton: some View {
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
    }

    private var saveButton: some View {
        Button("Save") {
            do {
                try save(draft)
                dismiss()
            } catch VaultStoreError.changedOnDisk {
                needsReopen = true
                saveProblem = String(localized: "\(vault) changed elsewhere. Close this screen, open the current vault, and choose the fields again.")
            } catch {
                saveProblem = (error as? VaultStoreError)?.message ?? (error as? KDBXError)?.message ?? error.localizedDescription
            }
        }
        .disabled(!issues.isEmpty || needsReopen)
    }
}
