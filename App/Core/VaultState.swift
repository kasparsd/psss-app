import Foundation

// The person-facing state of one vault (plan `docs/plans/vault-switcher-and-extension-style.md`, section 1; mock `#/vault-states`).
// Every vault menu, row and notice draws from this one type, so the words and the glyphs are the same in the app, on the lock
// screen, in AutoFill and in the browser popup. The type is pure: facts in, words and symbol names out, so tests cover it
// without a screen.

/// What the vault's file is, as far as Psss can tell without opening it.
enum VaultFileCondition: Equatable, Sendable {
    case available
    /// In iCloud Drive and not on this device yet.
    case notDownloaded
    /// Moved, deleted or the bookmark no longer resolves.
    case notFound
    /// Found, but the last attempt to open it said the file is damaged, not a vault, or from a newer format.
    case unreadable
}

/// The saved key behind Face ID, Touch ID or the passcode.
enum QuickUnlock: Equatable, Sendable {
    /// Saved and usable.
    case ready
    /// The person turned it off (or never turned it on).
    case off
    /// The key no longer opens the vault or was lost (biometry changed, vault changed elsewhere, reinstall).
    case lost
    /// Saved, but the system cannot ask right now (lockout, no passcode).
    case unavailableNow
}

/// Why a locked vault asks for its password rather than for Face ID or Touch ID.
enum PasswordReason: Equatable, Sendable {
    case off, lost, unavailableNow
}

/// The five states the person sees, plus the three ways a vault can be not available.
enum VaultState: Equatable, Sendable {
    /// Unlocked. Only the current vault, only in the process that opened it.
    case open
    /// Locked, and Face ID, Touch ID or the passcode opens it.
    case locked
    /// Locked, and only the vault password opens it.
    case needsPassword(PasswordReason)
    case notDownloaded
    case notFound
    case unreadable

    /// The facts the state is made from. `isCurrent` and `isUnlocked` describe the one vault the device has open; any other
    /// vault is locked by definition.
    init(file: VaultFileCondition, quickUnlock: QuickUnlock, isCurrent: Bool, isUnlocked: Bool) {
        if isCurrent && isUnlocked { self = .open; return }
        switch file {
        case .notDownloaded: self = .notDownloaded
        case .notFound: self = .notFound
        case .unreadable: self = .unreadable
        case .available:
            switch quickUnlock {
            case .ready: self = .locked
            case .off: self = .needsPassword(.off)
            case .lost: self = .needsPassword(.lost)
            case .unavailableNow: self = .needsPassword(.unavailableNow)
            }
        }
    }

    /// Not available: the file cannot be opened at all, and the way out is in Psss (Download, Locate…, details).
    var isAvailable: Bool {
        switch self {
        case .notDownloaded, .notFound, .unreadable: false
        default: true
        }
    }

    /// Locked, so an Unlock button makes sense (AutoFill and the browser popup).
    var isLocked: Bool {
        switch self {
        case .locked, .needsPassword: true
        default: false
        }
    }

    /// The words that replace the location line; nil for Open and Locked, which show where the file is kept.
    var subtitle: String? {
        switch self {
        case .open, .locked: nil
        case .needsPassword: String(localized: "Needs vault password")
        case .notDownloaded: String(localized: "Not downloaded yet")
        case .notFound: String(localized: "Not found")
        case .unreadable: String(localized: "Can’t be read")
        }
    }

    /// The second line of the vault's row: the state's words when it has some, otherwise where the file is kept.
    func subtitle(location: String) -> String { subtitle ?? location }

    /// The glyph at the row's trailing end: open padlock, closed padlock or the warning triangle.
    var symbol: String {
        switch self {
        case .open: "lock.open"
        case .locked, .needsPassword: "lock"
        case .notDownloaded, .notFound, .unreadable: "exclamationmark.triangle"
        }
    }

    /// What the glyph says to VoiceOver.
    var spoken: String {
        switch self {
        case .open: String(localized: "Unlocked")
        case .locked: String(localized: "Locked")
        case .needsPassword: String(localized: "Locked, needs vault password")
        case .notDownloaded: String(localized: "Not available, not downloaded yet")
        case .notFound: String(localized: "Not available, not found")
        case .unreadable: String(localized: "Not available, can’t be read")
        }
    }

    /// The reason a locked vault asks for its password, in a few words, for the notice under the Vault row (plan, Lead decisions).
    /// `name` is shown as given, so pass `VaultName.sentence(_:)`; `method` is "Face ID", "Touch ID" or similar. Nil for any
    /// other state.
    func passwordNotice(name: String, method: String) -> String? {
        guard case .needsPassword(let reason) = self else { return nil }
        switch reason {
        case .off: return String(localized: "\(method) is off for \(name).")
        case .lost: return String(localized: "\(method) changed since \(name) was set up.")
        case .unavailableNow: return String(localized: "\(method) is locked out right now.")
        }
    }
}

/// A vault's name made safe for a menu, a row or a sentence. The name is the person's own text and a vault may have come from
/// elsewhere, so newlines, bidirectional controls and invisible characters are removed and a long name is cut in the middle,
/// where the end (`Work 2026`, `.kdbx`) still reads.
enum VaultName {
    static let maxLength = 40

    /// One safe line, at most `maxLength` characters, cut in the middle with an ellipsis. `Vault` when nothing is left.
    static func short(_ name: String) -> String {
        let characters = Array(DisplayText.safe(name, empty: String(localized: "Vault")))
        guard characters.count > maxLength else { return String(characters) }
        let head = maxLength / 2, tail = maxLength - 1 - head
        return String(characters.prefix(head)).trimmingCharacters(in: .whitespaces) + "…"
            + String(characters.suffix(tail)).trimmingCharacters(in: .whitespaces)
    }

    /// What the new-vault sheet starts with: "Passwords" while no known vault has that name, otherwise nothing, so the person
    /// chooses a name that tells the vaults apart (the field's placeholder stays).
    static func suggested(among existing: [String]) -> String {
        let proposal = String(localized: "Passwords")
        let taken = existing.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(proposal) == .orderedSame }
        return taken ? "" : proposal
    }

    /// The name inside a sentence of fixed words: short, and without quotes that could close the sentence's own.
    static func sentence(_ name: String) -> String { short(name) }
}

// MARK: From the vault session

extension VaultReference {
    /// The state of the file now: found, in iCloud and not downloaded, or gone. Reads the file system, so call it when a menu
    /// opens or a screen appears, not in a tight loop. `unreadable` is what the session learned when opening it failed.
    func fileCondition(knownUnreadable: Bool = false) -> VaultFileCondition {
        if managed {
            return FileManager.default.fileExists(atPath: VaultFiles.managedURL(fileName: fileName).path) ? (knownUnreadable ? .unreadable : .available) : .notFound
        }
        guard let bookmark, let resolved = try? VaultFiles.resolve(bookmark) else { return .notFound }
        let url = resolved.url
        let keys: Set<URLResourceKey> = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
        if let values = try? url.resourceValues(forKeys: keys), values.isUbiquitousItem == true,
           let status = values.ubiquitousItemDownloadingStatus, status == .notDownloaded {
            return .notDownloaded
        }
        guard FileManager.default.fileExists(atPath: url.path) else { return .notFound }
        return knownUnreadable ? .unreadable : .available
    }

    /// The saved key's state from the reference's flags. `usable` is false when the system says it cannot ask now (lockout,
    /// no passcode); callers that do not know pass the default.
    func quickUnlock(usable: Bool = true) -> QuickUnlock {
        if biometricStale { return .lost }
        if !biometricUnlock { return .off }
        return usable ? .ready : .unavailableNow
    }
}

extension VaultSession {
    /// The person-facing state of `vault`. `unlocked` is whether the app or extension holds the current vault open.
    func state(of vault: VaultReference, unlocked: Bool, quickUnlockUsable: Bool = true) -> VaultState {
        VaultState(file: vault.fileCondition(knownUnreadable: unreadable.contains(vault.id)),
                   quickUnlock: vault.quickUnlock(usable: quickUnlockUsable),
                   isCurrent: vault.id == reference?.id, isUnlocked: unlocked)
    }
}
