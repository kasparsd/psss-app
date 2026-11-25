import SwiftUI

/// The cover that stands in for the window while Psss is not the app in front (`docs/experience.md`, "Leaving and coming back"):
/// charcoal filling the window with the logo's mark alone in butter, resting state, no tile. It has no text and no controls, shows
/// nothing of the vault, and is the same in light and dark mode. Drawn live at any size, so every iPad window size works.
struct PrivacyCover: View {
    var body: some View {
        GeometryReader { proxy in
            let icon = min(max(min(proxy.size.width, proxy.size.height) * 0.3, 96), 180)
            ZStack {
                charcoal
                LogoField(shown: false)
                    .frame(width: icon * LogoFieldGeometry.iconFill)
                    .foregroundStyle(butter)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea()
        .accessibilityElement()
        .accessibilityLabel("Psss")
    }
}

#if os(iOS)
import UIKit

/// Puts `PrivacyCover` over one scene in a window of its own, above sheets and every other window, so that nothing of the vault is in
/// the picture the system takes for the app switcher. A window is shown at once, in the same step that learns the scene left, which a
/// SwiftUI overlay is not (it waits for the next update, and it could not cover a sheet). Each scene has its own, so each iPad
/// window covers itself. Never animated (Reduce Motion or not).
@MainActor
final class SceneCover {
    fileprivate weak var scene: UIWindowScene? {
        didSet { if scene !== oldValue { observe() } }
    }
    private var window: UIWindow?
    private var observer: NSObjectProtocol?

    /// UIKit posts this synchronously as the scene enters the background, before the system takes its picture. SwiftUI's scene
    /// phase reaches the app a step later, too late for the picture, so the cover goes up from here and RootView only takes it down.
    private func observe() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        guard let scene else { return }
        observer = NotificationCenter.default.addObserver(forName: UIScene.didEnterBackgroundNotification, object: scene, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.show() }
        }
    }

    var isUp: Bool { window != nil }

    func show() {
        guard window == nil else { return }
        let scenes = scene.map { [$0] } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let target = scenes.first else { return }
        let host = UIHostingController(rootView: PrivacyCover())
        host.view.backgroundColor = UIColor(charcoal)
        let cover = UIWindow(windowScene: target)
        cover.rootViewController = host
        cover.backgroundColor = UIColor(charcoal)
        cover.windowLevel = .alert + 100
        cover.isHidden = false
        cover.layoutIfNeeded()
        window = cover
    }

    func hide() {
        window?.isHidden = true
        window = nil
    }
}

/// Tells a `SceneCover` which scene its view is in.
struct SceneReader: UIViewRepresentable {
    let cover: SceneCover

    func makeUIView(context: Context) -> Anchor { Anchor(cover: cover) }
    func updateUIView(_ view: Anchor, context: Context) {}

    final class Anchor: UIView {
        let cover: SceneCover
        init(cover: SceneCover) {
            self.cover = cover
            super.init(frame: .zero)
            isHidden = true
            isUserInteractionEnabled = false
        }
        required init?(coder: NSCoder) { fatalError() }
        override func didMoveToWindow() { cover.scene = window?.windowScene }
    }
}
#endif
