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
        state == .notFound ? reference.fileName : reference.menuLocation
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
/// stored reference of another vault). Unlock answers `needs-app` ("Open Psss to unlock Work."). Replaced by the app relay
/// (docs/browser-extension.md).
struct StoredVaultService: BrowserVaultService {
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
        return vault.state.isAvailable ? .needsApp : .notAvailable
    }
}

/// The app's half of a request from the browser popup: what the relay calls inside the running app, where the `VaultSession`
/// lives. It does what the app's own switcher does (`VaultSession.show`: no vault is locked or unlocked by it), and it unlocks
/// through the app's own flows, passed in as closures so this stays free of any screen: one shown vault and one unlock flow for
/// the whole app. Slice M2 (several open vaults for the popup) will let `vaults` and the fill requests read every open vault.
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

    /// Makes `id` the current vault. No vault is locked (several can be open) and none is unlocked (`unlockVault` does that).
    /// Choosing the current vault changes nothing.
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
}
