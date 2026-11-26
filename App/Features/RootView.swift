import SwiftUI

/// Shows the vaults only while at least one is unlocked. The app-wide lock (`gate`: auto-lock, sleep, quit, Lock All Vaults)
/// locks every vault and tears the vault view down, so no decrypted state, selection or search text stays in memory behind the
/// lock screen, and unlocking opens fresh. Locking one vault leaves the others open. On a Mac the search field has focus then; on iPhone and iPad it does not, so the keyboard stays closed.
///
/// The gate and the session: `gate.isUnlocked` means "some vault is open". It is set by every unlock (`markUnlocked`), and it
/// falls when the last vault locks (the observer below), however that happened; `gate.lock()` is the one call that locks every
/// vault, and the observer on the gate does the locking.
struct RootView: View {
    /// Owned by the app, so the Mac Settings window reads the same lock state and vault as this window.
    let gate: UnlockGate
    let session: VaultSession
    /// The sample vault lives in memory only. A fresh one starts whenever the app locks, so nothing typed into it is kept.
    @State private var sample = SampleVaultStore()
    /// What the system says about AutoFill, read here so every screen shows the same answer.
    let autoFill: AutoFillStatus
    /// Mac only: whether the bundled Safari extension is switched on. Reads nothing on iPhone and iPad, which have no extension.
    let safariExtension: SafariExtensionStatus
    #if os(iOS)
    /// Covers this scene while the app is away, so the app switcher's picture shows no item.
    @State private var cover = SceneCover()
    #endif
    @AppStorage("vaultSource") private var vaultSource = ""
    /// Where the window lands when another open vault's place is chosen, or a vault has just been unlocked.
    @State private var landing: VaultLanding?
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue
    @Environment(\.scenePhase) private var scenePhase
    @Environment(IncomingCodeRequests.self) private var incomingCodes
    @Environment(SettingsRequests.self) private var settingsRequests
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #else
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    static let keePassSource = "kdbx"
    private var usesDeviceAuth: Bool { vaultSource != Self.keePassSource }

    private var timing: LockTiming { LockTiming(rawValue: lockTiming) ?? .oneMinute }

    /// While no vault is open: on the Mac and on iPad at regular width the vault window itself, with its sidebar of locked vaults and
    /// the unlock form in the content area; on iPhone (and iPad at compact width, which has no sidebar) the full-screen lock screen.
    @ViewBuilder
    private var lockedWindow: some View {
        #if os(macOS)
        LockedVaultWindow(session: session, gate: gate)
        #else
        if sizeClass == .regular { LockedVaultWindow(session: session, gate: gate) } else { VaultPasswordView(session: session, gate: gate) }
        #endif
    }

    /// The window around an open store. One view per window store: a new vault (created, unlocked or shown) is never shown
    /// through the list and saved-key state the previous vault's view took when it appeared. While another vault's unlock form
    /// is shown, the window keeps the store it was built on, so the sidebar and the places stay.
    @ViewBuilder
    private func openWindow(_ store: KeePassVaultStore) -> some View {
        #if os(iOS)
        // iPhone and compact iPad have no sidebar: a locked vault's unlock screen replaces the vault, with a way back.
        if sizeClass == .compact, let shown = session.reference, !session.isOpen(shown.id) {
            VaultPasswordView(session: session, gate: gate, cancel: { session.show(store.reference.id) }).id(shown.id)
        } else {
            VaultView(store: store, landing: landing, selectVault: selectVault).id(ObjectIdentifier(store))
        }
        #else
        VaultView(store: store, landing: landing, selectVault: selectVault).id(ObjectIdentifier(store))
        #endif
    }

    /// Chooses a place of another open vault: that vault is shown with the place selected.
    private func selectVault(_ id: UUID, _ destination: VaultDestination) {
        landing = VaultLanding(destination: destination)
        session.show(id)
    }

    var body: some View {
        Group {
            if vaultSource.isEmpty {
                WelcomeView(session: session) { source in
                    gate.markUnlocked()
                    vaultSource = source
                }
            } else if vaultSource == Self.keePassSource {
                if gate.isUnlocked, let store = session.windowStore {
                    openWindow(store)
                } else {
                    lockedWindow
                }
            } else if gate.isUnlocked {
                VaultView(store: sample)
            } else {
                LockScreen(gate: gate)
            }
        }
        // Entering or leaving the sample vault (Welcome, Start Over) starts it fresh, so nothing typed into it comes back.
        .onChange(of: vaultSource) { sample = SampleVaultStore() }
        .environment(gate)
        .environment(session)
        .environment(autoFill)
        .environment(safariExtension)
        // Locking drops the keys and the decrypted vaults, after writing anything pending.
        .onChange(of: gate.isUnlocked) { _, unlocked in
            if unlocked { Task { await autoFill.refresh(); await safariExtension.refresh() } } else { session.lockAll(); sample = SampleVaultStore(); incomingCodes.clear() }
        }
        // The last vault locked by itself (Lock <name>): the gate follows, so the window and the gate agree.
        .onChange(of: session.isAnyOpen) { _, any in if !any, gate.isUnlocked, vaultSource == Self.keePassSource { gate.lock() } }
        // A vault that has just been unlocked while others are open lands on its All place, as Mail lands on an account's inbox.
        .onChange(of: session.openVaults.map(\.id)) { old, new in
            if !old.isEmpty, let added = new.first(where: { !old.contains($0) }), added == session.reference?.id, !session.returnPlaces.holds(vault: added) { landing = VaultLanding(destination: .all) }
        }
        #if os(macOS)
        // File, Vault Settings… and Lock <name> or Lock All Vaults: also while the window is locked (Settings opens at the vault's page).
        .focusedSceneValue(\.vaultMenu, vaultSource == Self.keePassSource ? session.reference.map { reference in
            VaultMenuCommands.make(session: session) { settingsRequests.show(.vault(reference.id)); openSettings() }
        } : nil)
        #endif
        .task { if !vaultSource.isEmpty { await gate.didBecomeActive(after: timing, prompt: usesDeviceAuth) } }
        // AutoFill and the Safari extension have no change notification, so both are read at launch, after unlock and whenever the
        // app becomes active.
        .task { await autoFill.refresh(); await safariExtension.refresh() }
        #if os(macOS)
        // Like Apple Passwords, a sleeping display or a locked screen locks the vault.
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.screensDidSleepNotification)) { _ in gate.lock() }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.willSleepNotification)) { _ in gate.lock() }
        .onReceive(DistributedNotificationCenter.default().publisher(for: Notification.Name("com.apple.screenIsLocked"))) { _ in gate.lock() }
        // Like Apple Passwords, no typing or clicking for the lock timing locks every vault, in front or not. The local monitor sees
        // each key and mouse event of this app (all its windows); a timer checks the clock.
        .task {
            let monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved]) { event in
                gate.noteInput()
                return event
            }
            defer { if let monitor { NSEvent.removeMonitor(monitor) } }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if gate.lockIfIdle(after: timing) { session.flushAll() }
            }
        }
        // Coming back from System Settings: the window's scene phase does not always say so on a Mac.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await autoFill.refreshSettling(); await safariExtension.refresh() } }
        #endif
        #if os(iOS)
        .background { SceneReader(cover: cover) }
        #endif
        // Leaving and coming back (docs/experience.md). On iPhone and iPad the cover goes up when the scene reaches the background
        // (not for a pull-down, which only makes it inactive), the lock is decided at the first step back (the inactive that
        // follows the background) so an unlock screen is what the cover lifts onto, and the cover comes off once the scene is
        // active. The Mac has no cover and starts the clock when the window stops being active.
        .onChange(of: scenePhase) { old, phase in
            switch phase {
            case .active:
                gate.decideOnReturn(after: timing)
                #if os(iOS)
                cover.hide()
                Task { await safariExtension.refresh() }
                #endif
                Task { await autoFill.refreshSettling() }
                if !vaultSource.isEmpty { Task { await gate.didBecomeActive(after: timing, prompt: usesDeviceAuth) } }
            case .inactive:
                session.flushAll()
                #if os(iOS)
                if old == .background { gate.decideOnReturn(after: timing) }
                #else
                gate.didLeave()
                #endif
            case .background:
                #if os(iOS)
                cover.show()
                #endif
                session.flushAll()
                gate.didEnterBackground(after: timing)
            @unknown default: break
            }
        }
    }
}

/// The app's scene reads focused values (menu commands) and so is evaluated again each time the vault window sets one. Without this
/// the window's content is built again then too, which sets the focused values again: a loop that keeps the main thread at 100%
/// and never lets the unlock finish. Comparing only what the app hands in (the environment still delivers changes) ends it.
extension RootView: Equatable {
    nonisolated static func == (lhs: RootView, rhs: RootView) -> Bool {
        MainActor.assumeIsolated {
            lhs.gate === rhs.gate && lhs.session === rhs.session && lhs.autoFill === rhs.autoFill && lhs.safariExtension === rhs.safariExtension
        }
    }
}
