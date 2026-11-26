import SwiftUI

// The app icon's two brand colours. They are the icon's artwork (the tile and its mark), not a UI tint.
let butter = Color(red: 1.0, green: 0xD8 / 255, blue: 0x4D / 255)
let charcoal = Color(red: 0x1F / 255, green: 0x1F / 255, blue: 0x23 / 255)

/// The logo's field drawn in the current foreground style: an outline holding a p and either three dots (hidden) or three s
/// (shown). Every path is in `LogoFieldGeometry.box` units, so one transform scales them all to the view's width.
struct LogoField: View {
    var shown: Bool
    /// The change answers a tap: all three places at once and without a slow start, so nothing seems to wait.
    var immediate = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which of the three places show the s. Each follows `shown` with its own delay, through an explicit animation that touches
    /// only this value: an implicit animation on the letters would also animate any layout change that lands in the same update
    /// (the lock screen's text and form change as the attempt starts) and slide the s into place.
    @State private var placed: [Bool]

    init(shown: Bool, immediate: Bool = false) {
        self.shown = shown
        self.immediate = immediate
        _placed = State(initialValue: Array(repeating: shown, count: 3))
    }

    var body: some View {
        let box = LogoFieldGeometry.box
        Color.clear
            .aspectRatio(box.width / box.height, contentMode: .fit)
            .overlay {
                GeometryReader { proxy in
                    let scale = proxy.size.width / box.width
                    let transform = CGAffineTransform(scaleX: scale, y: scale).translatedBy(x: -box.minX, y: -box.minY)
                    ZStack {
                        capsule.applying(transform)
                            .stroke(style: StrokeStyle(lineWidth: LogoFieldGeometry.line * scale, lineJoin: .round))
                        letter(LogoFieldGeometry.p, transform)
                        LogoFieldGeometry.tail.applying(transform).fill()
                        ForEach(0..<3, id: \.self) { i in
                            letter(LogoFieldGeometry.s[i], transform)
                                .opacity(placed[i] ? 1 : 0)
                            dot(i).applying(transform).fill()
                                .opacity(placed[i] ? 0 : 1)
                        }
                    }
                }
            }
            .onChange(of: shown) {
                for i in 0..<3 {
                    withAnimation(animation(i)) { placed[i] = shown }
                }
            }
    }

    private func dot(_ i: Int) -> Path {
        let c = LogoFieldGeometry.dotCentres[i], r = LogoFieldGeometry.dotRadius
        return Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
    }

    private var capsule: Path {
        let r = LogoFieldGeometry.outline
        // Circular ends, as in the icon: the p's tail is cut to that curve.
        return Path(roundedRect: r, cornerRadius: r.height / 2, style: .circular)
    }

    /// Fill and stroke together: the letters are thickened by the stroke, as in the logo.
    private func letter(_ path: Path, _ transform: CGAffineTransform) -> some View {
        let scaled = path.applying(transform)
        let width = LogoFieldGeometry.letterStroke * transform.a
        return ZStack {
            scaled.fill()
            scaled.stroke(style: StrokeStyle(lineWidth: width, lineJoin: .round))
        }
    }

    /// The three places change one after another; with Reduce Motion they change at once. Slower than the web logo (0.16 s, 70 ms
    /// apart), which a pointer is already watching: here it is one moment, often over before Face ID has finished.
    private func animation(_ i: Int) -> Animation? {
        if reduceMotion { return nil }
        return immediate ? .easeOut(duration: 0.15) : .easeInOut(duration: 0.28).delay(Double(i) * 0.12)
    }
}

/// The app icon tile drawn flat, so the field can switch between the dots and the name. Butter in light and dark mode
/// (owner, 2026-11-25), as the Home Screen icon.
struct LockAppIcon: View {
    var shown: Bool
    var size: CGFloat = 76
    var immediate = false

    var body: some View {
        let tile = RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
        tile.fill(butter)
            .overlay { LogoField(shown: shown, immediate: immediate).frame(width: size * LogoFieldGeometry.iconFill) }
            .foregroundStyle(charcoal)
            .overlay { tile.strokeBorder(.black.opacity(0.12), lineWidth: 0.5) }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
