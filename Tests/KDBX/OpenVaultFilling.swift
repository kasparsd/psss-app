import Foundation

/// Slice M2 of several open vaults: the browser popup and AutoFill fill from any open vault. The protocol runs over the real
/// `VaultSession` (`SessionVaultService`) with real encrypted vaults, so a vault that is locked really holds nothing. Covers the
/// hostile-input and secrecy checklist for these paths: names escaped and cut, no secret in any reply or state file, a vault that
/// locks between a search and the fill answers a plain error and never another vault's data, the identity store keeps each vault's
/// suggestions apart. Returns how many checks failed.
@MainActor func runOpenVaultFillingTests() async -> Int {
    var failed = 0
    func verify(_ name: String, _ ok: Bool) {
        if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
    }
    let session = VaultSession()
    func reset() {
        BrowserProtocol.vaultService = nil
        session.lockAll()
        while session.reference != nil { session.forget() }
        for vault in VaultReference.remembered { VaultReference.forget(vault.id) }
    }
    reset()
    let password = "pw-vault-\(UUID().uuidString)"
    let secretA = "Secret-A-\(UUID().uuidString)"
    let secretB = "Secret-B-\(UUID().uuidString)"
    let secretNew = "Secret-New-\(UUID().uuidString)"
    let secretOld = "Secret-Old-\(UUID().uuidString)"
    let secretLong = String(repeating: "L", count: 1024)
    let secretUpdated = "Secret-Updated-\(UUID().uuidString)"
    var transcript = ""
    func ask(_ type: String, _ fields: [String: Any] = [:]) -> [String: Any] {
        let reply = BrowserProtocol.handle(["v": BrowserProtocol.version, "id": "t", "type": type].merging(fields) { $1 })
        // Everything the host would send back, kept to look for a secret that should never be there. The only replies meant to
        // carry a password are a successful `credential` and `generate`; they are checked on their own.
        if !((type == "credential" || type == "generate") && reply["ok"] as? Bool == true) { transcript += "\(reply)\n" }
        return reply
    }
    func error(_ reply: [String: Any]) -> String { reply["error"] as? String ?? "none" }
    func titles(_ reply: [String: Any]) -> [String] { ((reply["candidates"] as? [[String: Any]]) ?? []).map { $0["title"] as? String ?? "" } }
    func order() -> [String] { ask("vaults")["vaults"].flatMap { $0 as? [[String: Any]] }.map { $0.map { $0["name"] as? String ?? "" } } ?? [] }
    func states() -> [String] { (ask("vaults")["vaults"] as? [[String: Any]] ?? []).map { "\($0["name"] ?? ""):\($0["state"] ?? ""):\($0["active"] ?? "")" } }
    let site = "https://gitforge.example"

    do {
        let loginA = VaultItem(kind: .login, title: "Gitforge (A)", account: "a@example.net", website: "gitforge.example", secret: secretA)
        let loginB = VaultItem(kind: .login, title: "Gitforge (B)", account: "b@example.net", website: "gitforge.example", secret: secretB)
        let ledgerB = VaultItem(kind: .login, title: "Ledger (B)", account: "b@example.net", website: "ledger.example", secret: secretB)
        try await session.create(name: "Fill A", credentials: .init(password: password), items: [loginA])
        let a = session.reference!
        try await session.create(name: "Fill B", credentials: .init(password: password), items: [loginB, ledgerB])
        let b = session.reference!
        BrowserProtocol.vaultService = SessionVaultService(session: session)
        _ = VaultIdentities.takeCalls()

        verify("both vaults are open and B is the shown one", session.isOpen(a.id) && session.isOpen(b.id) && session.reference?.id == b.id)
        let before = order()
        verify("the popup's list is in the fixed order, each vault open, only the shown one active",
               before == ["Fill A", "Fill B"] && states() == ["Fill A:open:false", "Fill B:open:true"])

        // Fill from the second open vault while another is shown: no unlock, nothing switched.
        let fromA = ask("candidates", ["origin": site, "vault": a.id.uuidString])
        verify("A is not the shown vault and still lists its login for the site", titles(fromA) == ["Gitforge (A)"] && session.reference?.id == b.id)
        verify("B lists its own, not A's", titles(ask("candidates", ["origin": site, "vault": b.id.uuidString])) == ["Gitforge (B)"])
        let found = ask("search", ["origin": site, "query": "ledger", "vault": b.id.uuidString])
        verify("search runs in the vault it names", ((found["results"] as? [[String: Any]]) ?? []).map { $0["title"] as? String ?? "" } == ["Ledger (B)"]
               && ((ask("search", ["origin": site, "query": "ledger", "vault": a.id.uuidString])["results"] as? [Any]) ?? ["x"]).isEmpty)
        let refA = ((fromA["candidates"] as? [[String: Any]])?.first?["ref"] as? String) ?? ""
        let credA = ask("credential", ["ref": refA, "origin": site, "vault": a.id.uuidString])
        verify("fill from A releases A's own password", credA["secret"] as? String == secretA && credA["account"] as? String == "a@example.net")
        verify("A's reference is nothing in B: another vault's login is never found by chance",
               error(ask("credential", ["ref": refA, "origin": site, "vault": b.id.uuidString])) == "not-found")
        verify("a reference never lifts the origin rule", error(ask("credential", ["ref": refA, "origin": "https://other.example", "vault": a.id.uuidString])) == "forbidden")

        // A request that names no vault, an unknown one or a hostile id reads nothing: never "whichever is shown".
        let nowhere: [Any] = [NSNull(), "", "nope", UUID().uuidString, String(repeating: "x", count: 65), 3]
        verify("no vault, an unknown vault or a hostile id: not-found, nothing served",
               nowhere.allSatisfy { error(ask("candidates", ["origin": site, "vault": $0])) == "not-found" && error(ask("search", ["origin": site, "query": "git", "vault": $0])) == "not-found" }
               && error(ask("candidates", ["origin": site])) == "not-found" && error(ask("credential", ["ref": refA, "origin": site])) == "not-found")

        // The offer ledger: a password is released only for a login the app has just shown for this page. A fake clock stands in for time.
        final class Clock: @unchecked Sendable { var now = Date(); func advance(_ seconds: TimeInterval) { now.addTimeInterval(seconds) } }
        let clock = Clock()
        BrowserProtocol.ledger = OfferLedger(now: { clock.now })
        let refB = ((ask("candidates", ["origin": site, "vault": b.id.uuidString])["candidates"] as? [[String: Any]])?.first?["ref"] as? String) ?? ""
        BrowserProtocol.ledger.clear()
        let bare = ask("credential", ["ref": refB, "origin": site, "vault": b.id.uuidString])
        verify("a bare reference that nothing offered releases nothing", error(bare) == "not-found" && bare["secret"] == nil && !"\(bare)".contains(secretB))
        verify("manual without a search releases nothing, and a wrongly typed manual is not manual",
               error(ask("credential", ["ref": refB, "origin": site, "vault": b.id.uuidString, "manual": true])) == "not-found"
               && [1, "true", NSNull(), [true]].allSatisfy { error(ask("credential", ["ref": refB, "origin": site, "vault": b.id.uuidString, "manual": $0])) == "not-found" })
        _ = ask("candidates", ["origin": site, "vault": b.id.uuidString])
        verify("after the list offered it, the login for this page is released", ask("credential", ["ref": refB, "origin": site, "vault": b.id.uuidString])["secret"] as? String == secretB)
        verify("the offer is for this page only", error(ask("credential", ["ref": refB, "origin": "https://other.example", "vault": b.id.uuidString, "manual": true])) == "not-found"
               && error(ask("credential", ["ref": refB, "origin": "https://other.example", "vault": b.id.uuidString])) == "forbidden")
        // Other Matches: the Ledger login belongs to another site; only a search on this page offers it as manual.
        let searched = ask("search", ["origin": site, "query": "ledger", "vault": b.id.uuidString])
        let refLedger = ((searched["results"] as? [[String: Any]])?.first?["ref"] as? String) ?? ""
        verify("the search offered a login saved for another site", !refLedger.isEmpty && (searched["results"] as? [[String: Any]])?.first?["matches"] as? Bool == false)
        verify("without manual, the origin rule still refuses it", error(ask("credential", ["ref": refLedger, "origin": site, "vault": b.id.uuidString])) == "forbidden")
        verify("manual releases a login the search returned", ask("credential", ["ref": refLedger, "origin": site, "vault": b.id.uuidString, "manual": true])["secret"] as? String == secretB)
        verify("manual is never released over plain http outside localhost",
               error(ask("credential", ["ref": refLedger, "origin": "http://gitforge.example", "vault": b.id.uuidString, "manual": true])) == "forbidden"
               && error(ask("search", ["origin": "http://gitforge.example", "query": "ledger", "vault": b.id.uuidString])) == "forbidden")
        verify("an over-long or wrongly typed reference is not found",
               [String(repeating: "r", count: 65), String(repeating: "r", count: 10_000), ""].allSatisfy { error(ask("credential", ["ref": $0, "origin": site, "vault": b.id.uuidString, "manual": true])) == "not-found" }
               && error(ask("credential", ["ref": 7, "origin": site, "vault": b.id.uuidString])) == "forbidden")
        verify("A's offer is not B's: a search in A does not let B release", {
            let inA = ask("search", ["origin": site, "query": "gitforge", "vault": a.id.uuidString])
            let ref = ((inA["results"] as? [[String: Any]])?.first?["ref"] as? String) ?? ""
            return !ref.isEmpty && error(ask("credential", ["ref": ref, "origin": site, "vault": b.id.uuidString, "manual": true])) == "not-found"
        }())
        clock.advance(OfferLedger.lifetime - 1)
        verify("an offer stands for five minutes", ask("credential", ["ref": refB, "origin": site, "vault": b.id.uuidString])["secret"] as? String == secretB)
        clock.advance(2)
        let expired = ask("credential", ["ref": refB, "origin": site, "vault": b.id.uuidString])
        verify("an expired offer releases nothing", error(expired) == "not-found" && expired["secret"] == nil
               && error(ask("credential", ["ref": refLedger, "origin": site, "vault": b.id.uuidString, "manual": true])) == "not-found")
        let made = ask("generate")
        verify("generate is made in the app", made["ok"] as? Bool == true && ((made["password"] as? String)?.count ?? 0) >= 12 && made["password"] as? String != ask("generate")["password"] as? String)
        // The ledger stays under its cap and holds no more than references.
        BrowserProtocol.ledger.clear()
        for index in 0..<(OfferLedger.capacity + 50) { BrowserProtocol.ledger.offer(["r\(index)"], vault: "v", host: "h.example", searched: false) }
        verify("the ledger is bounded", BrowserProtocol.ledger.count == OfferLedger.capacity)
        BrowserProtocol.ledger = OfferLedger()
        _ = ask("search", ["origin": site, "query": "gitforge", "vault": a.id.uuidString])
        verify("a search offers something before the lock", BrowserProtocol.ledger.count > 0)

        // Save: the vault the request names, any open vault, never another one.
        let account = "new@example.net"
        let created = ask("save", ["origin": site, "account": account, "secret": secretNew, "vault": a.id.uuidString])
        verify("a save goes to the chosen open vault even when another is shown", created["result"] as? String == "created" && created["vault"] as? String == a.id.uuidString
               && session.store(for: a.id)!.items().contains { $0.account == account && $0.secret == secretNew }
               && !session.store(for: b.id)!.items().contains { $0.account == account })
        verify("a second save for the same site and username updates the password only",
               ask("save", ["origin": site, "account": "a@example.net", "secret": secretNew, "vault": a.id.uuidString])["result"] as? String == "updated"
               && session.store(for: a.id)!.items().filter { $0.account == "a@example.net" }.map(\.title) == ["Gitforge (A)"])
        verify("the save is offered by AutoFill from its own vault (the window never saw it)", VaultIdentities.held.contains { $0.hasPrefix(a.id.uuidString + "/") })
        verify("a save with no vault or an unknown one writes nothing",
               error(ask("save", ["origin": site, "account": "x@example.net", "secret": "x"])) == "not-found"
               && error(ask("save", ["origin": site, "account": "x@example.net", "secret": "x", "vault": "nope"])) == "not-found"
               && !session.store(for: b.id)!.items().contains { $0.account == "x@example.net" })

        // Save, slice R4: limits, hostile values, the offer an update needs, and the password as the only change.
        func countA() -> Int { session.store(for: a.id)?.items().count ?? -1 }
        func saveA(_ fields: [String: Any]) -> [String: Any] {
            ask("save", ["origin": site, "account": "r4@example.net", "secret": "x-r4", "vault": a.id.uuidString].merging(fields) { $1 })
        }
        BrowserProtocol.ledger.clear()
        verify("a new login needs no offer", saveA(["account": "upd@example.net", "secret": secretOld])["result"] as? String == "created")
        let seeded = session.store(for: a.id)!.items().first { $0.account == "upd@example.net" }!
        verify("it is named by the site's host", seeded.displayTitle == "gitforge.example")
        verify("it holds the site, the username and the password, as a login",
               SharedVault.host(seeded.website) == "gitforge.example" && seeded.account == "upd@example.net" && seeded.secret == secretOld && seeded.kind == ItemKind.login)
        let beforeUpdate = countA()
        let notOffered = saveA(["account": "upd@example.net", "secret": secretUpdated])
        verify("an update of a login nothing offered for this page is not found, and writes nothing",
               error(notOffered) == "not-found" && countA() == beforeUpdate && session.store(for: a.id)!.items().first { $0.id == seeded.id }?.secret == secretOld)
        _ = ask("candidates", ["origin": "https://other.example", "vault": a.id.uuidString])
        _ = ask("candidates", ["origin": site, "vault": b.id.uuidString])
        verify("an offer for another page or another vault is not an offer for this one", error(saveA(["account": "upd@example.net", "secret": secretUpdated])) == "not-found")
        _ = ask("candidates", ["origin": site, "vault": a.id.uuidString])
        verify("after this page's list, the update goes through", saveA(["account": "upd@example.net", "secret": secretUpdated])["result"] as? String == "updated")
        let updated = session.store(for: a.id)!.items().first { $0.id == seeded.id }!
        let sameFields: Bool = updated.title == seeded.title && updated.account == seeded.account && updated.website == seeded.website
            && updated.notes == seeded.notes && updated.otpSecret == seeded.otpSecret
        verify("an update changes the password only: same item, title, username, website, notes",
               countA() == beforeUpdate && updated.secret == secretUpdated && sameFields)
        verify("the old password is kept in the history, as the app keeps it", session.store(for: a.id)!.previousPasswords(of: seeded.id).map { $0.password } == [secretOld])
        let others = session.store(for: a.id)!.items().filter { $0.id != seeded.id }.map(\.secret).sorted()
        verify("no other login changed", !others.contains(secretUpdated) && !others.contains(secretOld))

        let beforeHostile = countA()
        let hostileAccounts: [Any] = ["", "   ", "a\nb", "a\r\nb", "a\u{202E}b", "a\u{2066}b", "a\u{200B}b", "a\u{200D}b", "a\u{0}b", "a\u{2028}b", "a\u{85}b", "a\u{E000}b",
                                      "a\tb", String(repeating: "x", count: 321), String(repeating: "x", count: 10_000), 7, NSNull(), true, ["a"], ["a": 1]]
        verify("hostile or over-long accounts are refused and write nothing",
               hostileAccounts.allSatisfy { error(saveA(["account": $0])) == "unsupported" } && countA() == beforeHostile)
        verify("secrets that are empty, mistyped or over 1024 are refused and write nothing",
               ["", 7, NSNull(), ["x"], String(repeating: "L", count: 1025), String(repeating: "L", count: 10_000)].allSatisfy { error(saveA(["secret": $0])) == "unsupported" } && countA() == beforeHostile)
        verify("a page that cannot be filled is not saved for",
               ["http://gitforge.example", "http://192.168.0.7", "ftp://gitforge.example", "https://user:pw@gitforge.example", "https://", "", "https://\(String(repeating: "a", count: 300)).example"]
                .allSatisfy { error(saveA(["origin": $0])) == "forbidden" } && error(saveA(["origin": 3])) == "forbidden" && countA() == beforeHostile)
        verify("the longest username and password are saved",
               saveA(["account": String(repeating: "x", count: 320), "secret": secretLong])["result"] as? String == "created" && countA() == beforeHostile + 1)
        verify("localhost may be saved for over http", saveA(["origin": "http://localhost:8080", "account": "local@example.net"])["result"] as? String == "created")
        verify("two saves of one new login at once are one login: the second finds it, was never offered it, and changes nothing", {
            let first = saveA(["account": "twin@example.net", "secret": "Twin-1"])
            let second = saveA(["account": "twin@example.net", "secret": "Twin-2"])
            return first["result"] as? String == "created" && error(second) == "not-found"
                && session.store(for: a.id)!.items().filter { $0.account == "twin@example.net" }.map(\.secret) == ["Twin-1"]
        }())
        verify("the saves register A's AutoFill suggestions", VaultIdentities.held.contains { $0.hasPrefix(a.id.uuidString + "/") })

        // The race: A locks between the search and the fill. A plain error, not another vault's data.
        let search = ask("search", ["origin": site, "query": "gitforge", "vault": a.id.uuidString])
        let ref = ((search["results"] as? [[String: Any]])?.first?["ref"] as? String) ?? ""
        verify("the search found something to fill", !ref.isEmpty)
        session.lock(a.id)
        verify("locking a vault empties the ledger", BrowserProtocol.ledger.count == 0)
        let afterLock = ask("credential", ["ref": ref, "origin": site, "vault": a.id.uuidString])
        verify("a lock between the search and the fill: locked, no data", error(afterLock) == "locked" && afterLock["secret"] == nil)
        let raced = ask("credential", ["ref": ref, "origin": site, "vault": a.id.uuidString])
        verify("locked between search and fill: a plain locked error, no data", error(raced) == "locked" && raced["secret"] == nil && raced["fields"] == nil && !"\(raced)".contains(secretA))
        verify("B is not asked in A's place, and still serves", titles(ask("candidates", ["origin": site, "vault": b.id.uuidString])) == ["Gitforge (B)"])
        verify("a locked vault lists, searches and saves nothing",
               error(ask("candidates", ["origin": site, "vault": a.id.uuidString])) == "locked"
               && error(ask("search", ["origin": site, "query": "git", "vault": a.id.uuidString])) == "locked"
               && error(ask("save", ["origin": site, "account": "late@example.net", "secret": "x", "vault": a.id.uuidString])) == "locked")
        verify("the list says A is locked, B open, order unchanged, nothing else locked",
               !states()[0].hasPrefix("Fill A:open") && states()[1].hasPrefix("Fill B:open") && order() == before && session.isOpen(b.id))
        verify("switching the shown vault locks nothing and keeps the order",
               ask("switch-vault", ["vault": a.id.uuidString])["ok"] as? Bool == true && session.reference?.id == a.id && session.isOpen(b.id) && order() == before
               && titles(ask("candidates", ["origin": site, "vault": b.id.uuidString])) == ["Gitforge (B)"])
        verify("a vault that is not open is not shown as open after a switch", !states()[0].hasPrefix("Fill A:open"))

        // Hostile names: one safe line in the list, cut.
        let hostile = "Wo\u{202E}rk\nTaxes\u{200B}" + String(repeating: "x", count: 300)
        try await session.create(name: hostile, credentials: .init(password: password), items: [])
        let listed = (ask("vaults")["vaults"] as? [[String: Any]] ?? []).map { $0["name"] as? String ?? "" }
        verify("a hostile vault name is one safe, short line in the list", listed.count == 3 && !listed[2].contains("\n") && !listed[2].contains("\u{202E}")
               && !listed[2].contains("\u{200B}") && listed[2].count <= DisplayText.maxLength && listed[2].hasPrefix("Work"))
        verify("the list never carries a login or a password", !"\(ask("vaults"))".contains(secretA) && !"\(ask("vaults"))".contains(secretB))

        // Nothing secret in any reply or state file.
        verify("no secret in any reply but a fill that asked for it: no password, no login secret, in any list, search, save or error",
               ![password, secretA, secretB, secretNew, secretOld, secretUpdated, secretLong].contains(where: transcript.contains))
        var leaked = false
        let root = VaultFiles.storageRoot
        for path in (try? FileManager.default.subpathsOfDirectory(atPath: root.path)) ?? [] where !path.hasSuffix(".kdbx") {
            let file = root.appendingPathComponent(path)
            guard let data = try? Data(contentsOf: file) else { continue }
            let text = String(decoding: data, as: UTF8.self)
            if [password, secretA, secretB, secretNew, secretOld, secretUpdated, secretLong].contains(where: text.contains) { leaked = true; print("leak in \(file.path)") }
        }
        verify("no secret in any state file", !leaked)

        // The vault locks after the request was checked and before it is written: a plain locked error, nothing written, and it
        // opens again as it was. The service locks the vault just before the write, which is the latest moment the race can fall.
        final class LocksBeforeSave: BrowserVaultService, @unchecked Sendable {
            let inner: SessionVaultService
            let session: VaultSession
            init(inner: SessionVaultService, session: VaultSession) { self.inner = inner; self.session = session }
            func vaults() -> [BrowserVault] { inner.vaults() }
            func switchVault(id: String) -> BrowserVaultOutcome { inner.switchVault(id: id) }
            func unlockVault(id: String) -> BrowserUnlockOutcome { inner.unlockVault(id: id) }
            var servesCredentials: Bool { true }
            func items(vault id: String) -> [VaultItem]? { inner.items(vault: id) }
            func reference(for item: VaultItem) -> String { inner.reference(for: item) }
            func save(_ item: VaultItem, vault id: String) -> Bool {
                MainActor.assumeIsolated { if let target = UUID(uuidString: id) { session.lock(target) } }
                return inner.save(item, vault: id)
            }
        }
        let held = BrowserProtocol.vaultService
        let countB = session.store(for: b.id)?.items().count ?? -1
        BrowserProtocol.vaultService = LocksBeforeSave(inner: SessionVaultService(session: session), session: session)
        let late = ask("save", ["origin": site, "account": "late-lock@example.net", "secret": secretNew, "vault": b.id.uuidString])
        BrowserProtocol.vaultService = held
        verify("locked between the check and the write: locked, nothing written", error(late) == "locked" && !session.isOpen(b.id))
        session.show(b.id)
        try await session.unlock(credentials: .init(password: password), savingQuickUnlockKey: false)
        verify("the vault opens again with exactly what it had", session.store(for: b.id)?.items().count == countB
               && !(session.store(for: b.id)?.items().contains { $0.account == "late-lock@example.net" } ?? true))
    } catch {
        failed += 1
        print("FAIL open vault filling threw \(error)")
    }
    reset()

    // Identities: each vault's suggestions are kept apart, tied to the vault, and removed one vault at a time.
    do {
        _ = VaultIdentities.takeCalls()
        let one = VaultItem(kind: .login, title: "One", account: "a", website: "one.example", secret: "s")
        let two = VaultItem(kind: .login, title: "Two", account: "b", website: "two.example", secret: "s")
        try await session.create(name: "Id A", credentials: .init(password: password), items: [one])
        let a = session.reference!
        try await session.create(name: "Id B", credentials: .init(password: password), items: [two])
        let b = session.reference!
        VaultIdentities.removeAll()
        _ = VaultIdentities.takeCalls()
        VaultIdentities.register(vault: a.id, items: [one])
        VaultIdentities.register(vault: b.id, items: [two])
        verify("every open vault's suggestions are held together, each tied to its vault",
               Set(VaultIdentities.held) == [IdentityRecord.make(vault: a.id, item: one.id), IdentityRecord.make(vault: b.id, item: two.id)])
        verify("registering a vault again replaces only its own", {
            VaultIdentities.register(vault: a.id, items: [])
            let kept = VaultIdentities.held == [IdentityRecord.make(vault: b.id, item: two.id)]
            VaultIdentities.register(vault: a.id, items: [one])
            return kept && VaultIdentities.held.count == 2
        }())
        _ = VaultIdentities.takeCalls()
        session.lock(a.id)
        verify("locking a vault leaves every vault's suggestions registered (the system keeps them while locked)",
               VaultIdentities.takeCalls().isEmpty && VaultIdentities.held.count == 2)
        session.lock(b.id)
        session.remove(a.id)
        let calls = VaultIdentities.takeCalls()
        verify("removing a vault removes only its suggestions, never everything", calls == [.removed(vault: a.id)] && !calls.contains(.removedAll)
               && VaultIdentities.held == [IdentityRecord.make(vault: b.id, item: two.id)])
        session.remove(b.id)
        verify("removing the last vault leaves none", VaultIdentities.held.isEmpty)

        let item = UUID(), vault = UUID()
        verify("a record names its vault and its item", IdentityRecord.parse(IdentityRecord.make(vault: vault, item: item)).map { $0.vault == vault && $0.item == item } == true)
        let hostile: [String?] = [nil, "", "x", item.uuidString, "\(vault)/\(item)/\(item)", "\(vault)/", "/\(item)", "\(vault)\n/\(item)", "\(vault)/\(item)\u{202E}",
                                  String(repeating: "a", count: 100_000), "../\(item)", "\(vault)/../\(item)"]
        verify("a record that is not exactly a vault and an item is refused", hostile.allSatisfy { IdentityRecord.parse($0) == nil })
        var registry = IdentityRegistry<Int>()
        registry.set([1, 2], for: a.id); registry.set([3], for: b.id)
        verify("the registry merges, replaces and removes one vault at a time", registry.merged.count == 3 && { registry.set([9], for: a.id); return registry.merged.contains(9) && !registry.merged.contains(1) }()
               && registry.remove(a.id) && registry.merged == [3] && !registry.remove(a.id) && !registry.isEmpty && { registry.removeAll(); return registry.isEmpty }())
    } catch {
        failed += 1
        print("FAIL identities threw \(error)")
    }
    reset()
    return failed
}
