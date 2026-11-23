import AuthenticationServices
import CoreImage.CIFilterBuiltins
import SwiftUI

extension ItemKind {
    var label: LocalizedStringKey {
        switch self {
        case .login: "Login"
        case .creditCard: "Card"
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

/// The tabs of the iPhone (and of iPad at compact width): the three places, then the iOS 26 search tab at the trailing end.
private enum PhoneTab: Hashable { case place(VaultPlace), search }

/// Shows the search field only where the list owns it: Mac and iPad. On iPhone the search tab has it.
private struct ListSearch: ViewModifier {
    let enabled: Bool
    let text: Binding<String>
    let focus: FocusState<Bool>.Binding

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: text, prompt: "Search all items").searchFocused(focus)
        } else {
            content
        }
    }
}

private enum VaultCategory: Hashable {
    case recent
    case mostUsed
    case allItems
    /// Codes and Cards are places; the sidebar lists them as rows, and choosing one chooses the place. Never pills.
    case codes
    case cards
    case kind(ItemKind)
    case trait(ItemTrait)
    /// Items that were deleted and wait for 30 days. Not a filter of live items: it lists `store.recentlyDeleted()`.
    case recentlyDeleted

    /// The sidebar's top section: usage views, All, the Codes and Cards places, the kinds, then Recently Deleted.
    static var choices: [Self] { [.recent, .mostUsed, .allItems, .codes, .cards] + kindChoices + [.recentlyDeleted] }
    /// Cards is a kind of its own place, so it is not a kind row; Codes is not a trait row.
    private static var kindChoices: [Self] { ItemKind.allCases.filter { $0 != .creditCard }.map(Self.kind) }
    /// What the item has. Codes is a place of its own, so the code trait has no filter.
    static var traitChoices: [Self] { ItemTrait.allCases.filter { $0 != .code }.map(Self.trait) }
    /// The pills: usage views and kinds, the filters, and Recently Deleted last. The same on every platform.
    static var everyChoice: [Self] { [.recent, .mostUsed, .allItems] + kindChoices + traitChoices + [.recentlyDeleted] }

    /// Usage views are scopes of "what I need now". Searching always looks across everything.
    var isUsageView: Bool { self == .recent || self == .mostUsed }

    var title: LocalizedStringKey {
        switch self {
        case .recent: "Recent"
        case .mostUsed: "Most used"
        case .allItems: "All"
        case .codes: "Codes"
        case .cards: "Cards"
        case .kind(.login): "Logins"
        case .kind(.creditCard): "Cards"
        case .kind(.secureNote): "Secure notes"
        case .kind(.keePassEntry): "Custom items"
        case .trait(.passkey): "Passkeys"
        case .trait(.code): "Codes"
        case .trait(.notes): "With notes"
        case .recentlyDeleted: "Recently Deleted"
        }
    }

    var shortTitle: LocalizedStringKey {
        switch self {
        case .recent: "Recent"
        case .mostUsed: "Most used"
        case .allItems: "All"
        case .codes: "Codes"
        case .cards: "Cards"
        case .kind(.login): "Logins"
        case .kind(.creditCard): "Cards"
        case .kind(.secureNote): "Notes"
        case .kind(.keePassEntry): "Custom"
        case .trait(.passkey): "Passkeys"
        case .trait(.code): "Codes"
        case .trait(.notes): "With notes"
        case .recentlyDeleted: "Recently Deleted"
        }
    }

    var symbol: String {
        switch self {
        case .recent: "clock"
        case .mostUsed: "star"
        case .allItems: "square.stack"
        case .codes: VaultPlace.codes.symbol
        case .cards: VaultPlace.cards.symbol
        case .kind(let kind): kind.symbol
        case .trait(let trait): trait.symbol
        case .recentlyDeleted: "trash"
        }
    }

    /// How many items the filter lists. Recent and Most used show at most ten, so the count never promises more than the list holds.
    func listedCount(in items: [VaultItem]) -> Int {
        let count = items.count(where: includes)
        return isUsageView ? min(count, Self.usageLimit) : count
    }

    static let usageLimit = 10

    func includes(_ item: VaultItem) -> Bool {
        switch self {
        case .recent: item.lastUsed != nil
        case .mostUsed: item.useCount > 0
        case .allItems: true
        case .codes: item.traits.contains(.code)
        case .cards: item.kind == .creditCard
        case .kind(let kind): item.kind == kind
        case .trait(let trait): item.traits.contains(trait)
        case .recentlyDeleted: false  // live items are never in it; its own list comes from the store
        }
    }
}

struct VaultView: View {
    let store: any VaultStore
    @State private var items: [VaultItem]
    /// What waits in Recently Deleted, newest deletion first. Refreshed together with `items`.
    @State private var deletedEntries: [DeletedItem]
    /// The Undo capsule after a delete.
    @State private var undoBanner = UndoBannerModel()
    /// The window's undo stack: Edit, Undo Delete Item (and the same on iPad with a hardware keyboard).
    @Environment(\.undoManager) private var undoManager
    @State private var undoToken = UndoToken()
    @AppStorage("vaultSource") private var vaultSource = ""
    @Environment(VaultSession.self) private var session
    @State private var storeProblem: String?
    @State private var conflict = false
    /// The write the vault file refused because it changed elsewhere, kept while the alert is up so Replace can repeat it.
    @State private var refusedWrite: (() throws -> Void)?
    /// What follows a successful write of that kind (closing the editor, the selection), run if Save My Change Anyway works.
    @State private var refusedFollowUp: (() -> Void)?
    /// The item the refused write was about, so a reload that shows it gone (or moved) drops the offer to repeat the write.
    @State private var refusedSubject: VaultItem.ID?
    /// The item whose editor Reload Vault closed. If the reload shows it gone, the person is told it was removed.
    @State private var reloadingEditedItem: VaultItem.ID?
    @State private var changingPassword = false
    @State private var copyDocument: VaultCopy?

    init(store: any VaultStore) {
        self.store = store
        _items = State(initialValue: store.items())
        _deletedEntries = State(initialValue: store.recentlyDeleted().map(DeletedItem.init))
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
    /// The place showing: All, Codes or Cards. Every platform has the same three; only the control differs.
    @State private var place: VaultPlace = .all
    /// iPhone: the search tab, after the places, is showing. The place underneath stays what it was.
    @State private var inSearchTab = false
    /// iPhone tabs. Each has its own stack, so each keeps its own open login.
    @State private var codesPath: [VaultItem.ID] = []
    @State private var cardsPath: [VaultItem.ID] = []
    @State private var searchPath: [VaultItem.ID] = []
    /// Bumped to bring the All list back to its very top, where the title and the pills are.
    @State private var scrollToTop = 0
    /// A new value re-creates the iPhone All tab's NavigationStack, which brings its large title back after a scroll.
    @State private var stackIdentity = 0
    /// Changing it gives the All list a new identity, which starts at its resting top with the large title expanded. See `itemResults`.
    @State private var listIdentity = 0
    /// Bumped when the person leaves the item they are looking at (selection, tab or place), so revealed values hide again.
    @State private var hideSignal = 0
    /// Scroll position of the All list, so a re-tap can also set the offset to the very top once the new list is on screen.
    @State private var listScroll = ScrollPosition()
    /// The request above comes from a tap that also closed an open login: the scroll waits for the pop to finish.
    @State private var scrollAfterPop = false
    /// What waits for the confirmation before it is removed for good. The dialog hangs on the screen's root, see `ConfirmDeletion`.
    @State private var deletionRequest: DeletionRequest?
    /// The code buttons of search results.
    @State private var codeCopy = CodeCopyState()
    /// The height of the pill row inside the iPhone list, so an empty state starts below it and never covers the pills.
    @State private var pillsHeight: CGFloat = 0
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
    /// The sidebar's selection and the toolbar control are two views of one choice: Codes and Cards rows choose that place, any
    /// other row chooses All with that filter.
    private var sidebarSelection: Binding<VaultCategory?> {
        Binding(get: {
            switch place {
            case .all: category
            case .codes: .codes
            case .cards: .cards
            }
        }, set: { new in
            switch new {
            case .codes: placeBinding.wrappedValue = .codes
            case .cards: placeBinding.wrappedValue = .cards
            case nil: break
            default:
                placeBinding.wrappedValue = .all
                categorySelection.wrappedValue = new
            }
        })
    }
    /// The selected item of each place, so leaving a place and coming back finds its list as it was (Mac and iPad).
    @State private var selections: [VaultPlace: VaultItem.ID] = [:]
    private var selection: VaultItem.ID? {
        get { selections[place] }
        nonmutating set { selections[place] = newValue }
    }
    private var selectionBinding: Binding<VaultItem.ID?> { Binding(get: { selection }, set: { selection = $0 }) }
    @State private var search = ""
    @FocusState private var searchFocused: Bool
    @State private var didFocusOnLaunch = false
    @State private var editor: VaultItem?
    /// The editor opens at the verification code step (Set Up Code… on a login's page).
    @State private var editorStartsWithCode = false
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

    /// The place the person chose, from any control: the toolbar, the top tab bar, the View menu, ⌘1 to ⌘3. Another place starts
    /// with no search, since the person asked for something else.
    private var placeBinding: Binding<VaultPlace> {
        Binding(get: { place }, set: { new in
            inSearchTab = false
            place = new
        })
    }

    /// A usage pill with nothing to show falls back to All, so a new vault never opens empty.
    private var activeCategory: VaultCategory {
        let chosen = category ?? .recent
        return chosen.isUsageView && !items.contains(where: chosen.includes) ? .allItems : chosen
    }

    private var isSearching: Bool { !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The All list is showing: in the All place, and on iPhone also in the search tab, which is that list with a field.
    private var showsAllList: Bool { place == .all || inSearchTab }

    /// The pill that is lit. While searching from a usage pill the results span everything, so All is the honest highlight.
    private var shownCategory: VaultCategory { isSearching && searchesWholeVault ? .allItems : activeCategory }

    /// Search is global on every platform (owner, 2026-11-23): typing always searches the whole vault, whichever view or pill is
    /// open, and there is no scope bar, so a missing result never comes from a hidden scope.
    private var searchesWholeVault: Bool { true }

    /// The Recently Deleted list is showing. Searching leaves it: results come from the live vault, deleted items never turn up in
    /// them.
    private var isRecentlyDeleted: Bool { showsAllList && activeCategory == .recentlyDeleted && !isSearching }

    /// What the Recently Deleted list shows (kept for its empty-state branches; a search leaves the list).
    private var deletedResults: [DeletedItem] { ItemSearch.matching(deletedEntries, query: search) }

    private var results: [VaultItem] {
        if isRecentlyDeleted { return deletedResults.map(\.item) }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let scope: VaultCategory = query.isEmpty || !searchesWholeVault ? activeCategory : .allItems
        let matches = items.filter { item in scope.includes(item) && ItemSearch.matches(item, query: query) }
        switch scope {
        case .recent:
            return Array(matches.sorted { ($0.lastUsed ?? .distantPast) > ($1.lastUsed ?? .distantPast) }.prefix(VaultCategory.usageLimit))
        case .mostUsed:
            return Array(matches.sorted { $0.useCount > $1.useCount }.prefix(VaultCategory.usageLimit))
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
        withSheets
            .focusedSceneValue(\.newItem, { kind in editor = VaultItem(kind: kind) })
            .focusedSceneValue(\.vaultPlace, placeBinding)
            .focusedSceneValue(\.openSetup, { showsSetup = true })
            #if os(macOS)
            // Edit, Delete (system item) and the Delete key act on the selected item while the list has focus. A text field
            // that has focus handles both itself. ⌘⌫ is handled here too, since the system item shows no ⌘⌫ of its own.
            .onDeleteCommand { deleteSelectedAction?() }
            .onKeyPress(.delete, phases: .down) { press in
                guard press.modifiers.contains(.command), let action = deleteSelectedAction else { return .ignored }
                action()
                return .handled
            }
            #endif
            // Another place starts with no search: the person asked for something else.
            .onChange(of: place) { search = "" }
            .onChange(of: place) { hideSignal += 1 }
            .onChange(of: inSearchTab) { hideSignal += 1 }
            .onChange(of: selections) { hideSignal += 1 }
            .task { if store.isSample { VaultIdentities.remove() } else { registerIdentities() } }
            // AutoFill has just been found on, by the system's prompt or on coming back from Settings. Logins saved while it was
            // off were never sent to the system, so they are sent now, without waiting for the next unlock.
            .onChange(of: autoFill.reading) { old, new in if new == .on, old != .on { registerIdentities(knownEnabled: true) } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { reloadIfChangedOnDisk() }
            }
    }

    /// Edit, Delete (⌘⌫) on Mac: moves the selected item to Recently Deleted (Undo follows), or asks before deleting one that is
    /// already in Recently Deleted for good. Off while the editor is open or the search field has focus (⌘⌫ edits its text there).
    private var deleteSelectedAction: (() -> Void)? {
        guard !usesStack, editor == nil, !searchFocused, !sheetIsOpen,
              let id = regularVisibleItems.first(where: { $0.id == selection })?.id else { return nil }
        if items.contains(where: { $0.id == id }) { return { delete(id) } }
        if deletedEntries.contains(where: { $0.id == id }) { return { deletionRequest = .one(id) } }
        return nil
    }

    private var withSheets: some View {
        base
            .sheet(item: $editor, onDismiss: {
                editorStartsWithCode = false
                if editorItemRemoved { editorItemRemoved = false; showsEditorRemoved = true }
            }) { item in
                ItemEditor(item: item, onSave: save, onKeepDraft: keepDraft,
                           onDelete: items.contains { $0.id == item.id } ? { delete(item.id) } : nil,
                           startsWithCode: editorStartsWithCode)
                    .modifier(AlertSurfaceModifier(surface: .editor, owner: self))
            }
            .sheet(isPresented: $showsSetup, onDismiss: {
                // Change Vault Password opens its own sheet, but only once this one has gone.
                if wantsPasswordChange { wantsPasswordChange = false; changingPassword = true }
            }) { setupSheet.modifier(AlertSurfaceModifier(surface: .setup, owner: self)) }
    }

    private var base: some View {
        Group {
            if usesStack { stackLayout } else { splitLayout }
        }
        .passwordsImporter(isPresented: $importing, notice: $importNotice, problem: $importProblem) { added in
            try store.save(added)
            refresh()
            registerIdentities()
        }
        // One alert at a time, shown by the surface the action came from: the item editor or Setup while one of them is open,
        // otherwise this screen. The flags below say what is waiting; `nextAlert` picks by priority.
        .modifier(AlertSurfaceModifier(surface: .vault, owner: self))
        // On the root, not on a button or a pushed page. iPhone asks with an alert (always has Cancel), see `ConfirmDeletion`.
        .modifier(ConfirmDeletion(request: $deletionRequest, entries: deletedEntries, deleteAll: deleteAllForGood,
                                  deleteOne: deleteForGood))
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
        .onDisappear {
            alertTask?.cancel()
            alertTask = nil
            // Locking closes the vault: no Undo may reach a store that is no longer open.
            undoBanner.dismiss()
            undoToken.clear(in: undoManager)
        }
        .task { if !store.isSample, session.biometricNotice == nil, session.shouldOfferBiometric { offersBiometric = true } }
        .sheet(isPresented: $changingPassword) {
            if let store = store as? KeePassVaultStore { ChangePasswordSheet(store: store, onReloaded: { adoptReloadedVault() },
                                                          onChangedElsewhere: { gate.lock(notice: Self.changedElsewhereNotice) }) }
        }
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
            Button("Reload Vault") {
                conflict = false; refusedWrite = nil; refusedFollowUp = nil; refusedSubject = nil
                // The message says the change is discarded, so an editor holding it closes too. If the reloaded vault no longer has
                // the item, the person is told it was removed.
                reloadingEditedItem = editor?.id
                editor = nil
                reloadFromDisk()
            }
            Button("Save My Change Anyway", role: .destructive) { conflict = false; overwrite() }
            Button("Cancel", role: .cancel) { conflict = false; refusedWrite = nil; refusedFollowUp = nil; refusedSubject = nil }
        case .editorRemoved:
            Button("OK") { showsEditorRemoved = false }
        case .storeProblem:
            Button("OK") { storeProblem = nil }
        case .autoFillSettings:
            Button("OK") { autoFill.settingsDidNotOpen = false }
        case .importProblem:
            Button("OK") { importProblem = nil }
        case .importNotice:
            Button("Open vault") { importNotice = nil; refresh(); registerIdentities() }
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
                    emptyChoice("Add a card", "creditcard") { editor = VaultItem(kind: .creditCard) }
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

    /// iPhone: a tab bar with All, Codes, Cards and the search tab. The bar shrinks while a list scrolls down.
    @ViewBuilder
    private var stackLayout: some View {
        #if os(iOS)
        TabView(selection: tabSelection) {
            Tab("All", systemImage: VaultPlace.all.symbol, value: PhoneTab.place(.all)) { vaultTab }
            Tab("Codes", systemImage: VaultPlace.codes.symbol, value: PhoneTab.place(.codes)) { codesTab }
            Tab("Cards", systemImage: VaultPlace.cards.symbol, value: PhoneTab.place(.cards)) { cardsTab }
            Tab(value: PhoneTab.search, role: .search) { searchTab }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        // The field belongs to the search tab (see `searchTab`); selecting that tab activates it.
        .tabViewSearchActivation(.searchTabSelection)
        .onChange(of: inSearchTab) { _, now in
            // A search belongs to the search tab: the places always list what they list.
            if !now { search = ""; searchPath = [] }
        }
        #endif
    }

    /// Tapping the tab that is already showing returns to its list: out of an open item, and for All up to the very top, where the
    /// title and the pills are.
    private var tabSelection: Binding<PhoneTab> {
        Binding(get: { inSearchTab ? .search : .place(place) }, set: { new in
            let current: PhoneTab = inSearchTab ? .search : .place(place)
            if new == current {
                switch new {
                case .place(.all):
                    // One tap does both: closes an open login, then brings the list to its very top.
                    scrollAfterPop = !compactPath.isEmpty
                    compactPath = []
                    scrollToTop += 1
                case .place(.codes): codesPath = []
                case .place(.cards): cardsPath = []
                case .search: searchPath = []
                }
            }
            switch new {
            case .place(let chosen): inSearchTab = false; place = chosen
            case .search: inSearchTab = true
            }
        })
    }

    #if os(iOS)
    private var vaultTab: some View {
        allStack.id(stackIdentity)
            .onChange(of: scrollToTop) { _, _ in
                // `scrollTo(edge: .top)` only moves the list to the top of its content under the bar as it is now: a bar that was
                // collapsed (tab bar minimized, list scrolled) stays collapsed, because the large title expands only at the bar's
                // own full inset. A new NavigationStack starts with a fresh bar: large title expanded, list at its resting top with
                // the pills, tab bar not minimized. After a pop it waits for the bar to finish coming back.
                let afterPop = scrollAfterPop
                Task { @MainActor in
                    if afterPop { try? await Task.sleep(for: .milliseconds(450)) } else { await Task.yield() }
                    stackIdentity += 1
                }
            }
    }

    private var allStack: some View {
        NavigationStack(path: $compactPath) {
            itemResults(results, pillsInList: true)
                .navigationDestination(for: VaultItem.ID.self) { id in
                    detail(for: id)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Setup", systemImage: "gearshape") { showsSetup = true }
                            .labelStyle(.iconOnly)
                    }
                    if showsAddOrDeleteAll {
                        ToolbarSpacer(.fixed, placement: .topBarTrailing)
                        ToolbarItem(placement: .topBarTrailing) {
                            addOrDeleteAll
                        }
                    }
                }
                // The capsule sits above the tab bar, where a thumb is.
                .undoBanner(undoBanner)
        }
    }

    private var codesTab: some View {
        NavigationStack(path: $codesPath) {
            codesView
                .navigationDestination(for: VaultItem.ID.self) { id in
                    detail(for: id)
                }
                .undoBanner(undoBanner)
        }
    }

    private var cardsTab: some View {
        NavigationStack(path: $cardsPath) {
            cardsView
                .navigationDestination(for: VaultItem.ID.self) { id in
                    detail(for: id)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        // Text with its glyph, not a Label: iOS toolbars would reduce a Label to an icon-only circle.
                        Button { editor = VaultItem(kind: .creditCard) } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                Text("Add card")
                            }
                        }
                    }
                }
                .undoBanner(undoBanner)
        }
    }

    /// The search tab is the All screen with the TabView's field: the same list and pills, filtered in place as the person types. From Recent or
    /// Most used it searches the whole vault; a type pill narrows it. A result with a code shows it live.
    private var searchTab: some View {
        NavigationStack(path: $searchPath) {
            itemResults(results, pillsInList: true)
                .navigationDestination(for: VaultItem.ID.self) { id in
                    detail(for: id)
                }
                .undoBanner(undoBanner)
        }
        // `.searchable` goes on the search tab's own content, not on the TabView: iOS then draws the field at the bottom above the
        // keyboard when the tab is selected, and the field's X returns to the previous tab by itself, with no field left on it.
        // (On the TabView, with `isPresented` and a programmatic tab change, the X left an inline field on the tab it returned to;
        // proved in a probe on iOS 27.2.)
        .searchable(text: $search, prompt: "Search all items")
        .searchFocused($searchFocused)
        .onSubmit(of: .search) { openTopResult() }
    }
    #endif

    private var codesView: some View {
        CodesView(items: items, copy: codeCopy, selection: usesStack ? nil : selectionBinding, open: openItem(_:),
                  used: markUsed(_:), showLogins: showLogins)
            #if os(iOS)
            // The same inline title as the search results that replace this list on iPad, so the bar never changes between them
            // and the title cannot land on the first row.
            .navigationBarTitleDisplayMode(usesStack ? .automatic : .inline)
            #endif
    }

    private var cardsView: some View {
        CardsView(items: items, selection: usesStack ? nil : selectionBinding, open: openItem(_:),
                  add: { editor = VaultItem(kind: .creditCard) })
            #if os(iOS)
            .navigationBarTitleDisplayMode(usesStack ? .automatic : .inline)
            #endif
    }

    /// Opens an item: pushed on the tab that is showing on iPhone, shown beside the list on Mac and iPad.
    private func openItem(_ id: VaultItem.ID) {
        if usesStack {
            if inSearchTab {
                searchPath.append(id)
            } else {
                switch place {
                case .all: compactPath.append(id)
                case .codes: codesPath.append(id)
                case .cards: cardsPath.append(id)
                }
            }
        } else {
            selection = id
            compactColumn = .detail
        }
    }

    /// Codes' empty state: the logins, which are where a code is added.
    private func showLogins() {
        categorySelection.wrappedValue = .kind(.login)
        inSearchTab = false
        place = .all
        scrollAfterPop = false
        compactPath = []
        scrollToTop += 1
    }

    /// Takes every open item off screen, in every tab.
    private func closeOpenLogins() {
        compactPath = []
        codesPath = []
        cardsPath = []
        searchPath = []
    }

    private func sidebarRow(_ scope: VaultCategory) -> some View {
        NavigationLink(value: scope) {
            Label(scope.title, systemImage: scope.symbol)
                // Recently Deleted shows how many items wait in it, and nothing when it is empty.
                .badge(scope == .recentlyDeleted ? deletedEntries.count : scope.listedCount(in: items))
        }
    }

    /// The item's page: the vault's own, or the read-only one of an item in Recently Deleted. Ids are never in both lists.
    @ViewBuilder
    private func detail(for id: VaultItem.ID) -> some View {
        if let item = items.first(where: { $0.id == id }) {
            ItemDetail(item: item, hideSignal: hideSignal, edit: { editor = item },
                       setUpCode: { editorStartsWithCode = true; editor = item }, used: { markUsed(item.id) })
                .id(item.id)
        } else if let entry = deletedEntries.first(where: { $0.id == id }) {
            RecentlyDeletedDetail(entry: entry, hideSignal: hideSignal, restore: { restore(id) }, askDeleteNow: { deletionRequest = .one(id) })
                .id(entry.id)
        }
    }

    /// Recently Deleted has nothing to add, and its one bulk action is a labeled button while there is something to delete.
    private var showsAddOrDeleteAll: Bool { !isRecentlyDeleted || !deletedEntries.isEmpty }

    @ViewBuilder
    private var addOrDeleteAll: some View {
        if isRecentlyDeleted {
            DeleteAllButton { deletionRequest = .all }
        } else {
            newItemMenu(expanded: false)
        }
    }

    /// What the list column shows at regular width, in the order it shows it: the place's own list, or the results of the whole vault
    /// while a search is typed. Codes lists the recently copied first, then A to Z; Cards the live cards, then the expired ones.
    private var regularVisibleItems: [VaultItem] {
        if isSearching || place == .all { return results }
        if place == .codes {
            let withCode = items.filter { $0.traits.contains(.code) }
            let recent = CodeCopyLog.recent(among: Set(withCode.map(\.id)), limit: 3).compactMap { id in withCode.first { $0.id == id } }
            let rest = withCode.filter { item in !recent.contains { $0.id == item.id } }
                .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            return recent + rest
        }
        let cards = CardsOrder.ordered(items)
        return cards.live + cards.expired
    }

    /// Mac and iPad: the detail pane is never empty while the list has a row. When nothing in the list is selected (a place or filter
    /// was opened, a search replaced the list, the selected item went away) the first row is selected. Choosing a row this way only
    /// shows it: it is not a use, so Recent does not change, and focus stays where it is, so typing in the search field goes on.
    /// A selection the person made stays when its item is still listed.
    private func ensureSelection() {
        guard !usesStack else { return }
        let visible = regularVisibleItems
        if let current = selection, visible.contains(where: { $0.id == current }) { return }
        selection = visible.first?.id
    }

    /// After a removal: selects the row that followed the removed one in `before` (the list as it was), or the one before it when it
    /// was last. Mac and iPad only.
    private func selectNeighbor(of id: VaultItem.ID, in before: [VaultItem.ID]) {
        guard !usesStack, let index = before.firstIndex(of: id) else { return }
        let remaining = before.filter { $0 != id }
        selection = remaining.isEmpty ? nil : remaining[min(index, remaining.count - 1)]
    }

    /// Mac and iPad at regular width, the same on both: sidebar, list and item for every place. The sidebar lists Codes and Cards
    /// beside the filters, and the person can hide it with the standard button; that state is kept across places because it lives
    /// in `VaultView`, like the chosen filter and each place's selected item.
    private var splitLayout: some View { allSplit }

    /// The window toolbar: the All | Codes | Cards control in the middle, then Add and Setup. On Mac it is attached to the split view
    /// itself, so it stays where it is when a row is selected or the columns change. iPadOS draws only the toolbars of the columns'
    /// navigation bars (an outer one is dropped), so there it is attached to the detail column, which is always on screen, and
    /// holds the control, Add and Setup beside the search field and the open item's Edit. The one search field is attached to the
    /// split view, so typing on Codes or Cards swaps the list for results without losing the field.
    private func regularChrome<Content: View>(_ content: Content) -> some View {
        content
            .navigationSplitViewStyle(.balanced)
            .onAppear { ensureSelection() }
            .onChange(of: place) { ensureSelection() }
            .onChange(of: regularVisibleItems.map(\.id)) { ensureSelection() }
    }

    /// The list column's toolbar: the All | Codes | Cards control and a labeled Add (Delete All… in Recently Deleted).
    @ToolbarContentBuilder
    private var listToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("Place", selection: placeBinding) {
                ForEach(VaultPlace.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .help("Choose All, Codes or Cards (⌘1, ⌘2, ⌘3)")
        }
        if showsAddOrDeleteAll {
            ToolbarItem(placement: .primaryAction) { addOrDeleteAll }
        }
    }

    private var regularDetail: some View {
        let visible = regularVisibleItems
        return Group {
            if let id = visible.first(where: { $0.id == selection })?.id {
                detail(for: id)
            } else if items.isEmpty && deletedEntries.isEmpty {
                // Nothing exists to choose, so the detail column stays quiet.
                Color.clear
            } else {
                // The list has no row (a row is selected for the person whenever there is one).
                ContentUnavailableView("Nothing to show", systemImage: "tray")
            }
        }
        // On Mac and iPad the capsule sits at the bottom of the detail column.
        .undoBanner(undoBanner)
        // The item column's toolbar is the open item's labeled Edit (it has its own, hidden when nothing is open) and the one
        // search field, "Search all items", which searches the whole vault from any place and swaps the list for results.
        .modifier(ListSearch(enabled: true, text: $search, focus: $searchFocused))
        .onSubmit(of: .search) { openTopResult() }
    }

    private var allSplit: some View {
        regularChrome(
            NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
                List(selection: sidebarSelection) {
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
                #if os(iOS)
                // The sidebar column: the system's sidebar button, and on iPad the Setup gear. On Mac, Setup is Psss, Settings… (⌘,).
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Setup", systemImage: "gearshape") { showsSetup = true }
                            .labelStyle(.iconOnly)
                            .help("Setup")
                    }
                }
                #endif
            } content: {
                Group {
                    if isSearching || place == .all {
                        itemResults(regularVisibleItems)
                    } else if place == .codes {
                        codesView
                    } else {
                        cardsView
                    }
                }
                // Wide enough for the names, with the code button or the card's summary beside them.
                .navigationSplitViewColumnWidth(min: 320, ideal: 400, max: 560)
                .toolbar { listToolbar }
            } detail: {
                regularDetail
            }
        )
    }

    private var setupSheet: some View {
            NavigationStack {
                Form {
                    if let keePass = store as? KeePassVaultStore {
                        Section("Vault") {
                            LabeledContent("Name", value: keePass.title)
                            LabeledContent("Location", value: keePass.reference.managed
                                ? String(localized: "On this device") : keePass.reference.fileName)
                            Text(keePass.reference.encryptionDescription)
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
                    Section("Help") {
                        ForEach(HelpTopics.all) { HelpRow(topic: $0) }
                    }
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
                .alert("Start over?", isPresented: $confirmsReset) {
                    Button(resetButtonTitle, role: .destructive) {
                        VaultIdentities.remove()
                        session.forget()
                        showsSetup = false
                        vaultSource = ""
                    }
                    Button("Cancel", role: .cancel) {}
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

    /// The rows of the list: live items, or what waits in Recently Deleted, followed by the one sentence about other KeePass apps.
    @ViewBuilder
    private func listRows(_ results: [VaultItem], pillsInList: Bool = false) -> some View {
        // On iPhone the pills are the top of the list, under the large title: they scroll away with it and return at the top.
        if !usesStack {
            // Mac and iPad: the list's title and count are its first line (the bar carries the controls).
            // While a search is active the list shows results from the whole vault, whatever place is selected.
            ListTitleLine(title: isSearching ? "Results" : (showsAllList ? shownCategory.title : place.title),
                          count: RecentlyDeletedText.itemCount(results.count))
        }
        if pillsInList {
            pills
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { pillsHeight = $0 }
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        if isRecentlyDeleted {
            ForEach(deletedResults) { deletedRow($0) }
            if !deletedResults.isEmpty {
                RecentlyDeletedFooter()
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    #if os(iOS)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    #endif
            }
        } else {
            autoFillRow(results)
            ForEach(results) { row($0) }
        }
    }

    /// What an empty search says, with the one way forward: add it.
    private var noResults: some View {
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


    /// Return in the search field opens the top result.
    private func openTopResult() {
        guard let first = results.first else { return }
        if usesStack {
            if inSearchTab { searchPath = [first.id] } else { compactPath = [first.id] }
        } else {
            selection = first.id
            compactColumn = .detail
        }
    }

    /// The All list. The search field is not here: the TabView owns it on iPhone and the split view on Mac and iPad.
    private func itemResults(_ results: [VaultItem], pillsInList: Bool = false) -> some View {
        Group {
            if usesStack {
                // A stack pushes through its links, so the list must not also track a selection.
                List { listRows(results, pillsInList: pillsInList) }
            } else {
                List(selection: selectionBinding) { listRows(results) }
            }
        }
        // A new identity is a new list, which starts at its resting top: large title expanded, pills visible. Scrolling to the
        // first row would only align that row under the collapsed bar, and the large title would stay collapsed.
        .id(listIdentity)
        .scrollPosition($listScroll)
        .onChange(of: scrollToTop) { _, _ in
            // After a pop the new list waits for the navigation bar to finish coming back.
            let afterPop = scrollAfterPop
            Task { @MainActor in
                if afterPop { try? await Task.sleep(for: .milliseconds(450)) } else { await Task.yield() }
                listIdentity += 1
                if !usesStack {
                    try? await Task.sleep(for: .milliseconds(60))
                    listScroll.scrollTo(edge: .top)
                }
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
            Group {
            if results.isEmpty {
                if isRecentlyDeleted {
                    if isSearching {
                        ContentUnavailableView.search(text: search)
                    } else {
                        RecentlyDeletedEmpty { categorySelection.wrappedValue = .allItems }
                    }
                } else if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if items.isEmpty {
                        emptyVault
                    } else {
                        ContentUnavailableView("No items", systemImage: "tray")
                    }
                } else {
                    noResults
                }
            }
            }
        // Under the pills, which are the first row of the list on iPhone: the empty state must not cover or catch their taps.
        .padding(.top, pillsInList ? pillsHeight : 0)
        }
        .overlay(alignment: .bottom) { AutoFillHiddenNotice() }
        #if os(iOS)
        // Keep the title and the New button on screen while search is active.
        .searchPresentationToolbarBehavior(.avoidHidingContent)
        #endif
        #if os(iOS)
        .textInputAutocapitalization(.never)
        #endif
        .autocorrectionDisabled()
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
        // In Codes or Cards a search keeps that place's title: the title and the bar do not change while typing.
        .navigationTitle(showsAllList ? shownCategory.title : place.title)
        .columnTitleInList(!usesStack)
        .safeAreaInset(edge: .top, spacing: 0) {
            // The sidebar already filters on Mac and iPad. With it hidden, pills fill in. iPhone has them in the list itself.
            // Codes and Cards have no filters, so a search there shows none.
            if !usesStack && columns != .all && place == .all { pills }
        }
        #if os(iOS)
        .sensoryFeedback(.success, trigger: codeCopy.count)
        #endif
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
        let selected = shownCategory == scope
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

    /// A row of Recently Deleted. Restore is also a shortcut here (swipe, right-click), never the only way: the detail has the button.
    private func deletedRow(_ entry: DeletedItem) -> some View {
        NavigationLink(value: entry.id) {
            DeletedRow(entry: entry)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Restore") { restore(entry.id) }
                .tint(.accentColor)
        }
        .contextMenu {
            Button("Restore") { restore(entry.id) }
        }
        #if os(iOS)
        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        #else
        .listRowInsets(EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 4))
        #endif
    }

    @ViewBuilder
    private func row(_ item: VaultItem) -> some View {
        if isSearching, item.makesCode {
            // A search result with a code shows the live code in place of the chevron: tap it to copy, tap the rest to open.
            HStack(spacing: 12) {
                // The name and the account are stacked, so the account has the room the Codes list gives it.
                Button { openItem(item.id) } label: {
                    ItemRow(item: item, stacked: true).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }
                    .buttonStyle(.plain)
                    .layoutPriority(1)
                CodeCopyButton(item: item, state: codeCopy, used: { markUsed(item.id) })
            }
            .tag(item.id)
            #if os(iOS)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
            #else
            .listRowInsets(EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 4))
            #endif
        } else {
            NavigationLink(value: item.id) {
                // While searching, every result has the name over the account, so a long account is readable.
                ItemRow(item: item, stacked: isSearching)
            }
            #if os(iOS)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
            #else
            .listRowInsets(EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 4))
            #endif
        }
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
    /// `subject` is the item the write is about, so a reload that shows it gone drops the offer to repeat the write.
    @discardableResult
    private func attempt(_ write: @escaping () throws -> Void, subject: VaultItem.ID? = nil, then followUp: (() -> Void)? = nil) -> Bool {
        do { try write(); refusedWrite = nil; refusedFollowUp = nil; refusedSubject = nil; followUp?(); return true } catch VaultStoreError.changedOnDisk {
            refusedWrite = write
            refusedFollowUp = followUp
            refusedSubject = subject
            conflict = true
        } catch {
            storeProblem = (error as? VaultStoreError)?.message ?? (error as? KDBXError)?.message ?? error.localizedDescription
        }
        refresh()
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
        let before = Set(items.map(\.id)), waiting = Set(deletedEntries.map(\.id))
        refresh()
        registerIdentities()
        let now = Set(items.map(\.id)), waitingNow = Set(deletedEntries.map(\.id))
        // Gone from where it was: removed, or moved into Recently Deleted or back out of it, so a detail page that showed it has
        // nothing to show.
        func gone(_ id: VaultItem.ID) -> Bool {
            (before.contains(id) && !now.contains(id)) || (waiting.contains(id) && !waitingNow.contains(id))
        }
        if selections.values.contains(where: gone) { selections = [:] }
        if compactPath.contains(where: gone) || codesPath.contains(where: gone) || cardsPath.contains(where: gone)
            || searchPath.contains(where: gone) { closeOpenLogins() }
        // A write that was refused is moot when what it was about is gone: only "removed" is said, never an offer to save over it.
        if conflict, let subject = refusedSubject, gone(subject) { dropRefusedWrite() }
        // A removed item that is open in detail just leaves the list (above). An open editor holds a draft, so say it is lost.
        if let open = editor, gone(open.id) {
            dropRefusedWrite()
            editorItemRemoved = true
            editor = nil
        }
        // Reload Vault closed the editor of an item the reloaded vault no longer has.
        if let edited = reloadingEditedItem {
            reloadingEditedItem = nil
            if gone(edited) { showsEditorRemoved = true }
        }
    }

    /// Forgets the refused write and takes its alert away.
    private func dropRefusedWrite() {
        conflict = false
        refusedWrite = nil
        refusedFollowUp = nil
        refusedSubject = nil
        if activeAlert == .conflict { dropActiveAlert() }
    }

    /// Reads the list and Recently Deleted from the store again.
    private func refresh() {
        items = store.items()
        deletedEntries = store.recentlyDeleted().map(DeletedItem.init)
    }

    /// Repeats the refused change now, with the check for a changed file skipped, on the vault as the store holds it (the last
    /// version Psss read, or the reloaded one), and then does what a successful write of that kind does.
    private func overwrite() {
        guard let store = store as? KeePassVaultStore, let write = refusedWrite else { return }
        let followUp = refusedFollowUp, subject = refusedSubject
        refusedWrite = nil
        refusedFollowUp = nil
        refusedSubject = nil
        // Every follow-up registers the AutoFill identities itself, so this does so once, only when there is none.
        attempt({ try store.overwriting(write) }, subject: subject, then: {
            refresh()
            if let followUp { followUp() } else { registerIdentities() }
        })
    }

    /// Delete Item: moves the item to Recently Deleted with no question, then offers Undo for ten seconds (the capsule, and Edit,
    /// Undo Delete Item). The system stops offering the item to AutoFill at once, because the identities are sent again without it.
    private func delete(_ id: VaultItem.ID) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        let before = regularVisibleItems.map(\.id)
        // A refused delete leaves the selection and the open detail alone: the item is still there.
        attempt({ try store.moveToRecentlyDeleted(id) }, subject: id, then: {
            refresh()
            registerIdentities()
            selections = [:]
            selectNeighbor(of: id, in: before)
            closeOpenLogins()
            editor = nil
            offerUndo(of: item)
        })
    }

    private func offerUndo(of item: VaultItem) {
        let undo = { restore(item.id, afterUndo: true) }
        undoBanner.show(message: RecentlyDeletedText.movedMessage(title: item.displayTitle), undo: { undoToken.clear(in: undoManager); undo() })
        undoToken.register(in: undoManager, name: String(localized: "Delete Item")) {
            undoBanner.dismiss()
            undo()
        }
    }

    /// Puts an item back where it was deleted from. Goes through `attempt`, so a refused write is the same conflict alert as every
    /// other write: Reload Vault drops the restore, Save My Change Anyway repeats it, Cancel leaves the item where it is. The
    /// restored login is sent to AutoFill again. After a plain Restore the list shows; after Undo nothing opens either.
    private func restore(_ id: VaultItem.ID, afterUndo: Bool = false) {
        let before = regularVisibleItems.map(\.id)
        attempt({ try store.restore(id) }, subject: id, then: {
            refresh()
            registerIdentities()
            // Undo must not close the item the person is looking at; a plain Restore leaves the list.
            if !afterUndo {
                selections = [:]
                selectNeighbor(of: id, in: before)
                closeOpenLogins()
                undoBanner.dismiss()
                undoToken.clear(in: undoManager)
            }
        })
    }

    /// Delete Now…, after its confirmation: removes the item from Recently Deleted for good. Nothing can bring it back.
    private func deleteForGood(_ id: VaultItem.ID) {
        let before = regularVisibleItems.map(\.id)
        attempt({ try store.deletePermanently(id) }, subject: id, then: {
            refresh()
            registerIdentities()
            selections = [:]
            selectNeighbor(of: id, in: before)
            closeOpenLogins()
            undoBanner.dismiss()
            undoToken.clear(in: undoManager)
        })
    }

    /// Delete All…, after its confirmation: removes everything in Recently Deleted for good.
    private func deleteAllForGood() {
        attempt({ try store.emptyRecentlyDeleted() }, then: {
            refresh()
            registerIdentities()
            selections = [:]
            closeOpenLogins()
            undoBanner.dismiss()
            undoToken.clear(in: undoManager)
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
            // Show the saved item where it is listed: a card in Cards, a code in Codes, anything else in All (under its kind
            // when the chosen filter would hide it).
            inSearchTab = false
            if item.kind == .creditCard {
                place = .cards
            } else {
                if place == .cards || (place == .codes && !item.traits.contains(.code)) { place = .all }
                if place == .all, !activeCategory.includes(item) { category = .kind(item.kind) }
            }
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
    /// The name above the account instead of beside it: for a row that has a button at its end.
    var stacked = false
    @Environment(\.dynamicTypeSize) private var typeSize

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
            if typeSize.isAccessibilitySize || stacked {
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

/// The name and the login (or kind). Side by side while the login fits in at most 40% of the width, so both read in one line. When
/// the login is longer than that, the two stack, name over login, and the login has the full width: near-duplicate logins stay
/// distinguishable, and the middle of a login is cut only when even a whole line is too short (the caller's middle truncation).
struct TitleAndLogin: Layout {
    var spacing: CGFloat = 10
    var stackedSpacing: CGFloat = 2

    private enum Plan {
        case beside(title: CGFloat, login: CGFloat)
        case stacked
    }

    private func plan(_ available: CGFloat?, _ subviews: Subviews) -> Plan {
        let title = subviews[0].sizeThatFits(.unspecified).width
        let login = subviews[1].sizeThatFits(.unspecified).width
        guard let available else { return .beside(title: title, login: login) }
        let room = available - spacing
        if title + login <= room { return .beside(title: title, login: login) }
        if login <= room * 0.4 { return .beside(title: room - login, login: login) }
        return .stacked
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        switch plan(proposal.width, subviews) {
        case .beside(let title, let login):
            let height = max(subviews[0].sizeThatFits(.init(width: title, height: nil)).height,
                             subviews[1].sizeThatFits(.init(width: login, height: nil)).height)
            return CGSize(width: proposal.width ?? title + login + spacing, height: height)
        case .stacked:
            let width = proposal.width ?? 0
            let height = subviews[0].sizeThatFits(.init(width: width, height: nil)).height + stackedSpacing
                + subviews[1].sizeThatFits(.init(width: width, height: nil)).height
            return CGSize(width: width, height: height)
        }
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        switch plan(bounds.width, subviews) {
        case .beside(let title, let login):
            subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading,
                              proposal: .init(width: title, height: bounds.height))
            subviews[1].place(at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing,
                              proposal: .init(width: login, height: bounds.height))
        case .stacked:
            let titleHeight = subviews[0].sizeThatFits(.init(width: bounds.width, height: nil)).height
            subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY), anchor: .topLeading,
                              proposal: .init(width: bounds.width, height: titleHeight))
            subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + titleHeight + stackedSpacing), anchor: .topLeading,
                              proposal: .init(width: bounds.width, height: nil))
        }
    }
}

/// A site monogram today and the favicon slot later. Colour comes from the site so it is stable and offline.
struct ItemIcon: View {
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
    let hideSignal: Int
    let edit: () -> Void
    /// Opens the editor straight at the verification code step: the "Set Up Code…" row of a login that has none.
    let setUpCode: () -> Void
    let used: () -> Void
    @State private var revealed: Set<FieldID> = []
    /// The field whose copy icon is a checkmark, for about a second and a half.
    @State private var copied: FieldID?
    @State private var pill = CopiedPillModel()
    @State private var showsQR = false

    private enum FieldID: Hashable { case website, account, expiry, securityCode, secret, code, notes, totpSecret, totpLink }

    private var secretLabel: LocalizedStringResource {
        switch item.kind {
        case .login: "Password"
        case .creditCard: "Card number"
        case .keePassEntry: "Value"
        case .secureNote: "Secret"
        }
    }

    private var accountLabel: LocalizedStringResource { item.kind == .creditCard ? "Name on card" : "Username" }

    var body: some View {
        page.modifier(HidesRevealedValues(signal: hideSignal) { revealed = [] })
    }

    private var page: some View {
        Form {
            Section {
                if !item.account.isEmpty {
                    field(.account, accountLabel, item.account)
                }
                if !item.secret.isEmpty {
                    field(.secret, secretLabel, item.secret, hidden: true)
                }
                // In the order the fields are used: username, password, then the code, all in one card.
                if item.kind == .login { if item.otpSecret.isEmpty { noCodeRow } else { codeRow } }
                if !item.expiry.isEmpty { field(.expiry, "Expiry", item.expiry) }
                if !item.securityCode.isEmpty { field(.securityCode, "Security code", item.securityCode, hidden: true) }
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
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("Copied values leave the clipboard after 60 seconds.")
                    InfoButton(topic: HelpTopics.clipboard)
                }
            }
            if let url = item.totpSetupURL {
                Section {
                    field(.totpSecret, "Setup key", item.otpSecret, hidden: true)
                    Button("Copy setup link", systemImage: "link") { copy(url, as: .totpLink, name: String(localized: "Setup link")) }
                    Button("Show QR code", systemImage: "qrcode") { showsQR = true }
                } header: {
                    HStack(spacing: 4) {
                        Text("Verification code setup")
                        InfoButton(topic: HelpTopics.codeSetup)
                    }
                } footer: {
                    Text("To move this verification code to another authenticator, use the setup key, the link or the QR code. Anyone who has one of them can make your codes, so treat them like a password.")
                }
            }
            if let passkey = item.passkey {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text("Passkey").foregroundStyle(.secondary)
                                InfoButton(topic: HelpTopics.passkeys)
                            }
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
            // Text, not a Label: iOS toolbars would reduce a Label to an icon-only circle. Only an open item has it.
            Button(action: edit) { Text("Edit") }
                .keyboardShortcut("e", modifiers: .command)
        }
        .copiedPill(pill)
    }

    /// A login with no code: the row says so and offers Set Up Code…, where the code would be. Nothing to copy, so no copy icon.
    private var noCodeRow: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Verification code").foregroundStyle(.secondary)
                Text("None")
            }
            Spacer(minLength: 8)
            Button("Set Up Code…", action: setUpCode)
                .buttonStyle(.bordered)
        }
    }

    private var codeRow: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = TOTP.secondsRemaining(period: item.otpSettings.period, at: context.date)
            let code = TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) ?? "------"
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Verification code").foregroundStyle(.secondary)
                    Text(TOTP.grouped(code))
                        .font(.system(.largeTitle, design: .monospaced).weight(.medium))
                        .contentTransition(.numericText())
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Verification code")
                .accessibilityValue(Text("Expires in \(remaining) seconds"))
                Spacer(minLength: 8)
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
                if TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) != nil {
                    CopyIconButton(name: String(localized: "verification code"), copied: copied == .code) {
                        copy(code, as: .code, name: String(localized: "Verification code"))
                    }
                }
            }
        }
    }

    private func shown(_ id: FieldID, _ value: String) -> String { id == .secret ? item.spacedSecret : value }

    /// A field is one row with a copy icon at its end. Protected values stay hidden until a deliberate reveal.
    private func field(_ id: FieldID, _ label: LocalizedStringResource, _ value: String, hidden: Bool = false) -> some View {
        FieldRow(label: label, value: value, shown: shown(id, value), masked: id == .secret ? item.maskedSecret : VaultItem.hiddenMask,
                 hidden: hidden,
                 revealed: Binding(get: { revealed.contains(id) },
                                   set: { if $0 { revealed.insert(id) } else { revealed.remove(id) } }),
                 copied: copied == id,
                 copy: { copy(value, as: id, name: String(localized: label)) })
    }

    private func copy(_ value: String, as id: FieldID, name: String) {
        Clipboard.copy(value)
        used()
        copied = id
        pill.show(String(localized: "\(name) copied"))
        Task {
            try? await Task.sleep(for: .seconds(1.5))
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
    /// Opens the verification code step as soon as the editor is on screen.
    var startsWithCode = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool
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
                    labeled("Verification code (optional)", info: HelpTopics.setupKey) {
                        // The field's action sits on its right, on the same line; Remove code, being destructive, has its own row.
                        HStack(spacing: 8) {
                            SecureField("Setup key", text: $item.otpSecret, prompt: Text("Setup key or otpauth:// link"))
                                .autocorrectionDisabled()
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                #endif
                            Button(item.otpSecret.isEmpty ? "Add code" : "Replace code") { addingCode = true }
                                .buttonStyle(.bordered)
                                .fixedSize()
                        }
                        if totpInvalid {
                            Label("That is not a valid setup key.", systemImage: "exclamationmark.triangle")
                        }
                        if !item.otpSecret.isEmpty {
                            Button("Remove code", role: .destructive) {
                                item.otpSecret = ""
                                item.otpSettings = .standard
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    labeled("Name (optional)") {
                        TextField("Name", text: $item.title, prompt: Text(verbatim: namePlaceholder))
                    }
                case .creditCard:
                    labeled("Name on card") { TextField("Name on card", text: $item.account, prompt: Text(verbatim: "")) }
                    labeled("Card number") { SecureField("Card number", text: $item.secret, prompt: Text(verbatim: "")) }
                    labeled("Expiry") { TextField("Expiry", text: $item.expiry, prompt: Text("MM/YY")) }
                    labeled("Security code (optional)", info: HelpTopics.securityCode) {
                        SecureField("Security code", text: $item.securityCode, prompt: Text(verbatim: ""))
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                    }
                case .secureNote:
                    EmptyView()
                case .keePassEntry:
                    labeled("Protected value") { SecureField("Protected value", text: $item.secret, prompt: Text(verbatim: "")) }
                }
                labeled("Notes") {
                    TextField("Notes", text: $item.notes, prompt: Text(verbatim: ""), axis: .vertical)
                        .lineLimit(3...8)
                }
                if let onDelete {
                    // Nothing more is asked: the item goes to Recently Deleted and Undo follows. The line says where it goes.
                    Section {
                        Button("Delete Item", role: .destructive, action: onDelete)
                            // Explicit: a macOS Form draws a destructive button in the default text colour.
                            .foregroundStyle(.red)
                    } footer: {
                        Text(verbatim: RecentlyDeletedText.editorDeleteLine).font(.body)
                    }
                }
            }
            .formStyle(.grouped)
            // Delete Item is the form's last row: the form always scrolls, shows its scroll bar while it moves, and dragging it
            // lowers the keyboard, which otherwise covers the lower rows on iPad.
            .scrollDisabled(false)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
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
        .task {
            // A sheet cannot present another while it is still coming up.
            guard startsWithCode else { return }
            try? await Task.sleep(for: .milliseconds(450))
            addingCode = true
        }
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
    fileprivate func labeled<Content: View>(_ label: LocalizedStringKey, info: HelpTopic? = nil,
                                            @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(label).foregroundStyle(.secondary)
                if let info { InfoButton(topic: info) }
            }
            content().labelsHidden()
        }
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
        content.frame(minWidth: 450, minHeight: 360).frame(idealHeight: 560)
        #else
        // iPad: the tallest sheet the screen allows, so the fields and Delete Item at the bottom show with little scrolling; the
        // default form sheet is a short card.
        content.presentationSizing(.page)
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

private struct OpenSetupKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    /// Psss, Settings… (⌘,): opens Setup in the focused window.
    var openSetup: (() -> Void)? {
        get { self[OpenSetupKey.self] }
        set { self[OpenSetupKey.self] = newValue }
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

