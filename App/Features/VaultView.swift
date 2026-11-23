import AuthenticationServices
import CoreImage.CIFilterBuiltins
import SwiftUI

private extension ItemKind {
    var label: LocalizedStringKey {
        switch self {
        case .login: "Login"
        case .creditCard: "Credit card"
        case .secureNote: "Secure note"
        case .keePassEntry: "Custom item"
        }
    }

    var symbol: String {
        switch self {
        case .login: "key"
        case .creditCard: "creditcard"
        case .secureNote: "note.text"
        case .keePassEntry: "doc"
        }
    }
}

private extension ItemTrait {
    var symbol: String {
        switch self {
        case .passkey: "person.badge.key"
        case .code: "lock.badge.clock"
        case .notes: "note.text"
        }
    }

    var badgeLabel: LocalizedStringKey {
        switch self {
        case .passkey: "Has a passkey"
        case .code: "Has a verification code"
        case .notes: "Has notes"
        }
    }
}

/// Where an alert is shown: the vault screen, or a sheet that is open over it.
fileprivate enum AlertSurface: Hashable { case vault, editor, setup }

/// The one alert of a surface. Titles, messages and buttons come from the vault screen, so they are the same on every surface.
private struct AlertSurfaceModifier: ViewModifier {
    let surface: AlertSurface
    let owner: VaultView

    func body(content: Content) -> some View {
        content.alert(owner.alertTitle,
                      isPresented: Binding(get: { owner.activeAlert != nil && owner.activeSurface == surface },
                                           set: { if !$0, owner.activeSurface == surface { owner.dropActiveAlert() } }),
                      presenting: owner.activeSurface == surface ? owner.activeAlert : nil) { kind in
            owner.alertActions(kind)
        } message: { kind in
            owner.alertMessage(kind)
        }
    }
}

/// Every alert of the vault screen. Only one is shown at a time.
private enum VaultAlert: Hashable {
    case conflict, editorRemoved, storeProblem, autoFillSettings, importProblem, importNotice, biometricOff, biometricOffer
}

private enum VaultCategory: Hashable {
    case recent
    case mostUsed
    case allItems
    case kind(ItemKind)
    case trait(ItemTrait)

    /// Where the item lives: usage views and kinds.
    static var choices: [Self] { [.recent, .mostUsed, .allItems] + ItemKind.allCases.map(Self.kind) }
    /// What the item has. Every row badge has a matching filter.
    static var traitChoices: [Self] { ItemTrait.allCases.map(Self.trait) }
    static var everyChoice: [Self] { choices + traitChoices }

    /// Usage views are scopes of "what I need now". Searching always looks across everything.
    var isUsageView: Bool { self == .recent || self == .mostUsed }

    var title: LocalizedStringKey {
        switch self {
        case .recent: "Recent"
        case .mostUsed: "Most used"
        case .allItems: "All items"
        case .kind(.login): "Logins"
        case .kind(.creditCard): "Credit cards"
        case .kind(.secureNote): "Secure notes"
        case .kind(.keePassEntry): "Custom items"
        case .trait(.passkey): "Passkeys"
        case .trait(.code): "Codes"
        case .trait(.notes): "With notes"
        }
    }

    var shortTitle: LocalizedStringKey {
        switch self {
        case .recent: "Recent"
        case .mostUsed: "Most used"
        case .allItems: "All"
        case .kind(.login): "Logins"
        case .kind(.creditCard): "Cards"
        case .kind(.secureNote): "Notes"
        case .kind(.keePassEntry): "Custom"
        case .trait(.passkey): "Passkeys"
        case .trait(.code): "Codes"
        case .trait(.notes): "With notes"
        }
    }

    var symbol: String {
        switch self {
        case .recent: "clock"
        case .mostUsed: "star"
        case .allItems: "tray.full"
        case .kind(let kind): kind.symbol
        case .trait(let trait): trait.symbol
        }
    }

    func includes(_ item: VaultItem) -> Bool {
        switch self {
        case .recent: item.lastUsed != nil
        case .mostUsed: item.useCount > 0
        case .allItems: true
        case .kind(let kind): item.kind == kind
        case .trait(let trait): item.traits.contains(trait)
        }
    }
}

struct VaultView: View {
    let store: any VaultStore
    @State private var items: [VaultItem]
    @AppStorage("vaultSource") private var vaultSource = ""
    @Environment(VaultSession.self) private var session
    @State private var storeProblem: String?
    @State private var conflict = false
    /// The write the vault file refused because it changed elsewhere, kept while the alert is up so Replace can repeat it.
    @State private var refusedWrite: (() throws -> Void)?
    /// What follows a successful write of that kind (closing the editor, the selection), run if Save My Change Anyway works.
    @State private var refusedFollowUp: (() -> Void)?
    @State private var changingPassword = false
    @State private var copyDocument: VaultCopy?

    init(store: any VaultStore) {
        self.store = store
        _items = State(initialValue: store.items())
    }
    @State private var confirmsReset = false
    @State private var offersBiometric = false
    @State private var importing = false
    @State private var importNotice: String?
    @State private var importProblem: String?
    @Environment(UnlockGate.self) private var gate
    @Environment(AutoFillStatus.self) private var autoFill
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var compactColumn: NavigationSplitViewColumn = .content
    @State private var compactPath: [VaultItem.ID] = []
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var category: VaultCategory? = .recent
    private var categorySelection: Binding<VaultCategory?> {
        Binding(get: { category }, set: { newCategory in
            if category != newCategory { selection = nil }
            category = newCategory
        })
    }
    @State private var selection: VaultItem.ID?
    @State private var search = ""
    @FocusState private var searchFocused: Bool
    @State private var didFocusOnLaunch = false
    @State private var editor: VaultItem?
    /// The open editor's item was removed elsewhere. The alert waits for the sheet to finish closing.
    @State private var editorItemRemoved = false
    @State private var showsEditorRemoved = false
    @State private var showsSetup = false
    @State private var wantsPasswordChange = false
    /// The alert on screen and the surface that shows it. There is only ever one of each, so an alert cannot be asked for on
    /// two surfaces at once. See `nextAlert` for the order of the ones waiting.
    @State fileprivate var activeAlert: VaultAlert?
    @State fileprivate var activeSurface: AlertSurface?
    /// The pending wait before an alert appears. Replaced by a newer request, cancelled when the view goes away.
    @State private var alertTask: Task<Void, Never>?
    @Environment(\.scenePhase) private var scenePhase

    /// A usage pill with nothing to show falls back to All, so a new vault never opens empty.
    private var activeCategory: VaultCategory {
        let chosen = category ?? .recent
        return chosen.isUsageView && !items.contains(where: chosen.includes) ? .allItems : chosen
    }

    private var isSearching: Bool { !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var results: [VaultItem] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let scope: VaultCategory = query.isEmpty || !activeCategory.isUsageView ? activeCategory : .allItems
        let matches = items.filter { item in
            scope.includes(item) && (query.isEmpty ||
                [item.title, item.website, item.account, item.displayTitle].contains { $0.localizedStandardContains(query) })
        }
        switch scope {
        case .recent:
            return Array(matches.sorted { ($0.lastUsed ?? .distantPast) > ($1.lastUsed ?? .distantPast) }.prefix(10))
        case .mostUsed:
            return Array(matches.sorted { $0.useCount > $1.useCount }.prefix(10))
        default:
            return matches.sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        }
    }

    private var usesStack: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    var body: some View {
        Group {
            if usesStack { stackLayout } else { splitLayout }
        }
        .passwordsImporter(isPresented: $importing, notice: $importNotice, problem: $importProblem) { added in
            try store.save(added)
            items = store.items()
            registerIdentities()
        }
        // One alert at a time, shown by the surface the action came from: the item editor or Setup while one of them is open,
        // otherwise this screen. The flags below say what is waiting; `nextAlert` picks by priority.
        .modifier(AlertSurfaceModifier(surface: .vault, owner: self))
        .onChange(of: nextAlert?.0) { presentNextAlert() }
        .onChange(of: nextAlert?.1) { presentNextAlert() }
        .onChange(of: activeAlert) { presentNextAlert() }
        .onChange(of: sheetIsOpen) { _, open in
            // An alert whose sheet has gone, or a vault alert under a sheet that opened, is not lost: its flag is still set, so it
            // is asked for again on the surface that is there now.
            if let surface = activeSurface, !isOpen(surface) { dropActiveAlert() }
            presentNextAlert()
        }
        .onChange(of: showsSetup) { _, _ in if let surface = activeSurface, !isOpen(surface) { dropActiveAlert() } }
        .onChange(of: editor?.id) { _, _ in if let surface = activeSurface, !isOpen(surface) { dropActiveAlert() } }
        .onChange(of: gate.isUnlocked) { _, _ in dropActiveAlert() }
        .onDisappear { alertTask?.cancel(); alertTask = nil }
        .task { if !store.isSample, session.biometricNotice == nil, session.shouldOfferBiometric { offersBiometric = true } }
        .sheet(isPresented: $changingPassword) {
            if let store = store as? KeePassVaultStore { ChangePasswordSheet(store: store, onReloaded: { adoptReloadedVault() },
                                                          onChangedElsewhere: { gate.lock(notice: Self.changedElsewhereNotice) }) }
        }
        .focusedSceneValue(\.newItem, { kind in editor = VaultItem(kind: kind) })
        .task { if store.isSample { VaultIdentities.remove() } else { registerIdentities() } }
        // AutoFill has just been found on, by the system's prompt or on coming back from Settings. Logins saved while it was
        // off were never sent to the system, so they are sent now, without waiting for the next unlock.
        .onChange(of: autoFill.reading) { old, new in if new == .on, old != .on { registerIdentities(knownEnabled: true) } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { reloadIfChangedOnDisk() }
        }
        .sheet(item: $editor, onDismiss: {
            if editorItemRemoved { editorItemRemoved = false; showsEditorRemoved = true }
        }) { item in
            ItemEditor(item: item, onSave: save, onKeepDraft: keepDraft,
                       onDelete: items.contains { $0.id == item.id } ? { delete(item.id) } : nil)
                .modifier(AlertSurfaceModifier(surface: .editor, owner: self))
        }
        .sheet(isPresented: $showsSetup, onDismiss: {
            // Change Vault Password opens its own sheet, but only once this one has gone.
            if wantsPasswordChange { wantsPasswordChange = false; changingPassword = true }
        }) { setupSheet.modifier(AlertSurfaceModifier(surface: .setup, owner: self)) }
    }

    /// Everything waiting, in the order it is shown: a decision about the vault file first, then what was lost, then problems,
    /// then information, and the offer last.
    private var waitingAlerts: [VaultAlert] {
        var waiting: [VaultAlert] = []
        if conflict { waiting.append(.conflict) }
        if showsEditorRemoved { waiting.append(.editorRemoved) }
        if storeProblem != nil { waiting.append(.storeProblem) }
        if autoFill.settingsDidNotOpen { waiting.append(.autoFillSettings) }
        if importProblem != nil { waiting.append(.importProblem) }
        if importNotice != nil { waiting.append(.importNotice) }
        if session.biometricNotice != nil { waiting.append(.biometricOff) }
        if offersBiometric { waiting.append(.biometricOffer) }
        return waiting
    }

    private var sheetIsOpen: Bool { showsSetup || changingPassword || editor != nil || copyDocument != nil }

    private func isOpen(_ surface: AlertSurface) -> Bool {
        switch surface {
        case .vault: !sheetIsOpen
        case .editor: editor != nil
        case .setup: showsSetup
        }
    }

    /// Where an alert is shown now, or nil when it has to wait. Saving can be refused from inside the editor or Setup, so
    /// those two alerts belong to the sheet that is open (the editor first: it can open from nowhere else but the list).
    /// Everything else belongs to this screen, and waits while any sheet is open or closing.
    private func surface(for alert: VaultAlert) -> AlertSurface? {
        if alert == .conflict || alert == .storeProblem || alert == .autoFillSettings {
            if editor != nil { return .editor }
            if showsSetup { return .setup }
        }
        return sheetIsOpen ? nil : .vault
    }

    /// The first waiting alert that has a surface now. A blocked one does not hold back the ones behind it.
    private var nextAlert: (VaultAlert, AlertSurface)? {
        for alert in waitingAlerts { if let surface = surface(for: alert) { return (alert, surface) } }
        return nil
    }

    fileprivate func dropActiveAlert() {
        activeAlert = nil
        activeSurface = nil
    }

    private func presentNextAlert() {
        alertTask?.cancel()
        alertTask = nil
        guard activeAlert == nil, gate.isUnlocked, let (_, surface) = nextAlert else { return }
        alertTask = Task { @MainActor in
            // Lets a closing sheet, the code sheet inside the editor, or the previous alert finish leaving first. A request for
            // a sheet's own alert waits only a moment: the sheet is already on screen.
            try? await Task.sleep(for: .milliseconds(surface == .vault ? 450 : 250))
            guard !Task.isCancelled, activeAlert == nil, gate.isUnlocked, let (next, surface) = nextAlert else { return }
            activeSurface = surface
            activeAlert = next
        }
    }

    fileprivate var alertTitle: LocalizedStringKey {
        let faceID = session.biometry?.label ?? BiometryKind.nameForMessages
        switch activeAlert {
        case .conflict: return "The vault changed elsewhere"
        case .editorRemoved: return "This item was removed"
        case .storeProblem: return "Could not save"
        case .autoFillSettings: return LocalizedStringKey(AutoFillCopy(device: .current).settingsFailedTitle)
        case .importProblem: return "Could not import"
        case .importNotice: return "Imported"
        case .biometricOff: return "\(faceID) is off"
        case .biometricOffer: return "Unlock \(store.title) with \(faceID)?"
        case nil: return ""
        }
    }

    @ViewBuilder fileprivate func alertActions(_ kind: VaultAlert) -> some View {
        switch kind {
        case .conflict:
            Button("Reload Vault") { conflict = false; refusedWrite = nil; refusedFollowUp = nil; reloadFromDisk() }
            Button("Save My Change Anyway", role: .destructive) { conflict = false; overwrite() }
            Button("Cancel", role: .cancel) { conflict = false; refusedWrite = nil; refusedFollowUp = nil }
        case .editorRemoved:
            Button("OK") { showsEditorRemoved = false }
        case .storeProblem:
            Button("OK") { storeProblem = nil }
        case .autoFillSettings:
            Button("OK") { autoFill.settingsDidNotOpen = false }
        case .importProblem:
            Button("OK") { importProblem = nil }
        case .importNotice:
            Button("Open vault") { importNotice = nil; items = store.items(); registerIdentities() }
        case .biometricOff:
            Button("OK") { session.biometricNotice = nil }
        case .biometricOffer:
            Button("Use \(session.biometry?.label ?? "Face ID")") {
                offersBiometric = false
                do { try session.enableBiometric() } catch { storeProblem = String(localized: "\(session.biometry?.label ?? "Face ID") could not be turned on for this vault.") }
            }
            Button("Not Now", role: .cancel) { offersBiometric = false; session.declineBiometricOffer() }
        }
    }

    @ViewBuilder fileprivate func alertMessage(_ kind: VaultAlert) -> some View {
        switch kind {
        case .conflict:
            Text("The vault file was changed by another app or device since Psss last read it. Reload shows that version and discards the change you just made. Save My Change Anyway writes the vault as Psss has it, with your change, over the file; the version it replaces is kept as a backup copy on this device.")
        case .editorRemoved:
            Text("It was removed on another device or in another app, so the editor was closed. Changes you had not saved were not kept.")
        case .storeProblem: Text(storeProblem ?? "")
        case .autoFillSettings: Text(AutoFillCopy(device: .current).settingsFailedMessage)
        case .importProblem: Text(importProblem ?? "")
        case .importNotice: Text(importNotice ?? "")
        case .biometricOff: Text(session.biometricNotice ?? "")
        case .biometricOffer:
            Text("\(session.biometry?.label ?? "Face ID") opens this vault on this device only. Your vault password still works, and you need it if you change \(session.biometry?.label ?? "Face ID"). Turn it off any time in Setup.")
        }
    }

    /// A new vault has nothing to select, so there is no list, no detail pane and no search: just the ways to fill it.
    private var emptyVault: some View {
        ScrollView {
            VStack(spacing: 24) {
                // A new vault is where a new person learns about AutoFill, so the card sits above the empty state.
                if showsAutoFillCard { AutoFillCard(vault: autoFillVault) }
                VStack(spacing: 8) {
                    Image(systemName: "tray").font(.system(size: 40)).foregroundStyle(.secondary).accessibilityHidden(true)
                    Text("Your vault is empty").font(.title2.weight(.semibold))
                    Text("Add passwords yourself, bring them from another app, or let Psss offer to save the ones you sign in with.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                VStack(spacing: 10) {
                    emptyChoice("Add a login", "plus", prominent: true) { editor = VaultItem(kind: .login) }
                    emptyChoice("Add a credit card", "creditcard") { editor = VaultItem(kind: .creditCard) }
                    emptyChoice("Add a secure note", "note.text") { editor = VaultItem(kind: .secureNote) }
                    emptyChoice("Import from Apple Passwords", "square.and.arrow.down") { importing = true }
                }
                // While the card shows, or AutoFill is on, the short line. Off with the card hidden, the line that says to turn it on.
                Group {
                    if autoFill.reminder(for: autoFillVault).emptyVaultOffersSaving {
                        Text("Sign in to a site in Safari and choose Save in Psss.")
                    } else {
                        Text("To save passwords and passkeys from your browser, turn on Psss in Settings, AutoFill & Passwords. Then sign in to a site and choose Save in Psss.")
                    }
                }
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 420)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .background(.background)
    }

    @ViewBuilder
    private func emptyChoice(_ title: LocalizedStringKey, _ symbol: String, prominent: Bool = false,
                             action: @escaping () -> Void) -> some View {
        let label = Label(title, systemImage: symbol).frame(maxWidth: .infinity, alignment: .leading)
        if prominent {
            Button(action: action) { label }.buttonStyle(.borderedProminent).controlSize(.large)
        } else {
            Button(action: action) { label }.buttonStyle(.bordered).controlSize(.large)
        }
    }

    /// iPhone: the pills already switch categories, so there is no separate Vault screen to go back to.
    @ViewBuilder
    private var stackLayout: some View {
        #if os(iOS)
        NavigationStack(path: $compactPath) {
            itemResults(results)
                .navigationDestination(for: VaultItem.ID.self) { id in
                    if let item = items.first(where: { $0.id == id }) {
                        ItemDetail(item: item, edit: { editor = item }, used: { markUsed(item.id) })
                            .id(item.id)
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Setup", systemImage: "gearshape") { showsSetup = true }
                            .labelStyle(.iconOnly)
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) {
                        newItemMenu(expanded: false)
                    }
                }
        }
        #endif
    }

    private func sidebarRow(_ scope: VaultCategory) -> some View {
        NavigationLink(value: scope) {
            Label(scope.title, systemImage: scope.symbol)
                .badge(items.count(where: scope.includes))
        }
    }

    private var splitLayout: some View {
        let visibleItems = results
        return NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            List(selection: categorySelection) {
                Section(store.title) {
                    ForEach(VaultCategory.choices, id: \.self, content: sidebarRow)
                }
                Section("Filters") {
                    ForEach(VaultCategory.traitChoices, id: \.self, content: sidebarRow)
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Vault")
            .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        } content: {
            itemResults(visibleItems)
                .navigationSplitViewColumnWidth(min: 380, ideal: 460, max: 560)
        } detail: {
            if let item = visibleItems.first(where: { $0.id == selection }) {
                ItemDetail(item: item, edit: { editor = item }, used: { markUsed(item.id) })
                    .id(item.id)
            } else if items.isEmpty {
                // Nothing exists to choose, so the detail column stays quiet.
                Color.clear
            } else {
                ContentUnavailableView("Choose an item", systemImage: "lock")
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var setupSheet: some View {
            NavigationStack {
                Form {
                    if let keePass = store as? KeePassVaultStore {
                        Section("Vault") {
                            LabeledContent("Name", value: keePass.title)
                            LabeledContent("Location", value: keePass.reference.managed
                                ? String(localized: "On this device") : keePass.reference.fileName)
                            Text("A KeePass file, encrypted with your vault password.")
                            DisclosureGroup("Technical details") {
                                LabeledContent("Format", value: keePass.formatLabel)
                                LabeledContent("Encryption", value: keePass.kdfSummary)
                            }
                            if let modified = keePass.lastModified {
                                LabeledContent("Modified", value: modified.formatted(date: .abbreviated, time: .shortened))
                            }
                            LabeledContent("Items", value: items.count.formatted())
                            Button("Save a Copy…") { copyDocument = (try? VaultFiles.read(keePass.url)).map(VaultCopy.init) }
                            Button("Change Vault Password…") { wantsPasswordChange = true; showsSetup = false }
                            if let biometry = session.biometry {
                                Toggle("Unlock with \(biometry.label)", isOn: Binding(
                                    get: { session.reference?.biometricUnlock == true },
                                    set: { on in
                                        if on { do { try session.enableBiometric() } catch { storeProblem = String(localized: "\(biometry.label) could not be turned on for this vault.") } }
                                        else { session.disableBiometric() }
                                    }))
                            }
                        }
                    } else {
                        Section("Vaults") {
                            Text("Open a KeePass vault")
                            Text("Import from 1Password")
                            Text("Create a local or iCloud vault")
                        }
                    }
                    Section {
                        Picker(selection: $lockTiming) {
                            ForEach(LockTiming.allCases) { Text($0.title).tag($0.rawValue) }
                        } label: {
                            Text("Lock")
                        }
                        Button("Lock Now") {
                            showsSetup = false
                            gate.lock()
                        }
                    } header: {
                        Text("Security")
                    } footer: {
                        Text(store.isSample
                             ? "Psss unlocks with Face ID, Touch ID or your device passcode. AutoFill always asks."
                             : "Psss asks for the vault password each time it unlocks, or uses Face ID or Touch ID if you turn it on.")
                    }
                    AutoFillSetupSection()
                    Section {
                        Button("Start Over…", role: .destructive) {
                            confirmsReset = true
                        }
                    } header: {
                        Text("Reset")
                    } footer: {
                        Text(store.isSample ? "Shows the welcome screen again. Changes you make in the sample vault are not saved: they are gone when Psss locks or quits."
                             : (store as? KeePassVaultStore)?.reference.managed == true
                             ? "Deletes this vault from this device and shows the welcome screen again."
                             : "Forgets this vault and shows the welcome screen again. The file stays where it is.")
                    }
                }
                .formStyle(.grouped)
                // The exporter belongs to the sheet that asks for it: the vault screen is busy presenting this sheet.
                .fileExporter(isPresented: Binding(get: { copyDocument != nil }, set: { if !$0 { copyDocument = nil } }),
                              document: copyDocument, contentType: .keePassVault,
                              defaultFilename: store.title) { _ in copyDocument = nil }
                .confirmationDialog("Start over?", isPresented: $confirmsReset, titleVisibility: .visible) {
                    Button(resetButtonTitle, role: .destructive) {
                        VaultIdentities.remove()
                        session.forget()
                        showsSetup = false
                        vaultSource = ""
                    }
                } message: {
                    Text(resetMessage)
                }
                .navigationTitle("Vault setup")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showsSetup = false }
                    }
                }
            }
            .modifier(SheetSize())
    }

    private var resetButtonTitle: LocalizedStringKey {
        if store.isSample { "Start Over" }
        else if (store as? KeePassVaultStore)?.reference.managed == true { "Delete Vault and Start Over" }
        else { "Forget Vault and Start Over" }
    }

    private var resetMessage: LocalizedStringKey {
        if store.isSample { "The sample vault closes and the welcome screen shows again. Nothing from it was saved on this device." }
        else if (store as? KeePassVaultStore)?.reference.managed == true {
            "The vault and its backups are deleted from this device. Without another copy of the file, your logins are gone. This cannot be undone."
        } else { "Psss stops using this vault. The file is not deleted and you can open it again." }
    }

    /// The vault the AutoFill reminder is about. The sample vault registers no logins, so it never shows the card.
    private var autoFillVault: AutoFillVault { store.isSample ? .sample : .real }

    private var showsAutoFillCard: Bool { autoFill.reminder(for: autoFillVault).display != .nothing }

    /// The card is the first row of the list, so it scrolls away with it and never covers a row. An empty vault shows it
    /// above its own text instead, and a search or a filter with nothing to list has no room for it.
    @ViewBuilder
    private func autoFillRow(_ results: [VaultItem]) -> some View {
        if showsAutoFillCard, !results.isEmpty, !isSearching {
            AutoFillCard(vault: autoFillVault)
                #if os(iOS)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                #else
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                #endif
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
    }

    private func itemResults(_ results: [VaultItem]) -> some View {
        Group {
            if usesStack {
                // A stack pushes through its links, so the list must not also track a selection.
                List { autoFillRow(results); ForEach(results) { row($0) } }
            } else {
                List(selection: $selection) { autoFillRow(results); ForEach(results) { row($0) } }
            }
        }
        #if os(iOS)
        // HIG: touch targets are at least 44 x 44 pt.
        .environment(\.defaultMinListRowHeight, 44)
        #else
        .environment(\.defaultMinListRowHeight, 32)
        #endif
        #if os(macOS)
        .listStyle(.inset)
        #else
        .listStyle(.plain)
        #endif
        .overlay {
            if results.isEmpty {
                if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if items.isEmpty {
                        emptyVault
                    } else {
                        ContentUnavailableView("No items", systemImage: "tray")
                    }
                } else {
                    ContentUnavailableView {
                        Label("No results for “\(search)”", systemImage: "magnifyingglass")
                    } description: {
                        Text("Check the spelling, or add it now.")
                    } actions: {
                        Button("Add “\(search)” as a login") {
                            let text = search.trimmingCharacters(in: .whitespacesAndNewlines)
                            // Something that looks like a domain becomes the website, anything else a name.
                            if text.contains("."), !text.contains(" ") {
                                editor = VaultItem(kind: .login, website: text)
                            } else {
                                editor = VaultItem(kind: .login, title: text)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .overlay(alignment: .bottom) { AutoFillHiddenNotice() }
        .searchable(text: $search, prompt: "Search")
        .searchFocused($searchFocused)
        #if os(iOS)
        // Keep the title and the New button on screen while search is active.
        .searchPresentationToolbarBehavior(.avoidHidingContent)
        #endif
        #if os(iOS)
        .textInputAutocapitalization(.never)
        #endif
        .autocorrectionDisabled()
        .onSubmit(of: .search) {
            // Return opens the top result.
            if let first = results.first {
                selection = first.id
                compactColumn = .detail
                compactPath = [first.id]
            }
        }
        .task {
            // Only on launch: returning from an item must not pop the keyboard and hide the actions.
            guard !didFocusOnLaunch else { return }
            didFocusOnLaunch = true
            // An empty vault shows its actions, and the keyboard would cover them.
            if !items.isEmpty {
                #if os(macOS)
                // Typing finds an item at once on a Mac. On iPhone and iPad it would open the keyboard uninvited.
                searchFocused = true
                #endif
            } else {
                // macOS may focus the search field by itself; with nothing to search, let go of it.
                try? await Task.sleep(for: .milliseconds(150))
                searchFocused = false
            }
        }
        .navigationTitle(activeCategory.title)
        #if os(macOS)
        .navigationSubtitle("\(results.count) items")
        #endif
        .safeAreaInset(edge: .top, spacing: 0) {
            // The sidebar already filters on Mac and iPad. Pills fill in on iPhone and when the sidebar is hidden.
            if usesStack || columns != .all { pills }
        }
        #if os(iOS)
        // iOS 26 and later: a floating glass search field at the bottom, within thumb reach.
        .toolbar {
            DefaultToolbarItem(kind: .search, placement: .bottomBar)
        }
        #endif
        // Mac and iPad keep Setup and a labeled New in the window toolbar, where Notes and Mail put compose.
        .toolbar {
            if !usesStack {
                ToolbarItem(placement: .primaryAction) {
                    newItemMenu(expanded: false)
                }
                ToolbarSpacer(.fixed, placement: .primaryAction)
                ToolbarItem(placement: .primaryAction) {
                    // The same gear as on iPhone. Lock Now lives in Setup and in the Psss menu (⌘L).
                    Button("Setup", systemImage: "gearshape") { showsSetup = true }
                        .labelStyle(.iconOnly)
                }
            }
        }
    }

    /// Filters are always on screen as pills, one tap each. Usage pills lead.
    /// The row fades out at its trailing edge to show that it scrolls.
    private var pills: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(VaultCategory.everyChoice, id: \.self) { scope in
                        pill(scope)
                    }
                }
                .padding(.leading)
                .padding(.trailing, 12)
                .padding(.vertical, 8)
            }
            .scrollClipDisabled()
            .mask(fadeMask)
        }
    }

    private var fadeMask: some View {
        HStack(spacing: 0) {
            Color.black
            #if os(iOS)
            LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                .frame(width: 24)
            #endif
        }
    }

    @ViewBuilder
    private func pill(_ scope: VaultCategory) -> some View {
        // While searching from a usage pill the results span everything, so All is the honest highlight.
        let shown: VaultCategory = isSearching && activeCategory.isUsageView ? .allItems : activeCategory
        let selected = shown == scope
        let button = Button {
            categorySelection.wrappedValue = scope
        } label: {
            if scope.isUsageView {
                // A tight HStack: Label's default icon spacing is too wide inside a capsule.
                HStack(spacing: 4) {
                    Image(systemName: scope.symbol)
                    Text(scope.shortTitle)
                }
            } else {
                Text(scope.shortTitle)
            }
        }
        .buttonBorderShape(.capsule)
        .controlSize(.regular)
        .accessibilityAddTraits(selected ? .isSelected : [])
        if selected {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    /// The most common action stays visible and labeled. The type choice appears only after tapping it.
    private func newItemMenu(expanded: Bool) -> some View {
        Menu {
            ForEach(ItemKind.allCases) { kind in
                Button {
                    editor = VaultItem(kind: kind)
                } label: {
                    Label(kind.label, systemImage: kind.symbol)
                }
            }
        } label: {
            if expanded {
                Label("Add item", systemImage: "plus").frame(maxWidth: .infinity)
            } else {
                // Navigation and bottom bars drop the title from a Label, so spell it out.
                HStack(spacing: 4) {
                    Image(systemName: "plus")
                    Text("Add")
                }
            }
        }
    }

    private func row(_ item: VaultItem) -> some View {
        NavigationLink(value: item.id) {
            ItemRow(item: item)
        }
        #if os(iOS)
        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        #else
        .listRowInsets(EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 8))
        #endif
    }

    /// Tells the system which sites have logins. The sample vault registers none: nothing in it may ever be offered by AutoFill.
    /// `knownEnabled` is for the moment AutoFill has just been found on: the logins go to the system at once.
    private func registerIdentities(knownEnabled: Bool = false) {
        guard !store.isSample else { return }
        if knownEnabled { SharedVault.registerIdentities(for: items, knownEnabled: true) } else { VaultIdentities.register(for: items) }
    }

    /// Picks up what the AutoFill extension or another app wrote to the vault file while this view was in the background.
    /// If the password changed elsewhere, the kept key no longer opens the file, so the vault locks and asks again.
    private func reloadIfChangedOnDisk() {
        guard let store = store as? KeePassVaultStore else { return }
        Task {
            do {
                if try await store.reloadIfChanged() { adoptReloadedVault() }
            } catch KDBXError.wrongCredentials {
                gate.lock(notice: Self.changedElsewhereNotice)
            } catch {
                // The file is missing or unreadable for now. Keep what is open; the next save reports the problem.
            }
        }
    }

    private func markUsed(_ id: VaultItem.ID) {
        if let index = items.firstIndex(where: { $0.id == id }) {
            items[index].lastUsed = .now
            items[index].useCount += 1
            store.markUsed(id)
        }
    }

    /// Runs a write, then `followUp` when it worked. When it throws, the store has put the vault back to what the file holds, so
    /// the list and the AutoFill identities are refreshed from it; a write refused because the file changed elsewhere is kept,
    /// with its follow-up, for Save My Change Anyway. Returns whether it worked.
    @discardableResult
    private func attempt(_ write: @escaping () throws -> Void, then followUp: (() -> Void)? = nil) -> Bool {
        do { try write(); refusedWrite = nil; refusedFollowUp = nil; followUp?(); return true } catch VaultStoreError.changedOnDisk {
            refusedWrite = write
            refusedFollowUp = followUp
            conflict = true
        } catch {
            storeProblem = (error as? VaultStoreError)?.message ?? (error as? KDBXError)?.message ?? error.localizedDescription
        }
        items = store.items()
        registerIdentities()
        return false
    }

    private func reloadFromDisk() {
        guard let store = store as? KeePassVaultStore else { return }
        Task {
            do { try await store.reload(); adoptReloadedVault() }
            catch KDBXError.wrongCredentials {
                gate.lock(notice: Self.changedElsewhereNotice)
            } catch { storeProblem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? error.localizedDescription }
        }
    }

    private static let changedElsewhereNotice = String(localized: "The vault was changed by another app or device and needs your vault password again.")

    /// Shows the reloaded vault. An item that is gone from it loses its selection, detail and editor.
    private func adoptReloadedVault() {
        let before = Set(items.map(\.id))
        items = store.items()
        registerIdentities()
        let now = Set(items.map(\.id))
        func gone(_ id: VaultItem.ID) -> Bool { before.contains(id) && !now.contains(id) }
        if let selected = selection, gone(selected) { selection = nil }
        if compactPath.contains(where: gone) { compactPath = [] }
        // A removed item that is open in detail just leaves the list (above). An open editor holds a draft, so say it is lost.
        if let open = editor, gone(open.id) { editorItemRemoved = true; editor = nil }
    }

    /// Repeats the refused change now, with the check for a changed file skipped, on the vault as the store holds it (the last
    /// version Psss read, or the reloaded one), and then does what a successful write of that kind does.
    private func overwrite() {
        guard let store = store as? KeePassVaultStore, let write = refusedWrite else { return }
        let followUp = refusedFollowUp
        refusedWrite = nil
        refusedFollowUp = nil
        // Every follow-up registers the AutoFill identities itself, so this does so once, only when there is none.
        attempt({ try store.overwriting(write) }, then: {
            items = store.items()
            if let followUp { followUp() } else { registerIdentities() }
        })
    }

    private func delete(_ id: VaultItem.ID) {
        // A refused delete leaves the selection and the open detail alone: the item is still there.
        attempt({ try store.delete(id) }, then: {
            items = store.items()
            registerIdentities()
            selection = nil
            compactPath = []
            editor = nil
        })
    }

    /// Stores an item as it is while its editor stays open.
    private func keepDraft(_ item: VaultItem) {
        attempt({ try store.save([item]) }, then: { showSaved(item) })
    }

    private func save(_ item: VaultItem) {
        // A refused save leaves the editor open with the person's text, and the list as the file holds it.
        attempt({ try store.save([item]) }, then: {
            showSaved(item)
            search = ""
            if !activeCategory.includes(item) { category = .kind(item.kind) }
            selection = item.id
            compactColumn = .detail
            editor = nil
        })
    }

    private func showSaved(_ item: VaultItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        } else {
            items.append(item)
        }
        registerIdentities()
    }
}

/// One line per item: icon, name and login. The name is capped so the login always stays visible.
private struct ItemRow: View {
    let item: VaultItem
    @Environment(\.dynamicTypeSize) private var typeSize

    /// One line per row on every platform. The Mac list column is given enough width for it.
    private static var stacked: Bool { false }

    private var secondary: Text {
        item.account.isEmpty ? Text(item.kind.label) : Text(verbatim: item.account)
    }

    /// The name, then one quiet glyph per characteristic. Glyphs never truncate; the name does.
    private var titleLine: some View {
        HStack(spacing: 6) {
            Text(verbatim: item.displayTitle).lineLimit(1)
            ForEach(item.traits, id: \.self) { trait in
                Image(systemName: trait.symbol)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .layoutPriority(1)
                    .accessibilityLabel(trait.badgeLabel)
            }
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            ItemIcon(item: item)
                // The separator starts where the text starts, the same on every row and every platform.
                .alignmentGuide(.listRowSeparatorLeading) { $0[.trailing] + 12 }
            if typeSize.isAccessibilitySize || Self.stacked {
                VStack(alignment: .leading, spacing: 2) {
                    titleLine
                    secondary.foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
            } else {
                TitleAndLogin {
                    titleLine
                    secondary
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }
}

/// Gives the name the space it needs, but never takes more than 60% once the login would be squeezed out.
private struct TitleAndLogin: Layout {
    var spacing: CGFloat = 10

    private func widths(_ available: CGFloat?, _ subviews: Subviews) -> (CGFloat, CGFloat) {
        let title = subviews[0].sizeThatFits(.unspecified).width
        let login = subviews[1].sizeThatFits(.unspecified).width
        guard let available else { return (title, login) }
        let room = available - spacing
        if title + login <= room { return (title, login) }
        let loginShare = min(login, room * 0.4)
        let titleWidth = min(title, room - loginShare)
        return (titleWidth, min(login, room - titleWidth))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let (title, login) = widths(proposal.width, subviews)
        let height = max(subviews[0].sizeThatFits(.init(width: title, height: nil)).height,
                         subviews[1].sizeThatFits(.init(width: login, height: nil)).height)
        return CGSize(width: proposal.width ?? title + login + spacing, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (title, login) = widths(bounds.width, subviews)
        subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading,
                          proposal: .init(width: title, height: bounds.height))
        subviews[1].place(at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing,
                          proposal: .init(width: login, height: bounds.height))
    }
}

/// A site monogram today and the favicon slot later. Colour comes from the site so it is stable and offline.
private struct ItemIcon: View {
    let item: VaultItem
    var size: CGFloat = 30

    private var tint: Color {
        guard item.kind == .login else { return .gray }
        let seed = (item.website.isEmpty ? item.displayTitle : item.website).unicodeScalars.reduce(UInt32(7)) { $0 &* 31 &+ $1.value }
        return Color(hue: Double(seed % 360) / 360, saturation: 0.5, brightness: 0.72)
    }

    private var brand: BrandIcons.Brand? {
        switch item.kind {
        case .login: BrandIcons.brand(forWebsite: item.website)
        case .creditCard: CardBrand(number: item.secret).map { BrandIcons.Brand(asset: $0.asset, color: $0.color, glyph: .white) }
        default: nil
        }
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.27, style: .continuous).fill(brand?.color ?? tint)
            if let brand {
                Image(brand.asset)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size * 0.56, height: size * 0.56)
                    .foregroundStyle(brand.glyph)
            } else if item.kind == .login, let letter = item.displayTitle.first {
                Text(String(letter).uppercased())
                    .font(.system(size: size * 0.53, weight: .semibold, design: .rounded))
            } else {
                Image(systemName: item.kind.symbol).font(.system(size: size * 0.47, weight: .semibold))
            }
        }
        .foregroundStyle(.white)
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct ItemDetail: View {
    let item: VaultItem
    let edit: () -> Void
    let used: () -> Void
    @State private var revealed: Set<FieldID> = []
    @State private var copied: FieldID?
    @State private var showsQR = false

    private enum FieldID: Hashable { case website, account, expiry, secret, code, notes, totpSecret, totpLink }

    private var secretLabel: LocalizedStringKey {
        switch item.kind {
        case .login: "Password"
        case .creditCard: "Card number"
        case .keePassEntry: "Value"
        case .secureNote: "Secret"
        }
    }

    private var accountLabel: LocalizedStringKey { item.kind == .creditCard ? "Cardholder" : "Username" }

    var body: some View {
        Form {
            Section {
                if !item.account.isEmpty {
                    field(.account, accountLabel, item.account)
                }
                if !item.secret.isEmpty {
                    field(.secret, secretLabel, item.secret, hidden: true)
                }
                // In the order the fields are used: username, password, then the code, all in one card.
                if !item.otpSecret.isEmpty, item.kind == .login { codeRow }
                if !item.expiry.isEmpty { field(.expiry, "Expiry", item.expiry) }
                if !item.website.isEmpty { field(.website, "Website", item.website) }
                if !item.notes.isEmpty {
                    field(.notes, "Notes", item.notes)
                }
            } header: {
                // Every platform leads with the icon and name, as Apple Passwords does.
                VStack(spacing: 8) {
                    ItemIcon(item: item, size: 64)
                    Text(item.displayTitle)
                        .font(.title.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .textCase(nil)
                .padding(.vertical, 8)
            } footer: {
                #if os(macOS)
                Text("Click a row to copy it. Copied values leave the clipboard after 60 seconds.")
                #else
                Text("Tap a row to copy it. Copied values leave the clipboard after 60 seconds.")
                #endif
            }
            if let url = item.totpSetupURL {
                Section {
                    field(.totpSecret, "Setup key", item.otpSecret, hidden: true)
                    Button("Copy setup link", systemImage: "link") { copy(url, as: .totpLink) }
                    Button("Show QR code", systemImage: "qrcode") { showsQR = true }
                } header: {
                    Text("Verification code setup")
                } footer: {
                    Text("To move this verification code to another authenticator, use the setup key, the link or the QR code. Anyone who has one of them can make your codes, so treat them like a password.")
                }
            }
            if let passkey = item.passkey {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Passkey").foregroundStyle(.secondary)
                            Text("Saved \(passkey.created.formatted(date: .abbreviated, time: .omitted)) for \(passkey.rpID)")
                        }
                    } icon: {
                        Image(systemName: "person.badge.key")
                    }
                } footer: {
                    Text("Sign in on \(passkey.rpID) with this passkey. It never leaves your vault.")
                }
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $showsQR) {
            if let url = item.totpSetupURL { TOTPQRSheet(url: url, title: item.displayTitle) }
        }
        #if os(macOS)
        .navigationTitle(item.displayTitle)
        #else
        // The header already carries the name, so the bar stays quiet instead of repeating it.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
        // A labeled Edit in the toolbar of the detail column, as in Passwords (Mac) and Contacts (iOS).
        .toolbar {
            // Text, not a Label: iOS toolbars would reduce a Label to an icon-only circle.
            Button(action: edit) { Text("Edit") }
                .buttonStyle(.borderedProminent)
            .keyboardShortcut("e", modifiers: .command)
        }
        .overlay(alignment: .bottom) {
            if copied != nil {
                Label("Copied", systemImage: "checkmark.circle.fill")
                    .fontWeight(.semibold)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .animation(.snappy, value: copied)
        #if os(iOS)
        .sensoryFeedback(.success, trigger: copied)
        #endif
    }

    private var codeRow: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
                let remaining = TOTP.secondsRemaining(period: item.otpSettings.period, at: context.date)
                let code = TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) ?? "------"
                Button {
                    copy(code, as: .code)
                } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Verification code").foregroundStyle(.secondary)
                            Text(TOTP.grouped(code))
                                .font(.system(.largeTitle, design: .monospaced).weight(.medium))
                                .contentTransition(.numericText())
                        }
                        Spacer()
                        // Countdown first, so the copy icon lands in the same trailing column as every other row.
                        Gauge(value: Double(remaining), in: 0...Double(item.otpSettings.period)) {
                            Text("Seconds left")
                        } currentValueLabel: {
                            Text("\(remaining)")
                        }
                        .gaugeStyle(.accessoryCircularCapacity)
                        .tint(Color.accentColor)
                        .scaleEffect(0.7)
                        .frame(width: 40, height: 40)
                        .accessibilityHidden(true)
                        Image(systemName: "doc.on.doc")
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Verification code")
                .accessibilityValue(Text("Expires in \(remaining) seconds"))
                .accessibilityHint("Copies the code")
        }
    }

    private func masked(_ id: FieldID) -> String {
        id == .secret && item.kind == .creditCard ? "•••• " + item.secret.suffix(4) : "••••••••"
    }

    private func shown(_ id: FieldID, _ value: String) -> String {
        guard id == .secret, item.kind == .creditCard else { return value }
        return stride(from: 0, to: value.count, by: 4).map {
            String(value.dropFirst($0).prefix(4))
        }.joined(separator: " ")
    }

    /// A field is one row. Click or tap copies it. Protected values stay hidden until a deliberate reveal.
    private func field(_ id: FieldID, _ label: LocalizedStringKey, _ value: String, hidden: Bool = false) -> some View {
        let isHidden = hidden && !revealed.contains(id)
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    Text(isHidden ? masked(id) : shown(id, value))
                        .textSelection(.disabled)
                    if hidden {
                        // The reveal control sits right beside the value it reveals.
                        // A high-priority tap so it wins over the row's copy gesture.
                        Image(systemName: revealed.contains(id) ? "eye.slash" : "eye")
                            .foregroundStyle(Color.accentColor)
                            // The tap target grows past the glyph without growing the row, so a row with an eye
                            // is the same height as one without.
                            #if os(iOS)
                            .frame(minWidth: 44, alignment: .leading)
                            .contentShape(.rect.inset(by: -12))
                            #else
                            .frame(minWidth: 28, alignment: .leading)
                            .contentShape(.rect.inset(by: -6))
                            #endif
                            .highPriorityGesture(TapGesture().onEnded {
                                if revealed.contains(id) { revealed.remove(id) } else { revealed.insert(id) }
                            })
                            .accessibilityLabel(revealed.contains(id) ? Text("Hide") : Text("Show"))
                            .accessibilityAddTraits(.isButton)
                    }
                }
            }
            Spacer(minLength: 8)
            // Copy icons stay visible at the trailing edge of every row, quietly tinted.
            Image(systemName: "doc.on.doc")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .onTapGesture { copy(value, as: id) }
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: Text("Copy")) { copy(value, as: id) }
    }

    private func copy(_ value: String, as id: FieldID) {
        Clipboard.copy(value)
        used()
        copied = id
        Task {
            try? await Task.sleep(for: .seconds(2))
            if copied == id { copied = nil }
        }
    }
}

private struct ItemEditor: View {
    @State var item: VaultItem
    let onSave: (VaultItem) -> Void
    /// Stores the login without closing the editor, so a code survives leaving the app to type it into the site.
    let onKeepDraft: (VaultItem) -> Void
    /// Set only when editing an existing item.
    var onDelete: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool
    @State private var confirmsDelete = false
    @State private var addingCode = false

    var body: some View {
        NavigationStack {
            Form {
                if item.kind != .login {
                    labeled("Title") {
                        TextField("Title", text: $item.title, prompt: Text(verbatim: ""))
                            .focused($titleFocused)
                            .task { titleFocused = true }
                    }
                }
                switch item.kind {
                case .login:
                    labeled("Website") {
                        TextField("Website", text: $item.website, prompt: Text("example.com"))
                            .focused($titleFocused)
                            .task { titleFocused = item.website.isEmpty }
                            #if os(iOS)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            #endif
                            .autocorrectionDisabled()
                    }
                    labeled("Username") {
                        TextField("Username", text: $item.account, prompt: Text(verbatim: ""))
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                            .autocorrectionDisabled()
                    }
                    labeled("Password") { SecureField("Password", text: $item.secret, prompt: Text(verbatim: "")) }
                    labeled("Verification code (optional)") {
                        SecureField("Setup key", text: $item.otpSecret, prompt: Text("Setup key or otpauth:// link"))
                            .autocorrectionDisabled()
                        #if os(iOS)
                            .textInputAutocapitalization(.never)
                        #endif
                        if totpInvalid {
                            Label("That is not a valid setup key.", systemImage: "exclamationmark.triangle")
                        }
                        codeButtons
                    }
                    labeled("Name (optional)") {
                        TextField("Name", text: $item.title, prompt: Text(verbatim: namePlaceholder))
                    }
                case .creditCard:
                    labeled("Cardholder") { TextField("Cardholder", text: $item.account, prompt: Text(verbatim: "")) }
                    labeled("Card number") { SecureField("Card number", text: $item.secret, prompt: Text(verbatim: "")) }
                    labeled("Expiry") { TextField("Expiry", text: $item.expiry, prompt: Text("MM/YY")) }
                case .secureNote:
                    EmptyView()
                case .keePassEntry:
                    labeled("Protected value") { SecureField("Protected value", text: $item.secret, prompt: Text(verbatim: "")) }
                }
                labeled("Notes") {
                    TextField("Notes", text: $item.notes, prompt: Text(verbatim: ""), axis: .vertical)
                        .lineLimit(3...8)
                }
                if onDelete != nil {
                    Section {
                        Button("Delete Item…", role: .destructive) { confirmsDelete = true }
                    }
                }
            }
            .formStyle(.grouped)
            .confirmationDialog("Delete this item?", isPresented: $confirmsDelete, titleVisibility: .visible) {
                Button("Delete \(item.displayTitle)", role: .destructive) { onDelete?() }
            } message: {
                Text("It is deleted from this vault for good. Psss cannot bring it back.")
            }
            .navigationTitle(item.kind.label)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(saved) }
                        .disabled(item.displayTitle == String(localized: "Untitled") || totpInvalid)
                }
            }
        }
        .modifier(SheetSize())
        .sheet(isPresented: $addingCode) {
            VerificationCodeSheet(loginName: item.displayTitle, hasExistingCode: totpUsable) { setup in
                item.otpSecret = setup.secret
                item.otpSettings = setup.settings
                // A login with no name or website cannot be stored yet; it is kept when the person taps Save.
                if item.displayTitle != String(localized: "Untitled") { onKeepDraft(saved) }
            }
        }
    }
}

extension ItemEditor {
    /// A visible caption above each field, like the detail page, so a filled field never loses its name.
    fileprivate func labeled<Content: View>(_ label: LocalizedStringKey, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).foregroundStyle(.secondary)
            content().labelsHidden()
        }
    }

    /// Add, replace and remove for the code, stacked so no label is ever squeezed or clipped in a form row.
    fileprivate var codeButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(item.otpSecret.isEmpty ? "Add code" : "Replace code", systemImage: "qrcode.viewfinder") { addingCode = true }
            if !item.otpSecret.isEmpty {
                Button("Remove code", role: .destructive) {
                    item.otpSecret = ""
                    item.otpSettings = .standard
                }
            }
        }
        .buttonStyle(.bordered)
    }

    fileprivate var totpUsable: Bool {
        if case .setup = TOTP.parse(item.otpSecret) { return true }
        return false
    }

    fileprivate var totpInvalid: Bool { !item.otpSecret.isEmpty && !totpUsable }

    /// The item with its code reduced to the clean Base32 secret and its parameters, whatever was typed or pasted.
    /// A bare key keeps the parameters the login already has; a link brings its own.
    fileprivate var saved: VaultItem {
        var clean = item
        if case .setup(let setup) = TOTP.parse(item.otpSecret) {
            clean.otpSecret = setup.secret
            if item.otpSecret.lowercased().contains("otpauth://") { clean.otpSettings = setup.settings }
        } else {
            clean.otpSecret = ""
            clean.otpSettings = .standard
        }
        return clean
    }

    fileprivate var namePlaceholder: String {
        item.displayTitle == String(localized: "Untitled") ? String(localized: "Same as the website") : item.displayTitle
    }
}

private struct SheetSize: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.frame(minWidth: 450, minHeight: 360)
        #else
        content
        #endif
    }
}

/// Lets the File menu create an item in the focused window.
struct NewItemKey: FocusedValueKey {
    typealias Value = (ItemKind) -> Void
}

extension FocusedValues {
    var newItem: ((ItemKind) -> Void)? {
        get { self[NewItemKey.self] }
        set { self[NewItemKey.self] = newValue }
    }
}

private struct LockVaultKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    var lockVault: (() -> Void)? {
        get { self[LockVaultKey.self] }
        set { self[LockVaultKey.self] = newValue }
    }
}

/// A QR code of the `otpauth://` link, for scanning into another authenticator.
private struct TOTPQRSheet: View {
    let url: String
    let title: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let image = Self.qr(url) {
                    image
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 240, height: 240)
                        .padding(12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityLabel("QR code for the setup key of \(title)")
                }
                Text("Scan this with an authenticator app. Anyone who sees it can make your codes.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
            }
            .padding()
            .navigationTitle("QR code")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .modifier(SheetSize())
    }

    private static func qr(_ text: String) -> Image? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return Image(decorative: cg, scale: 1)
    }
}

