#if os(iOS)
import SwiftUI

/// Ends the iPhone search tab's field and reports when UIKit has finished doing it, so the tabs can then be replaced (see
/// `VaultView.changeLayout`). UIKit on iOS 27.2 throws if the search tab is removed while its field is up, and SwiftUI reports the
/// end of a search when it starts, not when it is over. So the search controller itself is asked to end, and its transition
/// coordinator says when that is done.
@MainActor
final class SearchFieldEnding {
    /// A controller inside the search tab's navigation stack, see `SearchFieldReader`.
    fileprivate weak var reader: UIViewController?

    private var controller: UISearchController? {
        sequence(first: reader, next: { $0?.parent }).lazy.compactMap { $0?.navigationItem.searchController }.first
    }

    /// The field is up, or on its way out.
    var isUp: Bool { controller.map { $0.isActive || $0.isBeingDismissed } ?? false }

    /// A transition is being waited for; its completion carries on, so there is only ever one such wait.
    private var isWaiting = false

    /// Ends the search and calls `done` once the field is gone, and only then.
    ///
    /// A transition that is running is left to finish before the field is touched: told to end while it is still appearing, UIKit
    /// can queue the dismissal with no transition to wait for. `ending` runs when the field has been told to end, so the caller
    /// can say the same to SwiftUI. Does nothing while an earlier call is still waiting. `done` is not called if UIKit reports
    /// the field up with nothing to wait for; calling again later is safe.
    func end(ending: @escaping @MainActor () -> Void, then done: @escaping @MainActor () -> Void) {
        guard !isWaiting else { return }
        guard let controller else { return done() }
        let carryOn: @MainActor () -> Void = { [self] in
            isWaiting = false
            end(ending: ending, then: done)
        }
        isWaiting = Self.afterTransition(of: controller, carryOn)
        if isWaiting { return }
        if controller.isActive {
            controller.isActive = false
            ending()
            isWaiting = Self.afterTransition(of: controller, carryOn)
            if isWaiting { return }
        }
        if !isUp { done() }
    }

    /// Runs `step` when the transition `controller` is in completes. False, and `step` never runs, when there is none to wait for.
    private static func afterTransition(of controller: UIViewController, _ step: @escaping @MainActor () -> Void) -> Bool {
        controller.transitionCoordinator?.animate(alongsideTransition: nil, completion: { _ in step() }) ?? false
    }
}

/// Invisible. Put on the search tab's content so `SearchFieldEnding` can find that stack's search controller.
struct SearchFieldReader: UIViewControllerRepresentable {
    let ending: SearchFieldEnding

    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        controller.view.isUserInteractionEnabled = false
        ending.reader = controller
        return controller
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {
        ending.reader = controller
    }
}
#endif
