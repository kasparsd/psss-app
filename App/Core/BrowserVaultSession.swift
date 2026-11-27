import Foundation

/// The browser popup's view of a stored vault reference: the file's condition and whether quick unlock is ready, from facts the
/// app and its extensions already keep (`VaultReference`). `open` is only ever true for the app's own session.
enum BrowserVaultFacts {
    /// What is wrong with the vault file, if anything: not found (moved, deleted, a stale bookmark), not downloaded yet (iCloud), or
    /// not a vault (it does not start with the KDBX signature). Nil when the file looks fine. Reads at most four bytes, and any
    /// other trouble reading counts as fine: this must never call a usable vault unavailable.
    static func fileProblem(of reference: VaultReference) -> BrowserVaultState? {
        let url: URL
        var scoped: URL?
        defer { scoped?.stopAccessingSecurityScopedResource() }
        if reference.managed {
            url = VaultFiles.managedURL(fileName: reference.fileName)
        } else {
            guard let bookmark = reference.bookmark, let resolved = try? VaultFiles.resolve(bookmark) else { return .notFound }
            url = resolved.url
            if url.startAccessingSecurityScopedResource() { scoped = url }
        }
        let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
        if values?.isUbiquitousItem == true, let status = values?.ubiquitousItemDownloadingStatus, status != .current, status != .downloaded {
            return .notDownloaded
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            // An iCloud file that is not downloaded is a hidden ".name.icloud" placeholder beside where the file would be.
            let placeholder = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
            return FileManager.default.fileExists(atPath: placeholder.path) ? .notDownloaded : .notFound
        }
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let head = try? handle.read(upToCount: 4) else { return nil }
        // KDBX signature 1 is 0x9AA2D903, stored little-endian.
        return head == Data([0x03, 0xD9, 0xA2, 0x9A]) ? nil : .unreadable
    }

    /// The state and, for a vault that needs its password, why. `open`: the app holds this vault unlocked. `lockedOut`: Touch ID is
    /// locked out right now (only the app can know).
    static func state(of reference: VaultReference, open: Bool, lockedOut: Bool = false) -> (state: BrowserVaultState, reason: BrowserPasswordReason?) {
        if let problem = fileProblem(of: reference) { return (problem, nil) }
        if open { return (.open, nil) }
        if reference.biometricStale { return (.needsPassword, .changed) }
        if !reference.biometricUnlock { return (.needsPassword, .off) }
        if lockedOut { return (.needsPassword, .lockedOut) }
        return (.locked, nil)
    }

    /// Where the vault is kept, in the words the app's menu uses. A file that cannot be found has no location to show.
    static func location(of reference: VaultReference, state: BrowserVaultState) -> String {
        state == .notFound ? DisplayText.safe(reference.fileName) : reference.menuLocation
    }

    static func vault(_ reference: VaultReference, active: Bool, open: Bool, lockedOut: Bool = false) -> BrowserVault {
        let facts = state(of: reference, open: open, lockedOut: lockedOut)
        return BrowserVault(id: reference.id.uuidString, name: reference.name, location: location(of: reference, state: facts.state),
                            active: active, state: facts.state, reason: facts.reason)
    }
}

/// The vault list as the Safari app extension can give it: read from the App Group (the same references the app and the
/// AutoFill extension read), every vault locked, because this process never holds a key and cannot ask the running app to
/// open one. A switch is `unsupported`: writing the stored reference from here would leave the running app's `VaultSession` on
/// another vault than the file says, and its own settings changes would then be dropped (`VaultReference.update` refuses a
/// stored reference of another vault). Unlock answers `needs-app` ("Open Psss to unlock Work."), or `came-forward` when `launchApp`
/// started the app. The Safari extension uses this only as the fallback when the app is not running; while it runs, every request
/// goes to the app over the relay (docs/browser-extension.md, "Safari on Mac").
struct StoredVaultService: BrowserVaultService {
    /// Starts the app, for an unlock when it is not running. True when it was started. Nothing by default.
    var launchApp: @Sendable () -> Bool = { false }


    func vaults() -> [BrowserVault] {
        let active = VaultReference.load()
        return VaultReference.all.map { vault in
            BrowserVaultFacts.vault(vault, active: vault.id == active?.id, open: false)
        }
    }

    func switchVault(id: String) -> BrowserVaultOutcome { .unsupported }

    func unlockVault(id: String) -> BrowserUnlockOutcome {
        guard let vault = vaults().first(where: { $0.id == id }) else { return .notFound }
        guard vault.active else { return .notCurrent }
        guard vault.state.isAvailable else { return .notAvailable }
        return launchApp() ? .cameForward : .needsApp
    }
}

/// The app's half of a request from the browser popup: what the relay calls inside the running app, where the `VaultSession`
/// lives. It does what the app's own switcher does (`VaultSession.show`: no vault is locked or unlocked by it), and it unlocks
/// through the app's own flows, passed in as closures so this stays free of any screen: one shown vault and one unlock flow for
/// the whole app. Several vaults can be open: `vaults` lists each one's own state, and `items` and `save` work on any open vault by
/// its id, never on "the shown one" (a request names the vault it means, so a popup that is out of date cannot read another).
@MainActor
enum BrowserVaultSwitch {
    /// The vaults as the popup lists them: the same rows, order and states as `VaultMenuItems`. `lockedOut` says Touch ID is locked
    /// out right now (the current vault's `needs-password` reason).
    static func vaults(_ session: VaultSession, lockedOut: Bool = false) -> [BrowserVault] {
        session.knownVaults.map { vault in
            let active = vault.id == session.reference?.id
            return BrowserVaultFacts.vault(vault, active: active, open: session.isOpen(vault.id), lockedOut: active && lockedOut)
        }
    }

    /// Makes `id` the shown vault. No vault is locked (several can be open) and none is unlocked (`unlockVault` does that).
    /// Choosing the shown vault changes nothing.
    static func switchVault(id: String, session: VaultSession) -> BrowserVaultOutcome {
        guard let target = UUID(uuidString: id), session.knownVaults.contains(where: { $0.id == target }) else { return .notFound }
        session.show(target)
        return .switched
    }

    /// Unlocks the current vault. Quick unlock ready: `touchID` runs the app's own prompt and says how it ended. Needs its
    /// password: `bringForward` asks the app to come forward on that vault's lock screen and says whether it could. A vault that is
    /// not the current one, or whose file is not available, is refused.
    static func unlockVault(id: String, session: VaultSession, lockedOut: Bool = false,
                            touchID: () async -> BrowserUnlockOutcome, bringForward: () -> Bool) async -> BrowserUnlockOutcome {
        guard let target = UUID(uuidString: id), session.knownVaults.contains(where: { $0.id == target }) else { return .notFound }
        guard target == session.reference?.id else { return .notCurrent }
        guard let current = vaults(session, lockedOut: lockedOut).first(where: \.active) else { return .notFound }
        switch current.state {
        case .open: return .unlocked
        case .notDownloaded, .notFound, .unreadable: return .notAvailable
        case .needsPassword: return bringForward() ? .cameForward : .needsApp
        case .locked: return await touchID()
        }
    }

    /// The items of vault `id` while it is open in this session; nil when it is not open (locked, unknown or not an id). Reads the
    /// vault the id names, whichever is shown.
    static func items(vault id: String, session: VaultSession) -> [VaultItem]? {
        guard let target = UUID(uuidString: id), let store = session.store(for: target) else { return nil }
        return store.items()
    }

    /// Saves `item` into vault `id` while it is open. False: the vault is not open or the file could not be written, and nothing
    /// was saved.
    static func save(_ item: VaultItem, vault id: String, session: VaultSession) -> Bool {
        guard let target = UUID(uuidString: id), let store = session.store(for: target), (try? store.save([item])) != nil else { return false }
        // The vault may not be the shown one, so its window never notices: its new login is offered by AutoFill from here.
        VaultIdentities.register(vault: target, items: store.items())
        return true
    }
}

/// The relay's view of the running app: the protocol's `BrowserVaultService` over the app's `VaultSession`. Its calls must be made
/// on the main actor (the relay hops there before it calls `BrowserProtocol.handle`). Unlock is the app's own flow, passed in: the
/// service never decides it. Without one, a locked vault answers `needs-app`.
final class SessionVaultService: BrowserVaultService, @unchecked Sendable {
    private let session: VaultSession
    private let unlock: @MainActor (String) -> BrowserUnlockOutcome
    private let lockedOut: @MainActor () -> Bool

    @MainActor init(session: VaultSession, lockedOut: @escaping @MainActor () -> Bool = { false },
                    unlock: @escaping @MainActor (String) -> BrowserUnlockOutcome = { _ in .needsApp }) {
        self.session = session
        self.lockedOut = lockedOut
        self.unlock = unlock
        // What was offered to the popup is forgotten the moment any vault locks (docs/plans/browser-relay.md, section 3).
        session.onVaultClosed = { _ in BrowserProtocol.ledger.clear() }
    }

    func vaults() -> [BrowserVault] { MainActor.assumeIsolated { BrowserVaultSwitch.vaults(session, lockedOut: lockedOut()) } }

    func switchVault(id: String) -> BrowserVaultOutcome { MainActor.assumeIsolated { BrowserVaultSwitch.switchVault(id: id, session: session) } }

    func unlockVault(id: String) -> BrowserUnlockOutcome {
        MainActor.assumeIsolated {
            guard let target = UUID(uuidString: id), session.knownVaults.contains(where: { $0.id == target }) else { return .notFound }
            guard target == session.reference?.id else { return .notCurrent }
            return unlock(id)
        }
    }

    var servesCredentials: Bool { true }

    func items(vault id: String) -> [VaultItem]? { MainActor.assumeIsolated { BrowserVaultSwitch.items(vault: id, session: session) } }

    func save(_ item: VaultItem, vault id: String) -> Bool { MainActor.assumeIsolated { BrowserVaultSwitch.save(item, vault: id, session: session) } }

    /// A real vault's login has a stable identifier of its own.
    func reference(for item: VaultItem) -> String { item.id.uuidString }
}
