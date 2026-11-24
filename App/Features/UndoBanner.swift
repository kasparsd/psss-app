import SwiftUI

/// The state behind the Undo capsule: what it says, what Undo does, and its ten seconds. It lives with the vault screen, not with a
/// view, so the capsule goes away on time even when the view it was drawn in is no longer on screen.
@MainActor
@Observable
final class UndoBannerModel {
    struct Offer: Identifiable, Equatable {
        let id = UUID()
        let message: String
    }

    /// How long the capsule stays, as the experience document says for the save prompt.
    static let visibleFor: Duration = .seconds(10)

    private(set) var offer: Offer?
    private var undoAction: (() -> Void)?
    private var timer: Task<Void, Never>?

    /// Shows the capsule with `message` and an Undo that runs `undo`. A newer offer replaces the one on screen. VoiceOver hears the
    /// message once, when it appears.
    func show(message: String, undo: @escaping () -> Void) {
        timer?.cancel()
        let offer = Offer(message: message)
        self.offer = offer
        undoAction = undo
        AccessibilityNotification.Announcement(message).post()
        timer = Task { [weak self] in
            try? await Task.sleep(for: Self.visibleFor)
            guard !Task.isCancelled, let self, self.offer?.id == offer.id else { return }
            dismiss()
        }
    }

    /// Takes the capsule away and runs its Undo.
    func undo() {
        let action = undoAction
        dismiss()
        action?()
    }

    func dismiss() {
        timer?.cancel()
        timer = nil
        offer = nil
        undoAction = nil
    }
}

/// A glass capsule with the sentence and a labeled Undo, like the "Copied" toast but with a button. iOS has no standard toast, so
/// this is a recorded departure (docs/experience.md). VoiceOver reads it as one element with the sentence and offers Undo as an
/// action; it is not focused, so dismissing it takes nothing away from where the person is.
struct UndoBanner: View {
    let model: UndoBannerModel

    var body: some View {
        if let offer = model.offer {
            HStack(spacing: 8) {
                Text(offer.message)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(offer.message)
                Button("Undo") { model.undo() }
                    .accessibilityLabel("Undo")
                    .buttonStyle(.borderless)
                    .fontWeight(.semibold)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .padding(.leading, 18)
            .padding(.trailing, 10)
            .padding(.vertical, 2)
            .glassEffect(.regular, in: .capsule)
            .frame(maxWidth: 520)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            // Two real elements: the sentence, and an Undo button VoiceOver and Voice Control can find and press.
            .accessibilityElement(children: .contain)
        }
    }
}

extension View {
    /// Puts the Undo capsule under this view, while `model` has an offer. The capsule takes its own band and the view above it gets
    /// shorter, so the capsule never covers a row: the last rows end above it, and the row that was under it is no longer there.
    /// A `safeAreaInset` on the list would only reserve space at the end of the scroll and leave a row in view underneath. The band
    /// sits in the safe area, so on iPhone it rises above the tab bar and follows it when the bar shrinks.
    func undoBanner(_ model: UndoBannerModel) -> some View {
        VStack(spacing: 0) {
            self
            UndoBanner(model: model)
                .padding(.horizontal, 16)
                .padding(.vertical, model.offer == nil ? 0 : 8)
                .frame(maxWidth: .infinity)
        }
        .animation(.snappy, value: model.offer)
    }
}

/// Puts the same Undo in the window's undo stack, so Mac and iPad (with a hardware keyboard) have Edit, Undo Move to Recently Deleted and
/// Command-Z. One level, like the capsule: a newer delete replaces an older one. The entry is dropped when the capsule's own Undo
/// runs and when the vault locks, so Command-Z never reaches a store that is no longer open.
@MainActor
final class UndoToken {
    private var actions: [Int: () -> Void] = [:]
    private var last = 0

    func register(in manager: UndoManager?, name: String, undo: @escaping () -> Void) {
        guard let manager else { return }
        clear(in: manager)
        last += 1
        let id = last
        actions[id] = undo
        manager.registerUndo(withTarget: self) { token in MainActor.assumeIsolated { token.run(id) } }
        manager.setActionName(name)
    }

    func clear(in manager: UndoManager?) {
        manager?.removeAllActions(withTarget: self)
        actions = [:]
    }

    private func run(_ id: Int) { actions.removeValue(forKey: id)?() }
}
