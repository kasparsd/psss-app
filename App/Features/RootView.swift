import SwiftUI

/// Shows the vault only while unlocked. Locking tears the vault view down, so no decrypted state, selection
/// or search text stays in memory behind the lock screen, and unlocking opens fresh. On a Mac the search field has focus then; on iPhone and iPad it does not, so the keyboard stays closed.
struct RootView: View {
    @State private var gate = UnlockGate()
    @State private var session = VaultSession()
    /// The sample vault lives in memory only. A fresh one starts whenever the app locks, so nothing typed into it is kept.
    @State private var sample = SampleVaultStore()
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
        // Locking drops the keys and the decrypted vault, after writing anything pending.
        .onChange(of: gate.isUnlocked) { _, unlocked in if !unlocked { session.lock(); sample = SampleVaultStore() } }
        .focusedSceneValue(\.lockVault, gate.isUnlocked ? { gate.lock() } : nil)
        .task { if !vaultSource.isEmpty { await gate.didBecomeActive(after: timing, prompt: usesDeviceAuth) } }
        #if os(macOS)
        // Like Apple Passwords, a sleeping display or a locked screen locks the vault.
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.screensDidSleepNotification)) { _ in gate.lock() }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.willSleepNotification)) { _ in gate.lock() }
        .onReceive(DistributedNotificationCenter.default().publisher(for: Notification.Name("com.apple.screenIsLocked"))) { _ in gate.lock() }
        #endif
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: if !vaultSource.isEmpty { Task { await gate.didBecomeActive(after: timing, prompt: usesDeviceAuth) } }
            case .inactive, .background:
                try? session.store?.flush()
                gate.didResignActive()
            @unknown default: break
            }
        }
    }
}
