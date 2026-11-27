#if os(iOS)
import SwiftUI
import UIKit

/// What Psss shows when Safari sent the person here (mock `#/ios-safari-fill`, frames 4b, 16a, 17a and 17b): one title, one line
/// and labeled buttons, over the whole window.
struct SafariFillReturnView: View {
    let coordinator: SafariFillCoordinator

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                if let screen = coordinator.screen {
                    VStack(spacing: 16) { content(screen) }
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 340)
                        .padding(24)
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background { Rectangle().fill(.background).ignoresSafeArea() }
    }

    @ViewBuilder private func content(_ screen: SafariFillCoordinator.Screen) -> some View {
        switch screen {
        case .confirm(let vault):
            // Face ID, Touch ID or Optic ID; nil without enrolled biometry (or while it is locked out), when the passcode is asked.
            let biometry = BiometryKind.current?.label
            title(String(localized: "Fill from \(vault) in Safari"))
            if let biometry {
                Text("Use \(biometry) to let Safari fill its cards and addresses.")
            } else {
                Text("Use your passcode to let Safari fill its cards and addresses.")
            }
            // While the system asks, there is nothing to tap here.
            if !coordinator.isAuthenticating {
                if let problem = coordinator.problem { Text(problem).foregroundStyle(.secondary) }
                primary(biometry.map { String(localized: "Use \($0)") } ?? String(localized: "Use Passcode")) {
                    Task { await coordinator.confirm() }
                }
                plain("Cancel")
            }
        case .shared(let vault):
            title(String(localized: "\(vault) is unlocked"))
            Text("Go back to Safari and tap Psss again.")
            plain("Done")
        case .failed(let vault):
            title(String(localized: "Couldn’t share with Safari"))
            Text("\(vault) is unlocked, but Safari can’t fill from it.")
            primary(String(localized: "Try Again")) { coordinator.retry() }
            plain("Done")
        }
    }

    private func title(_ text: String) -> some View {
        Text(text).font(.title2.bold()).accessibilityAddTraits(.isHeader)
    }

    private func primary(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(label).frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
    }

    /// Done and Cancel both go back to the vault.
    private func plain(_ label: LocalizedStringKey) -> some View {
        Button(label) { coordinator.dismiss() }
            .buttonStyle(.borderless)
            .controlSize(.large)
    }
}

/// Connects the coordinator to the app's window: tells it what changed, and shows its screen.
struct SafariFillPresentation: ViewModifier {
    let coordinator: SafariFillCoordinator
    let gate: UnlockGate
    let session: VaultSession

    func body(content: Content) -> some View {
        content
            .background { SafariFillWindowHost(coordinator: coordinator, isShown: coordinator.screen != nil) }
            .onChange(of: gate.isUnlocked) { coordinator.update() }
            .onChange(of: Set(session.stores.keys)) { coordinator.update() }
            .onChange(of: session.reference?.id) { coordinator.update() }
    }
}

/// The window of `SafariFillReturnView`, one per scene, above that scene's sheets. A window of its own leaves whatever is under
/// it, an open sheet or an unsaved edit, as it was; a sheet presented from the root could not show over another sheet. The privacy
/// cover (`SceneCover`) stays above it.
private final class SafariFillWindow: UIWindow {}

private struct SafariFillWindowHost: UIViewRepresentable {
    let coordinator: SafariFillCoordinator
    let isShown: Bool

    func makeUIView(context: Context) -> Anchor { Anchor(coordinator: coordinator) }

    func updateUIView(_ view: Anchor, context: Context) {
        view.isShown = isShown
        view.apply()
    }

    static func dismantleUIView(_ view: Anchor, coordinator: ()) {
        view.isShown = false
        view.apply()
    }

    final class Anchor: UIView {
        private let coordinator: SafariFillCoordinator
        private var cover: SafariFillWindow?
        private weak var previousKey: UIWindow?
        var isShown = false

        init(coordinator: SafariFillCoordinator) {
            self.coordinator = coordinator
            super.init(frame: .zero)
            isHidden = true
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { fatalError() }

        override func didMoveToWindow() { apply() }

        func apply() {
            if isShown, cover == nil, let scene = window?.windowScene {
                previousKey = scene.keyWindow
                // The keyboard would stay over the screen. What was typed stays in its field.
                for other in scene.windows { other.endEditing(true) }
                let new = SafariFillWindow(windowScene: scene)
                new.windowLevel = .normal + 10
                let host = UIHostingController(rootView: SafariFillReturnView(coordinator: coordinator))
                host.view.accessibilityViewIsModal = true
                new.rootViewController = host
                new.makeKeyAndVisible()
                cover = new
                UIAccessibility.post(notification: .screenChanged, argument: host.view)
            } else if !isShown, let shown = cover {
                shown.isHidden = true
                cover = nil
                previousKey?.makeKey()
                UIAccessibility.post(notification: .screenChanged, argument: nil)
            }
        }
    }
}

extension SafariFillCoordinator {
    /// The app's own coordinator: the real Keychain item, the real prompt.
    static func live(session: VaultSession, gate: UnlockGate) -> SafariFillCoordinator {
        SafariFillCoordinator(session: session, gate: gate, store: KeychainSafariFillStore(), surroundings: Surroundings(
            isSetUp: { UserDefaults.standard.string(forKey: "vaultSource") == RootView.keePassSource },
            timing: { LockTiming.chosen },
            isActive: { UIApplication.shared.applicationState == .active },
            isBusy: { ItemEdit.isAnyInProgress || isSomethingPresented },
            authenticate: { try await Unlock.authenticate(reason: $0) }))
    }

    /// A sheet, alert or menu is up in one of Psss's own windows. A search field's own presentation does not count.
    private static var isSomethingPresented: Bool {
        func presents(_ controller: UIViewController?) -> Bool {
            guard let controller else { return false }
            if let shown = controller.presentedViewController { return !(shown is UISearchController) || presents(shown) }
            return controller.children.contains(where: presents)
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            .contains { $0.windowLevel == .normal && !$0.isHidden && presents($0.rootViewController) }
    }

    /// At launch, before any link: takes back a grant an earlier run left, then follows what the system says about the app.
    func start() {
        revoke()
        observe(UIApplication.didBecomeActiveNotification) { $0.becameActive() }
        observe(UIApplication.didEnterBackgroundNotification) { $0.leftApp() }
        // The device is being locked while Psss runs.
        observe(UIApplication.protectedDataWillBecomeUnavailableNotification) { $0.revoke() }
        // The Safari extension's copy of the vault list is written now and on each return (the AutoFill provider cannot write
        // it); when that fails the extension must not be left with a grant.
        if !VaultReference.mirrorForSafari() { revoke() }
        observe(UIApplication.willEnterForegroundNotification) {
            if !VaultReference.mirrorForSafari() { $0.revoke() }
            $0.returned()
        }
    }

    /// For the life of the app, so nothing removes the observer.
    private func observe(_ name: Notification.Name, _ body: @escaping @MainActor @Sendable (SafariFillCoordinator) -> Void) {
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                body(self)
            }
        }
    }
}
#endif
