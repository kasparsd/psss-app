// iPhone and iPad only: the Mac has no Safari fill grant. Compiled into the app targets; the hostless tests compile it too.
#if os(iOS) || HOSTLESS_TESTS
import Foundation
import Observation

/// A link of the iPhone and iPad Safari popup (`Extensions/SafariIOS/web/popup-logic.js`, `LINKS`). Any website or app can send
/// these, so only the exact forms are read, and nothing in one is ever shown.
enum SafariFillLink: Equatable {
    /// `psss://safari-fill`, with or without `?vault=<uuid>`: asks to share one vault's cards and addresses with Safari.
    case share(vault: UUID?)
    /// `psss://open`: only brings Psss forward.
    case open

    private static let sharePrefix = "//safari-fill?vault="

    /// Nil for anything else: another host or scheme, a path, a port, a user, a fragment, another or repeated query item, or an
    /// identifier that is not 36 characters of a UUID.
    static func parse(_ url: URL) -> SafariFillLink? {
        guard url.scheme?.lowercased() == "psss" else { return nil }
        let rest = String(url.absoluteString.dropFirst("psss:".count))
        if rest == "//open" { return .open }
        if rest == "//safari-fill" { return .share(vault: nil) }
        guard rest.hasPrefix(sharePrefix) else { return nil }
        let text = String(rest.dropFirst(sharePrefix.count))
        guard text.utf8.count == 36, let id = UUID(uuidString: text) else { return nil }
        return .share(vault: id)
    }
}

/// The app side of card and address fill in Safari: takes Safari's request, waits for the person, writes the grant and takes it
/// back (`docs/browser-extension.md`, "The app side"). It runs on the main actor, which is where vaults are locked, so nothing
/// can lock or change a vault between the last check and the write. It keeps nothing on disk and logs nothing.
///
/// A link never shares anything by itself. The vault it names is shared only after the person unlocks it while the request
/// stands, or, when it was open already, after a new Face ID (or passcode) check on `Screen.confirm`.
@MainActor @Observable
final class SafariFillCoordinator {
    /// The extension is not finished: until it is switched on (`docs/plans/ios-safari-fill.md`, slice 7) a Release build ignores
    /// the links and writes no grant. A Release build does not register the scheme either (`Configuration/iOS.xcconfig`).
    #if DEBUG
    nonisolated static let isReachable = true
    #else
    nonisolated static let isReachable = false
    #endif

    /// How long a request stands, from the link's arrival. Never shown to the person.
    static let requestMilliseconds: Int64 = 120_000

    /// What Psss shows over its window. `vault` is the name, made safe to display.
    enum Screen: Equatable {
        /// Frames 17a and 17b: the vault was open already.
        case confirm(vault: String)
        /// Frame 4b.
        case shared(vault: String)
        /// Frame 16a.
        case failed(vault: String)
    }

    /// What the coordinator asks of the app around it.
    struct Surroundings {
        /// Real vaults are in use: not onboarding and not the sample vault.
        var isSetUp: @MainActor () -> Bool
        var timing: @MainActor () -> LockTiming
        /// Psss is the app in front, so a system prompt can show.
        var isActive: @MainActor () -> Bool
        /// A sheet, an alert or an item being edited, which showing another vault would throw away.
        var isBusy: @MainActor () -> Bool
        /// Face ID, Touch ID or the device passcode, asked anew. Throws `Unlock.Failure`.
        var authenticate: @MainActor (_ reason: String) async throws -> Void
    }

    private enum Step { case waiting, confirming, shared, failed }

    /// The stored clock as a type of its own, for calls that take one.
    private struct Clock: SafariFillClock {
        let base: any SafariFillClock
        func wallMilliseconds() -> Int64 { base.wallMilliseconds() }
        func continuousMilliseconds() -> Int64 { base.continuousMilliseconds() }
    }

    private struct Request {
        let id = UUID()
        let vault: UUID
        let arrived: Int64
        var step: Step
    }

    private var request: Request?
    private(set) var isAuthenticating = false
    /// Why the last check could not run or did not pass, in words; nil after a cancel.
    private(set) var problem: String?
    /// The check that starts by itself for a new request. Tests wait for it.
    @ObservationIgnored private(set) var promptTask: Task<Void, Never>?
    @ObservationIgnored private var promptedRequest: UUID?
    /// The vault of the grant this process wrote and has not taken back.
    @ObservationIgnored private var grantedVault: UUID?
    /// Psss locked for being left ("Immediately") and nothing was taken back since: what Safari holds lasts only until the person
    /// comes back to Psss.
    @ObservationIgnored private var keptThroughLeaveLock = false
    /// The last revoke failed. Tried again when Psss comes to the front.
    @ObservationIgnored private(set) var owesRevoke = false

    @ObservationIgnored private let session: VaultSession
    @ObservationIgnored private let gate: UnlockGate
    @ObservationIgnored private let store: (any SafariFillStore)?
    @ObservationIgnored private let clock: any SafariFillClock
    @ObservationIgnored private let surroundings: Surroundings
    @ObservationIgnored private let reachable: Bool

    /// Takes the session's vault events. `store` is nil when the build has no Keychain group for the grant: sharing then fails.
    init(session: VaultSession, gate: UnlockGate, store: (any SafariFillStore)?, clock: any SafariFillClock = SystemSafariFillClock(),
         reachable: Bool = SafariFillCoordinator.isReachable, surroundings: Surroundings) {
        self.session = session
        self.gate = gate
        self.store = store
        self.clock = clock
        self.reachable = reachable
        self.surroundings = surroundings
        session.onVaultEvent = { [weak self] in self?.vaultEvent($0) }
    }

    var screen: Screen? {
        guard let request, let reference = session.knownVaults.first(where: { $0.id == request.vault }) else { return nil }
        let name = VaultName.short(reference.name)
        switch request.step {
        case .waiting: return nil
        case .confirming: return .confirm(vault: name)
        case .shared: return .shared(vault: name)
        case .failed: return .failed(vault: name)
        }
    }

    // MARK: Links

    /// Every link the app receives comes here; anything that is not one of the two Safari links changes nothing.
    func open(_ url: URL) {
        guard reachable, let link = SafariFillLink.parse(url) else { return }
        guard case .share(let named) = link else {
            // "Open Psss" to copy something: whatever was asked before is over, and nothing is shared.
            request = nil
            return
        }
        // The lock that is due on this return happens first, so an overdue vault never counts as already open.
        gate.decideOnReturn(after: surroundings.timing())
        guard surroundings.isSetUp(), let id = named ?? session.reference?.id, isListed(id) else { return }
        // A new request ends whatever Safari had.
        revoke()
        request = nil
        problem = nil
        if session.reference?.id != id {
            if !surroundings.isBusy() {
                session.show(id)
                guard session.reference?.id == id else { return }
            } else if !session.isOpen(id) {
                // Its unlock screen would replace the one on screen, with what the person has typed there. They can ask again.
                return
            }
        }
        request = Request(vault: id, arrived: clock.continuousMilliseconds(), step: gate.isUnlocked && session.isOpen(id) ? .confirming : .waiting)
        promptIfDue()
    }

    // MARK: What the app tells the coordinator

    /// Call when the gate, the open vaults or the shown vault changed. This is where an unlock that follows a request shares.
    func update() {
        guard let current = request, current.step != .shared else { return }
        guard surroundings.isSetUp(), isFresh(current), isListed(current.vault) else { request = nil; return }
        let open = gate.isUnlocked && session.isOpen(current.vault)
        switch current.step {
        case .waiting:
            if open {
                share()
            } else if gate.isUnlocked, let shown = session.reference?.id, shown != current.vault, session.isOpen(shown) {
                // The person went to another vault instead.
                request = nil
            }
        case .confirming, .failed:
            if !open { request = nil }
        case .shared:
            break
        }
    }

    /// Psss came to the front.
    func becameActive() {
        returned()
        update()
        promptIfDue()
    }

    /// The whole app went to the background. A screen over the window is finished with; a request that waits for an unlock stays
    /// until it runs out.
    func leftApp() {
        guard let current = request, current.step != .waiting else { return }
        request = nil
        problem = nil
    }

    private func vaultEvent(_ event: VaultSession.VaultEvent) {
        switch event {
        case .locked:
            // Going back to Safari must not take away what Safari was just given ("Immediately" locks on the way out). Coming back
            // to Psss does (`returned`).
            if gate.isLockingForLeave { keptThroughLeaveLock = true; return }
            request = nil
            revoke()
        case .removed:
            request = nil
            revoke()
        case .contentWillChange(let id):
            if grantedVault == nil || grantedVault == id { revoke() }
        }
    }

    // MARK: The person's choices

    /// "Use Face ID", also run by itself once for each request that needs it.
    func confirm() async {
        guard let asked = request, asked.step == .confirming, !isAuthenticating else { return }
        guard isFresh(asked) else { request = nil; return }
        promptedRequest = asked.id
        isAuthenticating = true
        problem = nil
        var failure: Unlock.Failure?
        do {
            try await surroundings.authenticate(String(localized: "Let Safari fill the cards and addresses of \(name(of: asked.vault))."))
        } catch let error as Unlock.Failure {
            failure = error
        } catch {
            failure = .failed(error.localizedDescription)
        }
        isAuthenticating = false
        // A check answers only the request it was asked for. A newer one gets its own.
        guard let current = request, current.id == asked.id else { promptIfDue(); return }
        if let failure {
            if failure != .cancelled { problem = failure.message }
            return
        }
        share()
    }

    /// "Try Again" on the failure screen.
    func retry() {
        guard request?.step == .failed else { return }
        share()
    }

    /// "Done" and "Cancel": back to the vault. A grant already written stays.
    func dismiss() {
        request = nil
        problem = nil
    }

    // MARK: Taking back

    /// Takes back whatever grant there is. Also run at launch, when the device locks and when the copy of the vault list could
    /// not be written.
    func revoke() {
        grantedVault = nil
        keptThroughLeaveLock = false
        // "Go back to Safari" would no longer be true.
        if request?.step == .shared { request = nil }
        do {
            try store?.revoke()
            owesRevoke = false
        } catch {
            owesRevoke = true
        }
    }

    /// Psss is coming back to the front, or has, also before anything is unlocked. A locked Psss takes the grant back, also the one
    /// it kept for Safari when it locked on leaving; an unlocked one deletes a grant that may no longer be used. A delete still
    /// owed is tried again.
    func returned() {
        if owesRevoke || keptThroughLeaveLock || !gate.isUnlocked { revoke() } else { dropUnusable() }
    }

    /// The system does not expire a Keychain item, so one past its time is deleted here.
    private func dropUnusable() {
        guard let store else { return }
        do {
            guard try store.inTime(clock: Clock(base: clock)) == nil else { return }
            grantedVault = nil
            if request?.step == .shared { request = nil }
        } catch {
            revoke()
        }
    }

    // MARK: Giving

    /// Writes the grant for the request's vault. The caller has seen the unlock or the check that allows it. Everything here runs
    /// in one step on the main actor.
    private func share() {
        guard reachable, let asked = request else { return }
        guard surroundings.isSetUp(), isFresh(asked), gate.isUnlocked, isListed(asked.vault), let vault = session.store(for: asked.vault) else {
            request = nil
            return
        }
        // Without a current copy of the vault list the extension would judge the grant by an old one.
        guard let store, VaultReference.mirrorForSafari() else { return fail() }
        do {
            let grant = try SafariFillSnapshot.make(vaultID: asked.vault, vaultName: vault.reference.name, items: vault.items(),
                                                    clock: Clock(base: clock)).grant
            // Immediately before writing: still asked for, still unlocked, still listed and the very vault the snapshot is of.
            guard request?.id == asked.id, isFresh(asked), gate.isUnlocked, isListed(asked.vault), session.store(for: asked.vault) === vault else {
                request = nil
                revoke()
                return
            }
            try store.write(grant)
            grantedVault = asked.vault
            request?.step = .shared
            problem = nil
        } catch {
            fail()
        }
    }

    private func fail() {
        revoke()
        request?.step = .failed
    }

    private func promptIfDue() {
        guard let current = request, current.step == .confirming, !isAuthenticating, promptedRequest != current.id,
              surroundings.isActive() else { return }
        promptedRequest = current.id
        promptTask = Task { [weak self] in await self?.confirm() }
    }

    private func isFresh(_ request: Request) -> Bool {
        let age = clock.continuousMilliseconds() - request.arrived
        return age >= 0 && age < Self.requestMilliseconds
    }

    /// In this session's list and in the stored one, so a forgotten vault never counts.
    private func isListed(_ id: UUID) -> Bool {
        session.knownVaults.contains { $0.id == id } && VaultReference.all.contains { $0.id == id }
    }

    private func name(of id: UUID) -> String {
        VaultName.short(session.knownVaults.first { $0.id == id }?.name ?? "")
    }
}
#endif
