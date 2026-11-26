import Foundation
import Security

// Where the one grant is kept. The app writes and revokes, the app and the Safari extension read, and either deletes a grant it
// judges invalid. Nothing about a grant goes to disk, UserDefaults or extension storage.

/// What the store holds: the grant's bytes, and beside them its identifier, which is readable without parsing the bytes.
struct SafariFillStoredItem: Equatable, Sendable, SafariFillRedacted {
    var data: Data
    /// Nil when the item has none, which no item written here does.
    var grantID: Data?
}

/// Makes writing and revoking take turns within a process. One per stored item: every value that reaches the same item shares it.
final class SafariFillGate: @unchecked Sendable {
    private let turn = NSLock()
    private let counter = NSLock()
    private var started = 0
    private var unfinished = 0

    /// How many revokes have begun, and whether any has yet to finish.
    var state: (revocations: Int, revoking: Bool) { counter.withLock { (started, unfinished > 0) } }
    func inTurn<T>(_ body: () throws -> T) rethrows -> T { try turn.withLock(body) }

    /// Counted before waiting for a turn, so a write already under way, waiting, or yet to come sees it until it is done.
    func revoking<T>(_ body: () throws -> T) rethrows -> T {
        counter.withLock { started += 1; unfinished += 1 }
        defer { counter.withLock { unfinished -= 1 } }
        return try inTurn(body)
    }
}

/// At most one item. Every call is atomic, so a process killed at any moment leaves no item or a whole one.
protocol SafariFillStore: Sendable {
    var gate: SafariFillGate { get }
    /// Nil when there is none.
    func read() throws -> SafariFillStoredItem?
    /// Fails when there already is an item.
    func add(_ item: SafariFillStoredItem) throws
    /// Deletes the item whose identifier is `grantID`, or whatever is there when it is nil. An empty identifier matches nothing.
    /// Nothing to delete is a success.
    func delete(matching grantID: Data?) throws
}

extension SafariFillStore {
    /// Replaces any grant with this one: delete, then add, with no other write or revoke of this process in between. When it
    /// throws anything but `revoked`, this grant was not stored, and no earlier one is left unless deleting it is what failed.
    /// A revoke always wins: while one is unfinished, or when one begins before this write has its turn, it throws `revoked` and
    /// touches nothing; one that begins later deletes what this stored.
    ///
    /// A revoke that finished before this call cannot be known here. The caller (the app) must check, immediately before calling
    /// and on the actor that locks vaults, with no suspension in between, that the vault is still unlocked, still listed and
    /// unchanged since the snapshot was taken, and that Safari's request still stands. It must call `write` and `revoke` only
    /// through these two methods, and deal with a thrown `deleteFailed`, after which an earlier grant lives out its time.
    func write(_ grant: SafariFillGrant) throws {
        let before = gate.state
        guard !before.revoking else { throw SafariFillError.revoked }
        try gate.inTurn {
            let now = gate.state
            guard !now.revoking, now.revocations == before.revocations else { throw SafariFillError.revoked }
            try delete(matching: nil)
            try add(SafariFillStoredItem(data: grant.encoded(), grantID: grant.grantID))
        }
    }

    /// Takes back whatever grant there is: on lock, on a change to the vault, and at launch.
    func revoke() throws {
        try gate.revoking { try delete(matching: nil) }
    }

    /// The grant that may be used now, or nil when there is none. As `inTime`, and a grant whose vault is not in `listedVaults`
    /// is refused but kept: the list is stored apart from the grant and may be in the middle of a change. Whoever knows that the
    /// vault was removed deletes it. Call this for every request; a returned grant is not good for a later one.
    func current(clock: some SafariFillClock = SystemSafariFillClock(), listedVaults: Set<UUID>) throws -> SafariFillGrant? {
        guard let grant = try inTime(clock: clock) else { return nil }
        guard listedVaults.contains(grant.vault.id) else { throw SafariFillError.vaultNotListed }
        return grant
    }

    /// The stored grant when it is whole and in time, whatever its vault, or nil when there is none. The item is read once, and
    /// that very item is judged: one that may not be used is deleted by its identifier, so a newer grant written in the meantime
    /// stays, and the reason is thrown (also when the delete fails: it is refused either way). A store that cannot be read throws
    /// and deletes nothing.
    func inTime(clock: some SafariFillClock = SystemSafariFillClock()) throws -> SafariFillGrant? {
        guard let item = try read() else { return nil }
        do {
            let grant = try SafariFillGrant.decode(item.data)
            guard grant.grantID == item.grantID else { throw SafariFillError.unreadable }
            try grant.validate(clock: clock, listedVaults: [grant.vault.id])
            return grant
        } catch {
            discard(item)
            throw error
        }
    }

    /// Deletes a refused item. One without an identifier cannot be named, so whatever is there goes, after a second look that it
    /// still has none. Another process writing between that look and the delete would lose its grant, which only means asking again.
    private func discard(_ item: SafariFillStoredItem) {
        if let id = item.grantID, !id.isEmpty {
            try? delete(matching: id)
        } else {
            gate.inTurn {
                guard let again = try? read(), again.grantID?.isEmpty != false else { return }
                try? delete(matching: nil)
            }
        }
    }
}

/// The three Keychain calls, so tests check the queries and the meaning of each status without touching a Keychain.
struct SafariFillKeychainCalls: Sendable {
    var copy: @Sendable ([String: Any]) -> (OSStatus, Any?)
    var add: @Sendable ([String: Any]) -> OSStatus
    var delete: @Sendable ([String: Any]) -> OSStatus

    #if HOSTLESS_TESTS
    /// A hostless test can never reach the real Keychain.
    static let system = SafariFillKeychainCalls(copy: { _ in (errSecNotAvailable, nil) }, add: { _ in errSecNotAvailable },
                                                delete: { _ in errSecNotAvailable })
    #else
    static let system = SafariFillKeychainCalls(
        copy: { query in
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            return (status, result)
        },
        add: { SecItemAdd($0 as CFDictionary, nil) },
        delete: { SecItemDelete($0 as CFDictionary) })
    #endif
}

/// One generic password item in the data protection keychain, in an access group that only the app and the Safari extension list:
/// readable while the device is unlocked, on this device only, never synchronized. No Face ID on the item, as the extension could
/// not show it (the approved tradeoff). The system does not expire it: whoever reads it next refuses and deletes an old one.
struct KeychainSafariFillStore: SafariFillStore {
    static let service = "app.psss.safari-fill"
    static let account = "grant"
    /// The Info.plist key through which each target hands its team-prefixed access group to the code.
    static let infoKey = "PsssSafariFillAccessGroup"
    private static let groupSuffix = ".app.psss.safari-fill"
    private static let sharedGate = SafariFillGate()
    var gate: SafariFillGate { Self.sharedGate }

    let accessGroup: String
    private let calls: SafariFillKeychainCalls

    /// Nil unless the group is the fill group with a prefix in front: an unexpanded or missing prefix is not a group of ours.
    init?(accessGroup: String, calls: SafariFillKeychainCalls = .system) {
        guard accessGroup.hasSuffix(Self.groupSuffix), accessGroup.count > Self.groupSuffix.count, !accessGroup.contains("$") else { return nil }
        self.accessGroup = accessGroup
        self.calls = calls
    }

    init?(infoDictionary: [String: Any]? = Bundle.main.infoDictionary, calls: SafariFillKeychainCalls = .system) {
        guard let group = infoDictionary?[Self.infoKey] as? String else { return nil }
        self.init(accessGroup: group, calls: calls)
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecUseDataProtectionKeychain as String: true,
         kSecAttrService as String: Self.service,
         kSecAttrAccount as String: Self.account,
         kSecAttrAccessGroup as String: accessGroup,
         kSecAttrSynchronizable as String: false]
    }

    func read() throws -> SafariFillStoredItem? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, result) = calls.copy(query)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let found = result as? [String: Any], let data = found[kSecValueData as String] as? Data else {
            throw SafariFillError.storeUnavailable
        }
        return SafariFillStoredItem(data: data, grantID: found[kSecAttrGeneric as String] as? Data)
    }

    func add(_ item: SafariFillStoredItem) throws {
        var attributes = query
        attributes[kSecValueData as String] = item.data
        attributes[kSecAttrGeneric as String] = item.grantID
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard calls.add(attributes) == errSecSuccess else { throw SafariFillError.saveFailed }
    }

    func delete(matching grantID: Data?) throws {
        var query = query
        if let grantID {
            // An empty identifier is never one of ours, and must not turn into a delete of whatever is there.
            guard !grantID.isEmpty else { return }
            query[kSecAttrGeneric as String] = grantID
        }
        let status = calls.delete(query)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SafariFillError.deleteFailed }
    }
}
