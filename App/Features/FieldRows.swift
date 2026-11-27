import SwiftUI

extension Font {
    /// The one face of every secret value shown in the clear (owner, 2026-11-24): the system monospaced design at body size, so 1, l
    /// and I, and 0 and O, differ. Revealed passwords, card numbers, security codes, setup keys and custom values, the fields that edit
    /// them, and a generated password all use this, so it cannot drift. The eight hidden dots keep the normal face.
    static let secretValue = Font.system(.body, design: .monospaced)
}

extension View {
    /// What every field that edits a secret has (a password, card number, security code, setup key, custom value, the new vault
    /// password): the monospaced face, no autocorrection or capitals, and no offers from the system's own password manager.
    func secretEntry() -> some View { font(.secretValue).noPasswordOffers() }

    /// The part of `secretEntry` that is not the typeface, for the new vault password fields too.
    ///
    /// On iOS these fields are marked as one-time-code fields (owner, 2026-11-24). That is not what they are: it is the one content
    /// type found that stops iOS from sliding its "Use Strong Password?" sheet over a password a person is typing by hand. The sheet
    /// offers to make a password and keep it in Apple Passwords, which is the wrong place for something being saved into this vault,
    /// and on iPad it replaced a vault password that had already been typed. Tried on iOS 27.2 without effect: no content type, an
    /// empty one, and `.password`. The cost: if a text message with a code has just arrived, iOS may offer that code above the
    /// keyboard on these fields. Nothing is filled unless the person taps it. If a later iOS offers a proper way to opt a field out of
    /// strong-password suggestions, use that and remove this. The unlock field is left alone on purpose: there the system may offer a
    /// saved vault password. See `docs/experience.md`, "Secret fields (iOS)".
    func noPasswordOffers() -> some View {
        autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .textContentType(.oneTimeCode)
            #endif
    }
}

/// A tap or click anywhere on a field's row copies it (owner, 2026-11-24), with exactly what the copy icon does. The icon stays as the
/// visible sign that the row copies, and the eye stays its own button. The row's own button is a layer behind the row's content, so the
/// controls in it (the eye, the copy icon) keep their own taps and their own VoiceOver elements ("Show password", "Copy password"), and
/// the layer adds no element of its own. The row darkens while pressed on iPhone and iPad and under the pointer on Mac.
private struct CopyRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Highlighted(label: configuration.label, pressed: configuration.isPressed)
    }

    private struct Highlighted<Label: View>: View {
        let label: Label
        let pressed: Bool
        @State private var hovering = false

        var body: some View {
            label
                .background(Color.primary.opacity(pressed || hovering ? 0.08 : 0))
                #if os(macOS)
                .onHover { hovering = $0 }
                #endif
        }
    }
}

extension View {
    /// The whole row copies when tapped or clicked, see `CopyRowStyle`. Buttons inside the row keep working on their own.
    func copiesOnTap(_ copy: @escaping () -> Void) -> some View {
        background {
            // Out to the edges of the row, past its insets, so a tap beside the text copies too.
            Button(action: copy) { Color.clear.contentShape(.rect) }
                .buttonStyle(CopyRowStyle())
                .accessibilityHidden(true)
                #if os(iOS)
                .padding(.horizontal, -20).padding(.vertical, -12)
                #else
                .padding(.horizontal, -20).padding(.vertical, -8)
                #endif
        }
    }
}

/// The row of a web address (owner, 2026-11-26): a tap or click anywhere on it opens the address in the browser instead of copying,
/// and holding it (right-click on Mac) offers both. The copy icon stays and copies, as on every other row.
private struct OpensWebAddress: ViewModifier {
    /// The field's name as the menu writes it: "Copy Website".
    let name: String
    let open: () -> Void
    let copy: () -> Void

    func body(content: Content) -> some View {
        content
            .copiesOnTap(open)
            .contextMenu {
                Button("Open in Browser", systemImage: "safari", action: open)
                Button("Copy \(name)", systemImage: "doc.on.doc", action: copy)
            }
    }
}

/// The VoiceOver side of a link: the trait and the activate action, only where there is something to open.
private struct ActsAsLink: ViewModifier {
    let open: (() -> Void)?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let open { content.accessibilityAddTraits(.isLink).accessibilityAction(.default, open) } else { content }
    }
}

/// `copiesOnTap` where there is something to copy, the row as it is where there is not.
struct CopiesWhen: ViewModifier {
    let enabled: Bool
    let action: () -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled { content.copiesOnTap(action) } else { content }
    }
}

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

/// The inline eye shared by item details and field mapping previews.
struct RevealIconButton: View {
    let name: String
    @Binding var revealed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var revealAnimation: Animation { reduceMotion ? .easeInOut(duration: 0.2) : .snappy }

    var body: some View {
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
    /// A vault field name is user data and is displayed literally.
    var verbatimLabel: String? = nil
    /// What the row shows while a protected value is hidden: eight dots, except a card number, which keeps its last four digits.
    var masked: String = VaultItem.hiddenMask
    let hidden: Bool
    @Binding var revealed: Bool
    /// This row's value was just copied: its icon is a checkmark.
    var copied = false
    /// A problem with this value, written under it (an empty card number, an expiry that is not a date).
    var notice: String? = nil
    /// False for a fact that is not worth copying (a Wi-Fi network's security): no icon, no tap-to-copy.
    var copyable = true
    let copy: () -> Void
    /// The address this row opens when tapped. Nil for every row that copies when tapped, see `SiteMatch.webAddress`.
    var link: URL? = nil
    /// Called after the address was opened.
    var opened: () -> Void = {}

    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A protected value never opens: it would put the hidden address on screen in the browser.
    private var openable: URL? { hidden ? nil : link }

    private func open(_ url: URL) {
        openURL(url)
        opened()
    }

    private var isHidden: Bool { hidden && !revealed && !value.isEmpty }

    private var name: String { (verbatimLabel ?? String(localized: label)).localizedLowercase }

    private var revealAnimation: Animation { reduceMotion ? .easeInOut(duration: 0.2) : .snappy }

    private var valueText: some View {
        (isHidden ? Text(verbatim: masked) : value.isEmpty ? Text("Empty") : Text(verbatim: shown))
            // A protected value that is shown is set in the monospaced face; the dots and plain fields (username, website) are not.
            .font(hidden && !isHidden ? .secretValue : .body)
            // The accent colour says that this value is a link.
            .foregroundStyle(openable == nil ? Color.primary : Color.accentColor)
            .contentTransition(.opacity)
            // The eight dots never wrap, at any text size: they stay on one line with the eye. A shown value wraps as it needs.
            .lineLimit(isHidden ? 1 : nil)
            .fixedSize(horizontal: isHidden, vertical: true)
            .textSelection(.disabled)
            .accessibilityLabel(isHidden ? Text("Hidden") : value.isEmpty ? Text("Empty") : Text(verbatim: shown))
            // Only a link gets a trait and an action: an empty action on every value would swallow VoiceOver's activate.
            .modifier(ActsAsLink(open: openable.map { url in { open(url) } }))
    }

    var body: some View {
        if let url = openable {
            row.modifier(OpensWebAddress(name: verbatimLabel ?? String(localized: label), open: { open(url) }, copy: copy))
        } else {
            row.modifier(CopiesWhen(enabled: !value.isEmpty && copyable, action: copy))
        }
    }

    private var row: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                (verbatimLabel.map { Text(verbatim: $0) } ?? Text(label)).foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    valueText
                    if hidden && !value.isEmpty { RevealIconButton(name: name, revealed: $revealed) }
                }
                if let notice { ProblemText(text: notice) }
            }
            Spacer(minLength: 8)
            if !value.isEmpty, copyable { CopyIconButton(name: name, copied: copied, action: copy) }
        }
        .animation(revealAnimation, value: revealed)
    }
}

/// A recognized field the item has no value for (owner, 2026-11-24): the label where the value will be, "Not set" in the secondary
/// style and a labelled Add at the end. Nothing to copy, so no copy icon; the whole row and Add open Edit at this field.
struct UnsetFieldRow: View {
    let label: LocalizedStringResource
    let add: () -> Void

    var body: some View {
        Button(action: add) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundStyle(.secondary)
                    Text("Not set").foregroundStyle(.tertiary)
                }
                Spacer(minLength: 8)
                Text("Add").foregroundStyle(Color.accentColor)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(String(localized: label)), not set"))
        .accessibilityHint(Text("Opens Edit at this field"))
        .accessibilityAddTraits(.isButton)
    }
}

/// The same read-only custom rows appear in the live vault and in Recently Deleted.
struct OtherStoredFields: View {
    let fields: [StoredItemField]
    let hideSignal: Int
    let pill: CopiedPillModel
    var used: () -> Void = {}
    @State private var revealed: Set<StoredItemField.ID> = []
    @State private var copied: StoredItemField.ID?
    @State private var copyReset: Task<Void, Never>?

    var body: some View {
        ForEach(fields) { field in
            let name = field.key.isEmpty ? String(localized: "Unnamed field") : field.key
            FieldRow(label: "Field", value: field.value, shown: field.value, verbatimLabel: name, hidden: field.concealed,
                     revealed: Binding(get: { revealed.contains(field.id) }, set: {
                         if $0 { revealed.insert(field.id) } else { revealed.remove(field.id) }
                     }), copied: copied == field.id, copy: {
                Clipboard.copy(field.value)
                used()
                copied = field.id
                pill.show(String(localized: "\(name) copied"))
                copyReset?.cancel()
                copyReset = Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    if !Task.isCancelled { copied = nil }
                }
            }, link: SiteMatch.webAddress(field.value, requiresScheme: true), opened: used)
        }
        .modifier(HidesRevealedValues(signal: hideSignal) { revealed = [] })
        .onChange(of: fields) { revealed = [] }
        .onDisappear { copyReset?.cancel() }
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
        var symbol = "checkmark.circle.fill"
    }

    static let visibleFor: Duration = .seconds(2)

    private(set) var offer: Offer?
    /// Counts copies, for the haptic.
    private(set) var count = 0
    private var timer: Task<Void, Never>?

    func clear() {
        timer?.cancel()
        offer = nil
    }

    /// Shows `message` for about two seconds. VoiceOver hears it once, unless `announce` is false because it was already told.
    func show(_ message: String, symbol: String = "checkmark.circle.fill", announce: Bool = true) {
        timer?.cancel()
        let offer = Offer(message: message, symbol: symbol)
        self.offer = offer
        count += 1
        if announce { AccessibilityNotification.Announcement(message).post() }
        timer = Task { [weak self] in
            try? await Task.sleep(for: Self.visibleFor)
            guard !Task.isCancelled, let self, self.offer?.id == offer.id else { return }
            self.offer = nil
        }
    }
}

/// The pill itself: a checkmark (an orange triangle when something failed) and a short sentence on glass. Shared by every copy on an item page, so they all look and move alike.
struct CopiedPill: View {
    let message: String
    var symbol = "checkmark.circle.fill"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Label { Text(message) } icon: {
            Image(systemName: symbol).foregroundStyle(symbol == "exclamationmark.triangle.fill" ? Color.orange : Color.primary)
        }
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
    /// Room under the page's last row for the pill (its height plus its 24 pt gap and a little air), so the pill never covers text. It
    /// is always reserved, so the page does not jump when the pill appears.
    @ScaledMetric(relativeTo: .body) private var reserve: CGFloat = 80

    func body(content: Content) -> some View {
        content
            .contentMargins(.bottom, reserve, for: .scrollContent)
            // Inside the page's safe area: above the tab bar on iPhone, at the bottom centre of the detail on iPad and Mac.
            .overlay(alignment: .bottom) {
                if let offer = model.offer { CopiedPill(message: offer.message, symbol: offer.symbol) }
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
