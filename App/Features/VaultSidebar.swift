import SwiftUI

// The sidebar of the main window on Mac and iPad (owner, 2026-11-25, mock `#/vault-switcher` section 3): one section per vault,
// as Mail shows accounts. The open vault is expanded with its places; every other vault is collapsed with a lock. Choosing a
// locked vault shows its unlock form in the content area. The foot, pinned to the bottom, has the Add Vault menu and the
// Settings gear. The same pieces draw the locked window (`LockedVaultWindow`), where every section is collapsed.

/// The vault sections of the sidebar, to put in a `List` with the sidebar style. The vaults are in the fixed order (the order they
/// were added in) and never move: the open one is marked by being expanded.
///
/// - `openID`: the vault that is open, or nil when the window is locked (every section is then collapsed).
/// - `showing`: the vault whose unlock form is on screen (locked window); its header is drawn in the primary colour.
/// - `places`: the rows of the open vault's section.
struct VaultSections<Places: View>: View {
    let session: VaultSession
    let openID: UUID?
    var showing: UUID?
    let choose: (UUID) -> Void
    let settings: (UUID) -> Void
    let lock: () -> Void
    let remove: (UUID) -> Void
    @ViewBuilder var places: Places
    /// The open vault's section, collapsed by the person. Not kept: a vault opens expanded.
    @State private var collapsedOpen = false

    var body: some View {
        ForEach(session.knownVaults, id: \.id) { vault in
            let isOpen = vault.id == openID
            Section(isExpanded: expanded(vault, isOpen: isOpen)) {
                if isOpen { places }
            } header: {
                header(vault, isOpen: isOpen)
            }
            .headerProminence(.increased)
        }
    }

    /// The open vault's section opens and closes. A locked vault's section never opens: choosing it (the header, or the
    /// disclosure control the system draws) shows its unlock form instead.
    private func expanded(_ vault: VaultReference, isOpen: Bool) -> Binding<Bool> {
        if isOpen { return Binding(get: { !collapsedOpen }, set: { collapsedOpen = !$0 }) }
        return Binding(get: { false }, set: { if $0 { choose(vault.id) } })
    }

    /// The header is a plain label: the icon, then the name, at the size of a sidebar row. A locked vault shows a closed padlock
    /// (the warning triangle when the file is not available); the open vault shows the app's vault symbol. The system draws its
    /// own disclosure control on hover, so the open vault's section still collapses, and choosing a locked vault's header (or
    /// its disclosure) shows its unlock form. The vault's actions are the header's right-click (iPad: long-press) menu.
    private func header(_ vault: VaultReference, isOpen: Bool) -> some View {
        let name = VaultName.short(vault.name)
        let state = session.state(of: vault, unlocked: isOpen)
        let tint: Color = state.isAvailable ? (isOpen || vault.id == showing ? .primary : .secondary) : .orange
        return Label {
            Text(verbatim: name).lineLimit(1).truncationMode(.middle)
        } icon: {
            Image(systemName: isOpen ? VaultSwitcher.symbol : state.symbol)
                .foregroundStyle(tint)
        }
        .font(.body)
        .foregroundStyle(isOpen || vault.id == showing ? Color.primary : Color.secondary)
        .contentShape(Rectangle())
        .onTapGesture { if !isOpen { choose(vault.id) } }
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(Text(verbatim: state.spoken))
        .contextMenu { actions(vault, isOpen: isOpen, name: name) }
    }

    @ViewBuilder
    private func actions(_ vault: VaultReference, isOpen: Bool, name: String) -> some View {
        Button(String(localized: "Vault Settings…")) { settings(vault.id) }
        if isOpen {
            Button(String(localized: "Lock \(name)"), action: lock)
        } else if vault.id != showing {
            Button(String(localized: "Unlock…")) { choose(vault.id) }
        }
        #if os(macOS)
        if !vault.managed { VaultLocationRows.showInFinder(vault) }
        #endif
        Divider()
        Button(String(localized: "Remove Vault…"), role: .destructive) { remove(vault.id) }
    }
}

/// The sidebar's foot, pinned to the bottom with `.safeAreaInset(edge: .bottom)`: the labeled Add Vault menu (the three ways to
/// add a vault) and at the trailing end the icon-only Settings gear. The gear is in the sidebar, not in the window's toolbar, and
/// has the accessibility label and tooltip "Settings".
struct VaultSidebarFoot: View {
    /// False for the sample vault, which has no vaults to add to.
    var showsAdd = true
    let add: (AddVaultChoice) -> Void
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) {
                if showsAdd {
                    Menu {
                        ForEach(AddVaultChoice.all) { choice in Button(choice.menuTitle) { add(choice) } }
                    } label: {
                        Label("Add Vault", systemImage: "plus")
                    }
                    .menuIndicator(.hidden)
                    #if os(macOS)
                    .menuStyle(.borderlessButton)
                    #endif
                    .fixedSize()
                    .help("Add a vault: create one, open a file, or import")
                }
                Spacer(minLength: 0)
                Button(action: openSettings) {
                    Label("Settings", systemImage: "gearshape").labelStyle(.iconOnly)
                }
                #if os(macOS)
                .buttonStyle(.borderless)
                #endif
                .accessibilityLabel(Text("Settings"))
                .help("Settings")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }
}

/// Remove Vault… from a section header's menu: the same confirmation as the vault's Settings page. The open vault leaves through
/// `leaveOpenVault` (another vault, or the welcome screen, takes its place); another vault is removed without touching the open
/// one.
struct VaultRemoval: ViewModifier {
    @Binding var request: UUID?
    let session: VaultSession
    let gate: UnlockGate
    @AppStorage("vaultSource") private var vaultSource = ""

    func body(content: Content) -> some View {
        let reference = request.flatMap { id in session.knownVaults.first { $0.id == id } }
        let isCurrent = reference?.id == session.reference?.id
        let next = isCurrent
            ? (session.remembered.isEmpty ? String(localized: "Psss then shows the welcome screen.") : String(localized: "Psss then shows your next vault."))
            : String(localized: "The vault that is open stays open.")
        content.modifier(RemoveVaultAlert(isPresented: Binding(get: { request != nil }, set: { if !$0 { request = nil } }),
                                          reference: reference, next: next, remove: { deletingFile in
            guard let reference else { return }
            request = nil
            if reference.id == session.reference?.id {
                leaveOpenVault(session: session, gate: gate, vaultSource: &vaultSource, deletingFile: deletingFile)
            } else {
                session.forgetOther(reference.id, deletingFile: deletingFile)
            }
        }))
    }
}

/// The window while no vault is open (Mac, and iPad at regular width): the same sidebar with every vault collapsed and locked, the
/// foot, and in the content area the unlock form of the last used vault. Choosing another vault shows its form. This replaces
/// the full-window lock screen and its Vault pop-up.
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
                VaultSections(session: session, openID: nil, showing: session.reference?.id, choose: choose,
                              settings: showVaultSettings, lock: {}, remove: { removing = $0 }) { EmptyView() }
            }
            .listStyle(.sidebar)
            // A few collapsed headers always fit: no elastic scrolling, so the headers cannot be pushed up under the title bar.
            .scrollBounceBehavior(.basedOnSize)
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 320)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VaultSidebarFoot(add: { addChoice = $0 }, openSettings: showSettings)
            }
            #if os(macOS)
            .toolbar(removing: .title)
            #endif
        } detail: {
            unlockForm
        }
        .navigationSplitViewStyle(.balanced)
        .modifier(VaultRemoval(request: $removing, session: session, gate: gate))
        .addVaultFlow($addChoice, session: session) { gate.markUnlocked() }
        .focusedSceneValue(\.startAddVault, { addChoice = $0 })
        #if os(iOS)
        .sheet(isPresented: $showsSettings) {
            SettingsSheet(session: session, gate: gate, keePass: nil, isSample: false, itemCount: nil, path: $settingsPath,
                          changePassword: {}, close: { showsSettings = false }, added: { showsSettings = false; gate.markUnlocked() })
        }
        #endif
    }

    /// The unlock form of the vault `session` opens next, with the line that says what happened to the vault that was open.
    private var unlockForm: some View {
        let note = session.lockedForSwitch.map { String(localized: "\($0) is locked now. Only one vault is open at a time.") }
            ?? String(localized: "Psss is locked. All your vaults are locked.")
        return VaultPasswordView(session: session, gate: gate, embedded: true, footnote: note)
            .id(session.reference?.id)
    }

    /// Another vault's form: nothing is open, so only the reference changes.
    private func choose(_ id: UUID) {
        guard id != session.reference?.id else { return }
        session.switchTo(id)
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
