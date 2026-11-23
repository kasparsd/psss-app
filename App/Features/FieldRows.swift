import SwiftUI

/// The copy icon at the trailing end of a field's row. The glyph sits flush with the row's trailing text inset; the touch target
/// grows to the left of it (44 pt on iPhone and iPad, 28 pt on Mac). Copying turns it into a checkmark with the system replace
/// animation (a cross-fade with Reduce Motion) for as long as `copied` is true. VoiceOver says "Copy password", Mac shows the same
/// as a tooltip.
struct CopyIconButton: View {
    /// What it copies, in lowercase: "password", "verification code".
    let name: String
    let copied: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    #if os(iOS)
    private static let target: CGFloat = 44
    #else
    private static let target: CGFloat = 28
    #endif

    var body: some View {
        let label = String(localized: "Copy \(name)")
        let transition: ContentTransition = reduceMotion ? .opacity : .symbolEffect(.replace)
        Button(action: action) {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .contentTransition(transition)
                .animation(reduceMotion ? .easeInOut(duration: 0.2) : .default, value: copied)
                .foregroundStyle(Color.accentColor)
                .frame(width: Self.target, height: Self.target, alignment: .trailing)
                .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
        .help(label)
    }
}

/// One value of an item: its name above, the value below, a copy icon at the trailing end, and for a protected value an eye right
/// after the dots (the one control that is not at the trailing edge: it belongs to the value). Protected values show the same fixed
/// mask whatever their length and stay hidden until a deliberate reveal; VoiceOver hears "Hidden" for them, never the dots and
/// never the value. Revealing replaces the dots in place and may push the rows below down, animated.
struct FieldRow: View {
    let label: LocalizedStringResource
    /// What copy puts on the clipboard.
    let value: String
    /// What the row shows when the value is visible (a card number is grouped, for instance).
    let shown: String
    /// What the row shows while a protected value is hidden: eight dots, except a card number, which keeps its last four digits.
    var masked: String = VaultItem.hiddenMask
    let hidden: Bool
    @Binding var revealed: Bool
    /// This row's value was just copied: its icon is a checkmark.
    var copied = false
    let copy: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isHidden: Bool { hidden && !revealed }

    private var name: String { String(localized: label).localizedLowercase }

    private var revealAnimation: Animation { reduceMotion ? .easeInOut(duration: 0.2) : .snappy }

    private var valueText: some View {
        Text(isHidden ? masked : shown)
            .contentTransition(.opacity)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.disabled)
            .accessibilityLabel(isHidden ? Text("Hidden") : Text(shown))
    }

    private var eye: some View {
        let title = revealed ? String(localized: "Hide \(name)") : String(localized: "Show \(name)")
        return Button {
            withAnimation(revealAnimation) { revealed.toggle() }
        } label: {
            Image(systemName: revealed ? "eye.slash" : "eye")
                .contentTransition(reduceMotion ? ContentTransition.opacity : .symbolEffect(.replace))
                .foregroundStyle(Color.accentColor)
                // The tap target grows past the glyph without growing the row, so a row with an eye is as tall as one without.
                #if os(iOS)
                .frame(minWidth: 44, alignment: .leading)
                .contentShape(.rect.inset(by: -12))
                #else
                .frame(minWidth: 28, alignment: .leading)
                .contentShape(.rect.inset(by: -6))
                #endif
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(title)
        .help(title)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    valueText
                    if hidden { eye }
                }
            }
            Spacer(minLength: 8)
            CopyIconButton(name: name, copied: copied, action: copy)
        }
        .animation(revealAnimation, value: revealed)
    }
}

// MARK: The Copied pill

/// The state behind the pill that names what was just copied ("Password copied"): its sentence and its two seconds. One model per
/// item page; a newer copy replaces the pill on screen.
@MainActor
@Observable
final class CopiedPillModel {
    struct Offer: Equatable {
        let id = UUID()
        let message: String
    }

    static let visibleFor: Duration = .seconds(2)

    private(set) var offer: Offer?
    /// Counts copies, for the haptic.
    private(set) var count = 0
    private var timer: Task<Void, Never>?

    /// Shows `message` for about two seconds. VoiceOver hears it once.
    func show(_ message: String) {
        timer?.cancel()
        let offer = Offer(message: message)
        self.offer = offer
        count += 1
        AccessibilityNotification.Announcement(message).post()
        timer = Task { [weak self] in
            try? await Task.sleep(for: Self.visibleFor)
            guard !Task.isCancelled, let self, self.offer?.id == offer.id else { return }
            self.offer = nil
        }
    }
}

/// The pill itself: a checkmark and a short sentence on glass. Shared by every copy on an item page, so they all look and move alike.
private struct CopiedPill: View {
    let message: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Label(message, systemImage: "checkmark.circle.fill")
            .fontWeight(.semibold)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassEffect(.regular, in: .capsule)
            .padding(.bottom, 24)
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(message)
    }
}

private struct CopiedPillModifier: ViewModifier {
    let model: CopiedPillModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            // Inside the page's safe area: above the tab bar on iPhone, at the bottom centre of the detail on iPad and Mac.
            .overlay(alignment: .bottom) {
                if let offer = model.offer { CopiedPill(message: offer.message) }
            }
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : .snappy, value: model.offer)
            #if os(iOS)
            .sensoryFeedback(.impact(weight: .light), trigger: model.count)
            #endif
    }
}

extension View {
    /// Draws the Copied pill at the bottom of this page while `model` has one.
    func copiedPill(_ model: CopiedPillModel) -> some View { modifier(CopiedPillModifier(model: model)) }
}

extension VaultItem {
    /// Every hidden value looks like this, whatever its length: a mask that matched the secret would tell an onlooker how long it is.
    static let hiddenMask = "••••••••"

    /// How the item's main secret looks while it is hidden: the same eight dots as every protected value, a card number included.
    var maskedSecret: String { Self.hiddenMask }

    /// How the item's main secret looks when it is shown: a card number in groups of four.
    var spacedSecret: String {
        guard kind == .creditCard else { return secret }
        return stride(from: 0, to: secret.count, by: 4).map { String(secret.dropFirst($0).prefix(4)) }.joined(separator: " ")
    }
}


/// A revealed value hides again whenever the item is left: its page disappears, the selection, tab or place changes (the vault
/// screen bumps `signal`) or the app goes to the background.
struct HidesRevealedValues: ViewModifier {
    let signal: Int
    let hide: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onChange(of: signal) { hide() }
            .onChange(of: scenePhase) { _, phase in if phase != .active { hide() } }
            .onDisappear(perform: hide)
    }
}
