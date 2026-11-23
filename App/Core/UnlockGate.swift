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

    var isUnlocked: Bool { state == .unlocked }

    func unlock() async {
        guard state != .unlocking, state != .unlocked else { return }
        state = .unlocking
        do {
            try await Unlock.authenticate(reason: String(localized: "Unlock your passwords."))
            lockNotice = nil
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
        state = .unlocked
    }

    /// Why the vault was locked without the person asking. The password screen shows it for as long as it is set, also when it
    /// arrives while the screen is already up. Unlocking and any lock without a notice clear it, so it never outlives its cause.
    var lockNotice: String?

    func lock(notice: String? = nil) {
        lockNotice = notice
        state = .locked
    }

    /// Call when the scene stops being active. Starts the lock-timing clock.
    func didResignActive() {
        if isUnlocked, leftAt == nil { leftAt = .now }
    }

    /// Call when the scene becomes active. Locks if it was away longer than the chosen timing, then prompts
    /// (unless `prompt` is false: a KeePass vault asks for its vault password instead).
    func didBecomeActive(after timing: LockTiming, prompt: Bool = true) async {
        if let leftAt, isUnlocked, Date.now.timeIntervalSince(leftAt) >= TimeInterval(timing.rawValue) {
            lockNotice = nil
            state = .locked
        }
        leftAt = nil
        if prompt { await unlock() }
    }
}

/// Opaque cover shown instead of the vault while locked. Its one action is visible and labeled.
struct LockScreen: View {
    let gate: UnlockGate

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("Psss is locked")
                .font(.title2.weight(.semibold))
            if case .failed(let message) = gate.state, !message.isEmpty {
                Text(message)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
            Button {
                Task { await gate.unlock() }
            } label: {
                Label("Unlock", systemImage: "lock.open")
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(gate.state == .unlocking)
            .keyboardShortcut(.defaultAction)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}
