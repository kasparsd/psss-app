import Foundation

/// When each item was last copied or filled and how often, kept on this device only.
///
/// Use counts never go into the vault file: a write per copy would rotate out rollback copies and cause sync conflicts on
/// every other device. One small JSON file per vault lives under the shared storage root, so the app and the AutoFill
/// extension, which are separate processes, see the same counts. It holds item identifiers, dates and counts, no secrets.
/// Each update reads the file fresh before writing it back.
enum UsageLog {
    struct Entry: Codable, Equatable, Sendable {
        var lastUsed: Date
        var useCount: Int
    }

    static var directory: URL { VaultFiles.storageRoot.appendingPathComponent("Usage", isDirectory: true) }

    static func fileURL(for vault: UUID) -> URL { directory.appendingPathComponent("\(vault.uuidString).json") }

    static func load(for vault: UUID) -> [UUID: Entry] {
        guard let data = try? Data(contentsOf: fileURL(for: vault)),
              let stored = try? JSONDecoder().decode([String: Entry].self, from: data) else { return [:] }
        return Dictionary(stored.compactMap { key, value in UUID(uuidString: key).map { ($0, value) } }, uniquingKeysWith: { first, _ in first })
    }

    /// Counts one more use of the item, now.
    static func record(_ id: UUID, in vault: UUID, at date: Date = .now) {
        var all = load(for: vault)
        all[id] = Entry(lastUsed: date, useCount: (all[id]?.useCount ?? 0) + 1)
        write(all, for: vault)
    }

    /// Drops the entry of a deleted item.
    static func remove(_ id: UUID, in vault: UUID) {
        var all = load(for: vault)
        guard all.removeValue(forKey: id) != nil else { return }
        write(all, for: vault)
    }

    /// Drops the entries of deleted items, reading and writing the log once.
    static func remove(_ ids: some Sequence<UUID>, in vault: UUID) {
        var all = load(for: vault)
        var changed = false
        for id in ids where all.removeValue(forKey: id) != nil { changed = true }
        if changed { write(all, for: vault) }
    }

    /// Deletes the whole log, when the vault is forgotten.
    static func erase(for vault: UUID) { try? FileManager.default.removeItem(at: fileURL(for: vault)) }

    private static func write(_ all: [UUID: Entry], for vault: UUID) {
        let stored = Dictionary(uniqueKeysWithValues: all.map { ($0.key.uuidString, $0.value) })
        guard let data = try? JSONEncoder().encode(stored) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: fileURL(for: vault), options: VaultFiles.writeOptions)
    }
}
