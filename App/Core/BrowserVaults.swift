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
    /// Whether this vault is the one the app shows (one per device). It is only the popup's default choice: several vaults can be open,
    /// and every request that reads or writes logins names the vault it means.
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
    /// The vault is now the one the app shows. No vault was locked or unlocked: a locked one stays locked until `unlock-vault`.
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
/// (`BrowserVaultSwitch` and `SessionVaultService`, in the app). The calls are synchronous because the host waits for the reply either way.
protocol BrowserVaultService {
    func vaults() -> [BrowserVault]
    func switchVault(id: String) -> BrowserVaultOutcome
    func unlockVault(id: String) -> BrowserUnlockOutcome

    /// Whether this service holds logins to search, fill and save. The Safari app extension's stored list does not (it never holds a
    /// key): every request that would read or write a login is answered `unsupported` there.
    var servesCredentials: Bool { get }
    /// The vault's items while it is open, or nil when it is not (locked since the list was read, unknown). Nothing from a vault that
    /// is not open is ever returned, and never another vault's items instead.
    func items(vault id: String) -> [VaultItem]?
    /// Saves one login into the vault if it is open. False: nothing was written.
    func save(_ item: VaultItem, vault id: String) -> Bool
    /// The reference a login has in replies. It only has to be unique inside one vault: a request names its vault.
    func reference(for item: VaultItem) -> String
}

extension BrowserVaultService {
    var servesCredentials: Bool { false }
    func items(vault id: String) -> [VaultItem]? { nil }
    func save(_ item: VaultItem, vault id: String) -> Bool { false }
    func reference(for item: VaultItem) -> String { BrowserProtocol.reference(item) }
}

/// The prototype host's vaults, kept next to the prototype file (`vaults.json`) so a switch survives the per-message host
/// process. Nothing here is a real vault; the file also lets the end-to-end tests put every state on screen (`vaults` replaces the
/// default list; see `Spec`). Any number of vaults can be open (`open` in the state file); a switch locks none.
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

    /// The vault the app shows. The first vault until a switch says otherwise.
    var active: String {
        let all = specs
        guard let active = object["active"] as? String, all.contains(where: { $0.id == active }) else { return all[0].id }
        return active
    }

    /// The vaults that are open: any number. The first one until a request says otherwise (`open` in the state file lists them).
    var open: Set<String> {
        let all = specs
        guard let list = object["open"] as? [String] else { return [all[0].id] }
        return Set(list.filter { id in all.contains { $0.id == id } })
    }

    private func write(active: String, open: Set<String>) {
        var object = object
        object["active"] = active
        object["open"] = specs.map(\.id).filter(open.contains)
        if let data = try? JSONSerialization.data(withJSONObject: object) { try? data.write(to: stateURL, options: .atomic) }
    }

    private func state(of spec: Spec, open: Set<String>) -> (BrowserVaultState, BrowserPasswordReason?) {
        if let file = spec.file { return (file, nil) }
        if open.contains(spec.id) { return (.open, nil) }
        if let off = spec.quickUnlockOff { return (.needsPassword, off) }
        return (.locked, nil)
    }

    func vaults() -> [BrowserVault] {
        let active = active
        let open = open
        // In the fixed order of the list: the shown vault is not moved first, and the popup's pick list keeps each vault where it is.
        return specs.map { spec in
            let (state, reason) = state(of: spec, open: open)
            return BrowserVault(id: spec.id, name: spec.name, location: spec.location, active: spec.id == active, state: state, reason: reason)
        }
    }

    /// Makes the vault the shown one. No vault is locked or unlocked.
    func switchVault(id: String) -> BrowserVaultOutcome {
        guard specs.contains(where: { $0.id == id }) else { return .notFound }
        if id != active { write(active: id, open: open) }
        return .switched
    }

    func unlockVault(id: String) -> BrowserUnlockOutcome {
        guard let spec = specs.first(where: { $0.id == id }) else { return .notFound }
        guard id == active else { return .notCurrent }
        let open = open
        switch state(of: spec, open: open).0 {
        case .open: return .unlocked
        case .notDownloaded, .notFound, .unreadable: return .notAvailable
        case .needsPassword: return spec.appComesForward ? .cameForward : .needsApp
        case .locked:
            switch spec.touchID {
            case "cancelled": return .cancelled
            case "failed": return .failed
            default:
                write(active: id, open: open.union([id]))
                return .unlocked
            }
        }
    }

    var servesCredentials: Bool { true }

    func items(vault id: String) -> [VaultItem]? {
        guard let spec = specs.first(where: { $0.id == id }), spec.file == nil, open.contains(id) else { return nil }
        return BrowserPrototypeStore.items(vault: id)
    }

    func save(_ item: VaultItem, vault id: String) -> Bool {
        guard let spec = specs.first(where: { $0.id == id }), spec.file == nil, open.contains(id) else { return false }
        return BrowserPrototypeStore.save(item, vault: id)
    }
}
