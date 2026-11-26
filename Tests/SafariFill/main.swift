import Foundation
import Security

// Hostless checks for the Safari fill grant (docs/plans/ios-safari-fill.md, slices 1 and 2). Run with scripts/test-safari-fill.sh.
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
    let unlisted = MemoryStore()
    unlisted.stored = whole
    check("an unlisted vault is refused", thrown { _ = try unlisted.current(clock: clock, listedVaults: []) } == .vaultNotListed)
    check("and its grant kept", unlisted.stored == whole)
    check("in time whatever its vault", try unlisted.inTime(clock: clock) == grant)
    check("unlisted and out of time is deleted", thrown { _ = try unlisted.current(clock: clock.later(120_000), listedVaults: []) } == .expired
          && unlisted.stored == nil)
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

// MARK: Handler protocol: origins

do {
    func allowed(_ origin: String, loopback: Bool = false) -> Bool { SafariFillOrigin.isAllowed(origin, allowsLoopbackHTTP: loopback) }
    for origin in ["https://shop.example", "https://shop.example:8443", "https://a.b.c.example.", "https://xn--bcher-kva.example",
                   "https://127.0.0.1", "https://[::1]:9000", "https://[2001:db8::1]", "https://localhost", "https://my_host.example:65535"] {
        check("origin allowed", allowed(origin))
    }
    for origin in ["", "https://", "https:///", "https://:443", "http://shop.example", "ftp://shop.example", "file:///etc/passwd",
                   "shop.example", "//shop.example", "https:shop.example", "HTTPS://shop.example", "https://Shop.example",
                   "https://user@shop.example", "https://user:pass@shop.example", "https://@shop.example", "https://shop.example/",
                   "https://shop.example/pay", "https://shop.example?q=1", "https://shop.example#a", "https://shop.example\\@evil.example",
                   "https://shop.example ", " https://shop.example", "https://shop.example\n", "https://shop.example\0", "https://shop%2eexample",
                   "https://b\u{00FC}cher.example", "https://shop\u{202E}.example", "https://.", "https://..", "https://a..b", "https://.a",
                   "https://shop.example:", "https://shop.example:0", "https://shop.example:080", "https://shop.example:65536",
                   "https://shop.example:123456", "https://shop.example:1a", "https://shop.example:-1", "https://shop.example:1:2",
                   "https://[]", "https://[::1", "https://::1", "https://[example]", "https://[::1]x", "https://[::1]]", "null",
                   "about:blank", "data:text/html,x", "https://" + String(repeating: "a", count: 254),
                   "https://" + String(repeating: "a.", count: 100_000)] {
        check("origin refused", !allowed(origin) && !allowed(origin, loopback: true))
    }
    check("host of 253", allowed("https://" + String(repeating: "a", count: 253)))
    for origin in ["https://shop.example:443", "https://127.0.0.1:443", "https://[::1]:443", "https://127.1", "https://2130706433",
                   "https://0x7f.0.0.1", "https://127.0.0.0x1", "https://127.0.0.01", "https://256.0.0.1", "https://1.2.3.4.",
                   "https://1.2.3.4.5", "https://shop.123", "https://shop.0x1f", "https://[::ffff:127.0.0.1]", "https://[0::1]x",
                   "https://[00::1]", "https://[::01]", "https://[1::2::3]", "https://[1:2:3]", "https://[1:2:3:4:5:6:7:8:9]",
                   "https://[1:2:3:4:5:6:7::8]", "https://[:::]", "https://[:1:2:3:4:5:6:7]", "https://[12345::]", "https://[.]"] {
        check("a form a browser never writes", !allowed(origin) && !allowed(origin, loopback: true))
    }
    check("default HTTP port", !allowed("http://localhost:80", loopback: true) && allowed("http://localhost:443", loopback: true))
    for origin in ["https://1.2.3.4", "https://255.255.255.255:80", "https://123.example", "https://0x1.example", "https://[::]",
                   "https://[1:2:3:4:5:6:7:8]", "https://[::ffff:7f00:1]", "https://[fe80::]"] {
        check("a browser's numeric host", allowed(origin))
    }
    for origin in ["http://localhost", "http://localhost:5173", "http://127.0.0.1:8080", "http://[::1]:3000"] {
        check("loopback HTTP only when allowed", allowed(origin, loopback: true) && !allowed(origin))
    }
    for origin in ["http://localhost.evil.example", "http://127.0.0.1.evil.example", "http://127.0.0.2", "http://[::2]", "http://localhost.",
                   "http://a.localhost", "http://localhost@evil.example", "http://0.0.0.0"] {
        check("not loopback", !allowed(origin, loopback: true))
    }
    check("a build without DEBUG takes no HTTP", !SafariFillOrigin.loopbackHTTPByDefault)
}

// MARK: Handler protocol: text shown before a release

/// The digits of any script a text still shows.
func shownDigits(_ text: String) -> Int {
    text.precomposedStringWithCompatibilityMapping.unicodeScalars.filter { $0.properties.numericType != nil }.count
}

do {
    let line = SafariFillText.line
    for text in ["Travel card", "Visa 2030", "Flat 12, 1 Nowhere Lane", "Riga LV-1010", "1234567", "Caf\u{00E9} \u{4F60}\u{597D}", ""] {
        check("ordinary text stays", line(text) == text)
    }
    check("eight digits are masked", line("12345678") == "\u{2022}\u{2022}\u{2022}\u{2022}5678")
    check("plain number", line("4111111111111111") == String(repeating: "\u{2022}", count: 12) + "1111")
    check("spaced", line("Card 4111 1111 1111 1234 spare") == "Card \u{2022}\u{2022}\u{2022}\u{2022} \u{2022}\u{2022}\u{2022}\u{2022} \u{2022}\u{2022}\u{2022}\u{2022} 1234 spare")
    check("dashed", line("5555-5555-5555-4444") == "\u{2022}\u{2022}\u{2022}\u{2022}-\u{2022}\u{2022}\u{2022}\u{2022}-\u{2022}\u{2022}\u{2022}\u{2022}-4444")
    func scripted(_ zero: UInt32) -> String {
        String(String.UnicodeScalarView("4111111111111111".unicodeScalars.map { Unicode.Scalar(zero + $0.value - 48)! }))
    }
    var disguises = [scripted(0xFF10), scripted(0x0660), scripted(0x06F0), scripted(0x0966), scripted(0x0E50), scripted(0x1D7CE)]
    disguises += [
        "4111.1111.1111.1111", "4111/1111/1111/1111", "4111_1111_1111_1111", "4111,1111;1111|1111", "4111\n1111\r1111\t1111",
        "4111\u{00A0}1111\u{2009}1111\u{3000}1111", "4111\u{200B}1111\u{200D}1111\u{FEFF}1111", "4111\u{202E}1111\u{2066}1111\u{200F}1111",
        "4111 - 1111 \u{2013} 1111 \u{2014} 1111", "4111abc1111def1111ghi1111", "n\u{00B0}4111 (exp) 1111 [x] 1111 {y} 1111",
        "4\u{0301}1\u{0301}1\u{0301}1\u{0301}1111 1111 1111", "4\u{FE0F}\u{20E3}1111111 1111 1111",
        "\u{2463}\u{2460}\u{2460}\u{2460} \u{2460}\u{2460}\u{2460}\u{2460} \u{2460}\u{2460}\u{2460}\u{2460}",
        "\u{2074}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}\u{00B9}",
        "\u{56DB}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}\u{4E00}",
        String(repeating: "\u{3251}", count: 8), String(repeating: "\u{00BD}", count: 8), String(repeating: "\u{2491}", count: 8),
        "4111111" + String(repeating: " ", count: 3000) + "111111111", "4111111" + String(repeating: "x", count: 5000) + "111111111",
        String(repeating: "\u{200B}", count: 4090) + "4111111111111111", String(repeating: "x", count: 70) + "4111111111111111",
        "x" + String(repeating: "\u{0301}", count: 500) + "4111111111111111",
    ]
    for (index, text) in disguises.enumerated() {
        let result = line(text)
        // Past the length that is read, nothing numeric is shown at all.
        check("disguised number \(index)", shownDigits(result) <= (text.unicodeScalars.count > SafariFillText.maxInput ? 0 : 4))
    }
    check("an over-long text shows no digit", shownDigits(line("12 " + String(repeating: "x", count: 5000))) == 0)
    check("one line", line(" a\u{2028}b\u{2029}c\r\nd\te ") == "a b c d e")
    check("nothing invisible or reordering", line("a\u{202E}b\u{2067}c\u{200B}d\u{0007}e\u{E000}f\u{FFFC}g\u{E0041}h\u{00AD}i") == "abcdefghi")
    check("only invisible text is empty", line("\u{200B}\u{202E} \u{FEFF}\u{0301}") == "")
    check("path text is just text", line("../../etc/passwd") == "../../etc/passwd")
    for text in [String(repeating: "a", count: 100_000), String(repeating: "\u{1F468}\u{200D}\u{1F469}", count: 500),
                 "a" + String(repeating: "\u{0301}", count: 100_000), String(repeating: "\u{1100}", count: 5000),
                 String(repeating: "e\u{0301}\u{0301}\u{0301}\u{0301}", count: 200), String(repeating: "\u{0600}", count: 300) + "a"] {
        let result = line(text)
        check("cut short", result.count <= SafariFillText.maxCharacters && result.unicodeScalars.count <= SafariFillText.maxScalars)
    }
    // The texts of a row are counted together.
    let row = SafariFillText.row
    check("a few digits across a row stay", row(["Flat 12", "Robin", "LV-1010"], 0) == ["Flat 12", "Robin", "LV-1010"])
    check("a number split across a row", row(["411111", "1111 11", "city 1234"], 0)
          == ["\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}", "\u{2022}\u{2022}\u{2022}\u{2022} \u{2022}\u{2022}", "city 1234"])
    check("the last four of a row may span texts", row(["1234567", "8", "9"], 0) == ["\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}67", "8", "9"])
    check("digits shown elsewhere take the room", row(["4111", "1111"], 4) == ["\u{2022}\u{2022}\u{2022}\u{2022}", "\u{2022}\u{2022}\u{2022}\u{2022}"])
    check("and count towards the limit", row(["Card 2", "x 3"], 4) == ["Card 2", "x 3"])
    check("one cut text masks its row", row(["12", String(repeating: "a", count: 5000)], 0)[0] == "\u{2022}\u{2022}")
    check("exactly 80 is not cut", line(String(repeating: "a", count: 80)) == String(repeating: "a", count: 80))
    check("81 is cut", line(String(repeating: "a", count: 81)) == String(repeating: "a", count: 79) + "\u{2026}")
    var generator = SystemRandomNumberGenerator()
    check("random text never shows more than it may", (0..<3000).allSatisfy { _ in
        let pool: [Unicode.Scalar] = ["0", "1", "9", " ", "-", ".", "a", "\u{200B}", "\u{202E}", "\u{0301}", "\u{FF14}", "\u{0664}", "\u{2463}", "\u{3251}"]
        let text = String(String.UnicodeScalarView((0..<Int.random(in: 0...120, using: &generator)).map { _ in pool.randomElement(using: &generator)! }))
        let digits = shownDigits(line(text))
        return digits <= (digits > 0 && shownDigits(text) > 7 ? 4 : 7)
    })
}

// MARK: Handler protocol: the stored vault list

struct StoredVaults: SafariFillVaultSource {
    var values: [String: Any] = [:]
    func object(forKey key: String) -> Any? { values[key] }
}
func json(_ value: some Encodable) -> Data { try! JSONEncoder().encode(value) }
/// Answers as each source in turn, moving on when the active vault is asked for again: what the app changes between two readings.
final class ChangingVaults: SafariFillVaultSource {
    private let sources: [StoredVaults]
    private var readings = 0
    var onSecond: (() -> Void)?
    init(_ sources: [StoredVaults]) { self.sources = sources }
    func object(forKey key: String) -> Any? {
        if key == SafariFillVaultList.activeKey {
            readings += 1
            if readings == 2 { onSecond?() }
        }
        return sources[min(max(readings, 1), sources.count) - 1].object(forKey: key)
    }
}

do {
    typealias List = SafariFillVaultList
    check("no source", thrown { _ = try List(source: nil).vaults() } == .storeUnavailable)
    check("nothing stored", try List(source: StoredVaults()).vaults().isEmpty)

    // What the app itself writes, through its own code into the test root.
    let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PSSS_TEST_ROOT"]!, isDirectory: true)
    var first = VaultReference(name: "First", managed: true, bookmark: nil, fileName: "a.kdbx")
    first.biometricUnlock = true
    let second = VaultReference(name: "Second", managed: false, bookmark: Data(count: 4000), fileName: "b.kdbx")
    let third = VaultReference(name: "Third", managed: true, bookmark: nil, fileName: "c.kdbx")
    let gone = VaultReference(name: "Gone", managed: true, bookmark: nil, fileName: "d.kdbx")
    for reference in [first, second, gone, third] { reference.persist() }
    VaultReference.forget(gone.id)
    VaultReference.activate(second.id)
    var stored = StoredVaults()
    for (key, file) in [(List.activeKey, "vault-reference.json"), (List.rememberedKey, "vault-references-remembered.json"),
                        (List.forgottenKey, "vault-reference-forgotten.json"), (List.orderKey, "vault-order.json")] {
        stored.values[key] = try Data(contentsOf: root.appendingPathComponent(file))
    }
    let decoded = try List(source: stored).vaults()
    check("matches what the app lists", decoded == VaultReference.all.map { SafariFillListedVault(id: $0.id, name: $0.name) })
    check("in the fixed order", decoded.map(\.name) == ["First", "Second", "Third"])

    // What a reader can catch while the app switches vaults: the chosen one in neither key, and nothing says it was removed.
    var between = stored
    between.values[List.rememberedKey] = json(VaultReference.remembered.filter { $0.id != first.id })
    let caught = try List(source: between).contents()
    check("mid-switch it is neither listed nor forgotten", !caught.listed.contains { $0.id == first.id } && !caught.forgotten.contains(first.id))
    check("a removed one is forgotten", caught.forgotten == [gone.id])
    let held = MemoryStore()
    let mine = SafariFillGrant(vault: .init(id: first.id, name: "First"), cards: [sampleCard()], clock: clock)
    try held.write(mine)
    let midway = SafariFillHandler(store: held, vaults: List(source: between), clock: clock).reply(to: ["v": 1, "type": "status", "origin": "https://shop.example"])
    check("mid-switch: nothing shown, grant kept", midway.refusal == nil && (midway.message["cards"] as? [Any])?.isEmpty == true
          && held.stored?.grantID == mine.grantID)

    let a = UUID(), b = UUID()
    func entry(_ id: UUID, _ name: String) -> [String: String] { ["id": id.uuidString, "name": name] }
    let both: [String: Any] = [List.activeKey: json(entry(a, "A")), List.rememberedKey: json([entry(b, "B"), entry(a, "again")])]
    check("one entry for each identifier", try List(source: StoredVaults(values: both)).vaults().map(\.name) == ["A", "B"])
    var forgotten = both
    forgotten[List.forgottenKey] = json([a.uuidString])
    check("a forgotten vault is not listed", try List(source: StoredVaults(values: forgotten)).vaults().map(\.id) == [b])
    for order in [Data("junk".utf8), json([b.uuidString, b.uuidString, "x"])] {
        var values = both
        values[List.orderKey] = order
        check("a bad order never loses a vault", try Set(List(source: StoredVaults(values: values)).vaults().map(\.id)) == [a, b])
    }
    for key in [List.activeKey, List.rememberedKey, List.forgottenKey] {
        for bad: Any in [Data("junk".utf8), Data(), Data("{}".utf8 + [0]), "text", 7, [1, 2], Data(count: List.maxBytes + 1),
                         json([["name": "no identifier"]]), json(["id": "nope", "name": "x"])] {
            var values = both
            values[key] = bad
            check("damaged \(key)", thrown { _ = try List(source: StoredVaults(values: values)).vaults() } == .unreadable)
        }
    }
}

// MARK: Handler protocol: requests and replies

let shop = "https://shop.example"
let otherVault = UUID()
/// Values that only a release may carry.
let secretNumber = "4111111111111111", secretCode = "914"
let privateValues = [secretNumber, secretCode, "1 Nowhere Lane", "Flat 2", "Northshire", "EX1 2PL", "robin@example.invalid", "+44 0000 000000", "Acme Example"]

func vaultSource(_ vaults: [(UUID, String)] = [(vaultID, "Passwords"), (otherVault, "Work")]) -> SafariFillVaultList {
    let entries = vaults.map { ["id": $0.0.uuidString, "name": $0.1] }
    var values: [String: Any] = [:]
    if let active = entries.first { values[SafariFillVaultList.activeKey] = json(active) }
    values[SafariFillVaultList.rememberedKey] = json(Array(entries.dropFirst()))
    return SafariFillVaultList(source: StoredVaults(values: values))
}
func handler(_ store: (any SafariFillStore)?, at: TestClock = clock, vaults: SafariFillVaultList = vaultSource()) -> SafariFillHandler {
    SafariFillHandler(store: store, vaults: vaults, clock: at, allowsLoopbackHTTP: false)
}
func statusRequest(_ origin: Any = shop) -> [String: Any] { ["v": 1, "type": "status", "origin": origin] }
func releaseRequest(_ ref: String, kind: String = "card", roles: Any? = nil, vault: UUID = vaultID, origin: String = shop) -> [String: Any] {
    ["v": 1, "type": "release", "origin": origin, "vault": vault.uuidString, "kind": kind, "ref": ref,
     "roles": roles ?? (kind == "card" ? ["cc-name", "cc-number", "cc-exp", "cc-csc"] : ["name", "postal-code"])]
}
/// Every reply goes through here: it must be sendable, and a refusal must be nothing but its word.
func answer(_ handler: SafariFillHandler, _ message: Any?) -> SafariFillHandler.Reply {
    let reply = handler.reply(to: message)
    check("the reply is JSON", JSONSerialization.isValidJSONObject(reply.message) && reply.message["v"] as? Int == 1)
    if let refusal = reply.refusal {
        check("a refusal is only its word", Set(reply.message.keys) == ["v", "ok", "error"] && reply.message["ok"] as? Bool == false
              && reply.message["error"] as? String == refusal.rawValue)
    } else {
        check("an answer says ok", reply.message["ok"] as? Bool == true && reply.message["error"] == nil)
    }
    var printed = "\(reply) \(String(reflecting: reply))"
    dump(reply, to: &printed)
    check("a reply prints redacted", privateValues.allSatisfy { !printed.contains($0) } && !printed.contains("Robin"))
    return reply
}
func text(_ reply: SafariFillHandler.Reply) -> String {
    String(decoding: try! JSONSerialization.data(withJSONObject: reply.message, options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
}
func rows(_ reply: SafariFillHandler.Reply, _ key: String) -> [[String: Any]] { reply.message[key] as? [[String: Any]] ?? [] }
func ref(_ reply: SafariFillHandler.Reply, _ key: String, _ index: Int = 0) -> String { rows(reply, key)[index]["ref"] as! String }
/// Status with the random references taken out, so a digit in an identifier is not read as a leak.
func withoutRefs(_ reply: SafariFillHandler.Reply) -> String {
    var result = text(reply)
    for key in ["cards", "addresses", "vaults"] {
        for row in rows(reply, key) {
            for name in ["ref", "id"] { if let value = row[name] as? String { result = result.replacingOccurrences(of: value, with: "-") } }
        }
    }
    return result
}

do {
    let store = MemoryStore()
    let grant = sampleGrant()
    try store.write(grant)
    let h = handler(store)

    let status = answer(h, statusRequest())
    check("status type", status.type == "status" && status.refusal == nil)
    check("status keys", Set(status.message.keys) == ["v", "ok", "vaults", "cards", "addresses"])
    check("vaults ready or locked", rows(status, "vaults").map { "\($0["name"]!) \($0["ready"] as! Bool)" } == ["Passwords true", "Work false"])
    check("card row keys", Set(rows(status, "cards")[0].keys) == ["ref", "title", "brand", "lastFour", "expiry", "hasCode"])
    let cardRow = rows(status, "cards")[0]
    check("card row values", cardRow["title"] as? String == "Travel card" && cardRow["brand"] as? String == "Visa"
          && cardRow["lastFour"] as? String == "1111" && cardRow["expiry"] as? String == "2030-08" && cardRow["hasCode"] as? Bool == true)
    check("address row keys", Set(rows(status, "addresses")[0].keys) == ["ref", "label", "fullName", "city"])
    let addressRow = rows(status, "addresses")[0]
    check("address row values", addressRow["label"] as? String == "Home" && addressRow["fullName"] as? String == "Robin Fictional"
          && addressRow["city"] as? String == "Exampleton")
    check("status holds nothing private", (privateValues + ["GB\""]).allSatisfy { !withoutRefs(status).contains($0) })
    check("a status does not use the grant up", answer(h, statusRequest()).message.count == 5 && store.stored != nil)

    let cardRef = ref(status, "cards"), addressRef = ref(status, "addresses")
    check("reference carries the grant", SafariFillRef(cardRef)?.grantID == grant.grantID && SafariFillRef(cardRef)?.item == grant.cards[0].id)

    // Release: exactly the roles asked for.
    func fields(_ reply: SafariFillHandler.Reply) -> [String: String]? { reply.message["fields"] as? [String: String] }
    let card = answer(h, releaseRequest(cardRef))
    check("release type", card.type == "release" && Set(card.message.keys) == ["v", "ok", "fields"])
    check("card release", fields(card) == ["cc-name": "Robin Fictional", "cc-number": secretNumber, "cc-exp": "2030-08", "cc-csc": secretCode])
    check("only the asked role", fields(answer(h, releaseRequest(cardRef, roles: ["cc-number"]))) == ["cc-number": secretNumber])
    check("month and year release the expiry", fields(answer(h, releaseRequest(cardRef, roles: ["cc-exp-month", "cc-exp-year"]))) == ["cc-exp": "2030-08"])
    let whole: [String: String] = [
        "name": "Robin Fictional", "organization": "Acme Example", "street-address": "1 Nowhere Lane\nFlat 2", "address-level2": "Exampleton",
        "address-level1": "Northshire", "postal-code": "EX1 2PL", "country": "GB", "email": "robin@example.invalid", "tel": "+44 0000 000000"]
    let allRoles = Array(SafariFillKind.address.roles.keys)
    check("address release", fields(answer(h, releaseRequest(addressRef, kind: "address", roles: allRoles))) == whole)
    for (role, key) in SafariFillKind.address.roles {
        check("address role \(role)", fields(answer(h, releaseRequest(addressRef, kind: "address", roles: [role]))) == [key: whole[key]!])
    }
    for (role, key) in SafariFillKind.card.roles {
        check("card role \(role)", fields(answer(h, releaseRequest(cardRef, roles: [role]))).map { Set($0.keys) } == [key])
    }

    // The roles are those the page fill names.
    let script = try String(contentsOfFile: "Extensions/Browser/src/page-fill.js", encoding: .utf8)
    func pageRoles(_ name: String) -> Set<String> {
        guard let start = script.range(of: "const \(name) = {"), let end = script.range(of: "};", range: start.upperBound..<script.endIndex) else { return [] }
        let block = String(script[start.upperBound..<end.lowerBound])
        let pattern = try! NSRegularExpression(pattern: "(?m)^\\s*'?([a-z0-9-]+)'?:")
        return Set(pattern.matches(in: block, range: NSRange(block.startIndex..., in: block)).map { String(block[Range($0.range(at: 1), in: block)!]) })
    }
    check("card roles are the page fill's", pageRoles("cardAliases") == Set(SafariFillKind.card.roles.keys))
    check("address roles are the page fill's", pageRoles("addressAliases") == Set(SafariFillKind.address.roles.keys))

    // Only an entry of the current grant, of the asked kind, in the grant's vault.
    func refusal(_ message: Any?, _ h: SafariFillHandler = h) -> SafariFillRefusal? { answer(h, message).refusal }
    check("unknown entry", refusal(releaseRequest(SafariFillRef(grantID: grant.grantID, item: UUID()).text)) == .notFound)
    check("another grant's reference", refusal(releaseRequest(SafariFillRef(grantID: Data(count: 16), item: grant.cards[0].id).text)) == .notFound)
    check("a card as an address", refusal(releaseRequest(cardRef, kind: "address")) == .notFound)
    check("an address as a card", refusal(releaseRequest(addressRef)) == .notFound)
    check("another listed vault", refusal(releaseRequest(cardRef, vault: otherVault)) == .notFound)
    check("an unknown vault", refusal(releaseRequest(cardRef, vault: UUID())) == .notFound)
    check("refusals keep the grant", store.stored != nil)
    var lower = releaseRequest(cardRef)
    lower["vault"] = vaultID.uuidString.lowercased()
    check("a vault identifier in either case", refusal(lower) == nil)

    // A new grant of the very same entries refuses the earlier list.
    var again = grant
    again.grantID = Data(repeating: 7, count: 16)
    try store.write(again)
    check("earlier grant's reference refused", refusal(releaseRequest(cardRef)) == .notFound && refusal(releaseRequest(addressRef, kind: "address")) == .notFound)
    check("the new one serves", refusal(releaseRequest(ref(answer(h, statusRequest()), "cards"))) == nil)

    // Strict shape. None of these reads or changes the store.
    try store.write(grant)
    let untouched = MemoryStore()
    untouched.readFails = true
    let strict = handler(untouched)
    let good = releaseRequest(cardRef)
    func with(_ key: String, _ value: Any?, of base: [String: Any] = good) -> [String: Any] { var copy = base; copy[key] = value; return copy }
    check("good shape reaches the store", refusal(good, strict) == .unavailable)
    for message: Any? in [nil, "status", 1, [1, 2], NSNull(), Data(), [AnyHashable(1): 2] as [AnyHashable: Any]] {
        check("not a request", refusal(message, strict) == .invalid)
    }
    for version: Any? in [nil, 0, 2, "1", true, 1.5, -1, NSNull(), [1], Double.nan, Double.infinity, Int64.max] {
        check("another version", refusal(with("v", version), strict) == .unsupported && refusal(with("v", version, of: statusRequest()), strict) == .unsupported)
    }
    check("1.0 is 1", refusal(with("v", 1.0), strict) == .unavailable)
    for type: Any? in [nil, "", "Status", "status ", "vaults", "credential", "card", "unlock", 1, true, ["status"], String(repeating: "s", count: 100_000)] {
        let reply = answer(strict, with("type", type))
        check("another type", reply.refusal == .unsupported && reply.type == nil)
    }
    for key in ["origin", "vault", "kind", "ref", "roles"] {
        check("missing \(key)", refusal(with(key, nil), strict) == .invalid)
        for value: Any in [1, true, NSNull(), [:] as [String: Any], "", String(repeating: "a", count: 100_000), [[:] as [String: Any]]] {
            check("bad \(key)", refusal(with(key, value), strict) == .invalid)
        }
    }
    check("missing origin in status", refusal(with("origin", nil, of: statusRequest()), strict) == .invalid)
    for extra in ["vault", "ref", "roles", "extra"] {
        check("status takes no more", refusal(with(extra, "x", of: statusRequest()), strict) == .invalid)
    }
    check("release takes no more", refusal(with("extra", 1), strict) == .invalid)
    check("a huge dictionary", refusal(Dictionary(uniqueKeysWithValues: (0..<100_000).map { ("k\($0)", $0) }), strict) == .invalid)
    for kind in ["login", "Card", "cards", "password"] { check("unknown kind", refusal(with("kind", kind), strict) == .invalid) }
    for bad in ["", "x", cardRef + "a", String(cardRef.dropLast()), cardRef.uppercased(), cardRef.lowercased(),
                cardRef.replacingOccurrences(of: ".", with: ":"), grant.cards[0].id.uuidString,
                "+f" + String(cardRef.dropFirst(2)), String(repeating: "\u{00E9}", count: 16) + String(cardRef.dropFirst(32)),
                String(repeating: ".", count: SafariFillRef.length), "../" + String(cardRef.dropFirst(3))] where bad != cardRef {
        check("bad reference shape", refusal(with("ref", bad), strict) == .invalid)
    }
    for roles: [Any] in [[], ["password"], ["username"], ["current-password"], ["one-time-code"], ["postal-code"], ["cc-number", "email"],
                         ["cc-number", "cc-number"], ["cc-number", 1], ["CC-NUMBER"], ["cc-pin"], ["cc-type"], [""], ["__proto__"],
                         Array(repeating: "cc-number", count: 100_000)] {
        check("roles outside a card", refusal(with("roles", roles), strict) == .invalid)
    }
    for roles in [["cc-number"], ["name", "cc-csc"], ["postal-code", "postal-code"], ["notes"]] {
        check("roles outside an address", refusal(releaseRequest(addressRef, kind: "address", roles: roles), strict) == .invalid)
    }
    for origin in ["http://shop.example", "https://user@shop.example", "https://", "https://shop.example/x", "http://localhost"] {
        check("status origin", refusal(statusRequest(origin), strict) == .forbidden)
        check("release origin", refusal(releaseRequest(cardRef, origin: origin), strict) == .forbidden)
    }
    check("over-long origin", refusal(statusRequest("https://" + String(repeating: "a", count: 400)), strict) == .invalid)
    var local = handler(store)
    local.allowsLoopbackHTTP = true
    check("loopback when the build allows it", refusal(statusRequest("http://localhost:5173"), local) == nil)
}

// Locked, expired, unreadable.
do {
    let store = MemoryStore()
    let h = handler(store)
    let anyRef = SafariFillRef(grantID: Data(count: 16), item: UUID()).text
    func locked(_ reply: SafariFillHandler.Reply) -> Bool {
        reply.refusal == nil && rows(reply, "cards").isEmpty && rows(reply, "addresses").isEmpty
            && rows(reply, "vaults").map { $0["ready"] as! Bool } == [false, false]
    }
    check("no grant: status shows locked vaults", locked(answer(h, statusRequest())))
    check("no grant: release", answer(h, releaseRequest(anyRef)).refusal == .locked)
    check("no vaults at all", rows(answer(handler(store, vaults: SafariFillVaultList(source: StoredVaults())), statusRequest()), "vaults").isEmpty)

    for later in [clock.later(120_000), clock.later(wall: -1, continuous: 1), TestClock(wall: clock.wall + 1000, continuous: 10)] {
        let grant = sampleGrant()
        try store.write(grant)
        let listedRef = ref(answer(h, statusRequest()), "cards")
        check("released just before", answer(handler(store, at: clock.later(119_999)), releaseRequest(listedRef)).refusal == nil)
        check("ran out between status and release", answer(handler(store, at: later), releaseRequest(listedRef)).refusal == .locked && store.stored == nil)
        check("stays refused with an earlier clock", answer(h, releaseRequest(listedRef)).refusal == .locked)
        try store.write(grant)
        check("status past the time deletes", locked(answer(handler(store, at: later), statusRequest())) && store.stored == nil)
    }

    let grant = sampleGrant()
    let listedRef = SafariFillRef(grantID: grant.grantID, item: grant.cards[0].id).text
    try store.write(grant)
    store.deleteFails = true
    check("an old grant that cannot be deleted is still refused",
          answer(handler(store, at: clock.later(200_000)), releaseRequest(listedRef)).refusal == .locked
          && locked(answer(handler(store, at: clock.later(200_000)), statusRequest())))
    store.deleteFails = false

    // The grant's vault is not listed: never used, and deleted only when the app says it was removed.
    try store.write(grant)
    let missing = vaultSource([(otherVault, "Work")])
    check("not listed: locked and kept", answer(handler(store, vaults: missing), releaseRequest(listedRef)).refusal == .locked
          && rows(answer(handler(store, vaults: missing), statusRequest()), "cards").isEmpty && store.stored?.grantID == grant.grantID)
    check("nothing listed: locked and kept", answer(handler(store, vaults: SafariFillVaultList(source: StoredVaults())), releaseRequest(listedRef)).refusal == .locked
          && store.stored != nil)
    check("and served once listed again", answer(h, releaseRequest(listedRef)).refusal == nil)
    var removed = missing.source as! StoredVaults
    removed.values[SafariFillVaultList.forgottenKey] = json([vaultID.uuidString])
    check("removed: locked and deleted", answer(handler(store, vaults: SafariFillVaultList(source: removed)), releaseRequest(listedRef)).refusal == .locked
          && store.stored == nil)

    // The list changes between the two readings.
    let without = missing.source as! StoredVaults, with = vaultSource().source as! StoredVaults
    try store.write(grant)
    check("listed on the second reading", answer(handler(store, vaults: SafariFillVaultList(source: ChangingVaults([without, with]))),
                                                 releaseRequest(listedRef)).refusal == nil)
    check("its rows too", rows(answer(handler(store, vaults: SafariFillVaultList(source: ChangingVaults([without, with]))), statusRequest()),
                               "vaults").count == 2)
    let broke = StoredVaults(values: [SafariFillVaultList.activeKey: Data("junk".utf8)])
    check("second reading fails: unavailable and kept",
          answer(handler(store, vaults: SafariFillVaultList(source: ChangingVaults([without, broke]))), releaseRequest(listedRef)).refusal == .unavailable
          && store.stored != nil)
    check("forgotten only on the second reading",
          answer(handler(store, vaults: SafariFillVaultList(source: ChangingVaults([without, removed]))), releaseRequest(listedRef)).refusal == .locked
          && store.stored == nil)
    // A newer grant written after the old one was judged unlisted is not the one deleted.
    try store.write(grant)
    var newer = grant
    newer.grantID = Data(repeating: 9, count: 16)
    let late = ChangingVaults([without, removed])
    late.onSecond = { try! store.write(newer) }
    check("only the judged grant is deleted", answer(handler(store, vaults: SafariFillVaultList(source: late)), releaseRequest(listedRef)).refusal == .locked
          && store.stored?.grantID == newer.grantID)

    for data in [Data(), Data("junk".utf8), Data(count: SafariFillGrant.maxBytes + 1), Data(#"{"version":9}"#.utf8)] {
        store.stored = SafariFillStoredItem(data: data, grantID: grant.grantID)
        check("a damaged grant is locked and deleted", locked(answer(h, statusRequest())) && store.stored == nil)
    }

    // The Keychain cannot be read: nothing released, nothing deleted.
    try store.write(grant)
    store.readFails = true
    check("unreadable store", answer(h, statusRequest()).refusal == .unavailable && answer(h, releaseRequest(listedRef)).refusal == .unavailable
          && store.stored != nil)
    store.readFails = false
    check("no store", answer(handler(nil), statusRequest()).refusal == .unavailable && answer(handler(nil), releaseRequest(listedRef)).refusal == .unavailable)

    // A newer grant written while a request with an unreadable list judges the old one.
    for age: Int64 in [1_000, 130_000] {
        try store.write(grant)
        let newer = sampleGrant(clock.later(age))
        store.afterRead = { try! store.write(newer) }
        check("unreadable list never drops a newer grant",
              answer(handler(store, at: clock.later(age), vaults: SafariFillVaultList(source: nil)), statusRequest()).refusal == .unavailable
              && store.stored?.grantID == newer.grantID)
        try store.write(grant)
        store.afterRead = { try! store.write(newer) }
        _ = answer(handler(store, at: clock.later(age)), statusRequest())
        check("nor does a readable one", store.stored?.grantID == newer.grantID)
    }

    // The vault list cannot be read: nothing released, a grant in time stays, one out of time goes.
    for broken in [SafariFillVaultList(source: nil),
                   SafariFillVaultList(source: StoredVaults(values: [SafariFillVaultList.activeKey: Data("junk".utf8)]))] {
        try store.write(grant)
        let b = handler(store, vaults: broken)
        check("unreadable list", answer(b, statusRequest()).refusal == .unavailable && answer(b, releaseRequest(listedRef)).refusal == .unavailable
              && store.stored != nil)
        check("an unreadable list still expires", answer(handler(store, at: clock.later(120_000), vaults: broken), statusRequest()).refusal == .unavailable
              && store.stored == nil)
        store.stored = SafariFillStoredItem(data: Data("junk".utf8), grantID: grant.grantID)
        check("an unreadable list still drops damage", answer(b, statusRequest()).refusal == .unavailable && store.stored == nil)
    }
}

// Hostile names, and numbers typed into every text.
do {
    let numbers = ["4111111111111111", "5555 5555 5555 4444", "3782-822463-10005",
                   "\u{FF14}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}\u{FF11}"]
    let hostileName = "../..\n\u{202E}evil\u{2066}\u{200B}<img src=x onerror=1>\"'\\" + String(repeating: "A", count: 300)
    for number in numbers {
        let store = MemoryStore()
        var grant = sampleGrant()
        grant.cards[0].title = "\(number) \(hostileName)"
        grant.cards[0].brand = number
        grant.cards[0].cardholder = number
        grant.addresses[0].label = number
        grant.addresses[0].fullName = "\u{202E}\(number)"
        grant.addresses[0].city = "city \(number)"
        grant.vault.name = number
        try store.write(grant)
        let reply = answer(handler(store, vaults: vaultSource([(vaultID, "\(number) vault"), (otherVault, hostileName + number)])), statusRequest())
        var texts: [String] = []
        for key in ["vaults", "cards", "addresses"] {
            for row in rows(reply, key) { for name in ["name", "title", "brand", "label", "fullName", "city"] { if let value = row[name] as? String { texts.append(value) } } }
        }
        check("every text is there", texts.count == 7)
        check("every text is masked", texts.allSatisfy { shownDigits($0) <= 4 })
        check("every text is clean and short", texts.allSatisfy { value in
            value.count <= 80 && !value.unicodeScalars.contains { $0.properties.generalCategory == .control || $0.properties.generalCategory == .format }
        })
        for (key, names, extra) in [("cards", ["title", "brand"], "lastFour"), ("addresses", ["label", "fullName", "city"], "")] {
            check("a whole row shows at most four", rows(reply, key).allSatisfy { row in
                (names + [extra]).reduce(0) { $0 + shownDigits(row[$1] as? String ?? "") } <= 4
            })
        }
        let released = answer(handler(store), releaseRequest(ref(reply, "addresses"), kind: "address", roles: ["name", "address-level2"]))
        check("release fills what is stored", released.message["fields"] as? [String: String]
              == ["name": grant.addresses[0].fullName, "address-level2": grant.addresses[0].city])
    }

    // A number shared between the texts of a row.
    do {
        let store = MemoryStore()
        var grant = sampleGrant()
        grant.cards[0].title = "5555 55"
        grant.cards[0].brand = "55 5555"
        grant.addresses[0].label = "4111 11"
        grant.addresses[0].fullName = "11 1111"
        grant.addresses[0].city = "111 111"
        try store.write(grant)
        let reply = answer(handler(store), statusRequest())
        check("split across a card row", ["title", "brand"].allSatisfy { shownDigits(rows(reply, "cards")[0][$0] as! String) == 0 })
        check("split across an address row", ["label", "fullName", "city"].map { shownDigits(rows(reply, "addresses")[0][$0] as! String) } == [0, 0, 4])
    }

    // Row names.
    let store = MemoryStore()
    var grant = sampleGrant()
    grant.cards = [sampleCard(""), sampleCard("\u{200B}"), sampleCard("")]
    grant.cards[2].brand = ""
    grant.cards[2].expiry = nil
    grant.cards[2].securityCode = nil
    grant.cards[2].cardholder = ""
    grant.addresses = [sampleAddress(""), sampleAddress(""), sampleAddress("Office")]
    grant.addresses[1].fullName = ""
    grant.addresses[2].fullName = ""
    grant.addresses[2].city = ""
    try store.write(grant)
    let reply = answer(handler(store), statusRequest())
    check("untitled cards", rows(reply, "cards").map { $0["title"] as! String } == ["Visa", "Visa", "Card"])
    check("no expiry or code", rows(reply, "cards")[2]["expiry"] == nil && rows(reply, "cards")[2]["hasCode"] as? Bool == false)
    check("unlabelled addresses", rows(reply, "addresses").map { "\($0["label"]!)|\($0["fullName"]!)" }
          == ["Robin Fictional|", "Address|", "Office|"])
    check("never the street", !text(reply).contains("Nowhere"))
    let bare = answer(handler(store), releaseRequest(ref(reply, "cards", 2)))
    check("empty values are not released", bare.message["fields"] as? [String: String] == ["cc-number": secretNumber])

    // Many vaults: bounded, and the ready one is shown.
    let many = (0..<500).map { (UUID(), "v\($0)") } + [(vaultID, "")]
    let crowd = answer(handler(store, vaults: vaultSource(many)), statusRequest())
    check("at most 50 vaults, the ready one among them", rows(crowd, "vaults").count == 50
          && rows(crowd, "vaults").filter { $0["ready"] as! Bool }.map { $0["name"] as! String } == ["Vault"])
}

// Requests while grants are written, expired and revoked: a release gives the entry it names or nothing.
do {
    let store = MemoryStore()
    let a = sampleGrant()
    var other = sampleGrant()
    other.cards[0].id = a.cards[0].id
    other.cards[0].number = "5555555555554444"
    let b = other
    let wrong = Slot<Bool>(), message = releaseRequest(SafariFillRef(grantID: a.grantID, item: a.cards[0].id).text, roles: ["cc-number"])
    nonisolated(unsafe) let request = message
    let lock = NSLock()
    DispatchQueue.concurrentPerform(iterations: 3000) { index in
        switch index % 5 {
        case 0: try? store.write(a)
        case 1: try? store.write(b)
        case 2: if index % 50 == 2 { try? store.revoke() }
        default:
            let reply = handler(store, at: clock.later(index % 11 == 0 ? 130_000 : 1)).reply(to: request)
            let fine = reply.refusal == .locked || reply.refusal == .notFound
                || reply.message["fields"] as? [String: String] == ["cc-number": secretNumber]
            if !fine { lock.withLock { wrong.value = true } }
        }
    }
    check("never another grant's value", wrong.value == nil)
}

print("safari fill: \(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
