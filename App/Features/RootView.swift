import SwiftUI

/// Shows the vault only while unlocked. Locking tears the vault view down, so no decrypted state, selection
/// or search text stays in memory behind the lock screen, and unlocking opens fresh with search focused.
struct RootView: View {
    @State private var gate = UnlockGate()
    @AppStorage("lockTiming") private var lockTiming = LockTiming.oneMinute.rawValue
    @Environment(\.scenePhase) private var scenePhase

    private var timing: LockTiming { LockTiming(rawValue: lockTiming) ?? .oneMinute }

    var body: some View {
        Group {
            if gate.isUnlocked {
                VaultView(items: SharedVault.allItems)
            } else {
                LockScreen(gate: gate)
            }
        }
        .environment(gate)
        .focusedSceneValue(\.lockVault, gate.isUnlocked ? { gate.lock() } : nil)
        .task { await gate.didBecomeActive(after: timing) }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: Task { await gate.didBecomeActive(after: timing) }
            case .inactive, .background: gate.didResignActive()
            @unknown default: break
            }
        }
    }
}
