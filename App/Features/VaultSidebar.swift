import SwiftUI

// The sidebar of the main window on Mac and iPad (owner, 2026-11-25, mock `#/vault-switcher` section 2): one section per vault,
// as Mail shows accounts. Every open vault is an expanded section with its places; every locked vault is collapsed with a
// padlock. Selection is (vault, place). Choosing a locked vault's header shows its unlock form in the content area while the other
// vaults stay open. The foot, pinned to the bottom, has the Add Vault menu and the Settings gear. The same pieces draw the window
// while nothing is open (`LockedVaultWindow`), where every section is collapsed.

/// What the sidebar selects: a place of one vault (Mail: a mailbox of one account). Never a place across vaults.
struct VaultSelection: Hashable {
    let vault: UUID
    let destination: VaultDestination
}

/// A request to land on a place when the window is built or changes vault: another open vault's place was chosen, or a vault has
/// just been unlocked (its All place). A new value, even for the same place, asks again.
struct VaultLanding: Equatable {
    let id = UUID()
    let destination: VaultDestination
}

/// The vault sections of the sidebar, to put in a `List` with the sidebar style. The vaults are in the fixed order (the order they
/// were added in) and never move: an open vault is marked by being expanded, a locked one by its padlock.
///
/// - `places`: the rows of an open vault's section.
struct VaultSections<Places: View>: View {
    let session: VaultSession
    /// A locked vault's header (or its disclosure control) was chosen: show its unlock form.
    let choose: (UUID) -> Void
    let settings: (UUID) -> Void
    let lock: (UUID) -> Void
    let remove: (UUID) -> Void
    @ViewBuilder var places: (VaultReference) -> Places
    /// The open vaults whose section the person collapsed. Not kept: a vault opens expanded.
    @State private var collapsed: Set<UUID> = []

    var body: some View {
        ForEach(session.knownVaults, id: \.id) { vault in
            let isOpen = session.isOpen(vault.id)
            #if os(iOS)
            // iPad: a section header is the system's disclosure button (or, in a plain section, not a place a context menu can open
            // from), so a long-press there shows no menu. The vault's header is the section's first row instead: a row takes the
            // long-press menu natively, and its chevron collapses the places under it.
            Section {
                header(vault, isOpen: isOpen, toggle: { if isOpen { toggleCollapsed(vault.id) } else { choose(vault.id) } })
                if isOpen, !collapsed.contains(vault.id) { places(vault) }
            }
            #else
            Section(isExpanded: expanded(vault, isOpen: isOpen)) {
                if isOpen { places(vault) }
            } header: {
                header(vault, isOpen: isOpen)
            }
            #endif
        }
    }

    /// An open vault's section opens and closes. A locked vault's section never opens: choosing it (the header, or the disclosure
    /// control the system draws) shows its unlock form instead.
    private func expanded(_ vault: VaultReference, isOpen: Bool) -> Binding<Bool> {
        if isOpen { return Binding(get: { !collapsed.contains(vault.id) }, set: { if $0 { collapsed.remove(vault.id) } else { collapsed.insert(vault.id) } }) }
        return Binding(get: { false }, set: { if $0 { choose(vault.id) } })
    }

    private func toggleCollapsed(_ id: UUID) {
        if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) }
    }

    /// The header is a plain label: the icon, then the name, in the system's own sizes for a sidebar header, with no padding or
    /// frame of ours. A locked vault shows a closed padlock (the warning triangle when the file is not available); an open vault
    /// shows the app's vault symbol. The vault on screen is in the primary colour, the others secondary. The system draws its own
    /// disclosure control on hover, so an open vault's section collapses; choosing a locked vault's header (or its disclosure)
    /// shows its unlock form. The vault's actions are the header's right-click (iPad: long-press) menu.
    private func header(_ vault: VaultReference, isOpen: Bool, toggle: (() -> Void)? = nil) -> some View {
        let name = VaultName.short(vault.name)
        let state = session.state(of: vault)
        let showing = vault.id == session.reference?.id
        let tint: Color = state.isAvailable ? (showing ? .primary : .secondary) : .orange
        let label = Label {
            Text(verbatim: name).lineLimit(1).truncationMode(.middle)
                .foregroundStyle(showing ? Color.primary : Color.secondary)
        } icon: {
            Image(systemName: isOpen ? VaultSwitcher.symbol : state.symbol)
                .foregroundStyle(tint)
        }
        .foregroundStyle(showing ? Color.primary : Color.secondary)
        #if os(iOS)
        let row = HStack {
            label
            Spacer(minLength: 8)
            Image(systemName: isOpen && !collapsed.contains(vault.id) ? "chevron.down" : "chevron.right")
                .font(.body.weight(.semibold)).foregroundStyle(.secondary).accessibilityHidden(true)
        }
        #else
        let row = label
        #endif
        return row
        .contentShape(Rectangle())
        .onTapGesture {
            #if os(iOS)
            toggle?()
            #else
            if !isOpen { choose(vault.id) }
            #endif
        }
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(Text(verbatim: state.spoken))
        #if os(iOS)
        .accessibilityAddTraits(.isButton)
        #endif
        .contextMenu { actions(vault, isOpen: isOpen, name: name, showing: showing) }
    }

    @ViewBuilder
    private func actions(_ vault: VaultReference, isOpen: Bool, name: String, showing: Bool) -> some View {
        Button(String(localized: "Vault Settings…")) { settings(vault.id) }
        if isOpen {
            Button(String(localized: "Lock \(name)")) { lock(vault.id) }
        } else if !showing {
            Button(String(localized: "Unlock…")) { choose(vault.id) }
        }
        #if os(macOS)
        if !vault.managed { VaultLocationRows.showInFinder(vault) }
        #endif
        Divider()
        Button(String(localized: "Remove Vault…"), role: .destructive) { remove(vault.id) }
    }
}

/// The places of an open vault that is not the one the window is built on: the same rows and counts, each choosing (that vault,
/// that place). The counts are read once when the rows appear; this vault's items do not change while another vault is shown.
struct OtherVaultPlaces: View {
    let vault: UUID
    let store: KeePassVaultStore
    @State private var counts: [VaultDestination: Int] = [:]

    var body: some View {
        ForEach(VaultDestination.sidebar, id: \.self) { row in
            NavigationLink(value: VaultSelection(vault: vault, destination: row)) {
                Label(row.title, systemImage: row.symbol).badge(counts[row] ?? 0)
            }
            .task(id: ObjectIdentifier(store)) {
                guard row == VaultDestination.sidebar.first else { return }
                let items = store.items()
                counts = Dictionary(uniqueKeysWithValues: VaultDestination.sidebar.map { row in
                    (row, row == .recentlyDeleted ? store.recentlyDeleted().count : items.count(where: row.includes))
                })
            }
        }
    }
}

/// The sidebar's foot, pinned to the bottom with `.safeAreaBar(edge: .bottom)`: the labeled Add Vault menu (the three ways to
/// add a vault) and at the trailing end the icon-only Settings gear, as the system's glass buttons like the ones in the toolbar,
/// with no divider or bar behind them. The gear is in the sidebar, not in the window's toolbar, and has the accessibility label
/// and tooltip "Settings".
struct VaultSidebarFoot: View {
    /// False for the sample vault, which has no vaults to add to.
    var showsAdd = true
    let add: (AddVaultChoice) -> Void
    let openSettings: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if showsAdd {
                Menu {
                    ForEach(AddVaultChoice.all) { choice in Button(choice.menuTitle) { add(choice) } }
                } label: {
                    Label("Add Vault", systemImage: "plus")
                }
                .menuStyle(.button)
                .menuIndicator(.hidden)
                .buttonBorderShape(.capsule)
                .fixedSize()
                .help("Add a vault: create one, open a file, or import")
            }
            Spacer(minLength: 0)
            Button(action: openSettings) {
                Label("Settings", systemImage: "gearshape").labelStyle(.iconOnly)
            }
            .buttonBorderShape(.circle)
            .accessibilityLabel(Text("Settings"))
            .help("Settings")
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        // Stays at the bottom, behind the on-screen keyboard (iPad, typing in the unlock form beside the sidebar), instead of
        // being lifted over it.
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }
}

/// Remove Vault… from a section header's menu: the same confirmation as the vault's Settings page. Only the chosen vault goes:
/// the other vaults, open or locked, are not touched.
struct VaultRemoval: ViewModifier {
    @Binding var request: UUID?
    let session: VaultSession
    @AppStorage("vaultSource") private var vaultSource = ""

    func body(content: Content) -> some View {
        let reference = request.flatMap { id in session.knownVaults.first { $0.id == id } }
        let next = reference.map { RemoveVaultText.whatShowsNext(session: session, removing: $0.id) } ?? ""
        content.modifier(RemoveVaultAlert(isPresented: Binding(get: { request != nil }, set: { if !$0 { request = nil } }),
                                          reference: reference, next: next, remove: { deletingFile in
            guard let reference else { return }
            request = nil
            leaveVault(reference.id, session: session, vaultSource: &vaultSource, deletingFile: deletingFile)
        }))
    }
}

/// The unlock form of the shown vault in the content area, beside the sidebar. It says nothing about the other vaults: the
/// sidebar shows which are open.
struct VaultUnlockPane: View {
    let session: VaultSession
    let gate: UnlockGate

    var body: some View {
        VaultPasswordView(session: session, gate: gate, embedded: true)
            .id(session.reference?.id)
    }
}

/// The window while no vault is open (Mac, and iPad at regular width): the same sidebar with every vault collapsed and locked, the
/// foot, and in the content area the unlock form of the shown vault. Choosing another vault shows its form. When a vault opens,
/// the window becomes `VaultView`, which has the same sidebar with that vault's places.
struct LockedVaultWindow: View {
    let session: VaultSession
    let gate: UnlockGate
    @State private var addChoice: AddVaultChoice?
    @State private var removing: UUID?
    @Environment(SettingsRequests.self) private var requests
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #else
    @State private var showsSettings = false
    @State private var settingsPath: [UUID] = []
    #endif

    var body: some View {
        NavigationSplitView {
            List {
                VaultSections(session: session, choose: { session.show($0) }, settings: showVaultSettings, lock: { session.lock($0) },
                              remove: { removing = $0 }) { _ in EmptyView() }
            }
            .listStyle(.sidebar)
            // A few collapsed headers always fit: no elastic scrolling, so the headers cannot be pushed up under the title bar.
            .scrollBounceBehavior(.basedOnSize)
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 320)
            .safeAreaBar(edge: .bottom, spacing: 0) {
                VaultSidebarFoot(add: { addChoice = $0 }, openSettings: showSettings)
            }
            #if os(macOS)
            .toolbar(removing: .title)
            #endif
        } detail: {
            VaultUnlockPane(session: session, gate: gate)
        }
        .navigationSplitViewStyle(.balanced)
        .modifier(VaultRemoval(request: $removing, session: session))
        .addVaultFlow($addChoice, session: session) { gate.markUnlocked() }
        .focusedSceneValue(\.startAddVault, { addChoice = $0 })
        #if os(iOS)
        .sheet(isPresented: $showsSettings) {
            SettingsSheet(session: session, gate: gate, keePass: nil, isSample: false, itemCount: nil, path: $settingsPath,
                          changePassword: {}, close: { showsSettings = false }, added: { showsSettings = false; gate.markUnlocked() })
        }
        #endif
    }

    private func showSettings() {
        #if os(macOS)
        openSettings()
        #else
        settingsPath = []
        showsSettings = true
        #endif
    }

    private func showVaultSettings(_ id: UUID) {
        #if os(macOS)
        requests.show(.vault(id))
        openSettings()
        #else
        settingsPath = [id]
        showsSettings = true
        #endif
    }
}
