import Foundation

/// The browser extension prototype's plain-text login file. Used ONLY by `BrowserProtocol`, and only inside the native messaging
/// host, which sets `directory` to a prototype folder. In the apps and the Safari extension `directory` stays nil, so nothing is
/// ever read from or written to this file there. The prototype is frozen; it is replaced by a relay to the unlocked app
/// (docs/browser-extension.md). Nothing here is encrypted: never point it at real credentials.
enum BrowserPrototypeStore {
    /// Set once by the native host process at start. Nil everywhere else.
    nonisolated(unsafe) static var directory: URL?

    static var isAvailable: Bool { directory != nil }

    /// The logins saved into one vault. The first vault keeps the original file name; any other has its own file, named only
    /// from a vault id made of letters, digits and dashes (the id comes from the prototype's own list, never from a request).
    private static func fileURL(vault: String) -> URL? {
        guard let directory else { return nil }
        if vault == "passwords" { return directory.appendingPathComponent("saved-logins.json") }
        guard !vault.isEmpty, vault.count <= 40, vault.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else { return nil }
        return directory.appendingPathComponent("saved-logins-\(vault).json")
    }

    static func loadSaved(vault: String = "passwords") -> [VaultItem] {
        guard let url = fileURL(vault: vault), let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([VaultItem].self, from: data)) ?? []
    }

    /// The prototype's vaults (see `PrototypeVaultService`). Nil when the store is not available.
    static var vaultService: PrototypeVaultService? { directory.map(PrototypeVaultService.init) }

    /// The second sample vault's logins: a work copy of one site the first has no login for, and one it has.
    private static let workItems: [VaultItem] = [
        VaultItem(kind: .login, title: "Gitforge (work)", account: "sam@harbor.example", website: "gitforge.example", secret: "Demo-only-Work1!"),
        VaultItem(kind: .login, title: "Harbor Ledger", account: "sam@harbor.example", website: "ledger.harbor.example", secret: "Demo-only-Work2!"),
    ]

    /// One vault's items: the sample items plus the saved ones (first vault), the work vault's, or only what was saved into another
    /// vault. The caller has checked that the vault is open (`PrototypeVaultService.items`).
    static func items(vault id: String) -> [VaultItem] {
        let saved = loadSaved(vault: id)
        let base: [VaultItem]
        switch id {
        case "passwords": base = SampleVault.items
        case "work": base = workItems
        default: base = []
        }
        // An update of a built-in login is saved as a copy of it, which replaces the original (same site and account).
        return base.filter { original in
            !saved.contains { $0.kind == original.kind && $0.account == original.account && SharedVault.host($0.website) == SharedVault.host(original.website) }
        } + saved
    }

    @discardableResult
    static func save(_ item: VaultItem, vault: String = "passwords") -> Bool {
        guard let url = fileURL(vault: vault) else { return false }
        var saved = loadSaved(vault: vault)
        saved.removeAll { $0.id == item.id }
        saved.append(item)
        return (try? JSONEncoder().encode(saved).write(to: url, options: .atomic)) != nil
    }
}
