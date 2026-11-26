import Foundation
#if os(macOS)
import AppKit
#endif

/// Enforces the lock for the whole app, with or without a window: every lock closes every open vault, and on the Mac sleep, a
/// locked screen and the lock time are watched from launch. Windows, the menu bar and Settings only ask for a lock and draw it.
@MainActor
final class AppLock: NSObject {
    let gate: UnlockGate
    let session: VaultSession

    /// `whenLocked` drops what else must not outlive an unlocked app. It runs after the vaults are closed.
    init(gate: UnlockGate, session: VaultSession, whenLocked: @escaping @MainActor () -> Void = {}) {
        self.gate = gate
        self.session = session
        super.init()
        // Also on a lock of a gate that is locked already: nothing may stay open behind a lock.
        gate.onLock = { [weak session] wasUnlocked in
            session?.lockAll()
            if wasUnlocked { whenLocked() }
        }
    }

    #if os(macOS)
    private var inputMonitor: Any?
    private var idleTimer: Task<Void, Never>?

    /// Starts the Mac's watchers. Safe to call again.
    func watchTheMac() {
        guard idleTimer == nil else { return }
        // Like Apple Passwords, a sleeping display or a locked screen locks the vaults.
        let workspace = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification] {
            workspace.addObserver(self, selector: #selector(ownerLeft), name: name, object: nil)
        }
        // Delivered at once also while Psss is not in front.
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(ownerLeft), name: Notification.Name("com.apple.screenIsLocked"),
                                                            object: nil, suspensionBehavior: .deliverImmediately)
        // The person went to another app: a lock they chose no longer holds Touch ID back when they return.
        NotificationCenter.default.addObserver(self, selector: #selector(appResigned), name: NSApplication.didResignActiveNotification, object: nil)
        // Like Apple Passwords, no typing or clicking for the lock timing locks every vault, in front or not. The monitor sees each
        // key and mouse event of this app (all its windows); a timer checks the clock. A pointer passing over a panel while another
        // app is in front is not using Psss.
        inputMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved]) { [weak self] event in
            if event.type != .mouseMoved || NSApp.isActive { self?.gate.noteInput() }
            return event
        }
        idleTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                self?.gate.lockIfIdle(after: .chosen)
            }
        }
    }

    @objc private func ownerLeft() { gate.lock() }
    @objc private func appResigned() { session.releaseBiometricPrompts() }
    #endif
}
