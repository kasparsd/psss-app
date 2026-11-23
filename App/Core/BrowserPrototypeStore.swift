import Foundation

/// The browser extension prototype's plain-text login file. Used ONLY by `BrowserProtocol`, and only inside the native messaging
/// host, which sets `directory` to a prototype folder. In the apps and the Safari extension `directory` stays nil, so nothing is
/// ever read from or written to this file there. The prototype is frozen; it is replaced by a relay to the unlocked app
/// (docs/browser-extension.md). Nothing here is encrypted: never point it at real credentials.
enum BrowserPrototypeStore {
    /// Set once by the native host process at start. Nil everywhere else.
    nonisolated(unsafe) static var directory: URL?

    static var isAvailable: Bool { directory != nil }

    private static var fileURL: URL? { directory?.appendingPathComponent("saved-logins.json") }

    static func loadSaved() -> [VaultItem] {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([VaultItem].self, from: data)) ?? []
    }

    /// The sample items plus the saved ones. Empty when the store is not available.
    static var allItems: [VaultItem] { isAvailable ? SampleVault.items + loadSaved() : [] }

    static func save(_ item: VaultItem) {
        guard let url = fileURL else { return }
        var saved = loadSaved()
        saved.removeAll { $0.id == item.id }
        saved.append(item)
        try? JSONEncoder().encode(saved).write(to: url, options: .atomic)
    }
}
