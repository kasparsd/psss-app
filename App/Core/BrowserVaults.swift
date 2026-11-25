import Foundation

/// What the browser popup may know about one vault's condition (protocol v3, `vaults`). The same five person-facing states as the
/// app's vault menu and the AutoFill picker (docs/vaults.md): open; locked with quick unlock ready; locked and needing the vault
/// password; and the three ways a vault is not available. "Changed elsewhere" is not a state here: the app locks with a notice.
enum BrowserVaultState: String, Sendable {
    case open
    /// Closed padlock, and quick unlock (Touch ID) is ready: Unlock asks for it.
    case locked
    /// Closed padlock, and quick unlock is off, lost or unavailable now: the vault password is needed, so only the app can unlock.
    case needsPassword = "needs-password"
    case notDownloaded = "not-downloaded"
    case notFound = "not-found"
    case unreadable

    /// Whether the vault file can be used at all. Not available is never solved in the popup.
    var isAvailable: Bool {
        switch self { case .notDownloaded, .notFound, .unreadable: false; default: true }
    }
}

/// Why a vault needs its password (the notice says it in a few words).
enum BrowserPasswordReason: String, Sendable {
    /// Quick unlock is switched off for this vault.
    case off
    /// The saved key no longer opens it (Touch ID enrolment changed, a reinstall).
    case changed
    /// Touch ID is locked out right now.
    case lockedOut = "locked-out"
}

/// A vault as the browser popup lists it (protocol v3, `vaults`): the same facts as the app's menu.
struct BrowserVault: Equatable, Sendable {
    /// Stable identifier (a `VaultReference.id`, or a fixed name in the prototype). The protocol caps it at 64 characters.
    var id: String
    /// What the person named it. Shown as one safe line (see `DisplayText`): the popup never sees bidirectional controls,
    /// newlines or an unbounded name.
    var name: String
    /// Where the vault is kept, in the words the app's menu uses ("iCloud Drive", "On this device", a folder).
    var location: String
    /// Whether this vault is the app's current one (one per device).
    var active: Bool
    var state: BrowserVaultState
    /// Only with `.needsPassword`.
    var reason: BrowserPasswordReason?

    var isOpen: Bool { state == .open }

    var json: [String: Any] {
        var object: [String: Any] = ["id": id, "name": DisplayText.safe(name, empty: "Vault"), "location": DisplayText.safe(location),
                                     "active": active, "state": state.rawValue]
        if state == .needsPassword { object["reason"] = (reason ?? .off).rawValue }
        return object
    }
}

/// What a request to make a vault the current one came to.
enum BrowserVaultOutcome: Equatable, Sendable {
    /// The vault is now the app's current one (the open vault locked). It stays locked until `unlock-vault`.
    case switched
    case notFound
    /// This process cannot switch vaults (the Safari app extension today: it never holds a key and cannot reach the app).
    case unsupported
}

/// What a request to unlock the current vault came to.
enum BrowserUnlockOutcome: Equatable, Sendable {
    /// The vault is open now.
    case unlocked
    /// The vault needs its password and the app was asked to come forward on that vault's lock screen. Still locked.
    case cameForward
    /// The vault needs its password and this process cannot bring the app forward ("Open Psss to unlock Work.").
    case needsApp
    /// Touch ID was cancelled.
    case cancelled
    /// Touch ID did not work.
    case failed
    /// The vault file is not downloaded, not found or cannot be read.
    case notAvailable
    case notFound
    /// The vault exists but is not the current one: unlock only ever applies to the current vault.
    case notCurrent
    case unsupported
}

/// What the protocol needs from whoever holds the vaults. The native host relays to the app, which owns the `VaultSession`
/// (`BrowserVaultSwitch`, in the app). The calls are synchronous because the host waits for the reply either way.
protocol BrowserVaultService {
    func vaults() -> [BrowserVault]
    func switchVault(id: String) -> BrowserVaultOutcome
    func unlockVault(id: String) -> BrowserUnlockOutcome
}

/// The prototype host's vaults, kept next to the prototype file (`vaults.json`) so a switch survives the per-message host
/// process. Nothing here is a real vault; the file also lets the end-to-end tests put every state on screen (`vaults` replaces the
/// default list; see `Spec`).
///
/// By default there are seven: "Passwords" and "Work" open with Touch ID; "Archive" asks for Touch ID, which is cancelled; "Family"
/// needs its password (the prototype has no app to bring forward); "Travel" is not downloaded, "Taxes" cannot be read and "Old" is
/// not found.
struct PrototypeVaultService: BrowserVaultService {
    struct Spec: Equatable {
        var id: String
        var name: String
        var location: String
        /// A file state that makes the vault not available. Nil: the file is fine.
        var file: BrowserVaultState?
        /// Why quick unlock is not ready. Nil: Touch ID is ready.
        var quickUnlockOff: BrowserPasswordReason?
        /// What Touch ID does when asked: nil opens the vault; "cancelled" or "failed".
        var touchID: String?
        /// A vault that needs its password: whether the "app" comes forward (the real relay does; the prototype does not unless asked).
        var appComesForward = false
    }

    static let defaults: [Spec] = [
        Spec(id: "passwords", name: "Passwords", location: "iCloud Drive"),
        Spec(id: "work", name: "Work", location: "Work.kdbx"),
        Spec(id: "archive", name: "Archive", location: "On this device", touchID: "cancelled"),
        Spec(id: "family", name: "Family", location: "Family.kdbx", quickUnlockOff: .off),
        Spec(id: "travel", name: "Travel", location: "Travel.kdbx", file: .notDownloaded),
        Spec(id: "taxes", name: "Taxes", location: "Taxes.kdbx", file: .unreadable),
        Spec(id: "old", name: "Old", location: "Old.kdbx", file: .notFound),
    ]

    let directory: URL
    private var stateURL: URL { directory.appendingPathComponent("vaults.json") }

    private var object: [String: Any] {
        guard let data = try? Data(contentsOf: stateURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    /// The vaults: the file's `vaults` list when it has a valid one, otherwise the defaults. At most 20.
    var specs: [Spec] {
        guard let list = object["vaults"] as? [[String: Any]] else { return Self.defaults }
        let specs = list.prefix(20).compactMap { entry -> Spec? in
            guard let id = entry["id"] as? String, !id.isEmpty, id.count <= 64, let name = entry["name"] as? String else { return nil }
            return Spec(id: id, name: name, location: entry["location"] as? String ?? "",
                        file: (entry["file"] as? String).flatMap(BrowserVaultState.init(rawValue:)).flatMap { $0.isAvailable ? nil : $0 },
                        quickUnlockOff: (entry["quickUnlockOff"] as? String).flatMap(BrowserPasswordReason.init(rawValue:)),
                        touchID: entry["touchID"] as? String, appComesForward: entry["appComesForward"] as? Bool == true)
        }
        return specs.isEmpty ? Self.defaults : specs
    }

    /// The current vault and whether it is open. The first vault, open, until a switch says otherwise.
    var current: (id: String, unlocked: Bool) {
        let all = specs
        let object = object
        guard let active = object["active"] as? String, all.contains(where: { $0.id == active }) else { return (all[0].id, true) }
        return (active, object["unlocked"] as? Bool ?? true)
    }

    private func write(active: String, unlocked: Bool) {
        var object = object
        object["active"] = active
        object["unlocked"] = unlocked
        if let data = try? JSONSerialization.data(withJSONObject: object) { try? data.write(to: stateURL, options: .atomic) }
    }

    private func state(of spec: Spec, in current: (id: String, unlocked: Bool)) -> (BrowserVaultState, BrowserPasswordReason?) {
        if let file = spec.file { return (file, nil) }
        if spec.id == current.id && current.unlocked { return (.open, nil) }
        if let off = spec.quickUnlockOff { return (.needsPassword, off) }
        return (.locked, nil)
    }

    func vaults() -> [BrowserVault] {
        let current = current
        let all = specs
        // In the fixed order of the list, the current vault not moved first: the popup's pick list keeps each vault where it is.
        return all.map { spec in
            let (state, reason) = state(of: spec, in: current)
            return BrowserVault(id: spec.id, name: spec.name, location: spec.location, active: spec.id == current.id, state: state, reason: reason)
        }
    }

    func switchVault(id: String) -> BrowserVaultOutcome {
        guard specs.contains(where: { $0.id == id }) else { return .notFound }
        let current = current
        // Choosing the open vault changes nothing. Any other becomes current and the open one locks.
        if id == current.id { return .switched }
        write(active: id, unlocked: false)
        return .switched
    }

    func unlockVault(id: String) -> BrowserUnlockOutcome {
        guard let spec = specs.first(where: { $0.id == id }) else { return .notFound }
        let current = current
        guard id == current.id else { return .notCurrent }
        switch state(of: spec, in: current).0 {
        case .open: return .unlocked
        case .notDownloaded, .notFound, .unreadable: return .notAvailable
        case .needsPassword: return spec.appComesForward ? .cameForward : .needsApp
        case .locked:
            switch spec.touchID {
            case "cancelled": return .cancelled
            case "failed": return .failed
            default:
                write(active: id, unlocked: true)
                return .unlocked
            }
        }
    }
}
