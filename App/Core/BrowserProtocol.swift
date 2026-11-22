import CryptoKit
import Foundation

/// The browser extension protocol, shared by the native messaging host (Chrome, Firefox) and the
/// Safari app extension, so every browser gets the same answers and the same origin rules.
/// Messages are JSON objects: see `Extensions/Browser/src/lib/protocol.js` and docs/browser-extension.md.
///
/// PROTOTYPE LIMITS. This reads the sample vault and the saved-login file directly and answers
/// without asking the app. The shipping design keeps the vault key out of the host: it relays each
/// request to the running app, which verifies the peer, unlocks and approves release.
enum BrowserProtocol {
    static let version = 1

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

    static func handle(_ request: [String: Any]) -> [String: Any] {
        let id = request["id"] as? String ?? ""
        func fail(_ error: String) -> [String: Any] { ["v": version, "id": id, "ok": false, "error": error] }
        func ok(_ fields: [String: Any] = [:]) -> [String: Any] {
            fields.merging(["v": version, "id": id, "ok": true]) { $1 }
        }

        guard request["v"] as? Int == version else { return fail("unsupported") }

        switch request["type"] as? String {
        case "ping":
            return ok(["host": "psss", "protocol": version])

        case "candidates":
            guard let origin = request["origin"] as? String, let host = fillableHost(origin) else { return fail("forbidden") }
            let requested = SharedVault.host(host)
            let matches = SharedVault.allItems.filter { SharedVault.matches($0, host: requested) }
            return ok(["candidates": matches.map { ["ref": reference($0), "title": $0.displayTitle, "account": $0.account] }])

        case "search":
            // Metadata only. `matches` tells the popup which results belong to this page.
            guard let origin = request["origin"] as? String, let host = fillableHost(origin) else { return fail("forbidden") }
            let query = (request["query"] as? String ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty, query.count <= 100 else { return ok(["results": [Any]()]) }
            let requested = SharedVault.host(host)
            let hits = SharedVault.allItems
                .filter { $0.kind == .login && !$0.secret.isEmpty
                    && [$0.displayTitle, $0.account, $0.website].contains { $0.lowercased().contains(query) } }
                .prefix(20)
            return ok(["results": hits.map {
                ["ref": reference($0), "title": $0.displayTitle, "account": $0.account, "website": $0.website,
                 "matches": SharedVault.matches($0, host: requested)] as [String: Any]
            }])

        case "generate":
            return ok(["password": PasswordGenerator.strong()])

        case "save":
            // Creates a login, or updates the secret of the saved login for the same site and account.
            guard let origin = request["origin"] as? String, let host = fillableHost(origin) else { return fail("forbidden") }
            guard let account = (request["account"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !account.isEmpty, account.count <= 320,
                  let secret = request["secret"] as? String, !secret.isEmpty, secret.count <= 1024 else { return fail("unsupported") }
            let website = SharedVault.host(host)
            if var existing = SharedVault.loadSaved().first(where: {
                $0.kind == .login && SharedVault.host($0.website) == website && $0.account == account
            }) {
                existing.secret = secret
                SharedVault.save(existing)
                return ok(["result": "updated"])
            }
            SharedVault.save(VaultItem(kind: .login, account: account, website: website, secret: secret))
            return ok(["result": "created"])

        case "credential":
            guard let origin = request["origin"] as? String, let host = fillableHost(origin),
                  let ref = request["ref"] as? String else { return fail("forbidden") }
            guard let item = SharedVault.allItems.first(where: { reference($0) == ref }) else { return fail("not-found") }
            // Recheck the origin here. A reference alone never releases a secret. `manual` is the
            // person's explicit choice of a login saved for another site, confirmed in the popup.
            // The shipping app asks for approval itself instead of trusting this flag.
            let manual = request["manual"] as? Bool == true
            guard manual || SharedVault.matches(item, host: SharedVault.host(host)) else { return fail("forbidden") }
            return ok(["account": item.account, "secret": item.secret])

        default:
            return fail("unsupported")
        }
    }

}
