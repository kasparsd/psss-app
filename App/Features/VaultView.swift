import AuthenticationServices
import CoreImage.CIFilterBuiltins
import SwiftUI

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
    case conflict, editorRemoved, storeProblem, autoFillSettings, biometricOff
}

/// The tabs of the iPhone (and of iPad at compact width): All, Codes, Cards and More, then the iOS 26 search tab at the trailing end.
private enum PhoneTab: Hashable { case place(VaultPlace), more, search }

/// Where the More tab can go: the places that are not in the bar (owner, 2026-11-24).
private enum MoreRoute: Hashable { case addresses, wifi, recentlyDeleted }

/// The iPhone search as it was, kept while its field is put away ahead of a change of layout (see `changeLayout`).
private struct ParkedSearch {
    let text: String
    let fields: Set<SearchField>
    let inTab: Bool
    let path: [VaultItem.ID]
}

/// While a page is edited in place the rest of the window is dimmed and does not react (owner, 2026-11-24).
private struct DimsWhileEditing: ViewModifier {
    let editing: Bool

    func body(content: Content) -> some View {
        content
            .disabled(editing)
            .opacity(editing ? 0.4 : 1)
            .animation(.default, value: editing)
    }
}

/// Shows the search field only where the list owns it: Mac and iPad. On iPhone the search tab has it.
private struct ListSearch: ViewModifier {
    let enabled: Bool
    var disabled = false
    let text: Binding<String>
    let focus: FocusState<Bool>.Binding

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            // The field is attached to a view of its own beside the page, not to the page, so it can be disabled (and dimmed by the
            // system) while a page is edited in place without disabling that page.
            content.background {
                Color.clear
                    .searchable(text: text, prompt: "Search all items")
                    .searchFocused(focus)
                    .disabled(disabled)
            }
        } else {
            content
        }
    }
}

struct VaultView: View {
    let store: any VaultStore
    /// A place to land on when the window appears or this request changes: a place of another vault that was chosen in the
    /// sidebar, or the All place of a vault just unlocked.
    var landing: VaultLanding?
    /// Another open vault's place was chosen in the sidebar: the root shows that vault (it builds a window for its store).
    var selectVault: (UUID, VaultDestination) -> Void = { _, _ in }
    @State private var items: [VaultItem]
    /// What waits in Recently Deleted, newest deletion first. Refreshed together with `items`.
    @State private var deletedEntries: [DeletedItem]
    /// The Undo capsule after a delete.
    @State private var undoBanner = UndoBannerModel()
    /// The window's undo stack: Edit, Undo Move to Recently Deleted (and the same on iPad with a hardware keyboard).
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

    init(store: any VaultStore, landing: VaultLanding? = nil, selectVault: @escaping (UUID, VaultDestination) -> Void = { _, _ in }) {
        self.store = store
        self.landing = landing
        self.selectVault = selectVault
        _items = State(initialValue: store.items())
        _deletedEntries = State(initialValue: store.recentlyDeleted().map(DeletedItem.init))
    }
    @Environment(UnlockGate.self) private var gate
    @Environment(AutoFillStatus.self) private var autoFill
    #if os(macOS)
    @Environment(SafariExtensionStatus.self) private var safariExtension
    #endif
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var compactColumn: NavigationSplitViewColumn = .content
    @State private var compactPath: [VaultItem.ID] = []
    /// The place showing: All, Codes or Cards. Every platform has the same three; only the control differs.
    @State private var place: VaultPlace = .all
    /// iPhone: the search tab, after the places, is showing. The place underneath stays what it was.
    @State private var inSearchTab = false
    /// iPhone: the More tab is showing. The place underneath stays what it was.
    @State private var inMoreTab = false
    /// The place the More tab shows as its page; nil until the person has chosen one from the popover (owner, 2026-11-26).
    @State private var morePlace: MoreRoute?
    /// The popover of places that tapping More opens.
    @State private var showsMoreMenu = false
    /// What is open inside the place the More tab shows (an item's page).
    @State private var morePath: [VaultItem.ID] = []
    /// iPhone tabs. Each has its own stack, so each keeps its own open login.
    @State private var codesPath: [VaultItem.ID] = []
    @State private var cardsPath: [VaultItem.ID] = []
    @State private var searchPath: [VaultItem.ID] = []
    /// Bumped to bring the All list back to its very top, where the title is.
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
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    /// The layout on screen: tabs with stacks (true) or sidebar, list and item. It follows the width through `changeLayout`, which
    /// carries the shown item across first, so the new layout is built showing it. Nil until the screen first appears.
    @State private var laidOutAsStack: Bool?
    /// The layout the width asks for now. It differs from `laidOutAsStack` only while the search field is being put away.
    @State private var wantedStack = false
    /// The search tab's field is up (iPhone).
    @State private var searchPresented = false
    /// Set between putting that field away and changing the layout.
    @State private var parkedSearch: ParkedSearch?
    #if os(iOS)
    @State private var searchEnding = SearchFieldEnding()
    #endif
    /// The order of the All list, results and filters, kept on this device (owner, 2026-11-24). Codes, Cards and Recently Deleted keep
    /// their own orders.
    @AppStorage(ItemSort.storageKey) private var sortRaw = ItemSort.standard.rawValue
    private var sort: ItemSort { ItemSort(rawValue: sortRaw) ?? .standard }
    private var sortBinding: Binding<ItemSort> { Binding(get: { sort }, set: { sortRaw = $0.rawValue }) }
    /// The order the list was last laid out in. An item used or edited while the list is on screen keeps its place; the order is
    /// taken again when a sort is chosen, the filter or place changes, the search text changes, or the list next appears.
    @State private var sortRank: [VaultItem.ID: Int] = [:]
    /// The "Recently used" group as it was when the list was laid out: held still like `sortRank`, taken again at the same moments.
    /// Nil until then, when the group is taken from the list as it is.
    @State private var recentIDs: [VaultItem.ID]?
    /// Show and With, kept on this device (owner, 2026-11-24). Sort is separate (`sort`).
    @AppStorage(ItemShow.storageKey) private var showRaw = ItemShow.all.rawValue
    @AppStorage(ItemWith.storageKey) private var withRaw = 0
    private var filter: ItemFilter { ItemFilter(show: ItemShow(rawValue: showRaw) ?? .all, with: ItemWith(rawValue: withRaw)) }
    private var filterBinding: Binding<ItemFilter> {
        Binding(get: { filter }, set: { new in
            // Another kind is another list, and it is never Recently Deleted.
            if new.show != filter.show { selection = nil; showsDeleted = false }
            showRaw = new.show.rawValue
            withRaw = new.with.rawValue
        })
    }
    /// Recently Deleted is showing in the All place. Not remembered: the app never opens there.
    @State private var showsDeleted = false
    /// The row the sidebar (and the Show menu with the sidebar hidden) lights: a place, a kind, or Recently Deleted.
    private var destination: VaultDestination {
        switch place {
        case .codes: .codes
        case .cards: .cards
        case .addresses: .addresses
        case .wifi: .wifi
        case .all: showsDeleted ? .recentlyDeleted : VaultDestination(show: filter.show)
        }
    }
    private var destinationBinding: Binding<VaultDestination?> {
        Binding(get: { destination }, set: { new in
            guard let new else { return }
            choose(new)
        })
    }

    /// The vault this window is built on; nil for the sample vault.
    private var ownID: UUID? { (store as? KeePassVaultStore)?.reference.id }
    private static let sampleID = UUID()

    /// The sidebar's selection: a place of one vault. While another vault's unlock form is shown nothing is selected.
    private var sidebarBinding: Binding<VaultSelection?> {
        Binding(get: {
            guard let own = ownID else { return VaultSelection(vault: Self.sampleID, destination: destination) }
            return session.reference?.id == own ? VaultSelection(vault: own, destination: destination) : nil
        }, set: { new in
            guard let new else { return }
            guard let own = ownID else { choose(new.destination); return }
            // A place of another open vault: the root shows that vault with the place chosen.
            if new.vault != own { selectVault(new.vault, new.destination); return }
            // A place of this vault while another vault's unlock form was shown: this vault is shown again.
            if session.reference?.id != own { session.show(own) }
            choose(new.destination)
        })
    }

    /// The place and open item, as the person has them now, for `ReturnPlaces`. Never a title, a value or the search text.
    private var currentSpot: ReturnPlaces.Spot {
        var open: VaultItem.ID?
        if usesStack {
            if inSearchTab { open = searchPath.last } else {
                switch place {
                case .all: open = compactPath.last
                case .codes: open = codesPath.last
                case .cards: open = cardsPath.last
                case .addresses, .wifi: open = nil
                }
            }
        } else {
            open = selection
        }
        return ReturnPlaces.Spot(destination: destination, item: open)
    }

    /// After this vault was locked and unlocked again in this run: the place and item the person had. An item that is gone leaves
    /// the place showing, without a message.
    private func returnToSpot() {
        guard let own = ownID, let spot = session.returnPlaces.take(vault: own) else { return }
        choose(spot.destination)
        guard let id = spot.item, items.contains(where: { $0.id == id }), !isRecentlyDeleted else { return }
        if usesStack {
            showOnStack(id)
        } else {
            selection = id
            compactColumn = .detail
        }
    }

    private func applyLanding() {
        if let landing { choose(landing.destination) }
    }

    /// Selects a place or kind of this vault.
    private func choose(_ new: VaultDestination) {
        guard new != destination else { return }
        switch new {
        case .codes: placeBinding.wrappedValue = .codes
        case .cards: placeBinding.wrappedValue = .cards
        case .addresses: placeBinding.wrappedValue = .addresses
        case .wifi: placeBinding.wrappedValue = .wifi
        case .recentlyDeleted:
            placeBinding.wrappedValue = .all
            selection = nil
            showsDeleted = true
        default:
            placeBinding.wrappedValue = .all
            var next = filter
            next.show = new.show ?? .all
            filterBinding.wrappedValue = next
        }
    }
    /// The row the list selected, with its section (see `SectionedRowID`).
    @State private var pickedRow: SectionedRowID?
    private var allRowSelection: Binding<SectionedRowID?> {
        SectionedRowID.binding(outer: selectionBinding, picked: $pickedRow, recent: Set(recentGroup.map(\.id)))
    }
    /// The selected item of each place, so leaving a place and coming back finds its list as it was (Mac and iPad).
    @State private var selections: [VaultPlace: VaultItem.ID] = [:]
    private var selection: VaultItem.ID? {
        get { selections[place] }
        nonmutating set { selections[place] = newValue; autoSelected[place] = nil }
    }
    /// The rows that were selected for the person (`ensureSelection`, `selectNeighbor`), per place. Such a row is only shown beside
    /// the list: a narrower window shows the list, and does not push it.
    @State private var autoSelected: [VaultPlace: VaultItem.ID] = [:]
    /// The list's selection. At regular width the list cannot end up with rows and no selection: when the system clears it (a click on
    /// empty space, ⌘-click on the selected row, Escape) the previous row stays, see `ensureSelection`. On iPhone nothing is selected.
    private var selectionBinding: Binding<VaultItem.ID?> {
        Binding(get: { selection }, set: { new in
            // A list of the split layout that is going away must not change what is selected.
            if usesStack { return }
            if new == nil, regularVisibleItems.contains(where: { $0.id == selection }) { return }
            selection = new
        })
    }
    @State private var search = ""
    /// The fields the search is narrowed to (the pills under the results' title). None: every field. Reset with the text.
    @State private var searchFields: Set<SearchField> = []
    @FocusState private var searchFocused: Bool
    @State private var didFocusOnLaunch = false
    /// A new item being added, in a sheet. An existing item is edited on its own page, see `editingID`.
    @State private var editor: VaultItem?
    /// The item whose page is the editor right now (owner, 2026-11-24), with what was typed. While it is set, everything outside that
    /// page is dimmed and does not react: Cancel or Save come first. Held here, above both layouts, so a change of width keeps it.
    /// Memory only.
    @State private var edit = ItemEdit()
    private var editingID: VaultItem.ID? { edit.itemID }
    private var isEditingInPlace: Bool { editingID != nil }
    @State private var showsEditorRemoved = false
    @State private var showsSetup = false
    @Environment(AppleImportRequests.self) private var imports
    /// The add-vault flow being started, from the sidebar's foot, the vault menu or the File menu (`.addVaultFlow`). Settings has its own.
    @State private var addChoice: AddVaultChoice?
    /// The vault a section header's Remove Vault… asks about.
    @State private var removingVault: UUID?
    @Environment(SettingsRequests.self) private var settingsRequests
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #else
    /// The vault page the Settings sheet opens pushed to (empty: the root).
    @State private var settingsPath: [UUID] = []
    #endif
    @Environment(IncomingCodeRequests.self) private var incoming
    /// A new login started from a site's setup link; the editor opens once the link's sheet has gone.
    @State private var editorAfterLink: VaultItem?
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
            inMoreTab = false
            // Choosing All, or another place, leaves Recently Deleted.
            if new != place || new == .all { showsDeleted = false }
            place = new
        })
    }

    /// The Sort menu applies to the list that follows it: All and its filters, and search results, never Recently Deleted, Codes or
    /// Cards (which keep their own orders).
    private var showsSort: Bool { (isSearching || place == .all) && !isRecentlyDeleted }

    /// Takes the order of the whole vault as the sort gives it now, so every filter and search shows its items in it.
    private func resnapshotOrder() {
        sortRank = sort.ranks(of: items)
        recentIDs = RecentlyUsed.group(from: filter.listed(items)).map(\.id)
    }

    private var isSearching: Bool { !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The All list is showing: in the All place, and on iPhone also in the search tab, which is that list with a field.
    private var showsAllList: Bool { place == .all || searchTabShown }

    /// The search tab is on screen. `inSearchTab` is kept while the window is wide, so narrowing it again returns there.
    private var searchTabShown: Bool { usesStack && inSearchTab }

    /// Show and With narrow the list on screen, not search: typing always searches the whole vault (owner, 2026-11-24), and the
    /// iPhone search tab lists the whole vault too, so a missing result never comes from a forgotten filter.
    private var narrowsList: Bool { !isSearching && !searchTabShown }

    /// The Recently Deleted list is showing. Searching leaves it: results come from the live vault, deleted items never turn up in
    /// them.
    private var isRecentlyDeleted: Bool { showsDeleted && place == .all && !searchTabShown && !isSearching }

    /// What the Recently Deleted list shows (kept for its empty-state branches; a search leaves the list).
    private var deletedResults: [DeletedItem] { ItemSearch.matching(deletedEntries, query: search) }

    private var results: [VaultItem] {
        if isRecentlyDeleted { return deletedResults.map(\.item) }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = items.filter { item in (!narrowsList || filter.includes(item)) && ItemSearch.matches(item, query: query, in: searchFields) }
        return sort.ordered(matches, rank: sortRank)
    }

    /// The "Recently used" group at the top of the All list: only in the default order, never while searching, and only above a list
    /// of more than five items (owner, 2026-11-24). Every one of its items is in `results` too, so the list below is complete.
    private var recentGroup: [VaultItem] {
        guard sort == .recentlyUsed, narrowsList, place == .all, !isRecentlyDeleted else { return [] }
        return RecentlyUsed.visible(snapshot: recentIDs, in: results)
    }

    /// `list` once per item, in its order.
    private func unique(_ list: [VaultItem]) -> [VaultItem] {
        var seen = Set<VaultItem.ID>()
        return list.filter { seen.insert($0.id).inserted }
    }

    private var usesStack: Bool { laidOutAsStack ?? wantsStack }

    private var wantsStack: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    // MARK: Width changes

    /// The item on the page of the stack layout's tab that is showing; nil when that tab shows its list.
    private var stackShownItem: VaultItem.ID? {
        if let editingID { return editingID }
        if inSearchTab { return searchPath.last }
        if inMoreTab { return morePath.last }
        return switch place {
        case .all: compactPath.last
        case .codes: codesPath.last
        case .cards: cardsPath.last
        case .addresses, .wifi: nil
        }
    }

    /// The item beside the list that the person opened or edited; nil when there is none, or its row was only selected for them.
    private var splitShownItem: VaultItem.ID? {
        if let editingID { return editingID }
        guard !shownVaultIsLocked, let id = selection, autoSelected[place] != id,
              regularVisibleItems.contains(where: { $0.id == id }) else { return nil }
        return id
    }

    /// The window became narrow or wide (a foldable's posture, an iPad window): the item on screen stays on screen.
    private func changeLayout(toStack stack: Bool) {
        wantedStack = stack
        // A search that is being put away finishes the change itself, see `finishParkedSearch`.
        #if os(iOS)
        guard parkedSearch == nil else { return endParkedSearch() }
        #endif
        guard let old = laidOutAsStack, old != stack else { laidOutAsStack = stack; return }
        #if os(iOS)
        // UIKit throws ("Tried to invalidate an assertion that is already invalid", iOS 27.2) when the search tab is removed
        // while its field is up. The field is ended first, and the layout changes when UIKit reports that it is gone.
        if old, searchEnding.isUp {
            parkedSearch = ParkedSearch(text: search, fields: searchFields, inTab: inSearchTab, path: searchPath)
            endParkedSearch()
            return
        }
        #endif
        let open = old ? stackShownItem : splitShownItem
        laidOutAsStack = stack
        if stack {
            // The places have no search field on iPhone, so results are only ever shown in the search tab.
            if isSearching { inSearchTab = true; inMoreTab = false; showsDeleted = false }
            showOnStack(open)
        } else {
            showBesideList(open)
        }
    }

    #if os(iOS)
    private func endParkedSearch() {
        searchEnding.end {
            searchFocused = false
            searchPresented = false
        } then: {
            finishParkedSearch()
        }
    }

    /// The search field is gone: gives the search back what ending it cleared, and changes the layout. If the window is narrow
    /// again by then, the field comes back instead.
    private func finishParkedSearch() {
        guard let parked = parkedSearch else { return }
        parkedSearch = nil
        search = parked.text
        searchFields = parked.fields
        inSearchTab = parked.inTab
        searchPath = parked.path
        if wantedStack { searchPresented = parked.inTab } else { changeLayout(toStack: false) }
    }
    #endif

    /// Puts the stack layout on the tab for the place showing, with `id` pushed, or its list when `id` is nil.
    private func showOnStack(_ id: VaultItem.ID?) {
        let path = id.map { [$0] } ?? []
        if inSearchTab { searchPath = path; return }
        let more: MoreRoute? = switch place {
        case .addresses: .addresses
        case .wifi: .wifi
        case .all: isRecentlyDeleted ? .recentlyDeleted : nil
        case .codes, .cards: nil
        }
        inMoreTab = more != nil
        if let more {
            morePlace = more
            morePath = path
            // The More tab has Recently Deleted as its own page; the All tab goes back to its items.
            if more == .recentlyDeleted { showsDeleted = false }
        } else {
            switch place {
            case .all: compactPath = path
            case .codes: codesPath = path
            case .cards: cardsPath = path
            case .addresses, .wifi: break
            }
        }
    }

    /// Selects `id` in the split layout, in a list that has it. With nil the first row is selected, as always.
    private func showBesideList(_ id: VaultItem.ID?) {
        if !inSearchTab, inMoreTab, let morePlace {
            switch morePlace {
            case .addresses: place = .addresses
            case .wifi: place = .wifi
            case .recentlyDeleted: place = .all
            }
            showsDeleted = morePlace == .recentlyDeleted
        }
        let item = items.first { $0.id == id }
        if let id, item != nil || deletedEntries.contains(where: { $0.id == id }) {
            // The place underneath may not list it (an item opened from the search tab): All does, with the filter widened.
            if !regularVisibleItems.contains(where: { $0.id == id }) {
                if isSearching { search = "" }
                place = .all
                showsDeleted = item == nil
                if let item {
                    let wider = filter.revealing(item)
                    showRaw = wider.show.rawValue
                    withRaw = wider.with.rawValue
                }
            }
            selection = id
            compactColumn = .detail
        } else {
            selection = nil
        }
        ensureSelection()
    }

    // In two parts: one chain of this length is more than the compiler can type-check.
    private var withEndingsAndSearch: some View {
        withSceneValues
            .onChange(of: wantsStack, initial: true) { _, stack in changeLayout(toStack: stack) }
            // What was typed goes with the vault: when it locks, and when another vault is shown.
            .onChange(of: gate.isUnlocked) { edit.end() }
            .onChange(of: session.reference?.id) { edit.end() }
            .onChange(of: shownVaultIsLocked) { _, locked in if locked { edit.end() } }
            #if os(macOS)
            // Edit, Delete (system item) and the Delete key act on the selected item while the list has focus. A text field
            // that has focus handles both itself. ⌘⌫ belongs to the labeled item under it, Move to Recently Deleted (`deleteCommand`).
            .onDeleteCommand { deleteSelectedAction?() }
            #endif
            // Another place starts with no search: the person asked for something else.
            .onChange(of: place) { search = "" }
    }

    var body: some View {
        withEndingsAndSearch
            // The list takes its order again when a sort is chosen, the filter or place changes or the search text changes (and when
            // it next appears, see `itemResults`); in between it holds still.
            .onChange(of: sortRaw) { resnapshotOrder() }
            .onChange(of: filter) { resnapshotOrder() }
            .onChange(of: showsDeleted) { resnapshotOrder() }
            .onChange(of: place) { resnapshotOrder() }
            .onChange(of: search) { resnapshotOrder(); if !isSearching { searchFields = [] } }
            .onChange(of: inSearchTab) { resnapshotOrder() }
            .onChange(of: place) { hideSignal += 1 }
            .onChange(of: inSearchTab) { hideSignal += 1 }
            .onChange(of: selections) { hideSignal += 1 }
            .task { if store.isSample { VaultIdentities.removeAll() } else { registerIdentities() } }
            // Another open vault's place was chosen, or a vault was just unlocked: land on that place.
            .onAppear { applyLanding(); returnToSpot() }
            .onChange(of: landing) { applyLanding() }
            // Where the person is, kept in memory for after a lock (see `ReturnPlaces`).
            .onChange(of: currentSpot) { _, spot in if let own = ownID { session.returnPlaces.note(spot, vault: own) } }
            // AutoFill has just been found on, by the system's prompt or on coming back from Settings. Logins saved while it was
            // off were never sent to the system, so they are sent now, without waiting for the next unlock.
            .onChange(of: autoFill.reading) { old, new in if new == .on, old != .on { registerIdentities(knownEnabled: true) } }
            // The menu bar saved or reloaded this vault: show what the store holds now, so no old copy of an item is edited.
            .onReceive(NotificationCenter.default.publisher(for: .vaultChangedOutsideWindow)) { _ in adoptReloadedVault() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { reloadIfChangedOnDisk() }
            }
    }

    /// A vault was created, opened or imported from the Add a Vault sheet: it is open now, in place of the one that was.
    private func vaultAdded() {
        showsSetup = false
        gate.markUnlocked()
        vaultSource = RootView.keePassSource
    }

    /// Choosing a vault in the vault menu: it is shown. An open vault shows at once, with no password; a locked one shows its
    /// unlock form. No other vault is locked or unlocked by the choice.
    private func switchVault(to id: UUID) {
        session.show(id)
    }

    /// Locks one vault (a section header's menu): the other open vaults stay open.
    private func lockVault(_ id: UUID) {
        session.lock(id)
    }

    /// Locks this window's vault because the file's password changed elsewhere, and shows its unlock form with the reason. The
    /// other vaults stay open; with none open the whole window locks (`gate`).
    private func lockForChangedFile() {
        guard let own = ownID, session.openVaults.count > 1 else { gate.lock(notice: Self.changedElsewhereNotice); return }
        gate.lockNotice = Self.changedElsewhereNotice
        session.lock(own)
        session.show(own)
    }

    /// The vault button of the iPhone toolbar (the glyph) and of iPad with the sidebar hidden (glyph and name): a menu with every
    /// vault in the fixed order (a check on the shown one, a padlock only on a locked one), the shown vault's Vault Settings…,
    /// Lock and, with two or more open, Lock All Vaults, and the three add items. Shown with one vault too.
    @ViewBuilder
    private func vaultMenuButton(_ style: VaultSwitcher.Style) -> some View {
        if store is KeePassVaultStore {
            VaultSwitcher(session: session, style: style, context: .app, choose: switchVault,
                          add: { addChoice = $0 }, lock: { session.lock() }, lockAll: { session.lockAllByChoice() },
                          settings: { if let id = session.reference?.id { showVaultSettings(id) } })
                .disabled(isEditingInPlace)
        }
    }

    /// Settings (the gear): the Mac's Settings window, or the sheet on iPhone and iPad.
    private func showSettings() {
        #if os(macOS)
        openSettings()
        #else
        settingsPath = []
        showsSetup = true
        #endif
    }

    /// Settings at a vault's page.
    private func showVaultSettings(_ id: UUID) {
        #if os(macOS)
        settingsRequests.show(.vault(id))
        openSettings()
        #else
        settingsPath = [id]
        showsSetup = true
        #endif
    }

    /// Psss, Settings… (⌘,) on iPad with a keyboard. The Mac has its own Settings window and no sheet.
    private var openSetupAction: (() -> Void)? {
        #if os(iOS)
        isEditingInPlace ? nil : { showsSetup = true }
        #else
        nil
        #endif
    }

    private var withSceneValues: some View {
        withMenuCommandValues
            .focusedSceneValue(\.deleteSelection, deleteCommand)
            .focusedSceneValue(\.itemSort, showsSort && !isEditingInPlace ? sortBinding : nil)
            // Show and With describe the All list: off in Codes, Cards, Recently Deleted and search.
            .focusedSceneValue(\.itemFilter, place == .all && !isRecentlyDeleted && narrowsList && !isEditingInPlace ? filterBinding : nil)
    }

    private var withMenuCommandValues: some View {
        withSheets
            // Menu commands that would leave the page being edited are off until Save or Cancel.
            .focusedSceneValue(\.newItem, isEditingInPlace ? nil : { kind in editor = VaultItem(kind: kind) })
            .focusedSceneValue(\.startAddVault, isEditingInPlace ? nil : { addChoice = $0 })
            .focusedSceneValue(\.vaultPlace, isEditingInPlace ? nil : placeBinding)
            .focusedSceneValue(\.openSetup, openSetupAction)
            #if os(iOS)
            .focusedSceneValue(\.vaultMenu, vaultMenuCommands)
            #endif
    }

    #if os(iOS)
    /// File, Vault Settings… and Lock <name> or Lock All Vaults (iPad with a keyboard). On the Mac the root view supplies them (it
    /// also covers the locked window).
    private var vaultMenuCommands: VaultMenuCommands? {
        guard !isEditingInPlace, store is KeePassVaultStore, let reference = session.reference else { return nil }
        return VaultMenuCommands.make(session: session) { showVaultSettings(reference.id) }
    }
    #endif

    /// Edit, Delete (⌘⌫) on Mac: moves the selected item to Recently Deleted (Undo follows), or asks before deleting one that is
    /// already in Recently Deleted for good. Off while the editor is open or the search field has focus (⌘⌫ edits its text there).
    private var deleteSelectedAction: (() -> Void)? {
        guard !usesStack, editor == nil, !isEditingInPlace, !searchFocused, !sheetIsOpen,
              let id = regularVisibleItems.first(where: { $0.id == selection })?.id else { return nil }
        if items.contains(where: { $0.id == id }) { return { delete(id) } }
        if deletedEntries.contains(where: { $0.id == id }) { return { deletionRequest = .one(id) } }
        return nil
    }

    /// The same for the Edit menu, with the words that say what happens: "Move to Recently Deleted" for an item of the vault,
    /// "Delete Now…" for one that is already in Recently Deleted (it asks first).
    private var deleteCommand: DeleteSelectionCommand? {
        guard let action = deleteSelectedAction, let id = selection else { return nil }
        return DeleteSelectionCommand(permanent: !items.contains(where: { $0.id == id }), run: action)
    }

    private var withSheets: some View {
        let editorSheets = base
            .sheet(item: $editor) { item in
                NewItemSheet(item: item, onSave: save, onKeepDraft: keepDraft)
                    .modifier(AlertSurfaceModifier(surface: .editor, owner: self))
            }
            // A site's setup link (otpauth://) waits here until no other sheet is open. Choosing a login saves nothing.
            .sheet(item: Binding(get: { showsSetup || changingPassword || editor != nil ? nil : incoming.pending },
                                 set: { if $0 == nil { incoming.clear() } }), onDismiss: {
                incoming.clear()
                if let item = editorAfterLink { editorAfterLink = nil; editor = item }
            }) { link in
                IncomingCodeSheet(result: link.result, logins: items.filter { $0.kind == .login }, onSave: saveIncomingCode) { setup in
                    editorAfterLink = IncomingCodeMatch.newLogin(for: setup)
                }
            }
        #if os(iOS)
        return editorSheets
            .sheet(isPresented: $showsSetup, onDismiss: {
                // Change Vault Password opens its own sheet, but only once this one has gone.
                if wantsPasswordChange { wantsPasswordChange = false; changingPassword = true }
            }) { setupSheet.modifier(AlertSurfaceModifier(surface: .setup, owner: self)) }
        #else
        return editorSheets
            // The Mac Settings window asks for Change Vault Password here, where its sheet belongs.
            .onChange(of: settingsRequests.changePassword) { _, asked in
                if asked { settingsRequests.changePassword = false; changingPassword = true }
            }
        #endif
    }

    private var base: some View {
        // A ZStack, not a Group: a Group hands its modifiers to whichever layout is in it, so they would start over on a width change.
        ZStack {
            if usesStack { stackLayout } else { splitLayout }
        }
        .addVaultFlow($addChoice, session: session) { vaultAdded() }
        .modifier(VaultRemoval(request: $removingVault, session: session))
        // An import wrote a vault (the import sheet belongs to the app, above this window).
        .onChange(of: imports.imported) { refresh(); registerIdentities() }
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
        .task {
            // The key AutoFill and Face ID open the vault with is saved without a question (owner, 2026-11-24). No passcode on the
            // device, or a Keychain refusal, leaves it unsaved and the next password unlock tries again.
            if let own = store as? KeePassVaultStore, session.biometricNotice == nil, session.shouldOfferBiometric(for: own.reference.id) {
                try? session.enableBiometric(for: own.reference.id)
            }
        }
        .sheet(isPresented: $changingPassword) {
            if let store = store as? KeePassVaultStore { ChangePasswordSheet(store: store, onReloaded: { adoptReloadedVault() },
                                                          onChangedElsewhere: { lockForChangedFile() }) }
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
        if session.biometricNotice != nil { waiting.append(.biometricOff) }
        return waiting
    }

    private var sheetIsOpen: Bool { showsSetup || changingPassword || editor != nil || incoming.pending != nil }

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
        case .biometricOff: return "\(faceID) is off"
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
                reloadingEditedItem = editor?.id ?? editingID
                editor = nil
                edit.end()
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
        case .biometricOff:
            Button("OK") { session.biometricNotice = nil }
        }
    }

    @ViewBuilder fileprivate func alertMessage(_ kind: VaultAlert) -> some View {
        switch kind {
        case .conflict:
            Text("The vault file was changed by another app or device since Psss last read it. Reload shows that version and discards the change you just made. Save My Change Anyway writes the vault as Psss has it, with your change, over the file; the version it replaces is kept as a backup copy on this device.")
        case .editorRemoved:
            Text("It was removed on another device or in another app, so editing stopped. Changes you had not saved were not kept.")
        case .storeProblem: Text(storeProblem ?? "")
        case .autoFillSettings: Text(AutoFillCopy(device: .current).settingsFailedMessage)
        case .biometricOff: Text(session.biometricNotice ?? "")
        }
    }

    /// A new vault has nothing to select, so there is no list, no detail pane and no search: just the ways to fill it.
    private var emptyVault: some View {
        ScrollView {
            VStack(spacing: 24) {
                // A new vault is where a new person learns about AutoFill, so the card sits above the empty state.
                if showsAutoFillCard { ReminderCards(vault: autoFillVault) }
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
                    emptyChoice("Add a note", "note.text") { editor = VaultItem(kind: .secureNote) }
                    emptyChoice("Import from Apple Passwords", "square.and.arrow.down") { addChoice = .importPasswords }
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
            Tab("More", systemImage: "ellipsis", value: PhoneTab.more) { moreTab }
                .popover(isPresented: $showsMoreMenu, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) { moreMenu }
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
    /// title is.
    private var tabSelection: Binding<PhoneTab> {
        Binding(get: { inSearchTab ? .search : inMoreTab ? .more : .place(place) }, set: { new in
            let current: PhoneTab = inSearchTab ? .search : inMoreTab ? .more : .place(place)
            if new == current {
                switch new {
                case .place(.all):
                    // One tap does both: closes an open login, then brings the list to its very top. It also leaves Recently Deleted.
                    showsDeleted = false
                    scrollAfterPop = !compactPath.isEmpty
                    compactPath = []
                    scrollToTop += 1
                case .place(.codes): codesPath = []
                case .place(.cards): cardsPath = []
                case .place(.addresses), .place(.wifi): break
                case .more: morePath = []
                case .search: searchPath = []
                }
            }
            if new == .more {
                // More is not a page of its own: tapping it opens the popover of places. With a place already chosen, More also
                // shows that place underneath, so dismissing the popover leaves the person where they were.
                showsMoreMenu = true
                if morePlace != nil { inSearchTab = false; inMoreTab = true }
                return
            }
            switch new {
            case .place(let chosen): inSearchTab = false; inMoreTab = false; place = chosen; if chosen != .all { showsDeleted = false }
            case .more: break
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
                // own full inset. A new NavigationStack starts with a fresh bar: large title expanded, list at its resting top,
                // tab bar not minimized. After a pop it waits for the bar to finish coming back.
                let afterPop = scrollAfterPop
                Task { @MainActor in
                    if afterPop { try? await Task.sleep(for: .milliseconds(450)) } else { await Task.yield() }
                    stackIdentity += 1
                }
            }
    }

    private var allStack: some View {
        NavigationStack(path: $compactPath) {
            itemResults(results)
                .navigationDestination(for: VaultItem.ID.self) { id in
                    detail(for: id)
                }
                .toolbar {
                    // The gear and the vault button are two buttons, not one group (owner, 2026-11-25).
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "gearshape") { showSettings() }
                            .labelStyle(.iconOnly)
                    }
                    ToolbarSpacer(.fixed, placement: .topBarLeading)
                    ToolbarItem(placement: .topBarLeading) { vaultMenuButton(.icon) }
                    // Sort, Filter, then Add, as Apple's Passwords has Sort before Add. Filter stays in Recently Deleted: it is the
                    // way back to All.
                    if showsSort {
                        ToolbarItem(placement: .topBarTrailing) { SortMenu(sort: sortBinding) }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        FilterMenu(scope: .kinds, destination: destinationBinding, filter: filterBinding)
                    }
                    if showsAddOrDeleteAll {
                        // Sort and Filter share one capsule; Add (or Delete All…) stands in its own beside it (owner, 2026-11-24).
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

    /// The More tab shows the place chosen in `moreMenu` as its page (owner, 2026-11-26, mock `#/places` option B). Tapping the tab opens
    /// that popover, so the tab never shows a list of places itself; its label stays "More". An item opens on this tab's own stack.
    private var moreTab: some View {
        NavigationStack(path: $morePath) {
            Group {
                switch morePlace {
                case .addresses: addressesView
                case .wifi: wifiView
                case .recentlyDeleted: deletedList
                case nil: Color.clear
                }
            }
            .navigationDestination(for: VaultItem.ID.self) { id in
                detail(for: id)
            }
            .undoBanner(undoBanner)
        }
    }

    /// The popover above the More tab: the places that are not in the bar, with their counts, and Recently Deleted apart. It stays a
    /// popover on iPhone (not a sheet). A place is one more row, never one more tab. The symbols are the sidebar's.
    private var moreMenu: some View {
        VStack(spacing: 0) {
            moreMenuRow(.addresses, "Addresses", VaultPlace.addresses.symbol, count: items.count(where: { $0.kind == .address }))
            Divider()
            moreMenuRow(.wifi, "Wi-Fi", VaultPlace.wifi.symbol, count: items.count(where: { $0.kind == .wifi }))
            Divider().padding(.vertical, 4)
            moreMenuRow(.recentlyDeleted, "Recently Deleted", VaultDestination.recentlyDeleted.symbol, count: deletedEntries.count)
        }
        .padding(.vertical, 4)
        .frame(minWidth: 260)
        // A popover is sized once, so wrapped rows at the accessibility sizes overlap and a single line is cut short ("Address…"). Like
        // Apple's own menus, it stops growing at the largest regular size (checked on the iPhone 17 simulator, 2026-11-26).
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .presentationCompactAdaptation(.popover)
    }

    private func moreMenuRow(_ route: MoreRoute, _ title: LocalizedStringKey, _ symbol: String, count: Int) -> some View {
        Button {
            morePlace = route
            morePath = []
            inSearchTab = false
            inMoreTab = true
            showsMoreMenu = false
        } label: {
            HStack {
                Label(title, systemImage: symbol)
                Spacer(minLength: 16)
                if count > 0 { Text(verbatim: count.formatted()).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(count > 0 ? RecentlyDeletedText.itemCount(count) : "")
    }

    /// Recently Deleted as a page of the More tab: what waits there, newest first, Restore on a swipe and in the item's own page.
    private var deletedList: some View {
        List {
            ForEach(deletedResults) { deletedRow($0, first: $0.id == deletedResults.first?.id, last: $0.id == deletedResults.last?.id) }
            if !deletedResults.isEmpty {
                RecentlyDeletedFooter()
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
        .itemListStyle()
        .overlay {
            if deletedEntries.isEmpty { RecentlyDeletedEmpty { inMoreTab = false; place = .all; showsDeleted = false } }
        }
        .navigationTitle(VaultDestination.recentlyDeleted.title)
        .navigationSubtitle(RecentlyDeletedText.itemCount(deletedEntries.count))
        .toolbar {
            if !deletedEntries.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { DeleteAllButton { deletionRequest = .all } }
            }
        }
    }

    /// The search tab is the All screen with the TabView's field: the whole vault, filtered in place as the person types, in the
    /// order the Sort menu chose. A result with a code shows it live.
    private var searchTab: some View {
        NavigationStack(path: $searchPath) {
            itemResults(results)
                .background { SearchFieldReader(ending: searchEnding) }
                .navigationDestination(for: VaultItem.ID.self) { id in
                    detail(for: id)
                }
                .undoBanner(undoBanner)
        }
        // `.searchable` goes on the search tab's own content, not on the TabView: iOS then draws the field at the bottom above the
        // keyboard when the tab is selected, and the field's X returns to the previous tab by itself, with no field left on it.
        // (On the TabView, with `isPresented` and a programmatic tab change, the X left an inline field on the tab it returned to;
        // proved in a probe on iOS 27.2.)
        .searchable(text: $search, isPresented: $searchPresented, prompt: "Search all items")
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

    private var addressesView: some View {
        AddressesView(items: items, selection: usesStack ? nil : selectionBinding, add: { editor = VaultItem(kind: .address) })
            #if os(iOS)
            .navigationBarTitleDisplayMode(usesStack ? .automatic : .inline)
            .toolbar {
                if usesStack {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { editor = VaultItem(kind: .address) } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                Text("Add address")
                            }
                        }
                    }
                }
            }
            #endif
    }

    private var wifiView: some View {
        WifiView(items: items, selection: usesStack ? nil : selectionBinding, add: { editor = VaultItem(kind: .wifi) })
            #if os(iOS)
            .navigationBarTitleDisplayMode(usesStack ? .automatic : .inline)
            .toolbar {
                if usesStack {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { editor = VaultItem(kind: .wifi) } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                Text("Add network")
                            }
                        }
                    }
                }
            }
            #endif
    }

    private var cardsView: some View {
        CardsView(items: items, selection: usesStack ? nil : selectionBinding,
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
            } else if inMoreTab {
                morePath.append(id)
            } else {
                switch place {
                case .all: compactPath.append(id)
                case .codes: codesPath.append(id)
                case .cards: cardsPath.append(id)
                case .addresses, .wifi: morePath.append(id)
                }
            }
        } else {
            selection = id
            compactColumn = .detail
        }
    }

    /// Codes' empty state: the logins, which are where a code is added.
    private func showLogins() {
        filterBinding.wrappedValue = ItemFilter(show: .logins)
        showsDeleted = false
        inSearchTab = false
        inMoreTab = false
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
        morePath = []
        searchPath = []
    }

    private func sidebarRow(_ row: VaultDestination) -> some View {
        NavigationLink(value: VaultSelection(vault: ownID ?? Self.sampleID, destination: row)) {
            Label(row.title, systemImage: row.symbol)
                // Recently Deleted shows how many items wait in it, and nothing when it is empty.
                .badge(row == .recentlyDeleted ? deletedEntries.count : items.count(where: row.includes))
        }
    }

    /// The item's page: the vault's own, or the read-only one of an item in Recently Deleted. Ids are never in both lists.
    @ViewBuilder
    private func detail(for id: VaultItem.ID) -> some View {
        if let item = items.first(where: { $0.id == id }) {
            ItemDetail(item: item, hideSignal: hideSignal,
                       vault: store.title, vaultLocation: (store as? KeePassVaultStore).flatMap { $0.reference.managed ? nil : $0.reference.fileName },
                       edit: edit, beganEditing: { autoSelected[place] = nil },
                       save: saveEdited, keepDraft: keepDraft, mapFields: { mapping in
                           try saveMapping(mapping, of: item.id)
                       }, delete: { delete(item.id) }, used: { markUsed(item.id) })
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

    /// What the list column shows at regular width, in the order it shows it, each item once: the place's own list, or the results of
    /// the whole vault while a search is typed. A "Recently used" group comes first when there is one, so the first row is the first
    /// of the group. Codes and Cards list the group, then every item A to Z (Cards: the expired ones last).
    private var regularVisibleItems: [VaultItem] {
        if isSearching || place == .all { return unique(recentGroup + results) }
        if place == .codes {
            let withCode = items.filter { $0.traits.contains(.code) }
                .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
            return unique(RecentlyUsed.visible(snapshot: nil, in: withCode) + withCode)
        }
        if place == .addresses {
            let ordered = AddressesOrder.ordered(items)
            return unique(ordered.recent + ordered.all)
        }
        if place == .wifi {
            return items.filter { $0.kind == .wifi }
                .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
        }
        let cards = CardsOrder.ordered(items)
        return unique(cards.recent + cards.live + cards.expired)
    }

    /// Mac and iPad: the detail pane is never empty while the list has a row. When nothing in the list is selected (a place or filter
    /// was opened, a search replaced the list, the selected item went away) the first row is selected. Choosing a row this way only
    /// shows it: it is not a use, so the order does not change, and focus stays where it is, so typing in the search field goes on.
    /// A selection the person made stays when its item is still listed.
    private func ensureSelection() {
        guard !usesStack else { return }
        let visible = regularVisibleItems
        if let current = selection, visible.contains(where: { $0.id == current }) { return }
        selection = visible.first?.id
        autoSelected[place] = selection
    }

    /// After a removal: selects the row that followed the removed one in `before` (the list as it was), or the one before it when it
    /// was last. Mac and iPad only.
    private func selectNeighbor(of id: VaultItem.ID, in before: [VaultItem.ID]) {
        guard !usesStack, let index = before.firstIndex(of: id) else { return }
        let remaining = before.filter { $0 != id }
        selection = remaining.isEmpty ? nil : remaining[min(index, remaining.count - 1)]
        autoSelected[place] = selection
    }

    /// Mac and iPad at regular width, the same on both: sidebar, list and item for every place. The sidebar lists Codes and Cards
    /// beside the filters, and the person can hide it with the standard button; that state is kept across places because it lives
    /// in `VaultView`, like the chosen filter and each place's selected item.
    private var splitLayout: some View { allSplit }

    /// The toolbar follows the columns, on Mac and iPad alike: Sort, Filter and Add are the list column's
    /// (`listToolbar`), Edit and the one search field are the item column's, whether or not an item is open. The search field is
    /// attached to the item column, so typing on Codes or Cards swaps the list for results without losing the field. The detail also
    /// never stays empty while the list has a row (`ensureSelection`).
    private func regularChrome<Content: View>(_ content: Content) -> some View {
        content
            .navigationSplitViewStyle(.balanced)
            .onAppear { ensureSelection() }
            .onChange(of: place) { ensureSelection() }
            .onChange(of: regularVisibleItems.map(\.id)) { ensureSelection() }
            // Any other way the selection is lost (a sidebar row that yields the same rows, a stored selection that is gone).
            .onChange(of: selections) { ensureSelection() }
    }

    #if os(iOS)
    private var setupButton: some View {
        Button("Settings", systemImage: "gearshape") { showSettings() }
            .labelStyle(.iconOnly)
            .help("Settings")
            .disabled(isEditingInPlace)
    }
    #endif

    /// The Filter button of the list column. With the sidebar visible it belongs to the All list only (Codes, Cards and Recently
    /// Deleted have no Show or With). With the sidebar hidden it stays everywhere, since it is then the only way to change place.
    private var showsRegularFilter: Bool { columns != .all || (place == .all && !isRecentlyDeleted) }

    /// The list column's toolbar: Sort (where it applies), Filter and a labeled Add (Delete All… in Recently Deleted). The sidebar is
    /// the one control that chooses a place, so there is no All | Codes | Cards control here.
    @ToolbarContentBuilder
    private var listToolbar: some ToolbarContent {
        #if os(iOS)
        // While the sidebar is hidden its foot (Add Vault, the gear) is out of reach, so the gear and the vault button come here,
        // after the system's sidebar button: two separate buttons, the vault button with its name where it fits.
        if columns != .all {
            ToolbarItem(placement: .topBarLeading) { setupButton }
            ToolbarSpacer(.fixed, placement: .topBarLeading)
            ToolbarItem(placement: .topBarLeading) { vaultMenuButton(.capsule) }
        }
        #endif
        // Sort applies to All, its filters and search results only.
        if showsSort {
            ToolbarItem(placement: .primaryAction) { SortMenu(sort: sortBinding).disabled(isEditingInPlace) }
        }
        if showsRegularFilter {
            ToolbarItem(placement: .primaryAction) {
                FilterMenu(scope: columns == .all ? .withOnly : .everyPlace, destination: destinationBinding, filter: filterBinding)
                    // Typing searches the whole vault, so Show and With have nothing to do until the field is cleared.
                    .disabled(isEditingInPlace || isSearching)
            }
        }
        if showsAddOrDeleteAll {
            // Sort and Filter share one capsule; Add (or Delete All…) stands in its own at the trailing edge of the list column,
            // next to the item column's Edit, so adding and editing sit together (owner, 2026-11-26).
            ToolbarSpacer(.flexible, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) { addOrDeleteAll.disabled(isEditingInPlace) }
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
        #if os(macOS)
        // All column toolbars share the one window toolbar, and Mac only starts the item column's section at its own toolbar content:
        // with none (no item open: no rows, or an empty vault) the list column's control and Add are laid out in the item column,
        // beside the search field (confirmed by running it). A flexible spacer is that content, invisible. With an item open its Edit is.
        .toolbar {
            if visible.first(where: { $0.id == selection }) == nil { ToolbarSpacer(.flexible, placement: .primaryAction) }
        }
        #endif
        // The item column's toolbar is the open item's labeled Edit (it has its own, hidden when nothing is open) and the one
        // search field, "Search all items", which searches the whole vault from any place and swaps the list for results.
        .modifier(ListSearch(enabled: true, disabled: isEditingInPlace, text: $search, focus: $searchFocused))
        .onSubmit(of: .search) { openTopResult() }
    }

    /// Another vault's unlock form is shown: it fills the content area, and this window's sidebar stays, with every open vault's
    /// places, so choosing a place of an open vault goes straight back to it.
    private var shownVaultIsLocked: Bool {
        guard store is KeePassVaultStore, let shown = session.reference else { return false }
        return !session.isOpen(shown.id)
    }

    /// The sidebar, one section per vault: every open vault expanded with its places, every locked vault collapsed with a padlock
    /// (owner, 2026-11-25, mock `#/vault-switcher` D, D2, E).
    private var sidebarColumn: some View {
        List(selection: sidebarBinding) {
            if store is KeePassVaultStore {
                VaultSections(session: session, choose: switchVault, settings: showVaultSettings, lock: lockVault,
                              remove: { removingVault = $0 }) { vault in
                    if vault.id == ownID {
                        ForEach(VaultDestination.sidebar, id: \.self, content: sidebarRow)
                    } else if let other = session.store(for: vault.id) {
                        OtherVaultPlaces(vault: vault.id, store: other)
                    }
                }
            } else {
                Section(store.title) {
                    ForEach(VaultDestination.sidebar, id: \.self, content: sidebarRow)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollBounceBehavior(.basedOnSize)
        .modifier(DimsWhileEditing(editing: isEditingInPlace))
        // No title in the bar: each section's header names its vault (owner, 2026-11-25, mock `#/vault-switcher` H to J).
        .columnTitleInList(true)
        // The foot, pinned to the bottom: Add Vault and the Settings gear (the gear is not in a toolbar, on Mac or iPad).
        .safeAreaBar(edge: .bottom, spacing: 0) {
            VaultSidebarFoot(showsAdd: store is KeePassVaultStore, add: { addChoice = $0 }, openSettings: showSettings)
                .disabled(isEditingInPlace)
        }
        // Wide enough that "Recently Deleted" and its count stay on one line at the default text size on iPad (180 to 220 pt
        // wrapped them), and the same on Mac.
        .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 320)
    }

    private var allSplit: some View {
        regularChrome(
            Group {
                if shownVaultIsLocked {
                    NavigationSplitView(columnVisibility: $columns) {
                        sidebarColumn
                    } detail: {
                        VaultUnlockPane(session: session, gate: gate)
                    }
                } else {
                    openSplit
                }
            }
        )
    }

    private var openSplit: some View {
            NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
                sidebarColumn
            } content: {
                Group {
                    if isSearching || place == .all {
                        itemResults(results)
                    } else if place == .codes {
                        codesView
                    } else if place == .addresses {
                        addressesView
                    } else if place == .wifi {
                        wifiView
                    } else {
                        cardsView
                    }
                }
                .modifier(DimsWhileEditing(editing: isEditingInPlace))
                // Wide enough for the names, with the code button or the card's summary beside them.
                .navigationSplitViewColumnWidth(min: 340, ideal: 400, max: 560)
                .toolbar { listToolbar }
            } detail: {
                regularDetail
            }
    }

    // MARK: Settings (iPhone and iPad; the Mac has a Settings window, `MacSettingsView`)
    //
    // The root lists the vaults (each pushes its own page) and the app's own rows, which apply to every vault. The pages and
    // their words are shared, see SettingsViews.swift.

    #if os(iOS)
    private var setupSheet: some View {
        SettingsSheet(session: session, gate: gate, keePass: store as? KeePassVaultStore, isSample: !(store is KeePassVaultStore),
                      itemCount: items.count, path: $settingsPath,
                      changePassword: { wantsPasswordChange = true; showsSetup = false },
                      close: { showsSetup = false }, added: { vaultAdded() })
    }
    #endif

    /// A vault is open on every screen that asks, the sample vault included.
    private var autoFillVault: AutoFillVault { .real }

    /// Any reminder card: AutoFill, and on Mac the Safari extension once AutoFill is on.
    private var showsAutoFillCard: Bool {
        #if os(macOS)
        if SafariExtensionCard.isShown(safariExtension, autoFill) { return true }
        #endif
        return autoFill.reminder(for: autoFillVault).display != .nothing
    }

    /// The card is the first row of the list, above the title line on Mac and iPad, so it scrolls away with it and never covers a row. An empty vault shows it
    /// above its own text instead, and a search or a filter with nothing to list has no room for it.
    @ViewBuilder
    private func autoFillRow(_ results: [VaultItem]) -> some View {
        if showsAutoFillCard, !results.isEmpty, !isSearching {
            ReminderCards(vault: autoFillVault)
                #if os(iOS)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                #else
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                #endif
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
    }

    /// The title of the list and the line under it: what else is in force (owner, 2026-11-24). `phoneLine(count:)` is iPhone's line
    /// under the title: the title there is the name alone, so it is never cut, and the line always carries the count.
    private var heading: (title: String, detail: String?) {
        if isSearching { return (String(localized: "Results"), ItemSearch.foundLine(searchFields)) }
        if isRecentlyDeleted { return (VaultDestination.recentlyDeleted.title, nil) }
        // The iPhone search tab lists the whole vault, whatever Show and With say.
        if searchTabShown { return (ItemShow.all.title, nil) }
        return (filter.show.title, filter.secondLine(sort: sort))
    }

    private func phoneLine(count: Int) -> String {
        if isSearching, let found = ItemSearch.foundLine(searchFields) { return "\(RecentlyDeletedText.itemCount(count)) · \(found)" }
        if isSearching || isRecentlyDeleted || searchTabShown { return RecentlyDeletedText.itemCount(count) }
        return filter.countLine(count: count, sort: sort)
    }

    /// A row that opens its item: a link that pushes on iPhone, a row the list selects on Mac and iPad. The tag names the section too,
    /// so an item in "Recently used" and in the complete list below it is selected once.
    @ViewBuilder
    private func link<Content: View>(_ id: VaultItem.ID, _ section: SectionedRowID.Section, @ViewBuilder _ content: () -> Content) -> some View {
        if usesStack {
            NavigationLink(value: id) { content() }
        } else {
            content().tag(SectionedRowID(section: section, id: id))
        }
    }

    /// The rows of the list: live items, or what waits in Recently Deleted, followed by the one sentence about other KeePass apps.
    @ViewBuilder
    private func listRows(_ results: [VaultItem]) -> some View {
        // The notice is about the app, not the list, so it sits above the list's title and the title stays next to its rows (owner, 2026-11-24).
        if !isRecentlyDeleted { autoFillRow(results) }
        if !usesStack {
            // Mac and iPad: the list's title and count are its first line (the bar carries the controls).
            // While a search is active the list shows results from the whole vault, whatever place is selected.
            ListTitleLine(title: heading.title, count: RecentlyDeletedText.itemCount(results.count), detail: heading.detail)
            if showsSearchPills {
                searchPills
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
        }
        if isRecentlyDeleted {
            ForEach(deletedResults) { deletedRow($0, first: $0.id == deletedResults.first?.id, last: $0.id == deletedResults.last?.id) }
            if !deletedResults.isEmpty {
                RecentlyDeletedFooter()
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    #if os(iOS)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    #endif
            }
        } else {
            let group = recentGroup
            if group.isEmpty {
                ForEach(results) { row($0, section: .all, in: results) }
            } else {
                Section { ForEach(group) { row($0, section: .recent, in: group) } } header: { Text("Recently used") }
                Section { ForEach(results) { row($0, section: .all, in: results) } } header: { Text(verbatim: filter.show.allHeading) }
            }
        }
    }

    /// Counts of items with the text in each field, over the whole vault (search is global).
    private var searchCounts: [SearchField: Int] { ItemSearch.counts(items, query: search) }

    /// The pills show while there is text and something to narrow: some field has a match, or a pill is chosen.
    private var showsSearchPills: Bool {
        isSearching && !isRecentlyDeleted && (!searchFields.isEmpty || searchCounts.values.contains { $0 > 0 })
    }

    private var searchPills: some View { SearchFieldPills(counts: searchCounts, chosen: $searchFields) }

    /// What an empty search says, with the one way forward: add it.
    private var noResults: some View {
        if let found = ItemSearch.foundLine(searchFields) {
            return AnyView(ContentUnavailableView {
                Label("No match for “\(search)”", systemImage: "magnifyingglass")
            } description: {
                Text(verbatim: found + ". Other fields may still match.")
            } actions: {
                Button("Search All Fields") { searchFields = [] }
                    .buttonStyle(.borderedProminent)
            })
        }
        return AnyView(noResultsEverywhere)
    }

    private var noResultsEverywhere: some View {
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


    /// What a combination of Show and With that matches nothing says, in words, with the one way forward.
    private var filterEmpty: some View {
        ContentUnavailableView {
            Label(filter.emptySentence, systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text("Items must match everything chosen in Filter. Nothing was removed from your vault.")
        } actions: {
            Button("Show All Items") { filterBinding.wrappedValue = ItemFilter() }
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
    /// Type-erased: the full modifier chain makes a generic type so deep that the runtime overflows the main thread's stack
    /// demangling it (crash on iPhone right after unlocking, 2026-11-25).
    private func itemResults(_ results: [VaultItem]) -> AnyView {
        AnyView(itemResultsChrome(itemResultsList(results), count: results.count))
    }

    private func itemResultsList(_ results: [VaultItem]) -> AnyView {
        AnyView(Group {
            if usesStack {
                // A stack pushes through its links, so the list must not also track a selection.
                List { listRows(results) }
            } else {
                List(selection: allRowSelection) { listRows(results) }
            }
        }
        // The list next appears (also coming back from an open item on iPhone): the order is taken again.
        .onAppear { resnapshotOrder() }
        // A new identity is a new list, which starts at its resting top: large title expanded. Scrolling to the
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
        // iPhone: the pills stay under the navigation bar while the results scroll. Mac and iPad draw them in the list, under the title.
        .safeAreaInset(edge: .top, spacing: 0) {
            if usesStack, showsSearchPills { searchPills.padding(.vertical, 8) }
        }
        // The same list style as Codes and Cards (HIG: touch targets are at least 44 x 44 pt).
        .itemListStyle()
        .overlay { emptyResults(results) })
    }

    /// What the All list shows when it has no rows.
    private func emptyResults(_ results: [VaultItem]) -> AnyView {
        AnyView(Group {
            if results.isEmpty {
                if isRecentlyDeleted {
                    if isSearching {
                        ContentUnavailableView.search(text: search)
                    } else {
                        RecentlyDeletedEmpty { destinationBinding.wrappedValue = .all }
                    }
                } else if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if items.isEmpty {
                        emptyVault
                    } else if narrowsList, filter.isNarrowing {
                        filterEmpty
                    } else {
                        ContentUnavailableView("No items", systemImage: "tray")
                    }
                } else {
                    noResults
                }
            }
        })
    }

    /// The All list's notice, search behaviour, focus and titles.
    private func itemResultsChrome(_ list: AnyView, count: Int) -> some View {
        list
        .overlay(alignment: .bottom) { AutoFillLaterNotice() }
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
        // On iPhone the title is the name alone ("Custom items") and the navigation subtitle under it carries the count and what
        // is in force ("30 items, with notes"), so neither is cut. On Mac and iPad the list shows both itself (`ListTitleLine`) and
        // the bar carries none.
        .navigationTitle(Text(verbatim: heading.title))
        #if os(iOS)
        .navigationSubtitle(usesStack ? phoneLine(count: count) : "")
        #endif
        .columnTitleInList(!usesStack)
        #if os(iOS)
        .sensoryFeedback(.success, trigger: codeCopy.count)
        #endif
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
    private func deletedRow(_ entry: DeletedItem, first: Bool, last: Bool) -> some View {
        link(entry.id, .all) {
            DeletedRow(entry: entry)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Restore") { restore(entry.id) }
                .tint(.accentColor)
        }
        .contextMenu {
            Button("Restore") { restore(entry.id) }
        }
        .itemRowInsets(first: first, last: last)
    }

    /// A row of the All list, and of search results: the shared row, with the account (or the kind) as its second line, and what a
    /// login has as glyphs at the trailing end. A card is drawn as in Cards. A result with a code shows the live code as its
    /// accessory, in place of the code glyph: tap it to copy, tap the rest to open. `group` is the section the row stands in, for
    /// the line between rows (none above its first row or below its last).
    @ViewBuilder
    private func row(_ item: VaultItem, section: SectionedRowID.Section, in group: [VaultItem]) -> some View {
        let (first, last) = (group.first?.id == item.id, group.last?.id == item.id)
        if item.kind == .creditCard {
            link(item.id, section) { CardListRow(card: item) }
                .itemRowInsets(first: first, last: last)
        } else if item.kind == .address, !isSearching {
            link(item.id, section) { AddressListRow(address: item) }
                .itemRowInsets(first: first, last: last)
        } else {
            let subtitle = isSearching ? searchSubtitle(item, query: search, chosen: searchFields) : (item.shownAccount.isEmpty ? Text(item.kind.label) : Text(verbatim: item.shownAccount))
            if isSearching, item.makesCode {
                ItemListRow(item: item, subtitle: subtitle, glyphs: item.traits.filter { $0 == .passkey },
                            glyphColumns: [.passkey], open: { openItem(item.id) }) {
                    CodeCopyButton(item: item, state: codeCopy, used: { markUsed(item.id) })
                }
                .tag(SectionedRowID(section: section, id: item.id))
                .itemRowInsets(first: first, last: last)
            } else {
                link(item.id, section) {
                    ItemListRow(item: item, subtitle: subtitle, glyphs: item.traits.filter(ItemTrait.glyphColumns.contains))
                }
                .itemRowInsets(first: first, last: last)
            }
        }
    }

    /// Tells the system which sites have logins. The sample vault registers none: nothing in it may ever be offered by AutoFill.
    /// `knownEnabled` is for the moment AutoFill has just been found on: the logins go to the system at once.
    private func registerIdentities(knownEnabled: Bool = false) {
        guard !store.isSample, let id = (store as? KeePassVaultStore)?.reference.id else { return }
        VaultIdentities.register(vault: id, items: items, knownEnabled: knownEnabled)
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
                lockForChangedFile()
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
            showsEditorRemoved = true
            editor = nil
        }
        // The same for a page being edited in place: it has just left the list, so the draft has nowhere to go.
        if let open = editingID, gone(open) {
            dropRefusedWrite()
            showsEditorRemoved = true
            edit.end()
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

    /// Move to Recently Deleted: moves the item with no question, then offers Undo for ten seconds (the capsule, and Edit,
    /// Undo Move to Recently Deleted). The system stops offering the item to AutoFill at once, because the identities are sent again without it.
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
            edit.end()
            offerUndo(of: item)
        })
    }

    private func offerUndo(of item: VaultItem) {
        let undo = { restore(item.id, afterUndo: true) }
        undoBanner.show(message: RecentlyDeletedText.movedMessage(title: item.displayTitle), undo: { undoToken.clear(in: undoManager); undo() })
        undoToken.register(in: undoManager, name: RecentlyDeletedText.moveButton) {
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
            // Undo must not close the item the person is looking at, and on Mac and iPad the item that came back is the selected
            // one again, when the list on screen has it. A plain Restore leaves the list.
            if afterUndo {
                if !usesStack, regularVisibleItems.contains(where: { $0.id == id }) { selection = id }
            } else {
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

    /// Stores an item as it is while its editor (the sheet, or the page in edit mode) stays open.
    private func keepDraft(_ item: VaultItem) {
        attempt({ try store.save([item]) }, then: { showSaved(item) })
    }

    /// Save on an item's own page: stays on the item, back in view mode with the saved values. A refused save leaves edit mode open
    /// with the person's text (the conflict alert follows, as for every write).
    /// Stores a code that arrived as a link in the login the person chose, after they confirmed it. Returns whether the vault took it.
    private func saveIncomingCode(_ login: VaultItem, _ setup: TOTPSetup) -> Bool {
        var updated = login
        updated.otpSecret = setup.secret
        updated.otpSettings = setup.settings
        let form = updated.savedForm
        return attempt({ try store.save([form]) }, subject: form.id, then: { showSaved(form) })
    }

    private func saveEdited(_ item: VaultItem) {
        attempt({ try store.save([item]) }, subject: item.id, then: {
            refresh()
            registerIdentities()
            edit.end()
        })
    }

    private func saveMapping(_ mapping: ItemFieldMapping, of id: VaultItem.ID) throws {
        guard let vault = store as? KeePassVaultStore else { throw VaultStoreError.itemUnavailable }
        try vault.mapFields(mapping, of: id)
        refresh()
        registerIdentities()
        edit.end()
        if let item = items.first(where: { $0.id == id }), place == .all, !searchTabShown {
            let wider = filter.revealing(item)
            if wider != filter { filterBinding.wrappedValue = wider }
        }
    }

    /// Save of a new item from its sheet.
    private func save(_ item: VaultItem) {
        // A refused save leaves the editor open with the person's text, and the list as the file holds it.
        attempt({ try store.save([item]) }, then: {
            showSaved(item)
            search = ""
            // Show the saved item where it is listed: a card in Cards, a code in Codes, anything else in All (with Show and With
            // widened when they would hide it).
            inSearchTab = false
            inMoreTab = false
            if item.kind == .wifi || item.kind == .address {
                if usesStack {
                    inMoreTab = true
                    morePlace = item.kind == .address ? .addresses : .wifi
                    morePath = []
                    morePath.append(item.id)
                } else {
                    place = item.kind == .address ? .addresses : .wifi
                }
            } else if item.kind == .creditCard {
                place = .cards
            } else {
                if place == .cards || place == .addresses || place == .wifi || (place == .codes && !item.traits.contains(.code)) { place = .all }
                // Show the saved item: the filter is widened as little as it takes (its kind, then no With), and never Recently Deleted.
                if place == .all {
                    showsDeleted = false
                    let wider = filter.revealing(item)
                    if wider != filter { filterBinding.wrappedValue = wider }
                }
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

/// A toolbar text button a little wider than the others (owner, 2026-11-24), by padding inside the label, so it still grows with the
/// text size and other languages. Edit uses it as it is; Save, the one accent-filled button (it commits), adds the prominent glass
/// style. Cancel stays a plain button.
private struct WideToolbarButton: View {
    let title: LocalizedStringKey
    var prominent = false
    let action: () -> Void

    var body: some View {
        let button = Button(action: action) { Text(title).padding(.horizontal, 6) }
        if prominent { button.buttonStyle(.glassProminent) } else { button }
    }
}

private struct ItemDetail: View {
    let item: VaultItem
    let hideSignal: Int
    let vault: String
    let vaultLocation: String?
    /// Edit turns this page into the editor in place (owner, 2026-11-24). The vault screen owns the edit and its draft, because it
    /// dims and disables the rest of the window meanwhile, and because the page is built again when the window changes width.
    let edit: ItemEdit
    let beganEditing: () -> Void
    /// Stores the edited item. A refused save leaves the edit open, so the person's text stays.
    let save: (VaultItem) -> Void
    /// Stores the draft while editing goes on, so a code survives leaving the app to type it into the site.
    let keepDraft: (VaultItem) -> Void
    let mapFields: (ItemFieldMapping) throws -> Void
    let delete: () -> Void
    let used: () -> Void
    @State private var codeInput: VerificationCodeInput?
    @State private var confirmsDiscard = false
    @State private var revealed: Set<FieldID> = []
    /// The field whose copy icon is a checkmark, for about a second and a half.
    @State private var copied: FieldID?
    @State private var pill = CopiedPillModel()
    @State private var showsQR = false
    @State private var showsWifiQR = false
    @State private var showsFieldMapping = false

    init(item: VaultItem, hideSignal: Int, vault: String, vaultLocation: String?,
         edit: ItemEdit, beganEditing: @escaping () -> Void, save: @escaping (VaultItem) -> Void,
         keepDraft: @escaping (VaultItem) -> Void, mapFields: @escaping (ItemFieldMapping) throws -> Void,
         delete: @escaping () -> Void, used: @escaping () -> Void) {
        self.item = item
        self.hideSignal = hideSignal
        self.vault = vault
        self.vaultLocation = vaultLocation
        self.edit = edit
        self.beganEditing = beganEditing
        self.save = save
        self.keepDraft = keepDraft
        self.mapFields = mapFields
        self.delete = delete
        self.used = used
    }

    private var isEditing: Bool { edit.itemID == item.id }
    private var draft: VaultItem { edit.draft(of: item) }
    private var draftBinding: Binding<VaultItem> {
        Binding(get: { edit.draft(of: item) }, set: { edit.update($0) })
    }

    private enum FieldID: Hashable { case value(ItemField), code, totpSecret, totpLink, wifiSecurity, wifiHidden, copyAddress }

    /// The groups of the page, each its own card, in this order (owner, 2026-11-24): what you copy to sign in or pay (website,
    /// username, password; a card's number, expiry, security code and name); a login's verification code; the notes (a note's text);
    /// the passkey. A group with nothing in it has no card. Edit mode has the same groups in the same order (`ItemFields`).
    private enum Card: Int { case values, code, notes, passkey, otherFields }

    private var groupsShown: [Card] {
        var shown: [Card] = []
        if !item.firstCardRows.isEmpty { shown.append(.values) }
        if item.kind == .login { shown.append(.code) }
        if !item.notes.isEmpty { shown.append(.notes) }
        if item.passkey != nil { shown.append(.passkey) }
        if item.otherFields?.isEmpty == false { shown.append(.otherFields) }
        return shown
    }

    private var canSave: Bool { draft.canSave }

    private var canMap: Bool {
        // An address is never shown as a card or a login.
        item.kind != .address && (item.fieldMappingNeedsReview == true || item.fieldMapping != nil || item.sourceFields?.contains(where: { !$0.value.isEmpty }) == true)
    }

    /// One button opens the sheet; its words say what the sheet offers (owner, 2026-11-24).
    private var mappingLabel: LocalizedStringResource {
        if item.fieldMappingNeedsReview == true { return "Review fields…" }
        return item.fieldMapping == nil ? "Show as Card or Login…" : "Change how fields are used…"
    }

    private func beginFieldMapping() {
        revealed = []
        showsFieldMapping = true
    }

    private var editFields: ItemFields {
        let mappingAction: (() -> Void)? = canMap ? { beginFieldMapping() } : nil
        return ItemFields(item: draftBinding, codeInput: $codeInput, mapFieldsLabel: mappingLabel,
                          onMapFields: mappingAction, canMapFields: !draft.hasChanges(from: item), onDelete: delete,
                          focusField: edit.focus, tookFocus: { edit.focus = nil })
    }

    var body: some View {
        page
            .modifier(HidesRevealedValues(signal: hideSignal) { revealed = [] })
            // A password changed underneath an editor that has not touched it follows, so Save does not put the old one back.
            .onChange(of: item.secret) { old, new in if isEditing, draft.secret == old { draftBinding.wrappedValue.secret = new } }
            // Starting and ending edit mode hides what was shown, as leaving the item does.
            .onChange(of: isEditing) { revealed = [] }
            .onChange(of: showsFieldMapping) { revealed = [] }
    }

    private var page: some View {
        Form {
            if isEditing {
                editFields
            } else {
                viewGroups
            }
        }
        .formStyle(.grouped)
        .codeSheet(item: draftBinding, input: $codeInput, keepDraft: keepDraft)
        .sheet(isPresented: $showsQR) {
            if let url = item.totpSetupURL { TOTPQRSheet(url: url, title: item.displayTitle) }
        }
        .sheet(isPresented: $showsWifiQR) {
            if let payload = WiFiShare.payload(for: item) {
                TOTPQRSheet(url: payload, title: item.displayTitle, heading: String(localized: "Join \(item.displayTitle)"),
                            caption: String(localized: "Point a phone's Camera at this. It joins without typing the password. The code contains the password, so show it only to people you trust."))
            }
        }
        .sheet(isPresented: $showsFieldMapping) {
            ItemFieldMappingView(item: item, vault: vault, hideSignal: hideSignal, save: mapFields)
        }
        #if os(macOS)
        .navigationTitle(item.displayTitle)
        #else
        // The header already carries the name, so the bar stays quiet instead of repeating it.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // While editing, Cancel stands where Back was (hiding Back also turns off swipe-back) and the tab bar is hidden, so a
        // half-edited item cannot be left by accident.
        .navigationBarBackButtonHidden(isEditing)
        .toolbarVisibility(isEditing ? .hidden : .automatic, for: .tabBar)
        #endif
        .toolbar { toolbar }
        #if os(macOS)
        // Return saves, too, from a single-line field. Out of sight and out of the toolbar, so it takes no place there.
        .background {
            if isEditing {
                Button("Save", action: commit).keyboardShortcut(.defaultAction).disabled(!canSave)
                    .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
            }
        }
        #endif
        .copiedPill(pill)
        .modifier(DiscardChanges(isPresented: $confirmsDiscard) { edit.end() })
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isEditing {
            #if os(iOS)
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
            }
            ToolbarItem(placement: .confirmationAction) {
                WideToolbarButton(title: "Save", prominent: true, action: commit).keyboardShortcut("s", modifiers: .command).disabled(!canSave)
            }
            #else
            // Where Edit was, in the item column's toolbar. Escape cancels, ⌘S saves (Return too, see `page`).
            ToolbarItemGroup {
                Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
                WideToolbarButton(title: "Save", prominent: true, action: commit).keyboardShortcut("s", modifiers: .command).disabled(!canSave)
            }
            #endif
        } else {
            // Text, not a Label: iOS toolbars would reduce a Label to an icon-only circle. Only an open item has it.
            ToolbarItem {
                WideToolbarButton(title: "Edit") { beginEditing() }
                    .keyboardShortcut("e", modifiers: .command)
            }
        }
    }

    private func beginEditing(atCode: Bool = false, at field: ItemField? = nil) {
        revealed = []
        edit.begin(item, focus: field)
        beganEditing()
        if atCode { codeInput = .manual }
    }

    /// Cancel with something changed asks first; with nothing changed it just leaves edit mode.
    private func cancel() {
        if draft.hasChanges(from: item) { confirmsDiscard = true } else { edit.end() }
    }

    private func commit() { if canSave { save(draft.savedForm) } }

    // MARK: View mode

    /// The `Section` header: the icon and name above whichever card is first, then that card's own heading if it has one.
    @ViewBuilder
    private func header(for group: Card, heading: (() -> AnyView)? = nil) -> some View {
        let leads = groupsShown.first == group
        if leads || heading != nil {
            VStack(alignment: .leading, spacing: 0) {
                if leads { ItemIdentity(item: item) }
                if let heading { heading() }
            }
        }
    }

    @ViewBuilder
    private var viewGroups: some View {
        if groupsShown.isEmpty {
            Section {} header: { ItemIdentity(item: item) }
        }
        if item.kind == .address {
            addressSections
        } else if groupsShown.contains(.values) {
            Section {
                ForEach(item.firstCardRows, id: \.self) { entry in
                    if entry.isSet { field(entry.field) } else { unsetField(entry.field) }
                }
                if item.kind == .wifi { wifiRows }
            } header: {
                header(for: .values)
            }
        }
        if item.kind == .login {
            Section {
                if item.otpSecret.isEmpty { noCodeRow } else if !item.makesCode { brokenCodeRow } else { codeRow }
                if !item.otpSecret.isEmpty {
                    row(.totpSecret, "Setup key", item.otpSecret, hidden: true)
                }
                if let url = item.totpSetupURL {
                    Button("Copy setup link", systemImage: "link") { copy(url, as: .totpLink, name: String(localized: "Setup link")) }
                    Button("Show QR code", systemImage: "qrcode") { showsQR = true }
                }
            } header: {
                header(for: .code) {
                    AnyView(HStack(spacing: 4) {
                        Text("Verification code")
                        InfoButton(topic: HelpTopics.codeSetup)
                    })
                }
            } footer: {
                if !item.otpSecret.isEmpty {
                    Text("To move this verification code to another authenticator, use the setup key, the link or the QR code. Anyone who has one of them can make your codes, so treat them like a password.")
                }
            }
        }
        if groupsShown.contains(.notes) {
            Section {
                field(.notes)
            } header: {
                header(for: .notes)
            }
        }
        if let passkey = item.passkey {
            Section {
                PasskeyCard.row(passkey)
            } header: {
                header(for: .passkey) { AnyView(PasskeyCard.heading) }
            } footer: {
                PasskeyCard.footer(passkey)
            }
        }
        if let fields = item.otherFields, !fields.isEmpty {
            Section {
                OtherStoredFields(fields: fields, hideSignal: hideSignal &* 2 &+ (showsFieldMapping ? 1 : 0), pill: pill, used: used)
            } header: {
                header(for: .otherFields) { AnyView(Text("Other fields").font(.body)) }
            }
        }
        if canMap && (item.kind == .keePassEntry || item.otherFields?.isEmpty == false || item.fieldMappingNeedsReview == true) {
            Section {
                if item.fieldMappingNeedsReview == true {
                    Text("One or more mapped fields changed. Choose the fields again.").foregroundStyle(.secondary)
                }
                Button(mappingLabel, action: beginFieldMapping)
            }
        }
    }

    /// An address: name and organization; the address with Copy Address; email and phone; whatever else an import brought. The icon
    /// and name lead above the first card that is there.
    @ViewBuilder
    private var addressSections: some View {
        let groups = item.addressViewGroups()
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            Section {
                ForEach(group, id: \.self) { entry in
                    if entry.isSet { field(entry.field) } else { unsetField(entry.field) }
                }
                if group.contains(where: { $0.field == .country }), item.hasPostalAddress {
                    Button("Copy Address", systemImage: "doc.on.doc") {
                        copy(item.addressEnvelope(), as: .copyAddress, name: String(localized: "Address"))
                    }
                }
            } header: {
                if index == 0 { ItemIdentity(item: item) }
            }
        }
    }

    /// A login with no code: the row says so and offers Set Up Code…, where the code would be. Nothing to copy, so no copy icon.
    private var noCodeRow: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Code").foregroundStyle(.secondary)
                Text("None")
            }
            Spacer(minLength: 8)
            Button("Set Up Code…") { beginEditing(atCode: true) }
                .buttonStyle(.bordered)
        }
    }

    /// A seed that cannot make a code: the row says so plainly and offers the fix, in the code's place. The Codes list shows nothing
    /// about it; this page is where it is explained.
    private var brokenCodeRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Code").foregroundStyle(.secondary)
                Text("Psss can't make a code from this setup key. Replace it with a new key from the website.")
            }
            Button("Replace Code…") { beginEditing(atCode: true) }
                .buttonStyle(.bordered)
        }
    }

    private var codeRow: some View {
        // Read outside the TimelineView, and its identity follows it: a TimelineView redraws on its own schedule, so the checkmark
        // would otherwise wait for the next tick.
        let codeCopied = copied == .code
        return TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = TOTP.secondsRemaining(period: item.otpSettings.period, at: context.date)
            let made = TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date)
            let code = made ?? "------"
            let canCopy = made != nil
            let copyCode = { copy(code, as: .code, name: String(localized: "Verification code")) }
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Code").foregroundStyle(.secondary)
                    // The code is written as it is in the Codes list (`CodeDigits`), in the primary colour at the size of the item's
                    // name (title), so this screen has no third text size.
                    CodeDigits(code: code, style: .title).foregroundStyle(Color.primary)
                        .allowsHitTesting(false)
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
                if canCopy {
                    CopyIconButton(name: String(localized: "verification code"), copied: codeCopied, action: copyCode)
                }
            }
            // Like every field with a copy icon, a tap anywhere on the row copies the code that is valid now.
            .modifier(CopiesWhen(enabled: canCopy, action: copyCode))
        }
        .id(codeCopied)
    }

    /// One of the item's own values, under the name its kind gives it. A card's expiry is shown as MM/YY; protected values are hidden.
    private func field(_ field: ItemField) -> some View {
        var value = field == .expiry || field == .validFrom ? CardExpiry.displayed(item[field]) : item[field]
        // The street is one value of up to two lines, and the country is shown by its name.
        if field == .street { value = item.address.street }
        if field == .country { value = item.address.shownCountry }
        return row(.value(field), field.label(for: item.kind, layout: item.kind == .address ? item.address.layout() : nil), value,
                   hidden: field == .secret || field == .securityCode || field == .pin || item.concealedFields?.contains(field.rawValue) == true,
                   notice: item.mappedValueNotice(for: field))
    }

    /// A Wi-Fi network's other facts and its two actions, in the first card under the network name and password.
    @ViewBuilder
    private var wifiRows: some View {
        row(.wifiSecurity, "Security", item.wifiSecurity.label)
        if item.wifiHidden { row(.wifiHidden, "Hidden network", String(localized: "Yes")) }
        #if os(iOS)
        Button("Join This Network", systemImage: "wifi") { joinNetwork() }
        #endif
        if WiFiShare.payload(for: item) != nil {
            Button("Show QR Code", systemImage: "qrcode") { showsWifiQR = true }
        }
    }

    #if os(iOS)
    private func joinNetwork() {
        let network = item
        Task {
            switch await WiFiJoin.join(network) {
            case .joined: pill.show(String(localized: "Joined \(network.displayTitle)"))
            case .declined: break
            case .failed: pill.show(String(localized: "Could not join. Check the name and password."), symbol: "exclamationmark.triangle.fill")
            }
        }
    }
    #endif

    /// A recognized field with no value: "Not set" and an Add that opens Edit with this field focused (owner, 2026-11-24).
    private func unsetField(_ field: ItemField) -> some View {
        UnsetFieldRow(label: field.label(for: item.kind, layout: item.kind == .address ? item.address.layout() : nil)) { beginEditing(at: field) }
    }

    /// A field is one row with a copy icon at its end. Protected values stay hidden until a deliberate reveal.
    private func row(_ id: FieldID, _ label: LocalizedStringResource, _ value: String, shown: String? = nil, hidden: Bool = false, notice: String? = nil) -> some View {
        let isSecret = id == .value(.secret)
        let shape: DisplayText.Shape = id == .value(.notes) ? .asStored : id == .value(.street) ? .lines : .line
        return FieldRow(label: label, value: value, shown: shown ?? (isSecret ? item.spacedSecret : value), shape: shape,
                        masked: isSecret ? item.maskedSecret : VaultItem.hiddenMask,
                        hidden: hidden,
                        revealed: Binding(get: { revealed.contains(id) },
                                          set: { if $0 { revealed.insert(id) } else { revealed.remove(id) } }),
                        copied: copied == id,
                        notice: notice,
                        copyable: id != .wifiSecurity && id != .wifiHidden,
                        copy: { copy(value, as: id, name: String(localized: label)) },
                        link: id == .value(.website) ? SiteMatch.webAddress(value) : nil,
                        opened: used)
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

/// What Edit, Move to Recently Deleted (⌘⌫) does in the focused window. `permanent`: the selected item is already in Recently
/// Deleted, so the item reads "Delete Now…" and asks first.
struct DeleteSelectionCommand {
    let permanent: Bool
    let run: () -> Void
}

private struct DeleteSelectionKey: FocusedValueKey {
    typealias Value = DeleteSelectionCommand
}

extension FocusedValues {
    var deleteSelection: DeleteSelectionCommand? {
        get { self[DeleteSelectionKey.self] }
        set { self[DeleteSelectionKey.self] = newValue }
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

private struct AddVaultKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    /// The lock screen's own File, Add Vault… (one flow). Replaced by `startAddVault`; removed with the last caller.
    var addVault: (() -> Void)? {
        get { self[AddVaultKey.self] }
        set { self[AddVaultKey.self] = newValue }
    }
}

private struct StartAddVaultKey: FocusedValueKey {
    typealias Value = (AddVaultChoice) -> Void
}

extension FocusedValues {
    /// File, New Vault… / Open Vault File… / Import from Apple Passwords…: starts that flow in the focused window.
    var startAddVault: ((AddVaultChoice) -> Void)? {
        get { self[StartAddVaultKey.self] }
        set { self[StartAddVaultKey.self] = newValue }
    }
}

/// What the File menu's two vault items need from the focused window: Settings at the shown vault's page, and the lock. With
/// one vault open the lock is "Lock <name>" (that vault); with two or more it is "Lock All Vaults" (every vault). Nil while
/// nothing is open.
struct VaultMenuCommands {
    let settings: () -> Void
    let lockTitle: String?
    let lock: (() -> Void)?

    @MainActor
    static func make(session: VaultSession, settings: @escaping () -> Void) -> VaultMenuCommands {
        guard let title = session.lockMenuTitle else { return VaultMenuCommands(settings: settings, lockTitle: nil, lock: nil) }
        return VaultMenuCommands(settings: settings, lockTitle: title, lock: { session.lockForMenu() })
    }
}

private struct VaultMenuCommandsKey: FocusedValueKey {
    typealias Value = VaultMenuCommands
}

extension FocusedValues {
    var vaultMenu: VaultMenuCommands? {
        get { self[VaultMenuCommandsKey.self] }
        set { self[VaultMenuCommandsKey.self] = newValue }
    }
}

/// A QR code of the `otpauth://` link, for scanning into another authenticator.
private struct TOTPQRSheet: View {
    let url: String
    let title: String
    var heading = String(localized: "QR code")
    var caption = String(localized: "Scan this with an authenticator app. Anyone who sees it can make your codes.")
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
                        .accessibilityLabel("QR code for \(title)")
                }
                Text(verbatim: caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
            }
            .padding()
            .navigationTitle(heading)
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

