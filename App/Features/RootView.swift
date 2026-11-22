import SwiftUI

/// Shows the vault only while unlocked. Locking tears the vault view down, so no decrypted state, selection
/// or search text stays in memory behind the lock screen, and unlocking opens fresh with search focused.
struct RootView: View {
    @State private var gate = UnlockGate()
    @AppStorage("vaultSource") private var vaultSource = ""
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue
    @Environment(\.scenePhase) private var scenePhase

    private var timing: LockTiming { LockTiming(rawValue: lockTiming) ?? .oneMinute }

    var body: some View {
        Group {
            if vaultSource.isEmpty {
                WelcomeView { source in
                    gate.markUnlocked()
                    vaultSource = source
                }
            } else if gate.isUnlocked {
                VaultView(items: SharedVault.items(source: vaultSource))
            } else {
                LockScreen(gate: gate)
            }
        }
        .environment(gate)
        .focusedSceneValue(\.lockVault, gate.isUnlocked ? { gate.lock() } : nil)
        .task { if !vaultSource.isEmpty { await gate.didBecomeActive(after: timing) } }
        #if os(macOS)
        // Like Apple Passwords, a sleeping display or a locked screen locks the vault.
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.screensDidSleepNotification)) { _ in gate.lock() }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.willSleepNotification)) { _ in gate.lock() }
        .onReceive(DistributedNotificationCenter.default().publisher(for: Notification.Name("com.apple.screenIsLocked"))) { _ in gate.lock() }
        #endif
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: if !vaultSource.isEmpty { Task { await gate.didBecomeActive(after: timing) } }
            case .inactive, .background: gate.didResignActive()
            @unknown default: break
            }
        }
    }
}
