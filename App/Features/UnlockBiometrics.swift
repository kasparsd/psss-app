import LocalAuthentication
import SwiftUI

/// The app icon, with the biometric glyph on its bottom-trailing corner when `biometry` is given (the sample vault's lock screen,
/// where the glyph is the control that tries again). The vault lock screen passes none: its Use Touch ID button asks again.
struct LockIcon: View {
    var biometry: BiometryKind?
    var vaultName = ""
    /// The vault is being opened now: the icon shows the name instead of the dots.
    var opening = false
    var retry: () -> Void = {}

    private let size: CGFloat = 76

    var body: some View {
        LockAppIcon(shown: opening, size: size)
            .overlay(alignment: .bottomTrailing) {
                if let biometry { badge(biometry).offset(x: 12, y: 12) }
            }
            .padding(.bottom, 8)
            .accessibilityElement(children: .contain)
    }

    private func badge(_ biometry: BiometryKind) -> some View {
        Button(action: retry) {
            Image(systemName: biometry.symbol)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 40, height: 40)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(biometry.label)
        .accessibilityHint(Text("Tries \(biometry.label) again to open \(vaultName)."))
        .help("Try \(biometry.label) again")
        .background(.regularMaterial, in: Circle())
        .overlay(Circle().strokeBorder(.primary.opacity(0.15), lineWidth: 0.5))
    }
}

/// The top of every lock screen, so the sample vault and a real vault look the same: the app icon (with the biometric glyph
/// when the vault unlocks with it) and the title. The icon is drawn, and shows the name instead of the dots while the vault opens.
struct LockHeader: View {
    var biometry: BiometryKind?
    var vaultName = ""
    var opening = false
    var retry: () -> Void = {}
    /// Draws "Psss Is Locked" under the icon; the content column beside the sidebar leaves it out.
    var showsTitle = true
    @Environment(\.scenePhase) private var scenePhase
    /// Just long enough for the screen to draw its first frame with the dots, so the change is seen as a change. Nothing else waits.
    private static let firstFrame = Duration.milliseconds(80)
    /// The introduction: right after the lock screen shows, and again each time the app returns to the front, the dots change
    /// to the name and rest there. Nothing waits for it.
    @State private var introduced = false
    /// What the icon shows: the name, once an attempt or the introduction has been under way for a moment. Face ID can start an attempt in the same
    /// instant the screen appears, and a change in that very frame has nothing to animate from.
    @State private var showsName = false

    var body: some View {
        VStack(spacing: 16) {
            LockIcon(biometry: biometry, vaultName: vaultName, opening: showsName, retry: retry)
            if showsTitle { Text("Psss Is Locked").font(.title2.weight(.semibold)) }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { introduced = false; return }
            try? await Task.sleep(for: Self.firstFrame)
            if !Task.isCancelled { introduced = true }
        }
        .task(id: opening || introduced) {
            guard opening || introduced else { showsName = false; return }
            if !introduced { try? await Task.sleep(for: Self.firstFrame) }
            if !Task.isCancelled { showsName = true }
        }
    }
}

/// Shown instead of the sample vault while it is locked. Same layout as `VaultPasswordView`; the one action is the device unlock
/// (Face ID or Touch ID, with the passcode as the fallback). The glyph shows only where that unlock can use biometry.
struct LockScreen: View {
    let gate: UnlockGate

    private var unlocking: Bool { gate.state == .unlocking }

    var body: some View {
        VStack(spacing: 16) {
            LockHeader(biometry: BiometryKind.current, vaultName: String(localized: "the sample vault"), opening: unlocking,
                       retry: { Task { await gate.unlock() } })
            Text("Open the sample vault to continue.")
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if case .failed(let message) = gate.state, !message.isEmpty {
                Text(message)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Task { await gate.unlock() }
            } label: {
                Text("Unlock").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(unlocking)
            .keyboardShortcut(.defaultAction)
        }
        .frame(maxWidth: 340)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

// MARK: - Automatic biometric prompt

/// Asks the system for Face ID or Touch ID with Apple's own prompt (no embedded sensor view: a Mac cannot listen silently for a
/// finger). One prompt at a time: a new request invalidates the one in flight, so two never stack, and `cancel()` dismisses it
/// (the form disappeared, or the vault changed). The passed `LAContext` is handed on so the Keychain read needs no second prompt
/// (`EvaluatedContext`, BiometricKey.swift). Uses the async API on the main actor; no closure replies.
@MainActor
@Observable
final class BiometricPrompter {
    enum Outcome {
        /// The person passed. The context is evaluated and can read the saved key.
        case evaluated(LAContext)
        /// The person cancelled, or the prompt was dismissed by `cancel()` or a newer request. Change nothing on screen.
        case cancelled
        /// The finger or face did not match after the system's attempts.
        case notRecognised
        /// Lockout, no sensor, or anything else that makes the vault password necessary this time.
        case unavailable
    }

    private(set) var isPrompting = false
    private var context: LAContext?
    private var finishedAt: Date?

    /// A prompt ended a moment ago. The system prompt makes the window or scene inactive and active again, which is not a new
    /// activation.
    var finishedRecently: Bool { finishedAt.map { Date.now.timeIntervalSince($0) < 1.5 } ?? false }

    func evaluate(reason: String) async -> Outcome {
        context?.invalidate()
        let session = LAContext()
        session.localizedCancelTitle = String(localized: "Cancel")
        // No device-password fallback: the vault password field on the form is the fallback.
        session.localizedFallbackTitle = ""
        context = session
        isPrompting = true
        var outcome = Outcome.evaluated(session)
        do {
            _ = try await session.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch {
            switch (error as? LAError)?.code {
            case .userCancel, .appCancel, .systemCancel: outcome = .cancelled
            case .authenticationFailed: outcome = .notRecognised
            default: outcome = .unavailable
            }
        }
        // A stale answer (cancelled, or a newer request took over) changes nothing.
        guard context === session else { return .cancelled }
        context = nil
        isPrompting = false
        finishedAt = .now
        return outcome
    }

    /// Dismisses a prompt in flight. Nothing is reported to the caller beyond `.cancelled`.
    func cancel() {
        guard let context else { return }
        self.context = nil
        isPrompting = false
        context.invalidate()
    }
}

private struct BiometricActivation: ViewModifier {
    let prompter: BiometricPrompter
    let vault: AnyHashable
    let enabled: Bool
    let ask: @MainActor () async -> Void

    private struct Token: Equatable { var vault: AnyHashable; var activation: Int; var enabled: Bool }
    @State private var activation = 0
    /// The form wanted to ask but its window or scene was not in front; the next activation asks.
    @State private var pending = false
    @Environment(\.scenePhase) private var scenePhase
    #if os(macOS)
    @Environment(\.controlActiveState) private var controlActiveState
    #else
    /// The scene went to the background since the last ask. The system sheet itself only makes the scene inactive and active.
    @State private var leftScene = false
    #endif

    private var isActive: Bool {
        #if os(macOS)
        controlActiveState == .key
        #else
        scenePhase == .active
        #endif
    }

    func body(content: Content) -> some View {
        content
            .task(id: Token(vault: vault, activation: activation, enabled: enabled)) {
                guard enabled else { return }
                guard isActive else { pending = true; return }
                pending = false
                await ask()
            }
            .onChange(of: isActive) { _, now in
                guard now, enabled, !prompter.isPrompting, !prompter.finishedRecently else { return }
                #if os(iOS)
                guard pending || leftScene else { return }
                leftScene = false
                #endif
                activation += 1
            }
            #if os(iOS)
            .onChange(of: scenePhase) { _, phase in if phase == .background { leftScene = true } }
            #endif
            .onChange(of: vault) { prompter.cancel() }
            .onChange(of: enabled) { _, now in if !now { prompter.cancel() } }
            .onDisappear { prompter.cancel() }
    }
}

extension View {
    /// Shows the system biometric prompt by itself, once per activation: when this view appears, when its Mac window becomes key
    /// again or when the iOS scene returns from the background. Not again after a cancel, and not while the person types. `ask`
    /// should call `BiometricPrompter.evaluate` and act on the outcome; the "Use Touch ID" button calls the same function. A
    /// prompt in flight is cancelled when the view disappears, the vault changes or `enabled` turns off. Pass `enabled: false`
    /// when the prompt would only fail (no biometric unlock for this vault, a missing file, a stale key after a lock notice).
    func biometricAutoPrompt(prompter: BiometricPrompter, vault: some Hashable, enabled: Bool,
                             ask: @escaping @MainActor () async -> Void) -> some View {
        modifier(BiometricActivation(prompter: prompter, vault: AnyHashable(vault), enabled: enabled, ask: ask))
    }
}
