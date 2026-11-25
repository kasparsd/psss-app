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
    var transcript = ""
    func ask(_ type: String, _ fields: [String: Any] = [:]) -> [String: Any] {
        let reply = BrowserProtocol.handle(["v": BrowserProtocol.version, "id": "t", "type": type].merging(fields) { $1 })
        // Everything the host would send back, kept to look for a secret that should never be there. The one reply that is meant to
        // carry a password is a successful `credential`; it is checked on its own.
        if !(type == "credential" && reply["ok"] as? Bool == true) { transcript += "\(reply)\n" }
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

        // The race: A locks between the search and the fill. A plain error, not another vault's data.
        let search = ask("search", ["origin": site, "query": "gitforge", "vault": a.id.uuidString])
        let ref = ((search["results"] as? [[String: Any]])?.first?["ref"] as? String) ?? ""
        verify("the search found something to fill", !ref.isEmpty)
        session.lock(a.id)
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
               ![password, secretA, secretB, secretNew].contains(where: transcript.contains))
        var leaked = false
        let root = VaultFiles.storageRoot
        for path in (try? FileManager.default.subpathsOfDirectory(atPath: root.path)) ?? [] where !path.hasSuffix(".kdbx") {
            let file = root.appendingPathComponent(path)
            guard let data = try? Data(contentsOf: file) else { continue }
            let text = String(decoding: data, as: UTF8.self)
            if [password, secretA, secretB, secretNew].contains(where: text.contains) { leaked = true; print("leak in \(file.path)") }
        }
        verify("no secret in any state file", !leaked)
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
