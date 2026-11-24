import SwiftUI

/// A draft of the assignments. Saving writes the role names and source keys to the same vault.
struct ItemFieldMappingView: View {
    let item: VaultItem
    let vault: String
    let location: String?
    let hideSignal: Int
    let save: (ItemFieldMapping) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ItemFieldMapping
    @State private var saveProblem: String?
    @State private var needsReopen = false
    @State private var revealedSources: Set<FieldRole> = []

    init(item: VaultItem, vault: String, location: String?, hideSignal: Int, save: @escaping (ItemFieldMapping) throws -> Void) {
        self.item = item
        self.vault = vault
        self.location = location
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
    private var choices: [StoredItemField] { ItemFieldMapping.choices(in: fields) }
    private var roles: [FieldRole] { FieldRole.mappingRoles(for: draft.kind) }
    private var issues: [(role: FieldRole?, message: String)] { draft.validationIssues(in: fields) }
    private var unassigned: [String] {
        let assigned = Set(draft.keys.values)
        return fields.filter {
            !assigned.contains($0.key) && !(["UserName", "Password", "URL"].contains($0.key) && $0.value.isEmpty)
        }.map(\.key)
    }
    private var saveTitle: LocalizedStringResource {
        switch draft.kind {
        case .creditCard: "Save as Card"
        case .login: "Save as Login"
        default: "Save as Custom Item"
        }
    }

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

    private var form: some View {
        let issues = issues
        return Form {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.displayTitle).font(.title.weight(.semibold))
                Text(verbatim: [vault, location].compactMap { $0 }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
            }
            .accessibilityAddTraits(.isHeader)
            Section {
                Picker("Item type", selection: Binding(get: { draft.kind }, set: { kind in
                    draft = Self.suggested(for: kind, item: item)
                    saveProblem = nil
                    revealedSources = []
                })) {
                    Text("Card").tag(ItemKind.creditCard)
                    Text("Login").tag(ItemKind.login)
                    Text("Custom item").tag(ItemKind.keePassEntry)
                }
                .pickerStyle(.menu)
                ForEach(roles, id: \.self) { role in
                    rolePicker(role, issue: issues.first { $0.role == role }?.message)
                }
            }
            if !roles.isEmpty && !unassigned.isEmpty {
                Text("Psss keeps \(unassigned.formatted(.list(type: .and))) under Other fields.")
                    .foregroundStyle(.secondary)
            }
            #if os(macOS)
            HStack {
                Spacer()
                cancelButton
                saveButton.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
            #endif
            Text(verbatim: saveProblem ?? issues.first { $0.role == nil }?.message
                 ?? String(localized: "Saves the item type in \(vault). Existing fields and the vault password stay the same."))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(saveProblem == nil ? [] : .updatesFrequently)
        }
        .formStyle(.grouped)
        .modifier(HidesRevealedValues(signal: hideSignal) { revealedSources = [] })
        .onChange(of: fields) { revealedSources = [] }
    }

    private func rolePicker(_ role: FieldRole, issue: String?) -> some View {
        let name = String(localized: role.label)
        let label = role.required ? name : String(localized: "\(name) (optional)")
        let selected = choices.first { $0.key == draft[role] }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: label).layoutPriority(1)
                Spacer(minLength: 0)
                Text("From field").foregroundStyle(.secondary).fixedSize(horizontal: true, vertical: false)
                Picker(selection: Binding(get: { draft[role] }, set: {
                    draft[role] = $0
                    revealedSources.remove(role)
                    saveProblem = nil
                })) {
                    Text(role.required ? "Choose a field" : "Leave unassigned").tag(nil as String?)
                    ForEach(choices) { field in
                        Text(verbatim: field.key).tag(Optional(field.key))
                    }
                } label: {
                    Text("Source field for \(name)")
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }
            if let selected {
                sourcePreview(selected, as: role)
            }
            if let issue {
                ProblemText(text: issue)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.body)
    }

    private func sourcePreview(_ field: StoredItemField, as role: FieldRole) -> some View {
        let protected = !field.value.isEmpty && (field.concealed || role.sensitive)
        let shown = revealedSources.contains(role)
        let value = field.value.split(whereSeparator: \.isNewline).joined(separator: " ")
        return HStack(alignment: .firstTextBaseline, spacing: 4) {
            (field.value.isEmpty ? Text("Empty") : Text(verbatim: protected && !shown ? VaultItem.hiddenMask : value))
                .font(protected && shown ? .secretValue : .body)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityLabel(protected && !shown ? Text("Hidden") : field.value.isEmpty ? Text("Empty") : Text(verbatim: value))
            if protected {
                RevealIconButton(name: field.key.localizedLowercase, revealed: Binding(
                    get: { revealedSources.contains(role) },
                    set: { if $0 { revealedSources.insert(role) } else { revealedSources.remove(role) } }
                ))
            }
        }
    }

    private var cancelButton: some View {
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
    }

    private var saveButton: some View {
        Button(saveTitle) {
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
