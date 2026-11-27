import AuthenticationServices
import Foundation

/// What Apple Passwords has handed over and not yet been imported, one for the whole app. The hand-over is read at once, since its
/// token works only once, and is held in memory until the person closes the import sheet or `lifetime` passes without a sheet.
/// It survives a lock: Psss is in the background while the person is in Passwords, so it often locks before they see it.
@MainActor
@Observable
final class AppleImportRequests {
    static let lifetime: TimeInterval = 600

    enum Arrival {
        case plan(ImportPlan)
        case failed(String)
    }

    private(set) var pending: Arrival?
    /// Counts the arrivals, so a screen notices a second one.
    private(set) var arrivals = 0
    /// Counts the imports that wrote a vault, so the open vault window reads it again.
    private(set) var imported = 0
    /// The person chose Import from Apple Passwords somewhere, and the sheet is to open.
    private(set) var requested = false
    /// Import sheets on screen. While one is, it shows what arrives and no second one is opened.
    var openSheets = 0
    @ObservationIgnored private var expiry: Task<Void, Never>?

    static let failedMessage = String(localized: "Psss did not receive the items. Start the export again in Passwords.")

    func receive(_ activity: NSUserActivity) {
        guard let token = activity.userInfo?[ASCredentialImportToken] as? UUID else { arrive(.failed(Self.failedMessage)); return }
        Task {
            do {
                let data = try await ASCredentialImportManager().importCredentials(token: token)
                arrive(.plan(try AppleCredentialExchange.plan(from: data)))
            } catch ImportError.empty {
                arrive(.failed(String(localized: "Apple Passwords sent no items.")))
            } catch ImportError.tooLarge {
                arrive(.failed(String(localized: "There are too many items to import safely at once. Export fewer items from Passwords.")))
            } catch {
                arrive(.failed(Self.failedMessage))
            }
        }
    }

    private func arrive(_ arrival: Arrival) {
        pending = arrival
        arrivals += 1
        expiry?.cancel()
        expiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.lifetime))
            guard !Task.isCancelled, let self, openSheets == 0 else { return }
            pending = nil
        }
    }

    func start() { requested = true }

    /// What arrived has been imported, or was a problem the person has read.
    func clear() {
        expiry?.cancel()
        pending = nil
    }

    /// The sheet was closed by the person: nothing waits any more.
    func close() {
        requested = false
        clear()
    }

    /// The app locked and took the sheet away. What arrived waits for the next unlock.
    func putAside() { requested = false }

    func didImport() { imported += 1 }
}
