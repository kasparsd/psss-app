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
        .scrollContentBackground(.hidden)
    }

    private func setting<Value>(_ kind: MenuBarGenerated, _ path: WritableKeyPath<GeneratorSettings, Value>) -> Binding<Value> {
        Binding(get: { (model.settings[kind] ?? .recommended)[keyPath: path] },
                set: { new in
                    var settings = model.settings[kind] ?? .recommended
                    settings[keyPath: path] = new
                    model.settings[kind] = settings
                    model.regenerate(kind)
                    model.status = nil
                })
    }

    /// One kind's rows inside its section: the heading with its buttons, the value, the controls.
    @ViewBuilder
    private func block(_ kind: MenuBarGenerated, _ title: LocalizedStringKey, noun: String, @ViewBuilder controls: () -> some View) -> some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            Button("Copy") { model.copy(model.value(of: kind), as: noun) }
            Button("New") { model.regenerate(kind); model.status = nil }
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

struct MenuBarNewLoginView: View {
    @Bindable var model: MenuBarModel
    let openApp: () -> Void

    var body: some View {
        let draft = model.draft
        if let waiting = model.waiting[model.vaultID] {
            MenuBarMessage(title: "You have an unsaved login") {
                Text("For \(draft.name.isEmpty ? (draft.website.isEmpty ? String(localized: "no website yet") : draft.website) : draft.name) in \(model.vaultName).")
                    .foregroundStyle(.secondary)
                Button("Continue It") { model.waiting[model.vaultID] = nil }.buttonStyle(.borderedProminent)
                Button("Replace It") { model.draft = waiting; model.waiting[model.vaultID] = nil }
            }
        } else if draft.saved {
            MenuBarMessage(title: "Saved to \(model.vaultName)") {
                Button("Copy Password") { model.copy(draft.password, as: String(localized: "Password")) }.buttonStyle(.borderedProminent)
                Button("Show in Psss", action: openApp)
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
        let label = same.map { $0.account.isEmpty ? $0.displayTitle : "\($0.displayTitle) (\($0.account))" } ?? ""

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
                Text("Saved in \(model.vaultName). Add a code, notes or other fields in Psss.")
            }
            Section {
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
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }
}
#endif
