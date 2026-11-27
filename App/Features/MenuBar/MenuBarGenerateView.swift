#if os(macOS) && DEBUG
import SwiftUI

/// Every kind on one page, each with its value, its controls and its buttons. Nothing here is saved until the person saves it.
struct MenuBarGenerateView: View {
    @Bindable var model: MenuBarModel

    var body: some View {
        Form {
            Section {
                block(.strong, "Strong Password", noun: String(localized: "Password")) {}
            }
            Section {
                block(.characters, "Random Characters", noun: String(localized: "Password")) {
                    slider("Characters", range: GeneratorSettings.lengthRange, value: setting(.characters, \.length))
                    Toggle("Numbers", isOn: setting(.characters, \.includeNumber))
                    Toggle("Symbols", isOn: setting(.characters, \.includeSymbol))
                    hint(.characters, control: .length)
                }
            }
            Section {
                block(.words, "Words", noun: String(localized: "Password")) {
                    slider("Words", range: GeneratorSettings.wordRange, value: setting(.words, \.words))
                    Picker("Separator", selection: setting(.words, \.separator)) {
                        Text("Hyphen").tag(GeneratorSettings.Separator.hyphen)
                        Text("Space").tag(GeneratorSettings.Separator.space)
                        Text("Period").tag(GeneratorSettings.Separator.period)
                        Text("None").tag(GeneratorSettings.Separator.none)
                    }
                    Toggle("Capitals", isOn: setting(.words, \.capitalize))
                    Toggle("Number", isOn: setting(.words, \.includeNumber))
                    Toggle("Symbol", isOn: setting(.words, \.includeSymbol))
                    hint(.words, control: .words)
                }
            }
            Section {
                block(.pin, "PIN", noun: String(localized: "PIN")) {
                    slider("Digits", range: 4...12, value: Binding(get: { model.pinLength }, set: { model.pinLength = $0; model.regenerate(.pin) }))
                }
            }
            Section {
                block(.key, "Key", noun: String(localized: "Key")) {
                    slider("Bytes", range: 16...64, value: Binding(get: { model.keyBytes }, set: { model.keyBytes = $0; model.regenerate(.key) }))
                    Picker("Format", selection: Binding(get: { model.keyIsBase64 }, set: { model.keyIsBase64 = $0; model.regenerate(.key) })) {
                        Text("Hex").tag(false)
                        Text("Base64").tag(true)
                    }
                    .pickerStyle(.segmented)
                    Text("\(model.keyBytes * 8) random bits, for tokens and secrets.").foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .contentMargins(.top, 0, for: .scrollContent)
        .scrollContentBackground(.hidden)
    }

    private func setting<Value>(_ kind: MenuBarGenerated, _ path: WritableKeyPath<GeneratorSettings, Value>) -> Binding<Value> {
        Binding(get: { (model.settings[kind] ?? .recommended)[keyPath: path] },
                set: { new in
                    var settings = model.settings[kind] ?? .recommended
                    settings[keyPath: path] = new
                    model.settings[kind] = settings
                    model.regenerate(kind)
                    model.pill.clear()
                })
    }

    /// One kind's rows inside its section: the heading with its buttons, the value, the controls.
    @ViewBuilder
    private func block(_ kind: MenuBarGenerated, _ title: LocalizedStringKey, noun: String, @ViewBuilder controls: () -> some View) -> some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            Button("Copy") { model.copy(model.value(of: kind), as: noun) }
            Button("New") { model.regenerate(kind); model.pill.clear() }
        }
        Text(model.value(of: kind))
            .monospaced()
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        controls()
        if kind == .strong || kind == .characters || kind == .words {
            Button("Save as Login…") { model.startLogin(website: model.page.host ?? "", password: model.value(of: kind)) }
                .disabled(!model.hasVault)
        }
    }

    private func slider(_ label: LocalizedStringKey, range: ClosedRange<Int>, value: Binding<Int>) -> some View {
        LabeledContent(label) {
            HStack {
                Slider(value: Binding(get: { Double(value.wrappedValue) },
                                      set: { if Int($0.rounded()) != value.wrappedValue { value.wrappedValue = Int($0.rounded()) } }),
                       in: Double(range.lowerBound)...Double(range.upperBound)) { Text(label) }
                    .labelsHidden()
                Text("\(value.wrappedValue)").monospacedDigit().frame(minWidth: 24, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func hint(_ kind: MenuBarGenerated, control: GeneratorText.Control) -> some View {
        if let made = model.generated[kind], let hint = GeneratorText.hint(bits: made.bits, control: control) {
            Text(hint).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The Add tab: one panel for each type, then that type's form under Back.
struct MenuBarAddView: View {
    @Bindable var model: MenuBarModel

    var body: some View {
        if !model.formOpen {
            types
        } else {
            VStack(spacing: 0) {
                MenuBarTopLine(title: String(localized: "New \(model.addKind.unnamedTitle)"), help: "Esc", back: { model.leaveForm() }) {
                    Image(systemName: model.addKind.symbol).accessibilityHidden(true)
                }
                form.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var types: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
                ForEach(ItemKind.allCases) { kind in
                    Button { model.openForm(kind) } label: {
                        GroupBox {
                            VStack(spacing: 6) {
                                Image(systemName: kind.symbol).font(.title2).accessibilityHidden(true)
                                Text(kind.label)
                                if model.hasUnsaved(kind) { Text("Not saved yet").foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, minHeight: 76)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(MenuBarController.inset)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    @ViewBuilder
    private var form: some View {
        if model.addKind == .login {
            MenuBarNewLoginView(model: model)
        } else if let added = model.added {
            MenuBarMessage(title: "Saved to \(model.vaultName)") {
                if [.creditCard, .wifi, .keePassEntry].contains(added.kind), !added.secret.isEmpty {
                    Button(added.kind == .creditCard ? "Copy Card Number" : added.kind == .wifi ? "Copy Password" : "Copy Value") {
                        model.copyMain(of: added, modifiers: [])
                    }
                    .buttonStyle(.borderedProminent)
                }
                Button("Add Another") { model.addAnother() }
            }
        } else {
            MenuBarNewItemView(model: model)
        }
    }
}

/// The app's own new-item fields in the panel.
struct MenuBarNewItemView: View {
    @Bindable var model: MenuBarModel
    @State private var codeInput: VerificationCodeInput?

    var body: some View {
        let item = model.newItem
        Form {
            if let failure = model.saveFailure { Section { Text(failure.message) } }
            // `isNew` takes focus; not while kept on top, where typing could still go to the app in front.
            ItemFields(item: Binding(get: { model.newItem }, set: { model.newItem = $0 }), isNew: !model.keptOnTop, codeInput: $codeInput)
            Section {
            } footer: {
                // Under the fields, with no card of its own.
                HStack {
                    Text("Saved in \(model.vaultName).").foregroundStyle(.secondary)
                    Spacer()
                    Button("Save \(item.kind.unnamedTitle)") { Task { await model.saveNewItem() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!item.canSave || model.saving)
                }
                .font(.body)
            }
        }
        .formStyle(.grouped)
        // The app's item header adds 8 pt of its own; this starts the form as far under the top line as the others. A failure
        // message above it has no such header.
        .contentMargins(.top, model.saveFailure == nil ? -8 : 0, for: .scrollContent)
        .scrollContentBackground(.hidden)
    }
}

struct MenuBarNewLoginView: View {
    @Bindable var model: MenuBarModel
    @FocusState private var nameFocused: Bool

    var body: some View {
        let draft = model.draft
        if let waiting = model.waiting[model.vaultID] {
            MenuBarMessage(title: "You have an unsaved login") {
                Text("For \(DisplayText.safe(draft.name.isEmpty ? draft.website : draft.name, empty: String(localized: "no website yet"))) in \(model.vaultName).")
                    .foregroundStyle(.secondary)
                Button("Continue It") { model.waiting[model.vaultID] = nil }.buttonStyle(.borderedProminent)
                Button("Replace It") { model.draft = waiting; model.waiting[model.vaultID] = nil }
            }
        } else if draft.saved {
            MenuBarMessage(title: "Saved to \(model.vaultName)") {
                Button("Copy Password") { model.copy(draft.password, as: String(localized: "Password")) }.buttonStyle(.borderedProminent)
                Button("Add Another") { model.drafts[model.vaultID] = nil }
            }
        } else {
            form(draft)
        }
    }

    private func save(_ updating: UUID?) { Task { await model.saveLogin(updating: updating) } }

    private func form(_ draft: MenuBarDraft) -> some View {
        let matches = model.matches(draft)
        let exact = matches.first { $0.secret == draft.password }
        let same = exact ?? matches.first
        let named = !draft.name.trimmingCharacters(in: .whitespaces).isEmpty || !SiteMatch.normalizedHost(draft.website).isEmpty
        let can = !draft.password.isEmpty && named
        let label = same.map {
            let account = DisplayText.safe($0.account)
            return account.isEmpty ? $0.displayTitle : "\($0.displayTitle) (\(account))"
        } ?? ""

        func text(_ path: WritableKeyPath<MenuBarDraft, String>) -> Binding<String> {
            Binding(get: { model.draft[keyPath: path] }, set: { new in
                var draft = model.draft
                guard draft[keyPath: path] != new else { return }
                draft[keyPath: path] = new
                // Once something is typed the website stays put, so the draft never moves to another site.
                draft.websiteTyped = true
                model.draft = draft
            })
        }

        return Form {
            if let failure = model.saveFailure {
                Section {
                    LabeledContent(failure.message) {
                        if failure.retry { Button("Try Again") { save(failure.updating) }.disabled(!can || model.saving) }
                    }
                }
            }
            Section {
                TextField("Name", text: text(\.name), prompt: Text("Name or website"))
                    .focused($nameFocused)
                    // One click on the Login panel, then type.
                    // Not while kept on top: the panel may not have the keyboard, and typing would go to the app in front.
                    .onAppear { if !model.keptOnTop { nameFocused = true } }
                TextField("Website", text: text(\.website), prompt: Text("Optional"))
                TextField("Username", text: text(\.username), prompt: Text("Optional"))
                HStack {
                    if draft.shown {
                        TextField("Password", text: text(\.password), prompt: Text("Required")).monospaced()
                    } else {
                        SecureField("Password", text: text(\.password), prompt: Text("Required"))
                    }
                    Button { var draft = model.draft; draft.shown.toggle(); model.draft = draft } label: {
                        Image(systemName: draft.shown ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.borderless)
                    .help(draft.shown ? "Hide password" : "Show password")
                    .accessibilityLabel(draft.shown ? "Hide password" : "Show password")
                }
                Button("Use a Strong Password") {
                    var draft = model.draft
                    draft.password = PasswordGenerator.make(.recommended).value
                    draft.shown = true
                    draft.websiteTyped = true
                    model.draft = draft
                }
            } footer: {
                // What will happen and the buttons, under the fields with no card of their own.
                VStack(alignment: .leading, spacing: 10) {
                    Text("Saved in \(model.vaultName). Add a code, notes or other fields in Psss.").foregroundStyle(.secondary)
                    if !draft.password.isEmpty, !named { Text("Enter a name or a website.").foregroundStyle(.secondary) }
                    if exact != nil { Text("\(label) already has this password.") }
                    if same != nil, exact == nil, !draft.password.isEmpty {
                        Text("Replaces the password of \(label). The old one stays under Previous passwords.").foregroundStyle(.secondary)
                    }
                    HStack {
                        Spacer()
                        if let same, exact == nil {
                            Button("Save as New") { save(nil) }.disabled(!can || model.saving)
                            Button("Update \(label)") { save(same.id) }.buttonStyle(.borderedProminent).disabled(!can || model.saving)
                        } else {
                            Button("Save Login") { save(nil) }.buttonStyle(.borderedProminent).disabled(!can || exact != nil || model.saving)
                        }
                    }
                }
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .formStyle(.grouped)
        .contentMargins(.top, 0, for: .scrollContent)
        .scrollContentBackground(.hidden)
    }
}
#endif
