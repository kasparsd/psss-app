import SwiftUI

/// The cover that stands in for the window while Psss is not the app in front (`docs/experience.md`, "Leaving and coming back"):
/// charcoal filling the window, rows of faint butter dots in threes and the logo's mark in butter, resting state, no tile. It has no
/// text and no controls, shows nothing of the vault, and is the same in light and dark mode. Drawn live at any size, so every iPad
/// window size works.
struct PrivacyCover: View {
    /// Picks the arrangement of the dots. It is fixed while a cover is up, so a redraw (a rotation, a resized window) keeps it.
    var seed: UInt64

    var body: some View {
        GeometryReader { proxy in
            let icon = min(max(min(proxy.size.width, proxy.size.height) * 0.3, 96), 180)
            ZStack {
                charcoal
                CoverDots(seed: seed, size: proxy.size, icon: icon)
                    .foregroundStyle(butter)
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

/// Rows of dots in threes, like passwords being typed, falling differently for every seed. Static, never animated; nothing but the
/// seed and the window size goes into the drawing. The same layout as the mock (`Design/Mocks/app/src/pages/dotField.tsx`).
/// Drawn as shapes, like the mark, never as a `Canvas`: a canvas in a window made as the app leaves is often not drawn before the
/// system takes the app switcher's picture, and the dots were missing from it.
private struct CoverDots: View {
    let seed: UInt64
    let size: CGSize
    /// The size of the mark's icon box, which sets the clear space around the mark.
    let icon: CGFloat

    private struct Triple: Identifiable {
        let id: Int
        let path: Path
        let opacity: Double
    }

    private var groups: [Triple] {
        var random = SeededNumbers(state: seed)
        let scale = icon / 120
        // 0 behind the mark, 1 away from it, so the mark always stands on plain charcoal.
        func clear(_ x: CGFloat, _ y: CGFloat) -> CGFloat {
            let distance = hypot((x - size.width / 2) / 1.5, y - size.height / 2)
            return min(1, max(0, (distance - 56 * scale) / (70 * scale)))
        }
        var groups: [Triple] = []
        for y in stride(from: CGFloat(18), through: size.height - 8, by: 30) {
            var x = -CGFloat.random(in: 0..<70, using: &random)
            while x < size.width {
                defer { x += 78 }
                let weight = CGFloat.random(in: 0..<1, using: &random)
                guard weight > 0.3, x >= 8, x + 30 <= size.width - 8 else { continue }
                // A group fades as one, so no group is ever cut to one or two dots.
                let fade = (0..<3).map { clear(x + CGFloat($0) * 15, y) }.min() ?? 0
                guard fade > 0 else { continue }
                let radius = 1.2 + weight * 2.56
                var path = Path()
                for i in 0..<3 {
                    path.addEllipse(in: CGRect(x: x + CGFloat(i) * 15 - radius, y: y - radius,
                                               width: radius * 2, height: radius * 2))
                }
                groups.append(Triple(id: groups.count, path: path, opacity: (0.1 + weight * 0.224) * fade))
            }
        }
        return groups
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(groups) { group in
                group.path.fill().opacity(group.opacity)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .accessibilityHidden(true)
    }
}

/// SplitMix64: the same seed gives the same numbers.
private struct SeededNumbers: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
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
        let host = UIHostingController(rootView: PrivacyCover(seed: .random(in: .min ... .max)))
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
