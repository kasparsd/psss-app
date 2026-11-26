import Foundation
import Security

// Hostless checks for the Safari fill grant (docs/plans/ios-safari-fill.md, slice 1). Run with scripts/test-safari-fill.sh.
// The store is a stand-in and the Keychain calls are recorded: no Keychain, vault file or app data is touched. All data is
// fictional. A failure names the case, never a value.

nonisolated(unsafe) var failures = 0
nonisolated(unsafe) var passes = 0
func check(_ name: String, _ ok: Bool) {
    if ok { passes += 1 } else { failures += 1; print("FAIL \(name)") }
}
func thrown(_ body: () throws -> Void) -> SafariFillError? {
    do { try body(); return nil } catch let error as SafariFillError { return error } catch { check("an error of another type", false); return nil }
}

struct TestClock: SafariFillClock {
    var wall: Int64 = 1_795_000_000_000  // November 2026
    var continuous: Int64 = 500_000
    func wallMilliseconds() -> Int64 { wall }
    func continuousMilliseconds() -> Int64 { continuous }
    func later(wall w: Int64, continuous c: Int64) -> TestClock { TestClock(wall: wall + w, continuous: continuous + c) }
    func later(_ ms: Int64) -> TestClock { later(wall: ms, continuous: ms) }
}

final class MemoryStore: SafariFillStore, @unchecked Sendable {
    let gate = SafariFillGate()
    private let lock = NSLock()
    private var item: SafariFillStoredItem?
    var readFails = false
    var addFails = false
    var deleteFails = false
    /// Runs once after the next read has its answer: what another process does between a read and what follows.
    var afterRead: (() -> Void)?
    /// Run once inside the next delete or add, while a write holds its turn.
    var duringDelete: (() -> Void)?
    var duringAdd: (() -> Void)?
    private(set) var adds = 0

    var stored: SafariFillStoredItem? {
        get { lock.withLock { item } }
        set { lock.withLock { item = newValue } }
    }

    func read() throws -> SafariFillStoredItem? {
        if readFails { throw SafariFillError.storeUnavailable }
        let found = stored
        let hook = afterRead
        afterRead = nil
        hook?()
        return found
    }

    func add(_ new: SafariFillStoredItem) throws {
        let hook = duringAdd
        duringAdd = nil
        hook?()
        try lock.withLock {
            if addFails || item != nil { throw SafariFillError.saveFailed }
            item = new
            adds += 1
        }
    }

    /// As the Keychain query behaves: no filter takes whatever is there, a filter takes only an item carrying that very
    /// identifier (an item without one matches none), and the store ignores an empty one.
    func delete(matching grantID: Data?) throws {
        let hook = duringDelete
        duringDelete = nil
        hook?()
        try lock.withLock {
            if deleteFails { throw SafariFillError.deleteFailed }
            guard let grantID else { item = nil; return }
            if !grantID.isEmpty, item?.grantID == grantID { item = nil }
        }
    }
}

let utc: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}()

let clock = TestClock()
let vaultID = UUID()
let listed: Set<UUID> = [vaultID]

func sampleCard(_ title: String = "Travel card", number: String = "4111111111111111") -> SafariFillGrant.Card {
    .init(id: UUID(), title: title, brand: "Visa", cardholder: "Robin Fictional", number: number, expiry: "2030-08", securityCode: "914")
}
func sampleAddress(_ label: String = "Home") -> SafariFillGrant.Address {
    .init(id: UUID(), label: label, fullName: "Robin Fictional", organization: "Acme Example", street: "1 Nowhere Lane\nFlat 2",
          city: "Exampleton", region: "Northshire", postalCode: "EX1 2PL", country: "GB", email: "robin@example.invalid", phone: "+44 0000 000000")
}
func sampleGrant(_ at: TestClock = clock) -> SafariFillGrant {
    SafariFillGrant(vault: .init(id: vaultID, name: "Passwords"), cards: [sampleCard()], addresses: [sampleAddress()], clock: at)
}

// MARK: Expiry and clocks

do {
    let grant = sampleGrant()
    func verdict(_ now: TestClock) -> SafariFillError? { thrown { try grant.validate(clock: now, listedVaults: listed) } }
    check("lifetime is 120 s", SafariFillGrant.lifetimeMilliseconds == 120_000)
    check("at once", verdict(clock) == nil)
    check("119.9 s", verdict(clock.later(119_900)) == nil)
    check("119.999 s", verdict(clock.later(119_999)) == nil)
    check("120 s", verdict(clock.later(120_000)) == .expired)
    check("121 s", verdict(clock.later(121_000)) == .expired)
    check("a day", verdict(clock.later(86_400_000)) == .expired)
    check("continuous before issue", verdict(clock.later(wall: 0, continuous: -1)) == .clockChanged)
    check("wall before issue", verdict(clock.later(wall: -1, continuous: 0)) == .clockChanged)
    check("both before issue", verdict(clock.later(-1000)) == .clockChanged)
    check("wall forward within tolerance", verdict(clock.later(wall: 15_000, continuous: 10_000)) == nil)
    check("wall forward past tolerance", verdict(clock.later(wall: 15_001, continuous: 10_000)) == .clockChanged)
    check("wall back within tolerance", verdict(clock.later(wall: 5_000, continuous: 10_000)) == nil)
    check("wall back past tolerance", verdict(clock.later(wall: 4_999, continuous: 10_000)) == .clockChanged)
    check("wall set far forward", verdict(clock.later(wall: 3_600_000, continuous: 1_000)) == .clockChanged)
    check("wall set back an hour", verdict(clock.later(wall: -3_600_000, continuous: 1_000)) == .clockChanged)
    check("wall set back to hide 2 minutes", verdict(clock.later(wall: 1_000, continuous: 130_000)) == .clockChanged)
    check("continuous at limit, wall inside tolerance", verdict(clock.later(wall: 118_000, continuous: 120_000)) == .expired)
    check("continuous inside, wall past 120", verdict(clock.later(wall: 124_000, continuous: 119_999)) == nil)
    check("wall at 125 s", verdict(clock.later(wall: 125_000, continuous: 120_000)) == .expired)
    check("reboot, continuous restarted", verdict(TestClock(wall: clock.wall + 40_000, continuous: 20_000)) == .clockChanged)
    check("reboot, continuous happens to be later", verdict(TestClock(wall: clock.wall + 60_000, continuous: clock.continuous + 20_000)) == .clockChanged)
    check("failed continuous read", verdict(TestClock(wall: clock.wall + 1_000, continuous: 0)) == .clockChanged)
    check("negative now", verdict(TestClock(wall: -1, continuous: -1)) == .clockChanged)
    check("vault gone", thrown { try grant.validate(clock: clock, listedVaults: [UUID()]) } == .vaultNotListed)
    check("no vaults", thrown { try grant.validate(clock: clock, listedVaults: []) } == .vaultNotListed)
    for (wall, continuous) in [(Int64.min, Int64.min), (.max, .max), (.min, .max), (-1, 0), (0, -1)] {
        var hostile = grant
        hostile.issuedWall = wall
        hostile.issuedContinuous = continuous
        check("extreme issue times do not trap or pass", thrown { try hostile.validate(clock: clock, listedVaults: listed) } != nil)
    }
    var other = grant
    other.version = 2
    check("validate refuses another version", thrown { try other.validate(clock: clock, listedVaults: listed) } == .unknownVersion)

    let system = SystemSafariFillClock()
    let real = SafariFillGrant(vault: .init(id: vaultID, name: "n"))
    check("system clocks accept a new grant", thrown { try real.validate(clock: system, listedVaults: listed) } == nil)
    check("system clocks are positive", system.wallMilliseconds() > 0 && system.continuousMilliseconds() > 0)
    check("identifier is 16 bytes", real.grantID.count == 16)
    check("identifiers differ", Set((0..<100).map { _ in sampleGrant().grantID }).count == 100)
}

// MARK: Stored bytes

let good = try sampleGrant().encoded()
func decodeError(_ data: Data) -> SafariFillError? { thrown { _ = try SafariFillGrant.decode(data) } }
func altered(_ change: (inout [String: Any]) -> Void) -> Data {
    var object = try! JSONSerialization.jsonObject(with: good) as! [String: Any]
    change(&object)
    return try! JSONSerialization.data(withJSONObject: object)
}
func alteredCard(_ key: String, _ value: Any?) -> Data {
    altered { var cards = $0["cards"] as! [[String: Any]]; cards[0][key] = value; $0["cards"] = cards }
}
func alteredAddress(_ key: String, _ value: Any?) -> Data {
    altered { var list = $0["addresses"] as! [[String: Any]]; list[0][key] = value; $0["addresses"] = list }
}

do {
    check("round trip", (try? SafariFillGrant.decode(good))?.encodedEquals(good) == true)
    check("unchanged copy decodes", decodeError(altered { _ in }) == nil)
    check("version 0", decodeError(altered { $0["version"] = 0 }) == .unknownVersion)
    check("version 2", decodeError(altered { $0["version"] = 2 }) == .unknownVersion)
    check("version 2 of another shape", decodeError(Data(#"{"version":2,"anything":[]}"#.utf8)) == .unknownVersion)
    check("version as text", decodeError(altered { $0["version"] = "1" }) == .unreadable)
    check("huge version", decodeError(Data(#"{"version":1e400}"#.utf8)) == .unreadable)
    check("no version", decodeError(altered { $0["version"] = nil }) == .unreadable)
    check("empty", decodeError(Data()) == .unreadable)
    check("every truncation is unreadable", (0..<good.count).allSatisfy { decodeError(good.prefix($0)) == .unreadable })
    var generator = SystemRandomNumberGenerator()
    check("random bytes are refused", (0..<500).allSatisfy { n in
        decodeError(Data((0..<n).map { _ in UInt8.random(in: .min ... .max, using: &generator) })) != nil
    })
    check("flipped bytes never trap", (0..<good.count).allSatisfy { index in
        var damaged = good
        damaged[index] ^= 0x5A
        _ = decodeError(damaged)
        return true
    })
    for text in ["null", "[]", "1", "\"x\"", "{}", "{\"version\":1}", String(repeating: "[", count: 60_000), String(repeating: "{\"a\":", count: 10_000)] {
        check("wrong shape is unreadable", decodeError(Data(text.utf8)) == .unreadable)
    }
    for key in ["grantID", "issuedWall", "issuedContinuous", "vault", "cards", "addresses"] {
        check("missing \(key)", decodeError(altered { $0[key] = nil }) == .unreadable)
        check("wrong type \(key)", decodeError(altered { $0[key] = true }) == .unreadable)
    }
    check("time past Int64", decodeError(Data(String(decoding: good, as: UTF8.self).replacingOccurrences(of: "\"issuedWall\":", with: "\"issuedWall\":99999999999999999999").utf8)) == .unreadable)
    check("short identifier", decodeError(altered { $0["grantID"] = Data([1, 2]).base64EncodedString() }) == .unreadable)
    check("long identifier", decodeError(altered { $0["grantID"] = Data(count: 17).base64EncodedString() }) == .unreadable)

    check("over 64 KiB", decodeError(good + Data(repeating: 0x20, count: SafariFillGrant.maxBytes - good.count + 1)) == .overCap)
    check("exactly 64 KiB", decodeError(good + Data(repeating: 0x20, count: SafariFillGrant.maxBytes - good.count)) == nil)
    check("a huge item", decodeError(Data(count: 20_000_000)) == .overCap)
    let card = (try! JSONSerialization.jsonObject(with: good) as! [String: Any])["cards"] as! [[String: Any]]
    let address = (try! JSONSerialization.jsonObject(with: good) as! [String: Any])["addresses"] as! [[String: Any]]
    func copies(_ entry: [String: Any], _ count: Int) -> [[String: Any]] {
        (0..<count).map { _ in var copy = entry; copy["id"] = UUID().uuidString; return copy }
    }
    check("100 cards", decodeError(altered { $0["cards"] = copies(card[0], 100) }) == nil)
    check("101 cards", decodeError(altered { $0["cards"] = copies(card[0], 101) }) == .overCap)
    check("101 addresses", decodeError(altered { $0["addresses"] = copies(address[0], 101); $0["cards"] = [] as [Any] }) == .overCap)
    check("two cards with one identifier", decodeError(altered { $0["cards"] = [card[0], card[0]] }) == .unreadable)
    check("two addresses with one identifier", decodeError(altered { $0["addresses"] = [address[0], address[0]] }) == .unreadable)
    check("a card and an address with one identifier", decodeError(alteredAddress("id", card[0]["id"])) == .unreadable)
    var twice = sampleGrant()
    twice.cards.append(twice.cards[0])
    check("encoding refuses a repeated identifier", thrown { _ = try twice.encoded() } == .unreadable)
    for code in ["", "12", "12345", "12a", " 123", "１２３"] {
        check("bad security code refused", decodeError(alteredCard("securityCode", code)) == .overCap)
    }
    let long = String(repeating: "a", count: 513), exact = String(repeating: "a", count: 512)
    for key in ["title", "brand", "cardholder"] {
        check("card \(key) 512", decodeError(alteredCard(key, exact)) == nil)
        check("card \(key) 513", decodeError(alteredCard(key, long)) == .overCap)
    }
    for key in ["label", "fullName", "organization", "street", "city", "region", "postalCode", "country", "email", "phone"] {
        check("address \(key) 512", decodeError(alteredAddress(key, exact)) == nil)
        check("address \(key) 513", decodeError(alteredAddress(key, long)) == .overCap)
    }
    check("combining marks count", decodeError(alteredCard("title", "a" + String(repeating: "\u{0301}", count: 600))) == .overCap)
    check("vault name 513", decodeError(altered { $0["vault"] = ["id": vaultID.uuidString, "name": long] }) == .overCap)
    for number in ["", "41111111111", "41111111111111111111", "4111 1111 1111 1111", "411111111111111a", "４１１１１１１１１１１１１１１１"] {
        check("bad number refused", decodeError(alteredCard("number", number)) == .overCap)
    }
    for number in ["411111111111", "4111111111111111111"] { check("12 and 19 digits", decodeError(alteredCard("number", number)) == nil) }
    for expiry in ["", "2030-13", "2030-00", "30-08", "2030/08", "2030-8", "2030-08-01", "abcd-ef"] {
        check("bad expiry refused", decodeError(alteredCard("expiry", expiry)) == .overCap)
    }
    check("absent expiry and code", decodeError(altered {
        var cards = $0["cards"] as! [[String: Any]]; cards[0]["expiry"] = nil; cards[0]["securityCode"] = nil; $0["cards"] = cards
    }) == nil)
    var big = sampleGrant()
    big.cards = (0..<100).map { _ in sampleCard(exact) }
    big.addresses = (0..<100).map { _ in sampleAddress(exact) }
    check("encoding refuses over the size cap", thrown { _ = try big.encoded() } == .overCap)
    var badID = sampleGrant()
    badID.grantID = Data()
    check("encoding refuses a wrong identifier", thrown { _ = try badID.encoded() } == .overCap)
}

extension SafariFillGrant {
    var hasNoEntries: Bool { cards.isEmpty && addresses.isEmpty }
    func encodedEquals(_ data: Data) -> Bool { (try? encoded()) == data }
}

// MARK: Store

final class Slot<Value>: @unchecked Sendable { var value: Value? }

do {
    let store = MemoryStore()
    check("nothing stored", try store.current(clock: clock, listedVaults: listed) == nil)
    let grant = sampleGrant()
    try store.write(grant)
    check("written and read", try store.current(clock: clock.later(1_000), listedVaults: listed) == grant)
    check("still there", store.stored?.grantID == grant.grantID)
    let newer = sampleGrant()
    try store.write(newer)
    check("a write replaces", store.stored?.grantID == newer.grantID)
    try store.revoke()
    check("revoked", store.stored == nil)
    try store.revoke()
    check("revoking nothing is fine", store.stored == nil)

    func refused(_ name: String, _ item: SafariFillStoredItem, _ want: SafariFillError, now: TestClock = clock, vaults: Set<UUID> = listed) {
        let store = MemoryStore()
        store.stored = item
        check("\(name) refused", thrown { _ = try store.current(clock: now, listedVaults: vaults) } == want)
        check("\(name) deleted", store.stored == nil)
        check("\(name) then none", (try? store.current(clock: now, listedVaults: vaults)) == .some(nil))
    }
    let whole = SafariFillStoredItem(data: try grant.encoded(), grantID: grant.grantID)
    refused("expired", whole, .expired, now: clock.later(120_000))
    refused("clock change", whole, .clockChanged, now: clock.later(wall: 60_000, continuous: 1_000))
    refused("removed vault", whole, .vaultNotListed, vaults: [])
    refused("garbage", .init(data: Data("garbage".utf8), grantID: grant.grantID), .unreadable)
    refused("truncated", .init(data: whole.data.prefix(40), grantID: grant.grantID), .unreadable)
    refused("over cap", .init(data: Data(count: 70_000), grantID: grant.grantID), .overCap)
    refused("unknown version", .init(data: altered { $0["version"] = 9 }, grantID: grant.grantID), .unknownVersion)
    refused("identifier mismatch", .init(data: whole.data, grantID: Data(count: 16)), .unreadable)
    refused("no identifier", .init(data: whole.data, grantID: nil), .unreadable)
    refused("empty identifier", .init(data: whole.data, grantID: Data()), .unreadable)
    refused("no identifier, garbage", .init(data: Data("x".utf8), grantID: nil), .unreadable)

    let nameless = MemoryStore()
    nameless.stored = .init(data: whole.data, grantID: nil)
    try nameless.delete(matching: grant.grantID)
    try nameless.delete(matching: Data())
    check("the stand-in matches no filter against a nameless item", nameless.stored != nil)
    let replacement = sampleGrant()
    nameless.afterRead = { try! nameless.write(replacement) }
    check("a nameless item is refused", thrown { _ = try nameless.current(clock: clock, listedVaults: listed) } == .unreadable)
    check("a grant written since survives", nameless.stored?.grantID == replacement.grantID)

    // Interleavings. The second caller runs on another thread while the first holds its turn.
    func alongside(_ body: @escaping @Sendable () -> Void) -> DispatchSemaphore {
        let done = DispatchSemaphore(value: 0)
        Thread.detachNewThread { body(); done.signal() }
        return done
    }
    func waitForRevocation(_ store: MemoryStore, past count: Int) {
        while store.gate.state.revocations == count { Thread.sleep(forTimeInterval: 0.001) }
    }
    for point in ["delete", "add"] {
        let store = MemoryStore()
        try store.write(sampleGrant())
        let done = Slot<DispatchSemaphore>()
        let hook: () -> Void = {
            let before = store.gate.state.revocations
            done.value = alongside { try! store.revoke() }
            waitForRevocation(store, past: before)
        }
        if point == "delete" { store.duringDelete = hook } else { store.duringAdd = hook }
        check("write overtaken at \(point) does not fail", thrown { try store.write(sampleGrant()) } == nil)
        done.value?.wait()
        check("revoke during \(point) ends with no grant", store.stored == nil)
    }
    do {
        // A revoke while a write waits for its turn: the waiting write stores nothing.
        let store = MemoryStore()
        let result = Slot<SafariFillError>()
        let started = DispatchSemaphore(value: 0)
        let waiting = Slot<DispatchSemaphore>()
        let revoking = Slot<DispatchSemaphore>()
        store.gate.inTurn {
            waiting.value = alongside { started.signal(); result.value = thrown { try store.write(sampleGrant()) } }
            started.wait()
            Thread.sleep(forTimeInterval: 0.2)  // for the write to reach its wait
            let before = store.gate.state.revocations
            revoking.value = alongside { try! store.revoke() }
            waitForRevocation(store, past: before)
        }
        waiting.value?.wait()
        revoking.value?.wait()
        check("a write waiting through a revoke is refused", result.value == .revoked)
        check("and leaves nothing", store.stored == nil)
        check("a later write works", thrown { try store.write(sampleGrant()) } == nil && store.stored != nil)
    }
    do {
        // A write that comes while a revoke is unfinished: one under way, and one still waiting for its turn.
        let store = MemoryStore()
        try store.write(sampleGrant())
        let inside = Slot<SafariFillError>()
        store.duringDelete = { inside.value = thrown { try store.write(sampleGrant()) } }
        try store.revoke()
        check("a write during a revoke is refused", inside.value == .revoked)
        check("and the revoke ends with no grant", store.stored == nil && store.adds == 1)
        check("once finished, writing works", thrown { try store.write(sampleGrant()) } == nil && !store.gate.state.revoking)

        let revoking = Slot<DispatchSemaphore>()
        store.gate.inTurn {
            let before = store.gate.state.revocations
            revoking.value = alongside { try! store.revoke() }
            waitForRevocation(store, past: before)
            check("the revoke is pending", store.gate.state.revoking)
            for _ in 0..<3 { check("a write after a pending revoke is refused", thrown { try store.write(sampleGrant()) } == .revoked) }
        }
        revoking.value?.wait()
        check("a pending revoke wins", store.stored == nil)

        store.deleteFails = true
        check("a failed revoke reports", thrown { try store.revoke() } == .deleteFailed)
        check("and is finished", !store.gate.state.revoking)
        store.deleteFails = false
    }
    do {
        // A second writer arrives while the first is between its delete and its add, and its add fails.
        let store = MemoryStore()
        let result = Slot<SafariFillError>()
        let second = Slot<DispatchSemaphore>()
        let first = sampleGrant()
        store.duringAdd = {
            second.value = alongside {
                store.duringDelete = { store.addFails = true }
                result.value = thrown { try store.write(sampleGrant()) }
            }
            Thread.sleep(forTimeInterval: 0.2)
            check("the second writer waits its turn", store.duringDelete != nil || !store.addFails)
        }
        check("first write", thrown { try store.write(first) } == nil)
        second.value?.wait()
        check("second write fails", result.value == .saveFailed)
        check("and leaves no earlier grant", store.stored == nil)
    }
    do {
        let store = MemoryStore()
        DispatchQueue.concurrentPerform(iterations: 600) { index in
            if index % 2 == 0 { do { try store.write(sampleGrant()) } catch { precondition(error as? SafariFillError == .revoked) } }
            else { try! store.revoke() }
        }
        try store.revoke()
        check("writers and revokers at once end clean", store.stored == nil)
    }

    let locked = MemoryStore()
    locked.stored = whole
    locked.readFails = true
    check("unreadable store refuses", thrown { _ = try locked.current(clock: clock.later(500_000), listedVaults: listed) } == .storeUnavailable)
    check("unreadable store deletes nothing", locked.stored == whole)

    let stuck = MemoryStore()
    stuck.stored = whole
    stuck.deleteFails = true
    check("failed delete still refuses with the reason", thrown { _ = try stuck.current(clock: clock.later(120_000), listedVaults: listed) } == .expired)
    check("and every time after", thrown { _ = try stuck.current(clock: clock.later(120_001), listedVaults: listed) } == .expired)
    check("write reports a failed delete", thrown { try stuck.write(sampleGrant()) } == .deleteFailed)
    check("and adds nothing", stuck.stored == whole && stuck.adds == 0)
    check("revoke reports a failed delete", thrown { try stuck.revoke() } == .deleteFailed)

    let full = MemoryStore()
    full.stored = whole
    full.addFails = true
    check("write reports a failed add", thrown { try full.write(sampleGrant()) } == .saveFailed)
    check("a failed add leaves no grant", full.stored == nil)

    let tooBig = MemoryStore()
    tooBig.stored = whole
    var bad = sampleGrant()
    bad.cards = (0..<101).map { _ in sampleCard() }
    check("write refuses over cap", thrown { try tooBig.write(bad) } == .overCap)
    check("and leaves no grant", tooBig.stored == nil)

    // An old reader judges the expired grant while the app writes a new one.
    let raced = MemoryStore()
    try raced.write(grant)
    let fresh = sampleGrant(clock.later(200_000))
    raced.afterRead = { try! raced.write(fresh) }
    check("old reader refuses", thrown { _ = try raced.current(clock: clock.later(200_000), listedVaults: listed) } == .expired)
    check("the new grant survives", raced.stored?.grantID == fresh.grantID)
    check("and is usable", try raced.current(clock: clock.later(200_001), listedVaults: listed) == fresh)
    raced.stored = .init(data: Data("x".utf8), grantID: grant.grantID)
    raced.afterRead = { try! raced.write(fresh) }
    check("old reader of garbage refuses", thrown { _ = try raced.current(clock: clock.later(200_000), listedVaults: listed) } == .unreadable)
    check("the new grant survives it", raced.stored?.grantID == fresh.grantID)

    // Two writers and readers at once: no crash, and what is left is one whole grant or none.
    let shared = MemoryStore()
    DispatchQueue.concurrentPerform(iterations: 600) { index in
        switch index % 3 {
        case 0, 1:
            try! shared.write(sampleGrant())
        default:
            _ = try! shared.current(clock: clock, listedVaults: listed)
        }
    }
    check("concurrent writers leave a whole grant or none", shared.stored.map { item in
        (try? SafariFillGrant.decode(item.data))?.grantID == item.grantID
    } ?? true)
}

// MARK: Keychain queries (recorded, never sent to a Keychain)

final class Recorder: @unchecked Sendable {
    var queries: [[String: Any]] = []
    var status: OSStatus = errSecSuccess
    var result: Any?
    var calls: SafariFillKeychainCalls {
        .init(copy: { self.queries.append($0); return (self.status, self.result) },
              add: { self.queries.append($0); return self.status },
              delete: { self.queries.append($0); return self.status })
    }
}

do {
    let recorder = Recorder()
    let group = "ABCDE12345.app.psss.safari-fill"
    for bad in ["", "app.psss.safari-fill", ".app.psss.safari-fill", "$(AppIdentifierPrefix).app.psss.safari-fill", "group.app.psss", "ABCDE12345.app.psss.Psss"] {
        check("foreign access group refused", KeychainSafariFillStore(accessGroup: bad, calls: recorder.calls) == nil)
    }
    check("no Info.plist key", KeychainSafariFillStore(infoDictionary: [:], calls: recorder.calls) == nil)
    check("no Info.plist", KeychainSafariFillStore(infoDictionary: nil, calls: recorder.calls) == nil)
    let store = KeychainSafariFillStore(infoDictionary: [KeychainSafariFillStore.infoKey: group], calls: recorder.calls)!

    func base(_ q: [String: Any]) -> Bool {
        q[kSecClass as String] as? String == kSecClassGenericPassword as String
            && q[kSecUseDataProtectionKeychain as String] as? Bool == true
            && q[kSecAttrService as String] as? String == "app.psss.safari-fill"
            && q[kSecAttrAccount as String] as? String == "grant"
            && q[kSecAttrAccessGroup as String] as? String == group
            && q[kSecAttrSynchronizable as String] as? Bool == false
            && q[kSecAttrAccessControl as String] == nil
    }
    let item = SafariFillStoredItem(data: Data([1]), grantID: Data(repeating: 7, count: 16))
    try store.add(item)
    let added = recorder.queries.last!
    check("add attributes", base(added) && added[kSecValueData as String] as? Data == item.data && added[kSecAttrGeneric as String] as? Data == item.grantID
        && added[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    try store.delete(matching: item.grantID)
    check("conditional delete names the grant", base(recorder.queries.last!) && recorder.queries.last![kSecAttrGeneric as String] as? Data == item.grantID)
    try store.delete(matching: nil)
    check("revoke names no grant", base(recorder.queries.last!) && recorder.queries.last![kSecAttrGeneric as String] == nil)
    let before = recorder.queries.count
    try store.delete(matching: Data())
    check("an empty identifier deletes nothing", recorder.queries.count == before)

    recorder.result = [kSecValueData as String: item.data, kSecAttrGeneric as String: item.grantID]
    check("read", try store.read() == item)
    check("read query", base(recorder.queries.last!) && recorder.queries.last![kSecReturnData as String] as? Bool == true
        && recorder.queries.last![kSecReturnAttributes as String] as? Bool == true)
    recorder.result = [kSecValueData as String: item.data]
    check("read without identifier", try store.read().map { $0.grantID == nil } == true)
    check("Keychain stores share one gate", store.gate === KeychainSafariFillStore(accessGroup: group)!.gate)
    for odd: Any? in [nil, "text", [String: Any]()] {
        recorder.result = odd
        check("odd result", thrown { _ = try store.read() } == .storeUnavailable)
    }
    recorder.status = errSecItemNotFound
    check("not found reads nil", try store.read() == nil)
    check("not found deletes fine", thrown { try store.delete(matching: nil) } == nil)
    for status in [errSecInteractionNotAllowed, errSecMissingEntitlement, errSecDuplicateItem, errSecNotAvailable] {
        recorder.status = status
        check("read failure", thrown { _ = try store.read() } == .storeUnavailable)
        check("add failure", thrown { try store.add(item) } == .saveFailed)
        check("delete failure", thrown { try store.delete(matching: nil) } == .deleteFailed)
    }
    let real = KeychainSafariFillStore(accessGroup: group)!
    check("hostless builds cannot reach the Keychain", thrown { _ = try real.read() } == .storeUnavailable)
}

// MARK: Snapshot: what goes in, from a real vault document

/// A marker for each value that must never appear in a grant.
let secretMarker = "NEVERSHARED"
let hostile = "Card \u{202E}txt.exe\n../../etc/passwd \u{0000}\u{2066}\"}]"

func loaded(_ kind: ItemKind, title: String) -> VaultItem {
    var item = VaultItem(kind: kind, title: title, account: "\(secretMarker)-account", website: "https://\(secretMarker).invalid",
                         secret: "\(secretMarker)-secret", expiry: "08/30", securityCode: "\(secretMarker)-csc",
                         validFrom: "\(secretMarker)-from", pin: "\(secretMarker)-pin", issuer: "\(secretMarker)-issuer",
                         notes: "\(secretMarker)-notes", otpSecret: "JBSWY3DPEHPK3PXP")
    item.address = PostalAddress(organization: "\(secretMarker)-org", street: "\(secretMarker)-street", city: "\(secretMarker)-city",
                                 region: "\(secretMarker)-region", postalCode: "\(secretMarker)-zip", country: "\(secretMarker)-country",
                                 email: "\(secretMarker)-email", phone: "\(secretMarker)-phone")
    item.passkey = PasskeyRecord(credentialID: Data(secretMarker.utf8), userHandle: Data(secretMarker.utf8), rpID: "\(secretMarker).invalid",
                                 privateKey: Data(secretMarker.utf8), created: .now)
    item.otherFields = [StoredItemField(id: 1, key: "\(secretMarker)-key", value: "\(secretMarker)-value", isProtected: true)]
    item.sourceFields = item.otherFields
    return item
}

func card(_ title: String, number: String = "4111 1111 1111 1111", expiry: String = "08/30", code: String = "914") -> VaultItem {
    var item = VaultItem(kind: .creditCard, title: title, account: "Robin Fictional", secret: number, expiry: expiry, securityCode: code,
                         validFrom: "01/20", pin: "\(secretMarker)-pin", issuer: "\(secretMarker)-issuer", notes: "\(secretMarker)-notes")
    item.website = "https://\(secretMarker).invalid"
    item.otherFields = [StoredItemField(id: 1, key: "\(secretMarker)-key", value: "\(secretMarker)-value", isProtected: false)]
    return item
}

func address(_ title: String, name: String = "Robin Fictional") -> VaultItem {
    var item = VaultItem(kind: .address, title: title, account: name, notes: "\(secretMarker)-notes")
    item.address = PostalAddress(organization: "Acme Example", street: "1 Nowhere Lane\nFlat 2", city: "Exampleton", region: "Northshire",
                                 postalCode: "EX1 2PL", country: "GB", email: "robin@example.invalid", phone: "+44 0000 000000")
    return item
}

func snapshot(_ items: [VaultItem], name: String = "Passwords", at: TestClock = clock) throws -> SafariFillSnapshot.Result {
    try SafariFillSnapshot.make(vaultID: vaultID, vaultName: name, items: items, clock: at, calendar: utc)
}

func objects(_ data: Data, _ key: String) -> [[String: Any]] {
    (try! JSONSerialization.jsonObject(with: data) as! [String: Any])[key] as! [[String: Any]]
}

do {
    let others = ItemKind.allCases.filter { $0 != .creditCard && $0 != .address }.map { loaded($0, title: "\(secretMarker)-\($0.rawValue)") }
    check("every other kind is covered", Set(others.map(\.kind)).union([.creditCard, .address]) == Set(ItemKind.allCases))
    let wanted = [card("Travel card"), address("Home")]
    let result = try snapshot(others + wanted)
    let bytes = try result.grant.encoded()
    let text = String(decoding: bytes, as: UTF8.self)
    check("no excluded value in the bytes", !text.contains(secretMarker))
    check("no one-time secret or valid from", !text.contains("JBSWY3DPEHPK3PXP") && !text.contains("01\\/20"))
    check("one card, one address", result.grant.cards.count == 1 && result.grant.addresses.count == 1 && result.leftOut == 0)
    check("top level keys", Set((try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]).keys)
        == ["version", "grantID", "issuedWall", "issuedContinuous", "vault", "cards", "addresses"])
    check("card keys", Set(objects(bytes, "cards")[0].keys) == ["id", "title", "brand", "cardholder", "number", "expiry", "securityCode"])
    check("address keys", Set(objects(bytes, "addresses")[0].keys)
        == ["id", "label", "fullName", "organization", "street", "city", "region", "postalCode", "country", "email", "phone"])
    let made = result.grant.cards[0]
    check("card values", made.id == wanted[0].id && made.title == "Travel card" && made.brand == "Visa" && made.cardholder == "Robin Fictional"
        && made.number == "4111111111111111" && made.expiry == "2030-08" && made.securityCode == "914")
    let place = result.grant.addresses[0]
    check("address values", place.id == wanted[1].id && place.strings == ["Home", "Robin Fictional", "Acme Example", "1 Nowhere Lane\nFlat 2",
        "Exampleton", "Northshire", "EX1 2PL", "GB", "robin@example.invalid", "+44 0000 000000"])
    check("vault and times", result.grant.vault == .init(id: vaultID, name: "Passwords") && result.grant.issuedWall == clock.wall && result.grant.issuedContinuous == clock.continuous)

    // Every other kind alone, with the fields a card or an address would have.
    let none = try snapshot(others)
    check("other kinds give an empty grant", none.grant.cards.isEmpty && none.grant.addresses.isEmpty && none.leftOut == 0)

    // Expiry. The test clock is in November 2026.
    let dated = try snapshot([card("past", expiry: "10/26"), card("old", expiry: "2019-01"), card("this month", expiry: "11/26"),
                              card("later", expiry: "12/2031"), card("none", expiry: "", code: ""), card("unread", expiry: "soon")])
    check("expired cards left out", Set(dated.grant.cards.map(\.title)) == ["this month", "later", "none", "unread"] && dated.leftOut == 0)
    check("unreadable or absent expiry is absent", dated.grant.cards.filter { $0.expiry == nil }.count == 2)

    // Parsed and past: left out, and not counted.
    for past in ["01/19", "2019-01", "201901", "119", "10/26", "10 2026", "12-08"] {
        let result = try snapshot([card("c", expiry: past)])
        check("past expiry '\(past)' leaves the card out", result.grant.cards.isEmpty && result.leftOut == 0)
    }
    // Parsed and not past.
    for (text, month) in [("11/26", "2026-11"), ("08/30", "2030-08"), ("0830", "2030-08"), ("8/30", "2030-08"), ("08/2030", "2030-08"),
                          ("2030-08", "2030-08"), ("08 30", "2030-08"), (" 08/30\n", "2030-08"), ("203008", "2030-08")] {
        check("readable expiry '\(text)'", try snapshot([card("c", expiry: text)]).grant.cards.map(\.expiry) == [month])
    }
    // No digit at all: the card goes in without an expiry.
    for text in ["", "   ", "soon", "N/A", "?", "never", "January", "mm/yy"] {
        let result = try snapshot([card("c", expiry: text)])
        check("expiry '\(text)' is absent", result.grant.cards.map(\.expiry) == [nil] && result.leftOut == 0)
    }
    // Any other text with a digit in it: the card is left out and counted, whether the date meant is past or not.
    for text in ["19-01-31", "26/10/31", "15-01-28", "30-01-31", "01/30 may be replaced", "08/30 (mar)", "08/30 (old)", "exp 0119",
                 "exp 08/30", "310119", "311230", "janv. 19", "01/19 v2", "Jan 2019", "Jan 2030", "January 2030", "May 25", "31 January 2030",
                 "2019-01-31", "2030-01-31", "01/31/2019", "01/31/2030", "31.01.19", "31.01.30", "20190131", "20300131",
                 "2019-01-31T00:00:00Z", "2030-01-31T00:00:00Z", "2019-01-31 00:00", "2019/1/31", "1/1999", "01/19 - 01/30", "01/30 - 01/19",
                 "01/02/2030", "13/2030", "00/30", "2030", "2019", "19", "1", "08/30/", "08//30x", "08\n30", "good until 2030",
                 "janvāris 2019", "２０１９－０１－３１", "０１／１９", "０８／３０", "٠٨/٣٠", "二〇一九", "Ⅷ/ⅩⅩⅩ", "²⁰¹⁹", "①",
                 String(repeating: "9", count: 5_000), String(repeating: "1/", count: 5_000)] where CardExpiry.parse(text) == nil {
        let result = try snapshot([card("c", expiry: text)])
        check("unreadable expiry '\(text.prefix(40))' leaves the card out", result.grant.cards.isEmpty && result.leftOut == 1)
    }
    check("the reproductions are all unreadable to the app's parser", ["19-01-31", "26/10/31", "15-01-28", "01/30 may be replaced",
        "08/30 (mar)", "2019-01-31T00:00:00Z", "exp 0119", "310119", "janv. 19", "01/19 v2"].allSatisfy { CardExpiry.parse($0) == nil })

    for code in ["12", "12345", "12a", "1 23", "914 / 123", "１２３", "see note", "   "] {
        check("a code that is not 3 or 4 digits is omitted", try snapshot([card("c", code: code)]).grant.cards.map(\.securityCode) == [nil])
    }
    check("a code is trimmed", try snapshot([card("c", code: " 1234\n")]).grant.cards.first?.securityCode == "1234")

    for number in ["4111111111111111\n914", "4111111111111111\r\n914", "4111111111111111\u{2028}914", "4111111111111111\t914",
                   "4111111111111111 914", "4111111111111111-914", "914 4111111111111111", "4111111111111111\n", "\n4111111111111111",
                   " 4111111111111111", "4111111111111111 ", "4111  1111 1111 1111", "4111--1111-1111-1111", "4111 - 1111 - 1111 - 1111",
                   "4111-1111 1111-1111", "4111\u{00A0}1111\u{00A0}1111\u{00A0}1111", "4111.1111.1111.1111", "-4111111111111111",
                   // Luhn
                   "4111111111111112", "4111 1111 1111 1112", "1234567890123456",
                   // unlisted groupings
                   "4111 1111 1111 1111 914", "4111 1111 1111 1111 003", "4111-1111-1111-1111-3", "3782 822463 10005 123",
                   "914 4111 1111 1111 1111", "41111111 11111111", "4111 11111111 1111", "5000 0000 0009",
                   // 12 to 14 digits with a tail
                   "500000000009 123", "500000000009 1234", "500000000009-914", "5000 0000 0009 123", "5000 0000 0009 12",
                   "30569309025904 123", "3056 930902 5904 123", "4111111111111 123", "4111 1111 1111 1 123",
                   // a 12-digit number and a code that look like 16 digits
                   "5000 0000 0009 0000"] {
        let result = try snapshot([card("c", number: number)])
        check("number '\(number)' is left out", result.grant.cards.isEmpty && result.leftOut == 1)
    }
    for number in ["4111111111111111", "500000000009", "4111111111111111003", "4111 1111 1111 1111", "5555-5555-5555-4444",
                   "3782 822463 10005", "3056-930902-5904", "6212 3456 7890 1200 008", "621234 5678901234569",
                   "4111 1111 1117 0000", "5000 0000 0001 1113"] {
        check("number '\(number)' is read", try snapshot([card("c", number: number)]).grant.cards.map(\.number) == [number.filter(\.isNumber)])
    }

    // One identifier on two items.
    let one = card("first"), other = address("Home")
    var twin = card("second", number: "5555555555554444")
    twin = VaultItem(id: one.id, kind: .creditCard, title: "second", secret: twin.secret)
    var otherTwin = VaultItem(id: other.id, kind: .address, title: "Work", account: "Robin Fictional")
    otherTwin.address.city = "Elsewhere"
    let repeated = try snapshot([one, twin, other, otherTwin, card("alone")])
    check("neither of two cards or addresses with one identifier", repeated.grant.cards.map(\.title) == ["alone"] && repeated.grant.addresses.isEmpty)
    let across = try snapshot([one, VaultItem(id: one.id, kind: .login, title: "login"), VaultItem(id: other.id, kind: .secureNote), other])
    check("an identifier shared with another kind leaves it out too", across.grant.cards.isEmpty && across.grant.addresses.isEmpty)
    check("and the grant still encodes", (try? repeated.grant.encoded()) != nil)

    // The entry's own expiry.
    func expiring(_ item: VaultItem, at date: Date) -> VaultItem {
        VaultItem(id: item.id, kind: item.kind, title: item.title, account: item.account, secret: item.secret, expiry: item.expiry, expires: date)
    }
    let issued = Date(timeIntervalSince1970: Double(clock.wall) / 1000)
    check("an expired entry is left out", try snapshot([expiring(card("c"), at: issued), expiring(address("a"), at: .distantPast)]).grant.hasNoEntries)
    check("an entry expiring later is kept", try snapshot([expiring(card("c"), at: issued.addingTimeInterval(1))]).grant.cards.count == 1)

    check("empty code is absent", dated.grant.cards.first { $0.title == "none" }?.securityCode == nil)
    check("the card expires when its month ends", try snapshot([card("c", expiry: "11/26")], at: TestClock(wall: 1_796_100_000_000, continuous: 1)).grant.cards.isEmpty)

    // Numbers that cannot be filled as written.
    let numbers = try snapshot(["", "1234", "41111111111111111111", "4111111111111111 exp 08", "4111.1111.1111.1111", "４１１１１１１１１１１１１１１１"]
        .map { card("n", number: $0) })
    check("unusable numbers left out and counted", numbers.grant.cards.isEmpty && numbers.leftOut == 6)

    // Concealed fields.
    var hidden = card("\(secretMarker)-title")
    hidden.account = "\(secretMarker)-holder"
    hidden.concealedFields = ["title", "account", "expiry", "secret", "securityCode"]
    let fromHidden = try snapshot([hidden])
    check("concealed card fields", fromHidden.grant.cards.first.map {
        $0.title.isEmpty && $0.cardholder.isEmpty && $0.expiry == nil && $0.number.count == 16 && $0.securityCode == "914"
    } == true)
    check("concealed card bytes", !String(decoding: try fromHidden.grant.encoded(), as: UTF8.self).contains(secretMarker))
    var expiredHidden = card("c", expiry: "01/20")
    expiredHidden.concealedFields = ["expiry"]
    check("a concealed past expiry still excludes", try snapshot([expiredHidden]).grant.cards.isEmpty)
    var secretPlace = loaded(.address, title: "\(secretMarker)-label")
    secretPlace.concealedFields = ["title", "account", "addressOrganization", "addressStreet", "addressCity", "addressRegion",
                                   "addressPostalCode", "addressCountry", "addressEmail", "addressPhone"]
    check("a wholly concealed address is left out", try snapshot([secretPlace]).grant.addresses.isEmpty)
    var partly = address("Home")
    partly.address.phone = "\(secretMarker)-phone"
    partly.concealedFields = ["addressPhone"]
    let fromPartly = try snapshot([partly])
    check("one concealed address field", fromPartly.grant.addresses.first.map { $0.phone.isEmpty && $0.city == "Exampleton" } == true)
    check("an address with only a label is left out", try snapshot([VaultItem(kind: .address, title: "Empty")]).grant.addresses.isEmpty)
    let unnamed = try snapshot([address("")])
    check("an unnamed address has no label made from its street", unnamed.grant.addresses.first?.label == "")

    // A real document: protected fields as the codec reads them, and Recently Deleted.
    let document = try KDBX.create(name: "Test", credentials: .init(password: "fictional"), kdf: .aesForTesting(rounds: 100))
    let kept = card("Kept"), gone = card("\(secretMarker)-gone"), goneAddress = address("\(secretMarker)-gone-address"), home = address("Home")
    document.upsert([kept, gone, goneAddress, home] + others)
    document.moveToRecycleBin([gone.id, goneAddress.id])
    check("the deleted items are in the bin", document.recycledItems().count == 2)
    let real = try snapshot(document.items())
    check("deleted cards and addresses left out", real.grant.cards.map(\.id) == [kept.id] && real.grant.addresses.map(\.id) == [home.id])
    check("a stored card arrives whole", real.grant.cards.first.map {
        $0.number == "4111111111111111" && $0.securityCode == "914" && $0.cardholder == "Robin Fictional" && $0.expiry == "2030-08"
    } == true)
    check("a stored address arrives whole", real.grant.addresses.first?.strings.contains("") == false)
    // KeePass entry expiry, as the codec reads it from the file.
    func setTimes(_ id: UUID, _ flag: String, _ time: String) {
        let times = document.locations().first { EntryMapping.uuid(of: $0.entry) == id }!.entry.child("Times")!
        times.child("Expires")!.text = flag
        times.child("ExpiryTime")!.text = time
    }
    for (flag, time, offered) in [("True", "2019-01-01T00:00:00Z", false), ("true", "2019-01-01T00:00:00Z", false), ("True", "garbled", false),
                                  ("True", "2090-01-01T00:00:00Z", true), ("False", "2019-01-01T00:00:00Z", true), ("null", "garbled", true)] {
        setTimes(kept.id, flag, time)
        setTimes(home.id, flag, time)
        let result = try snapshot(document.items())
        check("entry expiry \(flag) \(time)", result.grant.cards.count == (offered ? 1 : 0) && result.grant.addresses.count == (offered ? 1 : 0))
    }
    setTimes(kept.id, "False", "2019-01-01T00:00:00Z")
    setTimes(home.id, "False", "2019-01-01T00:00:00Z")

    check("nothing excluded from a real vault", !String(decoding: try real.grant.encoded(), as: UTF8.self).contains(secretMarker))

    // Hostile text is data: stored as it is, bounded, and cleaned where it is shown.
    var nasty = card(hostile)
    nasty.account = hostile
    let nastyResult = try snapshot([nasty, address(hostile, name: hostile)], name: hostile)
    let back = try SafariFillGrant.decode(try nastyResult.grant.encoded())
    check("hostile text round trips", back.cards.first?.title == hostile && back.addresses.first?.fullName == hostile && back.vault.name == hostile)
    let longName = try snapshot([], name: String(repeating: "é\u{202E}", count: 100_000))
    check("a huge vault name is cut", longName.grant.vault.name.unicodeScalars.count == 512 && (try? longName.grant.encoded()) != nil)

    // Order.
    var older = card("A older"), newer = card("Z newer")
    older.lastUsed = Date(timeIntervalSince1970: 1_000)
    newer.lastUsed = Date(timeIntervalSince1970: 2_000)
    check("recently used first, then by name", try snapshot([card("C"), older, card("B"), newer]).grant.cards.map(\.title) == ["Z newer", "A older", "B", "C"])

    // Caps.
    let many = try snapshot((0..<150).map { card("c\($0)") } + (0..<130).map { address("a\($0)", name: "n") }.map {
        var item = $0; item.address = PostalAddress(city: "x"); return item
    })
    check("at most 100 of each", many.grant.cards.count == 100 && many.grant.addresses.count == 100 && many.leftOut == 80)
    let long = String(repeating: "a", count: 513), exact = String(repeating: "a", count: 512)
    var longHolder = card("long holder"), longStreet = address("long street")
    longHolder.account = long
    longStreet.address.street = long
    var exactCard = card(exact)
    exactCard.account = exact
    let lengths = try snapshot([card(long), longHolder, longStreet, exactCard])
    check("an item with a long value is left out whole", lengths.grant.cards.map(\.id) == [exactCard.id] && lengths.grant.addresses.isEmpty && lengths.leftOut == 3)
    check("512 is not cut", lengths.grant.cards.first?.title == exact)

    let wide = (0..<100).map { index -> VaultItem in
        var item = address("a\(index)", name: String(repeating: "漢", count: 400))
        item.address.street = String(repeating: "/", count: 500)
        item.address.city = String(repeating: "\u{1}", count: 100)
        return item
    }
    let bulk = wide + (0..<100).map { card(String(repeating: "t", count: 500) + "\($0)") }
    let full = try snapshot(bulk)
    let fullBytes = try full.grant.encoded()
    check("within 64 KiB", fullBytes.count <= SafariFillGrant.maxBytes)
    check("filled nearly to the cap", fullBytes.count > SafariFillGrant.maxBytes - 4_000)
    check("the rest counted", full.leftOut == 200 - full.grant.cards.count - full.grant.addresses.count && full.leftOut > 0)
    check("neither kind crowds out the other", !full.grant.cards.isEmpty && !full.grant.addresses.isEmpty)
    let sources = Dictionary(uniqueKeysWithValues: bulk.map { ($0.id, $0) })
    check("every included item is whole", full.grant.addresses.allSatisfy {
        $0.fullName == sources[$0.id]?.account && $0.street == sources[$0.id]?.address.street && $0.city == sources[$0.id]?.address.city
    } && full.grant.cards.allSatisfy { $0.title == sources[$0.id]?.title })
    // Every size near the cap, one character at a time, so the running size is exact.
    var exactFit = true
    for extra in 0..<80 {
        var items = (0..<41).map { card(String(repeating: "t", count: 500) + "\($0)") }
        items.append(card(String(repeating: "u", count: extra * 6)))
        let result = try? snapshot(items)
        exactFit = exactFit && result.map { $0.grant.cards.count + $0.leftOut == 42 } == true && (try? result?.grant.encoded()) != nil
    }
    check("sizes at the edge never overflow the cap", exactFit)

    // Secrecy: errors, descriptions and dumps.
    let errors: [SafariFillError] = [.storeUnavailable, .saveFailed, .deleteFailed, .overCap, .unreadable, .unknownVersion, .expired, .clockChanged, .vaultNotListed, .revoked]
    check("errors carry no values", errors.allSatisfy { Mirror(reflecting: $0).children.isEmpty })
    let marked = try snapshot([card("\(secretMarker)-t"), address("\(secretMarker)-l", name: "\(secretMarker)-n")], name: "\(secretMarker)-v")
    var printed = ""
    let stored = SafariFillStoredItem(data: try marked.grant.encoded(), grantID: marked.grant.grantID)
    for value in [marked.grant, marked.grant.vault, marked.grant.cards[0], marked.grant.addresses[0], stored] as [Any] {
        printed += "\(value) \(String(reflecting: value))"
        dump(value, to: &printed)
    }
    dump(marked, to: &printed)
    check("descriptions and dumps are redacted", !printed.contains(secretMarker) && !printed.contains("4111") && !printed.contains("914)") && !printed.contains("Exampleton"))
    let damaged = Data(String(decoding: stored.data, as: UTF8.self).replacingOccurrences(of: "\"cards\":[", with: "\"cards\":7,\"x\":[").utf8)
    do { _ = try SafariFillGrant.decode(damaged); check("damaged grant refused", false) } catch {
        let message = "\(error) \(String(reflecting: error)) \(error.localizedDescription)"
        check("decode errors quote nothing", !message.contains(secretMarker) && !message.contains("4111"))
    }
}

print("safari fill: \(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
