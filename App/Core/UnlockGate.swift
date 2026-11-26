import LocalAuthentication
import SwiftUI

/// Device-owner authentication shared by the app and the AutoFill extension: Face ID or Touch ID, with the
/// device passcode (or the Mac login password) as the fallback. One policy means one behavior everywhere.
///
/// Prototype caveat: the sample vault is not encrypted yet, so this gate is a user-interface gate. The real
/// protection arrives with the Keychain-held vault key behind biometrics (roadmap S2 and S6).
enum Unlock {
    enum Failure: Error, Equatable {
        case cancelled
        case unavailable(String)
        case failed(String)

        var message: String {
            switch self {
            case .cancelled: String(localized: "Unlock was cancelled.")
            case .unavailable(let text), .failed(let text): text
            }
        }
    }

    /// Asks the system to authenticate. Returns on success; throws `Failure` otherwise.
    static func authenticate(reason: String) async throws {
        let context = LAContext()
        context.localizedCancelTitle = String(localized: "Cancel")
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            if error?.code == LAError.passcodeNotSet.rawValue {
                throw Failure.unavailable(String(localized: "Set a device passcode to protect your passwords, then try again."))
            }
            throw Failure.unavailable(error?.localizedDescription ?? String(localized: "This device cannot authenticate."))
        }
        do {
            try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch let error as LAError where [.userCancel, .appCancel, .systemCancel].contains(error.code) {
            throw Failure.cancelled
        } catch {
            throw Failure.failed(error.localizedDescription)
        }
    }
}

/// How long the app may stay in the background before it asks again.
enum LockTiming: Int, CaseIterable, Identifiable {
    case immediately = 0, oneMinute = 60, fiveMinutes = 300, fifteenMinutes = 900

    var id: Int { rawValue }

    /// The timing chosen in Settings (`lockTiming`), for code that is not a view.
    static var chosen: LockTiming { (UserDefaults.standard.object(forKey: "lockTiming") as? Int).flatMap(LockTiming.init(rawValue:)) ?? .oneMinute }

    /// How long without any keyboard or mouse input locks an app that stays open (Mac). "Immediately" is about leaving the app, so
    /// it never locks someone who is reading or typing: it waits a minute, as Apple Passwords does.
    var idleLimit: TimeInterval { TimeInterval(max(rawValue, LockTiming.oneMinute.rawValue)) }

    var title: LocalizedStringKey {
        switch self {
        case .immediately: "Immediately"
        case .oneMinute: "After 1 minute"
        case .fiveMinutes: "After 5 minutes"
        case .fifteenMinutes: "After 15 minutes"
        }
    }
}

/// App-side lock state. The vault is covered, never torn down, so selection, search and scroll survive a lock.
@MainActor
@Observable
final class UnlockGate {
    enum State: Equatable {
        case locked
        case unlocking
        case unlocked
        case failed(String)
    }

    private(set) var state: State = .locked
    private var leftAt: Date?
    /// The last keyboard or mouse input the app saw (Mac), or when it was unlocked, whichever is later.
    private var lastInput = Date.now

    var isUnlocked: Bool { state == .unlocked }

    /// Runs on every lock, before the caller goes on; `wasUnlocked` is false when it was locked already. The app closes its vaults
    /// here (`AppLock`), so a lock holds with no window open. The AutoFill extension sets none.
    @ObservationIgnored var onLock: ((_ wasUnlocked: Bool) -> Void)?

    private func close(notice: String? = nil) {
        let wasUnlocked = isUnlocked
        lockNotice = notice
        state = .locked
        onLock?(wasUnlocked)
    }

    /// Call for every key press and mouse event in the app.
    func noteInput(now: Date = .now) { lastInput = now }

    /// Locks (all vaults, through the gate) when nothing was typed or clicked for the timing's idle limit, whether the app is in
    /// front or not. Returns whether it locked. Called from a timer; does nothing when already locked.
    @discardableResult
    func lockIfIdle(after timing: LockTiming, now: Date = .now) -> Bool {
        guard isUnlocked, now.timeIntervalSince(lastInput) >= timing.idleLimit else { return false }
        close()
        return true
    }

    func unlock() async {
        guard state != .unlocking, state != .unlocked else { return }
        state = .unlocking
        do {
            try await Unlock.authenticate(reason: String(localized: "Unlock your passwords."))
            lockNotice = nil
            lastInput = .now
            state = .unlocked
        } catch let failure as Unlock.Failure {
            state = .failed(failure == .cancelled ? "" : failure.message)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// For a vault the person just created or imported: they are already here, so no prompt.
    func markUnlocked() {
        lockNotice = nil
        lastInput = .now
        state = .unlocked
    }

    /// Why the vault was locked without the person asking. The password screen shows it for as long as it is set, also when it
    /// arrives while the screen is already up. Unlocking and any lock without a notice clear it, so it never outlives its cause.
    var lockNotice: String?

    func lock(notice: String? = nil) { close(notice: notice) }

    /// Call when the scene is leaving: on iPhone and iPad when it reaches the background (a pull-down such as Control Center only
    /// makes it inactive and does not count), on the Mac when it stops being active. Starts the lock-timing clock.
    func didLeave(now: Date = .now) {
        if isUnlocked, leftAt == nil { leftAt = now }
    }

    /// The scene reached the background. Starts the clock, and with "Immediately" locks at once, so what is locked is already
    /// locked when the person comes back.
    func didEnterBackground(after timing: LockTiming, now: Date = .now) {
        didLeave(now: now)
        guard timing == .immediately else { return }
        // Locked already: a vault still being opened must not finish behind the lock.
        if isUnlocked { close() } else { onLock?(false) }
    }

    /// The lock decision when the scene comes back: locks if it was away at least the chosen timing, and ends the clock. Called at
    /// the first step out of the background, before the first frame is drawn, so the unlock screen is the first thing uncovered.
    /// Returns whether it locked. Nothing happens when no clock is running (a pull-down that never left).
    @discardableResult
    func decideOnReturn(after timing: LockTiming, now: Date = .now) -> Bool {
        defer { leftAt = nil }
        guard let leftAt, isUnlocked, now.timeIntervalSince(leftAt) >= TimeInterval(timing.rawValue) else { return false }
        close()
        return true
    }

    /// Call when the scene becomes active. Decides the lock if that has not been done yet, then prompts (unless `prompt` is false:
    /// a KeePass vault asks for its vault password instead).
    func didBecomeActive(after timing: LockTiming, prompt: Bool = true, now: Date = .now) async {
        decideOnReturn(after: timing, now: now)
        if prompt { await unlock() }
    }
}
