import SwiftUI

/// Shows the vault only while unlocked. Locking tears the vault view down, so no decrypted state, selection
/// or search text stays in memory behind the lock screen, and unlocking opens fresh. On a Mac the search field has focus then; on iPhone and iPad it does not, so the keyboard stays closed.
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
    @AppStorage("vaultSource") private var vaultSource = ""
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue
    @Environment(\.scenePhase) private var scenePhase

    static let keePassSource = "kdbx"
    private var usesDeviceAuth: Bool { vaultSource != Self.keePassSource }

    private var timing: LockTiming { LockTiming(rawValue: lockTiming) ?? .oneMinute }

    var body: some View {
        Group {
            if vaultSource.isEmpty {
                WelcomeView(session: session) { source in
                    gate.markUnlocked()
                    vaultSource = source
                }
            } else if vaultSource == Self.keePassSource {
                if gate.isUnlocked, let store = session.store {
                    VaultView(store: store)
                } else {
                    VaultPasswordView(session: session, gate: gate)
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
        // Locking drops the keys and the decrypted vault, after writing anything pending.
        .onChange(of: gate.isUnlocked) { _, unlocked in
            if unlocked { Task { await autoFill.refresh(); await safariExtension.refresh() } } else { session.lock(); sample = SampleVaultStore() }
        }
        .focusedSceneValue(\.lockVault, gate.isUnlocked ? { gate.lock() } : nil)
        .task { if !vaultSource.isEmpty { await gate.didBecomeActive(after: timing, prompt: usesDeviceAuth) } }
        // AutoFill has no change notification, so it is read at launch, after unlock and whenever the app becomes active.
        .task { await autoFill.refresh(); await safariExtension.refresh() }
        #if os(macOS)
        // Like Apple Passwords, a sleeping display or a locked screen locks the vault.
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.screensDidSleepNotification)) { _ in gate.lock() }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.willSleepNotification)) { _ in gate.lock() }
        .onReceive(DistributedNotificationCenter.default().publisher(for: Notification.Name("com.apple.screenIsLocked"))) { _ in gate.lock() }
        // Coming back from System Settings: the window's scene phase does not always say so on a Mac.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await autoFill.refresh(); await safariExtension.refresh() } }
        #endif
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await autoFill.refresh() }
                if !vaultSource.isEmpty { Task { await gate.didBecomeActive(after: timing, prompt: usesDeviceAuth) } }
            case .inactive, .background:
                try? session.store?.flush()
                gate.didResignActive()
            @unknown default: break
            }
        }
    }
}
