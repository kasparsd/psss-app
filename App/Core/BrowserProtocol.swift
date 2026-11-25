import CryptoKit
import Foundation

/// The browser extension protocol, shared by the native messaging host (Chrome, Firefox) and the
/// Safari app extension, so every browser gets the same answers and the same origin rules.
/// Messages are JSON objects: see `Extensions/Browser/src/lib/protocol.js` and docs/browser-extension.md.
///
/// PROTOTYPE LIMITS. In the native host this reads the sample vault and the prototype's saved-login file (`BrowserPrototypeStore`)
/// directly and answers without asking the app. Anywhere else (the apps and the Safari extension) there is no such file, and
/// every request that would read or write a credential is answered `unsupported`. The shipping design keeps the vault key out of the host: it relays each
/// request to the running app, which verifies the peer, unlocks and approves release.
enum BrowserProtocol {
    /// 5 (2026-11-25): the host relays to the running app (`docs/browser-extension.md`, "Host and app"), which adds the errors
    /// `not-running` (no app is serving), `not-verified` (the app or the host could not be shown to be ours), `timeout` and `busy`
    /// (the relay's limits), and `ping` says `app: true` when the app answered. Everything else is as 4.
    /// 4 (2026-11-25): several vaults can be open at once. `candidates`, `search`, `credential`, `card-candidates` and `card` name the
    /// `vault` they read (any open vault; a locked one answers `locked`, never another vault's data), `save` writes into any open
    /// vault, `switch-vault` only changes which vault the app shows (nothing locks) and `active` in `vaults` is only the popup's
    /// default. 3 (2026-11-24): `vaults` answers each vault's `state` (and `reason`) instead of a `locked` flag, `unlock-vault` is new,
    /// `switch-vault` only makes the vault current (it no longer asks for the unlock), `save` carries the `vault` it saves into and
    /// `candidates` carry the `website`. 2 added field-aware `search`, `vaults` and `switch-vault`. Hosts and extensions of
    /// different versions are not mixed: a mismatch is `unsupported`.
    static let version = RelayLimits.protocolVersion

    /// Who holds the vaults in this process. The native host installs the prototype's, the Safari app extension the stored list
    /// (read only). Nil answers `vaults` and `switch-vault` with `unsupported`.
    nonisolated(unsafe) static var vaultService: BrowserVaultService?

    /// What this process has shown the popup, and so may release (`OfferLedger`). One for the process: `SessionVaultService` empties
    /// it when a vault locks, the relay launcher on sleep, screen lock and quit. Tests replace it to inject a clock.
    nonisolated(unsafe) static var ledger = OfferLedger()

    // MARK: Origin rule, mirrored from the extension (src/lib/origin.js). Both sides enforce it.

    static func fillableHost(_ origin: String) -> String? {
        guard let url = URL(string: origin), let host = url.host, url.user == nil, url.password == nil else { return nil }
        // A host that normalizes to empty (see `SiteMatch`) is never a fillable origin: no match, no save, no release.
        guard !SharedVault.host(host).isEmpty else { return nil }
        if url.scheme == "https" { return host }
        if url.scheme == "http", ["localhost", "127.0.0.1", "::1"].contains(host) { return host }
        return nil
    }

    /// A reference that survives process restarts. Chrome and Firefox start a new host per message,
    /// and the sample vault makes new random item IDs each launch, so the prototype derives the
    /// reference from website and account. A real vault uses its stable record identifier.
    static func reference(_ item: VaultItem) -> String {
        SHA256.hash(data: Data("\(item.website)|\(item.account)".utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    /// What a request may not read or write unless the vault it names is open: `locked` when the person can open it (Touch ID or
    /// the vault password), `not-available` when the file cannot be used, `not-found` for a vault that is not named or not known.
    private static let vaultRequests = ["candidates", "search", "save", "credential", "card-candidates", "card"]

    private static func vaultsReply(_ service: BrowserVaultService) -> [String: Any] { ["vaults": service.vaults().map(\.json)] }

    /// The names the protocol uses for the search fields (`SearchField` is the app's, with localized labels).
    private static func searchName(_ field: SearchField) -> String {
        switch field { case .name: "name"; case .website: "website"; case .username: "username" }
    }

    private static func searchField(_ name: String) -> SearchField? {
        SearchField.allCases.first { searchName($0) == name }
    }

    /// Sample cards have a fixed order across native-host invocations. The connected vault uses record IDs.
    private static func sampleCardReference(_ index: Int) -> String { "sample-card-\(index)" }

    /// A JSON `true` and nothing else: the number 1 reads as a Bool through `as? Bool`, and must not be taken for the flag.
    private static func isTrue(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
        return number.boolValue
    }

    static func handle(_ request: [String: Any]) -> [String: Any] {
        let id = request["id"] as? String ?? ""
        func fail(_ error: String) -> [String: Any] { ["v": version, "id": id, "ok": false, "error": error] }
        func ok(_ fields: [String: Any] = [:]) -> [String: Any] {
            fields.merging(["v": version, "id": id, "ok": true]) { $1 }
        }

        guard request["v"] as? Int == version else { return fail("unsupported") }

        let type = request["type"] as? String
        // No credential is served or stored unless the service holds logins (the native host's prototype file, or the app's session).
        // The sample cards exist only in the prototype.
        var service: BrowserVaultService?
        if let type, vaultRequests.contains(type) {
            guard let held = vaultService, held.servesCredentials else { return fail("unsupported") }
            if type.hasPrefix("card"), !BrowserPrototypeStore.isAvailable { return fail("unsupported") }
            service = held
        }

        /// The vault a request names, when it is open: its id and its items now. Anything else is a plain error and nothing is served:
        /// a vault that closed since the popup listed it answers `locked` (or `not-available`), and no other vault is read instead.
        enum Named { case open(String, [VaultItem]), refused([String: Any]) }
        func openVault(_ held: BrowserVaultService) -> Named {
            guard let vault = request["vault"] as? String, !vault.isEmpty, vault.count <= 64,
                  let listed = held.vaults().first(where: { $0.id == vault }) else { return .refused(fail("not-found")) }
            guard listed.isOpen else { return .refused(fail(listed.state.isAvailable ? "locked" : "not-available")) }
            guard let items = held.items(vault: vault) else { return .refused(fail("locked")) }
            return .open(vault, items)
        }
        var opened: (vault: String, items: [VaultItem])?
        if let held = service, type != "save" {
            switch openVault(held) {
            case .refused(let error): return error
            case .open(let vault, let items): opened = (vault, items)
            }
        }
        let items = opened?.items ?? []
        func refOf(_ item: VaultItem) -> String { service?.reference(for: item) ?? reference(item) }

        switch type {
        case "ping":
            return ok(["host": "psss", "protocol": version])

        case "candidates":
            guard let origin = request["origin"] as? String, let host = fillableHost(origin) else { return fail("forbidden") }
            let requested = SharedVault.host(host)
            let matches = items.filter {
                $0.fillValue(for: .password) != nil && SharedVault.matches($0, host: requested)
            }
            ledger.offer(matches.map(refOf), vault: opened?.vault ?? "", host: requested, searched: false)
            return ok(["candidates": matches.map { ["ref": refOf($0), "title": $0.displayTitle, "account": $0.visibleAccount,
                                                    "website": $0.visibleWebsite, "passkey": $0.passkey != nil] as [String: Any] }])

        case "search":
            // Metadata only. `matches` says whether a result belongs to this page. The search is the app's (`ItemSearch`): the
            // text is looked for in the chosen fields (none chosen: all three), `counts` says how many logins have it in each
            // field whatever is chosen, and each result says which field it was found in and which part of it to set in bold.
            guard let origin = request["origin"] as? String, let host = fillableHost(origin) else { return fail("forbidden") }
            let query = (request["query"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let counts = ["name": 0, "website": 0, "username": 0]
            guard !query.isEmpty, query.count <= 100 else { return ok(["results": [Any](), "counts": counts, "total": 0]) }
            let chosen = Set((request["fields"] as? [String] ?? []).compactMap(searchField))
            let requested = SharedVault.host(host)
            let logins = items.filter { $0.kind == .login && !$0.secret.isEmpty }
            let found = logins
                .filter { ItemSearch.matches($0, query: query, in: chosen) }
                .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            let perField = ItemSearch.counts(logins, query: query)
            // Every result shown is offered for this page, the ones saved for other sites too: only a login the person's own search
            // returned can be filled as "Other Matches".
            ledger.offer(found.prefix(20).map(refOf), vault: opened?.vault ?? "", host: requested, searched: true)
            return ok([
                "results": found.prefix(20).map { item -> [String: Any] in
                    var row: [String: Any] = ["ref": refOf(item), "title": item.displayTitle, "account": item.visibleAccount,
                                              "website": item.visibleWebsite, "matches": SharedVault.matches(item, host: requested),
                                              "passkey": item.passkey != nil]
                    if let hit = ItemSearch.hit(of: item, query: query, chosen: chosen) {
                        row["found"] = searchName(hit.field)
                        row["hit"] = hit.text
                        if let range = hit.range { row["hitRange"] = [range.lowerBound, range.count] }
                    }
                    return row
                },
                "counts": Dictionary(uniqueKeysWithValues: SearchField.allCases.map { (searchName($0), perField[$0] ?? 0) }),
                "total": found.count,
            ])

        case "vaults":
            guard let service = vaultService else { return fail("unsupported") }
            return ok(vaultsReply(service))

        case "switch-vault":
            // Makes the vault the one the app shows. No vault locks and none unlocks: the popup shows Unlock when the new vault is
            // locked. The reply carries the new list so the popup draws the states as they are now.
            guard let service = vaultService else { return fail("unsupported") }
            guard let vault = request["vault"] as? String, !vault.isEmpty, vault.count <= 64 else { return fail("not-found") }
            switch service.switchVault(id: vault) {
            case .switched: return ok(vaultsReply(service))
            case .notFound: return fail("not-found")
            case .unsupported: return fail("unsupported")
            }

        case "unlock-vault":
            // Unlocks the current vault: Touch ID when it is ready, otherwise the app is asked to come forward on that vault's lock
            // screen, or the answer is `needs-app`. Every answer except the input errors carries the vault list, so the popup (or
            // the next one, after the Touch ID prompt closed it) draws the state as it is now. No secret is ever in a reply.
            guard let service = vaultService else { return fail("unsupported") }
            guard let vault = request["vault"] as? String, !vault.isEmpty, vault.count <= 64 else { return fail("not-found") }
            let list = vaultsReply(service)
            switch service.unlockVault(id: vault) {
            case .unlocked: return ok(vaultsReply(service))
            case .cameForward: return ok(vaultsReply(service)).merging(["app": "opened"]) { $1 }
            case .needsApp: return fail("needs-app").merging(vaultsReply(service)) { $1 }
            case .cancelled: return fail("cancelled").merging(vaultsReply(service)) { $1 }
            case .failed: return fail("failed").merging(vaultsReply(service)) { $1 }
            case .notAvailable: return fail("not-available").merging(vaultsReply(service)) { $1 }
            case .notFound: return fail("not-found")
            case .notCurrent: return fail("forbidden").merging(list) { $1 }
            case .unsupported: return fail("unsupported")
            }

        case "generate":
            return ok(["password": PasswordGenerator.strong()])

        case "save":
            // Creates a login in the vault the request names, or updates the password of the saved login there for the same site and
            // account. Any open vault can be written; one that is not open is not (`locked` or `not-available`, `not-found` for an
            // unknown one), so a popup that is out of date never writes into another vault than the one its button names.
            guard let origin = request["origin"] as? String, let host = fillableHost(origin) else { return fail("forbidden") }
            guard let account = (request["account"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !account.isEmpty, account.count <= 320,
                  let secret = request["secret"] as? String, !secret.isEmpty, secret.count <= 1024 else { return fail("unsupported") }
            guard let held = service else { return fail("unsupported") }
            let website = SharedVault.host(host)
            let vault: String
            var existing: VaultItem?
            switch openVault(held) {
            case .refused(let error): return error
            case .open(let id, let stored):
                vault = id
                existing = stored.first { $0.kind == .login && SharedVault.host($0.website) == website && $0.account == account }
            }
            if var existing {
                // Only the password changes: never the username, title or website.
                existing.secret = secret
                guard held.save(existing, vault: vault) else { return fail("locked") }
                return ok(["result": "updated", "vault": vault])
            }
            guard held.save(VaultItem(kind: .login, account: account, website: website, secret: secret), vault: vault) else { return fail("locked") }
            return ok(["result": "created", "vault": vault])

        case "credential":
            guard let origin = request["origin"] as? String, let host = fillableHost(origin),
                  let ref = request["ref"] as? String else { return fail("forbidden") }
            guard ref.count <= 64, let item = items.first(where: { $0.kind == .login && refOf($0) == ref }),
                  let password = item.fillValue(for: .password) else { return fail("not-found") }
            // Recheck the origin here. A reference alone never releases a secret: it must be one this app showed for this page
            // (`ledger`) a moment ago. `manual` is the person's choice of a login saved for another site, in Other Matches; it is
            // released only for a login that a search on this page returned.
            let manual = isTrue(request["manual"])
            let requested = SharedVault.host(host)
            guard manual || SharedVault.matches(item, host: requested) else { return fail("forbidden") }
            guard let vault = opened?.vault, ledger.allows(ref: ref, vault: vault, host: requested, manual: manual) else { return fail("not-found") }
            let username = item.fillValue(for: .username) ?? ""
            let fields = [FieldRole.username.rawValue: username, FieldRole.password.rawValue: password]
            return ok(["account": username, "secret": password, "fields": fields])

        case "card-candidates":
            guard let origin = request["origin"] as? String, fillableHost(origin) != nil else { return fail("forbidden") }
            let cards = SampleVault.items.enumerated().compactMap { index, item -> [String: String]? in
                guard let raw = item.fillValue(for: .cardNumber) else { return nil }
                let lastFour = String(CardNumber.normalized(raw).suffix(4))
                return ["ref": sampleCardReference(index), "title": item.displayTitle, "account": "•• \(lastFour)"]
            }
            return ok(["candidates": cards])

        case "card":
            guard let origin = request["origin"] as? String, fillableHost(origin) != nil,
                  let ref = request["ref"] as? String else { return fail("forbidden") }
            guard let card = SampleVault.items.enumerated().first(where: { sampleCardReference($0.offset) == ref })?.element,
                  let raw = card.fillValue(for: .cardNumber) else { return fail("not-found") }
            let number = CardNumber.normalized(raw)
            guard (12...19).contains(number.count) else { return fail("not-found") }
            var fields = [FieldRole.cardNumber.rawValue: number]
            fields[FieldRole.cardholder.rawValue] = card.fillValue(for: .cardholder)
            if let expiry = card.fillValue(for: .expiry).flatMap(CardExpiry.parse) {
                fields[FieldRole.expiry.rawValue] = String(format: "%04d-%02d", expiry.year, expiry.month)
            }
            return ok(["fields": fields])

        default:
            return fail("unsupported")
        }
    }

}
