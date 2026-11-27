import Foundation

// Hostless checks for the app side of Safari fill (`SafariFillCoordinator`, docs/plans/ios-safari-fill.md, slice 6): the links,
// the request, when a grant is written and when it is taken back. A real vault session on files under the test root, the real
// app lock, a stand-in store and clock, and a stand-in for Face ID that a test can hold open. This file is compiled without
// DEBUG, so `SafariFillCoordinator.isReachable` is what a Release build has.

final class MovingClock: SafariFillClock, @unchecked Sendable {
    var time = TestClock()
    func wallMilliseconds() -> Int64 { time.wall }
    func continuousMilliseconds() -> Int64 { time.continuous }
    func pass(_ milliseconds: Int64) { time = time.later(milliseconds) }
}

/// What the app around the coordinator says, and the system's check.
@MainActor final class Surroundings {
    var isSetUp = true
    var timing = LockTiming.oneMinute
    var isActive = true
    var isBusy = false
    var asked = 0
    var outcome: Unlock.Failure?
    /// Keeps the check on screen until `answer` is called.
    var holds = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    var values: SafariFillCoordinator.Surroundings {
        .init(isSetUp: { self.isSetUp }, timing: { self.timing }, isActive: { self.isActive }, isBusy: { self.isBusy },
              authenticate: { _ in try await self.authenticate() })
    }

    private func authenticate() async throws {
        asked += 1
        if holds { await withCheckedContinuation { waiting.append($0) } }
        if let outcome { throw outcome }
    }

    func answer() {
        let held = waiting
        waiting = []
        held.forEach { $0.resume() }
    }

    /// Until the held check has begun.
    func untilAsked(_ count: Int) async {
        for _ in 0..<1000 where asked < count || (holds && waiting.isEmpty) { await Task.yield() }
    }
}

@MainActor struct Rig {
    let session: VaultSession
    let gate: UnlockGate
    let lock: AppLock
    let store = MemoryStore()
    let clock = MovingClock()
    let around = Surroundings()
    let coordinator: SafariFillCoordinator

    init(reachable: Bool? = true, noStore: Bool = false) {
        let session = VaultSession(), gate = UnlockGate()
        self.session = session
        self.gate = gate
        lock = AppLock(gate: gate, session: session)
        if let reachable {
            coordinator = SafariFillCoordinator(session: session, gate: gate, store: noStore ? nil : store, clock: clock,
                                                reachable: reachable, surroundings: around.values)
        } else {
            coordinator = SafariFillCoordinator(session: session, gate: gate, store: store, clock: clock, surroundings: around.values)
        }
    }

    /// The password unlock of the shown vault, as the lock screen does it: the vault, then the gate, then what the window tells
    /// the coordinator.
    func unlock(_ id: UUID) async throws {
        session.show(id)
        coordinator.update()
        try await session.unlock(credentials: .init(password: vaultPassword))
        coordinator.update()
        gate.markUnlocked()
        coordinator.update()
    }

    var grant: SafariFillGrant? { store.stored.flatMap { try? SafariFillGrant.decode($0.data) } }

    func leave() {
        coordinator.leftApp()
        gate.didEnterBackground(after: around.timing)
        coordinator.update()
    }

    /// An open vault with Safari's grant written for it.
    func share(_ id: UUID) async throws {
        coordinator.open(link(id))
        try await unlock(id)
        await coordinator.promptTask?.value
    }
}

let vaultPassword = "pw-fictional-slice6"
func link(_ id: UUID?) -> URL { URL(string: "psss://safari-fill" + (id.map { "?vault=\($0.uuidString)" } ?? ""))! }
let openLink = URL(string: "psss://open")!

@MainActor func checkCoordinator() async throws {
    typealias Screen = SafariFillCoordinator.Screen

    // MARK: Links
    do {
        let id = UUID()
        func parsed(_ text: String) -> SafariFillLink? { URL(string: text).flatMap(SafariFillLink.parse) }
        check("share without a vault", parsed("psss://safari-fill") == .share(vault: nil))
        check("share a vault", parsed("psss://safari-fill?vault=\(id.uuidString)") == .share(vault: id))
        check("lowercase identifier", parsed("psss://safari-fill?vault=\(id.uuidString.lowercased())") == .share(vault: id))
        check("scheme case", parsed("PSSS://safari-fill") == .share(vault: nil))
        check("open", parsed("psss://open") == .open)
        let popup = (try? String(contentsOfFile: "Extensions/SafariIOS/web/popup-logic.js", encoding: .utf8)) ?? ""
        check("the popup's links are these", popup.contains("'psss://safari-fill'") && popup.contains("`?vault=${vault}`")
              && popup.contains("app: 'psss://open'"))
        for bad in ["psss:safari-fill", "psss://", "psss://safari-fill/", "psss://safari-fill/x", "psss://SAFARI-FILL", "psss://safari-fill?",
                    "psss://safari-fill?vault=", "psss://safari-fill?vault=abc", "psss://safari-fill?vault=\(id.uuidString)x",
                    "psss://safari-fill?vault=\(id.uuidString)&vault=\(id.uuidString)", "psss://safari-fill?vault=\(id.uuidString)&a=1",
                    "psss://safari-fill?a=1", "psss://safari-fill?Vault=\(id.uuidString)", "psss://safari-fill#x", "psss://safari-fill?vault=\(id.uuidString)#",
                    "psss://user@safari-fill", "psss://safari-fill:80", "psss://open?x", "psss://open/", "psss://openx", "psss://other",
                    "psss://safari-fill?vault=%30\(id.uuidString.dropFirst())", "psss://safari-fill?vault=../\(id.uuidString.dropFirst(3))",
                    "psss://safari-fill?vault=\(id.uuidString.dropLast())%E2%80%AE", "psss://safari-fill?vault=\(id.uuidString)%0A",
                    "otpauth://totp/x?secret=A", "https://safari-fill", "psss2://safari-fill",
                    "psss://safari-fill?vault=" + String(repeating: "A", count: 100_000)] {
            check("a malformed link is nothing", parsed(bad) == nil)
        }
    }

    for reference in VaultReference.all { VaultReference.forget(reference.id) }
    VaultReference.clear()
    let list = SafariCopy()
    VaultReference.testSafariStore = list
    defer { VaultReference.testSafariStore = nil }

    // Two fictional vaults.
    let first = VaultSession()
    try await first.create(name: "Passwords", credentials: .init(password: vaultPassword),
                           items: [card("Everyday Visa"), address("Home"), VaultItem(kind: .login, title: "Site", account: "me", secret: "login-secret-s6")])
    let passwords = first.reference!.id
    try await first.create(name: "Work", credentials: .init(password: vaultPassword), items: [card("Work card", number: "5555 5555 5555 4444")])
    let work = first.reference!.id
    first.lockAll()

    // MARK: Release builds
    do {
        check("without DEBUG the flow is not reachable", !SafariFillCoordinator.isReachable)
        let rig = Rig(reachable: nil)
        let held = SafariFillGrant(vault: .init(id: passwords, name: "Passwords"), clock: rig.clock)
        try rig.store.write(held)
        rig.session.show(work)
        rig.coordinator.open(link(passwords))
        check("a Release build ignores the link", rig.session.reference?.id == work && rig.coordinator.screen == nil && rig.grant == held)
        try await rig.unlock(passwords)
        rig.coordinator.open(link(passwords))
        await rig.coordinator.promptTask?.value
        check("and asks and writes nothing", rig.around.asked == 0 && rig.coordinator.screen == nil && rig.grant == held)
    }

    // MARK: Unlocking after the request
    do {
        let rig = Rig()
        rig.session.show(work)
        rig.coordinator.open(link(passwords))
        check("the asked vault is shown", rig.session.reference?.id == passwords)
        check("a link shares nothing by itself", rig.store.stored == nil && rig.coordinator.screen == nil && rig.around.asked == 0)
        try await rig.session.unlock(credentials: .init(password: vaultPassword))
        rig.coordinator.update()
        check("not while the app is still locked", rig.store.stored == nil)
        rig.gate.markUnlocked()
        rig.coordinator.update()
        check("shared after the unlock", rig.coordinator.screen == .shared(vault: "Passwords") && rig.around.asked == 0)
        let grant = rig.grant
        check("only that vault's cards and addresses", grant?.vault.id == passwords && grant?.cards.map(\.title) == ["Everyday Visa"]
              && grant?.addresses.map(\.label) == ["Home"])
        let bytes = String(decoding: rig.store.stored?.data ?? Data(), as: UTF8.self)
        check("no login or password in it", !bytes.contains("login-secret-s6") && !bytes.contains(vaultPassword) && !bytes.contains(secretMarker))
        check("the extension's list was written", (try? SafariFillVaultList(source: list).vaults().contains { $0.id == passwords }) == true)
        rig.coordinator.update()
        check("written once", rig.store.adds == 1)
        rig.coordinator.dismiss()
        check("Done keeps the grant", rig.coordinator.screen == nil && rig.grant == grant)
    }

    // MARK: Already open
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.around.holds = true
        rig.coordinator.open(link(passwords))
        await rig.around.untilAsked(1)
        check("asked again", rig.coordinator.screen == .confirm(vault: "Passwords") && rig.around.asked == 1 && rig.coordinator.isAuthenticating)
        rig.coordinator.update()
        rig.coordinator.becameActive()
        check("nothing before the answer, and one prompt", rig.store.stored == nil && rig.around.asked == 1)
        rig.around.outcome = .cancelled
        rig.around.answer()
        await rig.coordinator.promptTask?.value
        check("cancelled: still asking, nothing given", rig.coordinator.screen == .confirm(vault: "Passwords") && rig.store.stored == nil
              && rig.coordinator.problem == nil && !rig.coordinator.isAuthenticating)
        rig.coordinator.becameActive()
        await Task.yield()
        check("no second prompt by itself", rig.around.asked == 1)
        rig.around.holds = false
        rig.around.outcome = .failed("The check failed.")
        await rig.coordinator.confirm()
        check("failed: says why, nothing given", rig.coordinator.problem == "The check failed." && rig.store.stored == nil)
        rig.around.outcome = nil
        await rig.coordinator.confirm()
        check("passed: shared", rig.coordinator.screen == .shared(vault: "Passwords") && rig.grant?.vault.id == passwords && rig.coordinator.problem == nil)
        await rig.coordinator.confirm()
        check("a second tap asks nothing", rig.around.asked == 3 && rig.store.adds == 1)
    }
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.around.isActive = false
        rig.coordinator.open(link(nil))
        check("without a vault: the shown one", rig.coordinator.screen == .confirm(vault: "Passwords"))
        check("no prompt while Psss is not in front", rig.around.asked == 0)
        rig.around.isActive = true
        rig.coordinator.becameActive()
        await rig.coordinator.promptTask?.value
        check("prompts once in front", rig.around.asked == 1 && rig.grant != nil)
    }
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.coordinator.open(link(passwords))
        await rig.coordinator.promptTask?.value
        rig.around.holds = true
        rig.coordinator.open(link(passwords))
        check("a new request takes the grant back at once", rig.store.stored == nil)
        await rig.around.untilAsked(2)
        rig.around.answer()
        await rig.coordinator.promptTask?.value
    }

    // MARK: What can happen during the check
    func held(_ name: String,
              during: (Rig) async throws -> Void) async throws {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.around.holds = true
        rig.coordinator.open(link(passwords))
        await rig.around.untilAsked(1)
        try await during(rig)
        rig.around.holds = false
        rig.around.answer()
        await rig.coordinator.promptTask?.value
        check("during the check: \(name)", rig.store.stored == nil && rig.coordinator.screen == nil)
    }
    try await held("Lock All") { $0.gate.lock(); $0.coordinator.update() }
    try await held("Lock All before the window says so") { $0.gate.lock() }
    try await held("the vault locked") { $0.session.lock(passwords) }
    try await held("the vault locked, and the window says so") { $0.session.lock(passwords); $0.coordinator.update() }
    try await held("leaving Psss") { $0.leave() }
    try await held("leaving with Immediately") { $0.around.timing = .immediately; $0.leave() }
    try await held("too long") { $0.clock.pass(120_000) }
    try await held("not set up any more") { $0.around.isSetUp = false }
    try await held("the open link") { $0.coordinator.open(openLink) }
    try await held("Cancel") { $0.coordinator.dismiss() }
    do {
        // A request for another vault replaces it: the first answer counts for nothing, and the second vault asks for itself.
        let rig = Rig()
        try await rig.unlock(work)
        try await rig.unlock(passwords)
        rig.around.holds = true
        rig.coordinator.open(link(passwords))
        await rig.around.untilAsked(1)
        rig.coordinator.open(link(work))
        check("two requests: the newer one shows", rig.coordinator.screen == .confirm(vault: "Work"))
        rig.around.answer()
        await rig.around.untilAsked(2)
        check("two requests: the old answer gives nothing", rig.store.stored == nil && rig.around.asked == 2)
        rig.around.answer()
        for _ in 0..<1000 where rig.grant == nil { await Task.yield() }
        check("two requests: only the newer vault", rig.grant?.vault.id == work && rig.store.adds == 1)
    }

    // MARK: Waiting requests
    do {
        for (age, shares) in [(Int64(119_999), true), (120_000, false), (3_600_000, false)] {
            let rig = Rig()
            rig.coordinator.open(link(passwords))
            rig.clock.pass(age)
            try await rig.unlock(passwords)
            check("unlock after \(age) ms", (rig.grant != nil) == shares && (rig.coordinator.screen != nil) == shares)
        }
        let rig = Rig()
        rig.coordinator.open(link(passwords))
        rig.clock.time = rig.clock.time.later(wall: 0, continuous: -1)
        try await rig.unlock(passwords)
        check("a clock that went back", rig.store.stored == nil)
    }
    do {
        let rig = Rig()
        rig.around.timing = .immediately
        rig.coordinator.open(link(passwords))
        rig.leave()
        rig.gate.decideOnReturn(after: .immediately)
        rig.coordinator.becameActive()
        try await rig.unlock(passwords)
        check("a short absence keeps a waiting request", rig.grant != nil)
    }
    do {
        let rig = Rig()
        rig.coordinator.open(link(work))
        try await rig.unlock(passwords)
        check("another vault unlocked instead: nothing", rig.store.stored == nil && rig.coordinator.screen == nil)
        try await rig.unlock(work)
        check("and the request is gone", rig.store.stored == nil && rig.coordinator.screen == nil)
    }
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.coordinator.open(link(work))
        check("a locked vault beside an open one: its unlock screen", rig.session.reference?.id == work && rig.coordinator.screen == nil && rig.around.asked == 0)
        rig.coordinator.update()
        rig.session.show(passwords)  // Cancel on the unlock screen
        rig.coordinator.update()
        try await rig.unlock(work)
        check("Cancel there ends the request", rig.store.stored == nil)
        rig.session.lock(work)
        rig.coordinator.open(link(work))
        try await rig.unlock(work)
        check("asked again, shared", rig.grant?.vault.id == work && rig.grant?.cards.map(\.title) == ["Work card"] && rig.grant?.addresses.isEmpty == true)
        rig.coordinator.open(link(passwords))
        await rig.coordinator.promptTask?.value
        check("the other vault replaces it", rig.grant?.vault.id == passwords)
    }
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.coordinator.open(link(work))
        rig.gate.lock()
        rig.coordinator.update()
        try await rig.unlock(work)
        check("a chosen lock ends a waiting request", rig.store.stored == nil)
    }

    // MARK: Unsaved work
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.around.isBusy = true
        rig.coordinator.open(link(work))
        check("busy: a locked vault is not put over the edit", rig.session.reference?.id == passwords && rig.coordinator.screen == nil)
        try await rig.unlock(work)
        check("busy: and the request is dropped", rig.store.stored == nil)
        rig.session.show(passwords)
        rig.coordinator.open(link(work))
        await rig.coordinator.promptTask?.value
        check("busy: an open vault is asked about without switching", rig.session.reference?.id == passwords && rig.grant?.vault.id == work)
        let edit = ItemEdit()
        check("no edit in progress", !ItemEdit.isAnyInProgress)
        edit.begin(card("Edited"))
        check("an edit in progress is seen", ItemEdit.isAnyInProgress)
        edit.end()
        check("and its end", !ItemEdit.isAnyInProgress)
    }

    // MARK: Links that change nothing
    do {
        let rig = Rig()
        try await rig.share(passwords)
        let before = rig.grant
        rig.coordinator.dismiss()
        let shown = rig.session.reference?.id
        for url in [link(UUID()), URL(string: "psss://safari-fill?vault=nonsense")!, URL(string: "psss://other")!, URL(string: "otpauth://totp/x")!] {
            rig.coordinator.open(url)
        }
        check("unknown and malformed links change nothing", before != nil && rig.grant == before && rig.coordinator.screen == nil && rig.session.reference?.id == shown)
        rig.coordinator.open(openLink)
        check("the open link keeps the grant and asks nothing", rig.grant == before && rig.coordinator.screen == nil && rig.around.asked == 0)
        rig.around.isSetUp = false
        rig.coordinator.open(link(passwords))
        check("onboarding and the sample vault: ignored", rig.grant == before && rig.coordinator.screen == nil)
    }
    do {
        let rig = Rig()
        rig.coordinator.open(link(passwords))
        rig.coordinator.open(openLink)
        try await rig.unlock(passwords)
        check("the open link ends a waiting request", rig.store.stored == nil)
    }

    // MARK: What keeps and what takes back
    func shared(_ name: String, kept: Bool = false, timing: LockTiming = .oneMinute, _ event: (Rig) async throws -> Void) async throws {
        let rig = Rig()
        rig.around.timing = timing
        rig.around.holds = false
        try await rig.share(passwords)
        let before = rig.grant
        try await event(rig)
        rig.coordinator.update()
        check("after sharing, \(name): \(kept ? "kept" : "taken back")", before != nil && rig.grant == (kept ? before : nil)
              && (kept || rig.coordinator.screen == nil))
    }
    try await shared("leaving with Immediately", kept: true, timing: .immediately) {
        $0.leave()
        check("the vault is locked meanwhile", !$0.session.isAnyOpen && !$0.gate.isUnlocked && $0.coordinator.screen == nil)
    }
    try await shared("leaving twice with Immediately", kept: true, timing: .immediately) { $0.leave(); $0.leave() }
    try await shared("coming back to a locked Psss", timing: .immediately) {
        $0.leave(); $0.leave()
        $0.gate.decideOnReturn(after: .immediately)
        $0.coordinator.becameActive()
    }
    try await shared("coming back, before Psss is even active", timing: .immediately) {
        $0.leave()
        $0.coordinator.returned()
    }
    try await shared("coming back when an unlock got in first", timing: .immediately) {
        $0.leave()
        try await $0.unlock(work)
        $0.coordinator.becameActive()
    }
    try await shared("the open link after Immediately, and the return it causes", timing: .immediately) {
        $0.leave()
        $0.coordinator.returned()
        $0.coordinator.open(openLink)
        $0.coordinator.becameActive()
    }
    // The mark of a lock for leaving must not outlast it: no return in between, so only the lock itself can take this back.
    try await shared("a manual lock after a lock for leaving, on the same gate", timing: .immediately) {
        $0.leave()
        check("the mark is cleared", !$0.gate.isLockingForLeave && $0.grant != nil)
        try await $0.unlock(work)
        check("still there", $0.grant != nil)
        $0.gate.lock()
    }
    try await shared("changed elsewhere while locked, then coming back", timing: .immediately) {
        $0.leave()
        let other = Rig(reachable: false)
        try await other.unlock(passwords)
        try other.session.store(for: passwords)?.save([card("Changed while away")])
        $0.coordinator.becameActive()
    }
    try await shared("coming back after its time") {
        $0.leave()
        $0.clock.pass(120_000)
        $0.gate.decideOnReturn(after: .oneMinute)
        $0.coordinator.becameActive()
    }
    try await shared("coming back just in time", kept: true) {
        $0.leave()
        $0.clock.pass(119_999)
        $0.gate.decideOnReturn(after: .oneMinute)
        $0.coordinator.becameActive()
    }
    do {
        let rig = Rig()
        try await rig.share(passwords)
        rig.clock.pass(120_000)
        rig.store.deleteFails = true
        rig.coordinator.becameActive()
        check("an expired grant that cannot be deleted is remembered", rig.coordinator.owesRevoke && rig.coordinator.screen == nil)
        rig.store.deleteFails = false
        rig.coordinator.becameActive()
        check("and deleted on the next return", !rig.coordinator.owesRevoke && rig.store.stored == nil)
    }

    // The vault's file: linked anew, gone, or unreadable. Each is put back for what follows.
    let file = VaultFiles.managedURL(fileName: VaultReference.all.first { $0.id == passwords }!.fileName)
    let aside = file.appendingPathExtension("aside")
    func withoutTheFile(_ body: () async throws -> Void) async throws {
        try FileManager.default.moveItem(at: file, to: aside)
        defer {
            try? FileManager.default.removeItem(at: file)
            try? FileManager.default.moveItem(at: aside, to: file)
        }
        try await body()
    }
    try await shared("the file linked anew") { try $0.session.relink(to: file) }
    try await shared("another vault's file linked anew", kept: true) {
        try await $0.unlock(work)
        $0.session.show(work)
        try $0.session.relink(to: VaultFiles.managedURL(fileName: $0.session.reference!.fileName))
    }
    try await shared("the file deleted, seen by the check for changes") { rig in
        try await withoutTheFile {
            let result = try? await rig.session.store(for: passwords)?.reloadIfChanged()
            check("it cannot be read", result == nil)
        }
    }
    try await shared("the file deleted, seen by a reload") { rig in
        try await withoutTheFile { try? await rig.session.store(for: passwords)?.reload() }
    }
    try await shared("the file damaged") { rig in
        try await withoutTheFile {
            try Data("not a vault".utf8).write(to: file)
            _ = try? await rig.session.store(for: passwords)?.reloadIfChanged()
        }
    }
    try await shared("the locked vault's file gone at an unlock", timing: .immediately) { rig in
        rig.leave()
        check("kept while away", rig.grant != nil)
        try await withoutTheFile {
            rig.session.show(passwords)
            try? await rig.session.unlock(credentials: .init(password: vaultPassword))
        }
    }
    try await shared("a wrong password at an unlock", kept: true, timing: .immediately) {
        $0.leave()
        $0.session.show(passwords)
        try? await $0.session.unlock(credentials: .init(password: "wrong"))
    }
    try await shared("leaving and returning in time", kept: true) {
        $0.leave()
        $0.gate.decideOnReturn(after: .oneMinute)
        $0.coordinator.becameActive()
    }
    try await shared("the lock on a late return") {
        $0.leave()
        check("kept while away", $0.grant != nil)
        $0.gate.decideOnReturn(after: .oneMinute, now: .now + 61)
    }
    try await shared("Lock All", timing: .immediately) { $0.gate.lock() }
    try await shared("a lock with a notice") { $0.gate.lock(notice: "changed") }
    try await shared("Lock Vault") { $0.session.lock(passwords) }
    try await shared("the idle lock") { $0.gate.lockIfIdle(after: .oneMinute, now: .now + 3600) }
    try await shared("a lock of another vault", timing: .oneMinute) {
        try await $0.unlock(work)
        check("unlocking another vault keeps it", $0.grant?.vault.id == passwords)
        $0.session.lock(work)
    }
    try await shared("a change in another vault", kept: true) {
        try await $0.unlock(work)
        try $0.session.store(for: work)?.save([card("Second work card")])
    }
    try await shared("a use of an item", kept: true) {
        if let store = $0.session.store(for: passwords), let item = store.items().first { store.markUsed(item.id) }
    }
    try await shared("a saved item") { try $0.session.store(for: passwords)?.save([card("Added")]) }
    try await shared("a deleted item") {
        if let store = $0.session.store(for: passwords), let item = store.items().first(where: { $0.title == "Added" }) {
            try store.moveToRecentlyDeleted(item.id)
        }
    }
    try await shared("a new vault name") {
        try $0.session.store(for: passwords)?.rename("Renamed")
        try $0.session.store(for: passwords)?.rename("Passwords")
    }
    try await shared("a new vault password") {
        _ = try await $0.session.store(for: passwords)?.changeCredentials(to: .init(password: vaultPassword))
    }
    try await shared("a file changed elsewhere") { rig in
        let other = Rig(reachable: false)
        try await other.unlock(passwords)
        try other.session.store(for: passwords)?.save([card("From elsewhere")])
        check("another writer does not reach this app's grant", rig.grant != nil)
        let reloaded = try await rig.session.store(for: passwords)?.reloadIfChanged()
        check("the change is seen", reloaded == true)
    }
    try await shared("a reload") { try await $0.session.store(for: passwords)?.reload() }
    try await shared("an unchanged file", kept: true) { _ = try await $0.session.store(for: passwords)?.reloadIfChanged() }
    try await shared("a new request") { $0.coordinator.open(link(work)) }
    try await shared("the device locking") { $0.coordinator.revoke() }
    do {
        // The next launch, before anything else.
        let rig = Rig()
        try await rig.share(passwords)
        let next = SafariFillCoordinator(session: VaultSession(), gate: UnlockGate(), store: rig.store, clock: rig.clock,
                                         reachable: false, surroundings: rig.around.values)
        next.revoke()
        check("launch takes back what was left", rig.store.stored == nil)
    }

    // MARK: Failures
    do {
        let rig = Rig()
        try await rig.share(passwords)
        VaultReference.testSafariStore = nil
        rig.coordinator.open(link(passwords))
        await rig.coordinator.promptTask?.value
        check("no copy of the list: nothing written, none left", rig.store.stored == nil && rig.coordinator.screen == .failed(vault: "Passwords"))
        rig.coordinator.retry()
        check("Try Again, still failing", rig.store.stored == nil && rig.coordinator.screen == .failed(vault: "Passwords"))
        VaultReference.testSafariStore = list
        rig.coordinator.retry()
        check("Try Again, shared", rig.grant?.vault.id == passwords && rig.coordinator.screen == .shared(vault: "Passwords"))
    }
    do {
        let rig = Rig()
        rig.store.addFails = true
        try await rig.share(passwords)
        check("an unwritable store", rig.store.stored == nil && rig.coordinator.screen == .failed(vault: "Passwords") && rig.session.isOpen(passwords))
        rig.clock.pass(120_000)
        rig.store.addFails = false
        rig.coordinator.retry()
        check("Try Again after too long gives nothing", rig.store.stored == nil && rig.coordinator.screen == nil)
        rig.store.addFails = true
        try await rig.share(passwords)
        rig.session.lock(passwords)
        rig.store.addFails = false
        rig.coordinator.retry()
        check("Try Again after a lock gives nothing", rig.store.stored == nil && rig.coordinator.screen == nil)
    }
    do {
        let rig = Rig(noStore: true)
        try await rig.share(passwords)
        check("no Keychain group: says it could not share", rig.coordinator.screen == .failed(vault: "Passwords"))
    }
    do {
        let rig = Rig()
        try await rig.share(passwords)
        rig.store.deleteFails = true
        rig.gate.lock()
        check("a failed delete is remembered", rig.coordinator.owesRevoke && rig.store.stored != nil)
        rig.coordinator.becameActive()
        check("and tried again", rig.coordinator.owesRevoke)
        rig.store.deleteFails = false
        rig.coordinator.becameActive()
        check("until it works", !rig.coordinator.owesRevoke && rig.store.stored == nil)
    }
    do {
        let rig = Rig()
        try await rig.share(passwords)
        rig.store.deleteFails = true
        rig.coordinator.open(link(passwords))
        await rig.coordinator.promptTask?.value
        check("an old grant that cannot be deleted: could not share", rig.coordinator.screen == .failed(vault: "Passwords"))
    }

    // MARK: A return that is due to lock
    do {
        let rig = Rig()
        try await rig.unlock(passwords)
        rig.gate.didLeave(now: .now - 61)
        rig.coordinator.open(link(passwords))
        check("the due lock comes first: no confirmation, an unlock", !rig.gate.isUnlocked && rig.coordinator.screen == nil && rig.around.asked == 0 && rig.store.stored == nil)
        try await rig.unlock(passwords)
        check("then shared", rig.grant != nil)
    }

    // MARK: Removal (last: it forgets the vaults)
    do {
        let rig = Rig()
        try await rig.share(passwords)
        rig.session.remove(work, deletingFile: true)
        check("removing a locked vault takes the grant back", rig.store.stored == nil && rig.coordinator.screen == nil)
        rig.coordinator.open(link(work))
        check("a forgotten vault is unknown", rig.coordinator.screen == nil && rig.session.reference?.id == passwords)
        try await rig.share(passwords)
        rig.session.remove(passwords)
        check("removing the shared vault takes the grant back", rig.store.stored == nil && rig.coordinator.screen == nil)
        rig.coordinator.open(link(nil))
        check("no vault left: ignored", rig.coordinator.screen == nil && rig.store.stored == nil)
    }
}
